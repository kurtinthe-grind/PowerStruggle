import { Events } from "bf6-portal-utils/events";
import { Timers } from "bf6-portal-utils/timers";
import { Vectors } from "bf6-portal-utils/vectors";
import { PlayerLocations } from "bf6-portal-utils/player-locations";
import { PlayerUndeployFixer } from "bf6-portal-utils/player-undeploy-fixer";
import { log, logAdmin, safe, willLogDebug } from "./util/log";
import { healthFactor } from "./util/perf";
import { allPlayers, forgetTeamCache, isEnemyTeam, teamIdOf } from "./util/roster";
import { teamHandle } from "./teams";
import { AI_SPAWNERS } from "./objids";
import {
    claimBotName, expiredBotNames, initBotNames, lastExpiredBotName, releaseBotName, takeBotName
} from "./botnames";
import { bindBotStats, pushRow, statsOf, writeRow, PlayerStats } from "./stats";
import {
    BOT_BUNKER_SPAWN_CHANCE, BOT_CORPSE_SECONDS, BOT_COUNT_PER_TEAM, BOT_NAV_REACH_M,
    BOT_NAV_STUCK_PENALTY, BOT_NAV_WATER_PENALTY, BOT_DAMAGE_MULT, BOT_DRIVE_CHECK_MS,
    BOT_DRIVE_PROGRESS_M, BOT_INCOMING_DAMAGE, BOT_JUMP_S, BOT_RESPAWN_DELAY_MS, BOT_SLICE,
    BOT_SPAWN_PER_SWEEP, BOT_STUCK_MIN_M, BOT_STUCK_STRIKES, BOT_STUCK_WINDOW_MS,
    BOT_SWEEP_MS, BOT_TRACE, BOT_TRACE_MS, BOT_VEHICLE_APPROACH_MS, BOT_VEHICLE_DISMOUNT_M,
    BOT_VEHICLE_FREE_SEATS, BOT_VEHICLE_MAX_MS, BOT_VEHICLE_MIN_TRIP_M, BOT_VEHICLE_RADIUS_M,
    BOT_VEHICLE_BAN_MS, BOT_VEHICLE_SCAN_MS, BOT_VEHICLE_SEAT_M, BOT_VEHICLE_STUCK_M,
    BOT_VEHICLE_STUCK_MS, BOT_RESEAT_TRIES, BOT_STEER_REPEAT_MS,
    BOT_TELEPORT_DELAY_MS, BOT_RIDE_RADIUS_M, BOT_RIDE_SLOW_M, BOT_RIDE_DELIVER_M, BOT_RIDE_STILL_MS,
    BOT_RIDE_BAN_MS, BOT_ROW_REFRESH_MS, BOT_TEAM_SLOTS, BOT_PERSISTENT, BOT_REDEPLOY_S,
    BOT_REDEPLOY_WATCHDOG_MS, BOT_MAINTAIN_MS
} from "./config";
import {
    bunkerCapturePoint, distSqTo, dropOccupant, initBotObjectives, isOccupant, markOwnersDirty,
    nearestEnemyObjective, objectiveCount, objectiveKey, objectiveLabel, objectiveRadius,
    objectiveVector, ownersNeedRefresh, pickSpawnObjective, refreshOwners, refreshScoreSnapshot,
    releaseClaim
} from "./botobjectives";
import {
    BotMind, clearIntent, enterBattle, giveUp, inBattle, JOB_ROAM, newMind, noteMoveFailed, thinkBot
} from "./botbrain";
import { JOB_ATTACK } from "./botscore";
import {
    initNav, navActive, nodeDistSq, objectiveNode, penalizeLink
} from "./botnav";

// Custom AI_Spawner bot population. The spawner prefab carries no count or
// respawn property, so this module owns the whole lifecycle: an initial burst
// queue, a per-sweep spawn drain, death -> timed re-queue, and a registry the
// rest of the mod consults (UI suppression, nuke guard, prestige guard).
//
// Cost model: one Timers sweep per second. Each sweep drains at most
// BOT_SPAWN_PER_SWEEP spawns and re-thinks BOT_SLICE bots; a think costs one
// GetPosition (3 FFI) plus a behavior call only when the intent changed.
// Occupancy, ownership and deaths are event-driven - nothing is polled.

interface BotRec {
    pid: number;
    team: number;
    player: mod.Player;
    mind: BotMind;
    dead: boolean;
    // String-table key of the name this soldier was spawned with. Held so the
    // name can go back to the pool when the soldier leaves, since a name cannot
    // be read back off the player.
    nameKey: string;
    // Stuck tracking, by time rather than by think count (a capture flip
    // re-thinks every bot every second, which turned a "2 think" window into
    // 2 s). lastX/Y/Z is where the bot was when stillSince started (0: no
    // window yet); a window ends after BOT_STUCK_WINDOW_MS within
    // BOT_STUCK_MIN_M of that spot. strikes counts windows that have passed
    // without the bot escaping.
    lastX: number;
    lastY: number;
    lastZ: number;
    stillSince: number;
    strikes: number;
    // True while this bot is occupying a vehicle seat. Gates both the boarding
    // attempt and the position-based stuck detector, which cannot tell a parked
    // bot from a bot at the wheel.
    inVehicle: boolean;
    // Walking to a vehicle to board it: the vehicle, its ObjId (reservation key)
    // and when to give up. approachVid is -1 when not approaching.
    approachVeh: mod.Vehicle | undefined;
    approachVid: number;
    approachUntil: number;
    // Seated: when, and the vehicle position at the last stuck check. seatedAt
    // is 0 when not seated.
    seatedAt: number;
    seatX: number;
    seatY: number;
    seatZ: number;
    // Height at which it was seated: an aircraft still at that height and not
    // moving never took off.
    boardY: number;
    seatCheckAt: number;
    // Driver steering toward an objective: -1 when not steering. driveD is the
    // vehicle's distance to it at the last progress check.
    driveObj: number;
    driveD: number;
    driveCheckAt: number;
    // While the driver exit-and-reseat used for steering is in flight, the
    // sweep must not read the brief "not in a vehicle" as the bot leaving.
    reseatUntil: number;
    // Ejects that did not take. ForcePlayerExitVehicle was logged 41 times for
    // one bot in the 2026-10-02 playtest without it ever leaving the seat.
    ejectTries: number;
    // No vehicle boarding until this time, after an eject or a failed walk to
    // one. The 2026-10-02 log had bots walking to the same vehicle, timing out
    // and walking straight back to it for minutes.
    vehicleBanUntil: number;
    // Consecutive thinks spent in water while walking, for the swim trace.
    wetFor: number;
    // The last steer (steerDriver): vehicle, its ObjId, objective and time. Not
    // cleared by resetSeat, so the same steer is not repeated when the seat
    // state is reset under it: in the 2026-10-02 playtest one AH64 pilot was
    // exited and re-seated on every think for two minutes, and boat drivers
    // were left on foot, walked back, boarded and were steered again.
    steerVeh: mod.Vehicle | undefined;
    steerVid: number;
    steerObj: number;
    steerAt: number;
    // Direct re-seats tried after a steer left the driver on foot.
    reseatFails: number;
    // Set by our eject, cleared once the sweep sees the bot out of the
    // vehicle. Seen seated while it is still set, the eject did not take.
    ejectPending: boolean;
    // The current vehicle is an aircraft: never ejected from it.
    seatAir: boolean;
    // The vehicle it was seated in (ours or the engine's), to double-check an
    // IsInVehicle that says it is out.
    seatVeh: mod.Vehicle | undefined;
    // The vehicle walked to is a player's ride (any job, passenger seat).
    approachRide: boolean;
    // Riding as a passenger in a vehicle a human drives: the vehicle (kept
    // after the bot leaves it, for one re-seat), its ObjId, where it boarded,
    // and the 3D position at the last stillness check.
    rideVeh: mod.Vehicle | undefined;
    rideVid: number;
    boardX: number;
    boardZ: number;
    rideX: number;
    rideY: number;
    rideZ: number;
    rideCheckAt: number;
    rideReseats: number;
    // After being dropped off: no ride in that vehicle until rideBanUntil.
    rideBanVid: number;
    rideBanUntil: number;
    // Persistent bots: when it died (0 while alive), for the redeploy
    // watchdog.
    deadAt: number;
}

interface SpawnReq {
    team: number;
    // Name of the bot being respawned, so it comes back under the same name
    // and keeps its scoreboard row. Empty for a brand-new bot.
    nameKey: string;
}

const respawnPending: { [pid: number]: boolean } = {};

const bots: { [pid: number]: BotRec } = {};
const botOrder: number[] = [];
const botPidSet: { [pid: number]: boolean } = {};
const spawnerByTeam: { [team: number]: mod.Spawner[] } = { 1: [], 2: [] };
const spawnQueue: SpawnReq[] = [];

let sweepTimer: Timers.TimerID | null = null;
let cursor: number = 0;
let spawnRound: number = 0;
let fixerWired: boolean = false;
let fullRethink: boolean = false;
// Named distinctly rather than a third generic "inited": the bundler flattens
// every module into one scope and suffixes colliding top-level names
// (inited / inited_2 / inited_3), so a uniquely named flag keeps this module
// independent of the other two that share the word.
let botsInited: boolean = false;

// Scratch reused for every position read. Never stored, never returned.
const posScratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

// Zero-FFI bot test for the hot paths (nuke probe, award). Populated at
// OnSpawnerSpawned and at deploy; cleared on leave.
export function isBotPid(pid: number): boolean {
    return botPidSet[pid] === true;
}

// Slower test for event paths that already hold a Player: registry first,
// one IsAISoldier read on miss (deploy is infrequent), then memoized.
export function isBotPlayer(p: mod.Player): boolean {
    let pid: number = -1;
    try {
        pid = mod.GetObjId(p);
    } catch (e) {
        return false;
    }
    if (pid < 0) {
        return false;
    }
    if (botPidSet[pid] === true) {
        return true;
    }
    let ai: boolean = false;
    try {
        ai = mod.GetSoldierState(p, mod.SoldierStateBool.IsAISoldier);
    } catch (e) {
        return false;
    }
    if (ai) {
        botPidSet[pid] = true;
    }
    return ai;
}

function liveCount(team: number): number {
    let n: number = 0;
    for (const pid of botOrder) {
        const rec: BotRec | undefined = bots[pid];
        if (rec !== undefined && !rec.dead && rec.team === team) {
            n++;
        }
    }
    return n;
}

// Bot records on a team, alive or a corpse not yet unspawned: both hold a
// team slot.
function presentCount(team: number): number {
    let n: number = 0;
    for (const pid of botOrder) {
        const rec: BotRec | undefined = bots[pid];
        if (rec !== undefined && rec.team === team) {
            n++;
        }
    }
    return n;
}

// Humans per team, counted once per drain that has work to do.
const humansScratch: { [team: number]: number } = { 1: 0, 2: 0 };

function countHumans(): void {
    humansScratch[1] = 0;
    humansScratch[2] = 0;
    for (const p of allPlayers()) {
        try {
            if (isBotPid(mod.GetObjId(p))) {
                continue;
            }
            const t: number = teamIdOf(p);
            if (t === 1 || t === 2) {
                humansScratch[t]++;
            }
        } catch (e) {
        }
    }
}

function queueSpawn(team: number, nameKey: string): void {
    if (team !== 1 && team !== 2) {
        return;
    }
    spawnQueue.push({ team: team, nameKey: nameKey });
}

function drainSpawns(): void {
    if (spawnQueue.length === 0) {
        return;
    }
    countHumans();
    let n: number = 0;
    // Requests looked at this sweep; one waiting for a corpse to clear goes to
    // the back, so the loop ends once every request has been seen.
    let looked: number = 0;
    const queued: number = spawnQueue.length;
    while (n < BOT_SPAWN_PER_SWEEP && spawnQueue.length > 0 && looked < queued) {
        looked++;
        const req: SpawnReq = spawnQueue[0];
        const team: number = req.team;
        const live: number = BOT_PERSISTENT ? presentCount(team) : liveCount(team);
        if (live >= BOT_COUNT_PER_TEAM) {
            spawnQueue.shift();
            continue;
        }
        if (live >= BOT_TEAM_SLOTS - humansScratch[team]
            || presentCount(team) + humansScratch[team] >= BOT_TEAM_SLOTS) {
            // Humans or a corpse hold the slot: wait rather than drop, so the
            // bot comes back when a human leaves or the corpse unspawns (a
            // dropped request is never re-queued).
            spawnQueue.push(spawnQueue.shift() as SpawnReq);
            continue;
        }
        const pool: mod.Spawner[] = spawnerByTeam[team];
        if (pool.length === 0) {
            spawnQueue.shift();
            log("bots", "no spawner for team " + team + ", dropping queued spawn");
            continue;
        }
        const sp: mod.Spawner = pool[spawnRound % pool.length];
        spawnRound++;
        const cls: mod.SoldierClass = spawnRound % 4 === 0
            ? mod.SoldierClass.Assault
            : spawnRound % 4 === 1
                ? mod.SoldierClass.Engineer
                : spawnRound % 4 === 2
                    ? mod.SoldierClass.Recon
                    : mod.SoldierClass.Support;
        const handle: mod.Team | undefined = teamHandle(team);
        if (handle === undefined) {
            spawnQueue.shift();
            log("bots", "no team handle for team " + team + ", dropping queued spawn");
            continue;
        }
        spawnQueue.shift();
        n++;
        // Name is the 4th argument of the four-arg SpawnAIFromAISpawner
        // overload. It must be a string-table key, not a literal: mod.Message
        // renders table entries only, and this is the sole naming path in
        // Tier 0 (no mod.SetPlayerName).
        const nameKey: string = takeBotName(team, req.nameKey, Date.now());
        try {
            mod.SpawnAIFromAISpawner(sp, cls, mod.Message(nameKey), handle);
        } catch (e) {
            releaseBotName(team, nameKey);
            log("bots", "spawn failed team " + team + ": " + String(e));
        }
    }
}

// claim is true on the spawn event. The deploy event re-registers the same
// soldier and claims only when the spawn event could not (its team was not
// readable yet); claiming there every time took the name queued for the next
// spawn. A live record is only refreshed: a repeated spawn or deploy event
// must not wipe the seat, approach and stuck state of a bot that is driving.
function registerBot(p: mod.Player, pid: number, team: number, claim: boolean): BotRec {
    let rec: BotRec | undefined = bots[pid];
    // A persistent bot redeploying is the same soldier under the same name:
    // claiming here would take the name queued for the next new bot.
    const redeploy: boolean = BOT_PERSISTENT && rec !== undefined && rec.nameKey !== "" && rec.team === team;
    if (rec === undefined) {
        rec = {
            pid: pid, team: team, player: p, mind: newMind(), dead: false, nameKey: "",
            lastX: 0, lastY: 0, lastZ: 0, stillSince: 0, strikes: 0, inVehicle: false,
            approachVeh: undefined, approachVid: -1, approachUntil: 0,
            seatedAt: 0, seatX: 0, seatY: 0, seatZ: 0, boardY: 0, seatCheckAt: 0,
            driveObj: -1, driveD: 0, driveCheckAt: 0, reseatUntil: 0,
            ejectTries: 0, vehicleBanUntil: 0, wetFor: 0,
            steerVeh: undefined, steerVid: -1, steerObj: -1, steerAt: 0, reseatFails: 0,
            ejectPending: false, seatAir: false, seatVeh: undefined,
            approachRide: false, rideVeh: undefined, rideVid: -1, boardX: 0, boardZ: 0,
            rideX: 0, rideY: 0, rideZ: 0, rideCheckAt: 0, rideReseats: 0, rideBanVid: -1, rideBanUntil: 0,
            deadAt: 0
        };
        bots[pid] = rec;
        botOrder.push(pid);
        log("bots", "registered pid=" + pid + " team=" + team);
    } else if (rec.dead || rec.team !== team) {
        rec.player = p;
        rec.team = team;
        rec.dead = false;
        rec.stillSince = 0;
        rec.strikes = 0;
        rec.inVehicle = false;
        rec.wetFor = 0;
        rec.ejectPending = false;
        rec.rideVeh = undefined;
        rec.deadAt = 0;
        endApproach(rec);
        resetSeat(rec);
    } else {
        rec.player = p;
        rec.team = team;
    }
    botPidSet[pid] = true;
    // The name was queued by drainSpawns before the engine spawned this
    // soldier, so claiming it here pairs the key with the real player id.
    if (!redeploy && (claim || rec.nameKey === "")) {
        const expired: number = expiredBotNames();
        const claimed: string = claimBotName(team, Date.now());
        if (expiredBotNames() !== expired) {
            log("bots", "name " + lastExpiredBotName() + " expired unclaimed on team " + team
                + " (a spawn produced no soldier)");
        }
        if (claimed !== "") {
            if (rec.nameKey !== "" && rec.nameKey !== claimed) {
                // A new soldier on a reused id: the old name is free again.
                releaseBotName(team, rec.nameKey);
            }
            rec.nameKey = claimed;
        }
    }
    // A dead bot leaves the game and comes back as a new player, so stats kept
    // by player id were wiped on every death: no bot ever showed a kill, death
    // or score on the scoreboard. They are kept by team and name instead, and
    // a respawn reuses its name (see scheduleRespawn). The same key follows the
    // bot's fail memory in botbrain.
    if (rec.nameKey !== "") {
        rec.mind.failKey = team + ":" + rec.nameKey;
        bindBotStats(pid, team + ":" + rec.nameKey);
        pushRow(p);
    }
    return rec;
}

function forgetBot(pid: number): void {
    const rec: BotRec | undefined = bots[pid];
    if (rec !== undefined) {
        // Release here, on leaving the game, not on death: the corpse still
        // carries the name in the kill feed until it unspawns.
        releaseBotName(rec.team, rec.nameKey);
        endApproach(rec);
    }
    // The claim goes; the fail memory in botbrain stays, keyed by team and
    // name, because the respawn keeps the name (rarely the player id).
    releaseClaim(pid);
    delete bots[pid];
    delete botPidSet[pid];
    delete respawnPending[pid];
    dropOccupant(pid);
    const at: number = botOrder.indexOf(pid);
    if (at >= 0) {
        botOrder.splice(at, 1);
    }
}

function onSpawnerSpawned(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    // A fresh soldier may reuse the id of a bot from the other team that just
    // left, so never trust a cached team here.
    forgetTeamCache(pid);
    const team: number = teamIdOf(p);
    if (team !== 1 && team !== 2) {
        return;
    }
    registerBot(p, pid, team, true);
    if (willLogDebug()) {
        log("bots", "spawned pid=" + pid + " team=" + team + " live=" + liveCount(team));
    }
}

function onBotDead(pid: number): void {
    const rec: BotRec | undefined = bots[pid];
    if (rec !== undefined) {
        if (!rec.dead) {
            rec.dead = true;
            rec.deadAt = Date.now();
            scheduleRespawn(pid, rec.team, rec.nameKey);
        }
        endApproach(rec);
        resetSeat(rec);
        rec.rideVeh = undefined;
        clearIntent(pid, rec.mind);
        rec.mind.battleUntil = 0;
    }
    releaseClaim(pid);
    dropOccupant(pid);
}

// Respawn is scheduled from OnPlayerDied, not from OnPlayerUndeploy. The old
// code only armed the timer in the undeploy handler, and a playtest showed no
// respawns at all: the engine unspawns a dead AI soldier without raising
// OnPlayerUndeploy, so nothing was ever queued. OnPlayerDied is reliable (the
// death handler demonstrably runs), so it is the safe anchor.
function scheduleRespawn(pid: number, team: number, nameKey: string): void {
    // Persistent bots redeploy by themselves; maintainPopulation replaces one
    // that left the game.
    if (BOT_PERSISTENT || (team !== 1 && team !== 2)) {
        return;
    }
    if (respawnPending[pid] === true) {
        return;
    }
    respawnPending[pid] = true;
    const h: Timers.TimerID | null = Timers.setTimeout(() => {
        safe("bots.respawn", () => {
            delete respawnPending[pid];
            if (liveCount(team) < BOT_COUNT_PER_TEAM) {
                queueSpawn(team, nameKey);
            }
        });
    }, BOT_RESPAWN_DELAY_MS);
    if (h === null) {
        delete respawnPending[pid];
        logAdmin("bots", "WARNING respawn timer refused for team " + team);
    }
}

function onBotUndeployed(p: mod.Player, pid: number): void {
    onBotDead(pid);
    const rec: BotRec | undefined = bots[pid];
    const team: number = rec !== undefined ? rec.team : teamIdOf(p);
    // Safety net only. onBotDead already armed the timer; scheduleRespawn is
    // idempotent per pid, so reaching here for a bot that has not left yet is
    // harmless, and it covers the case where the bot undeploys without dying.
    scheduleRespawn(pid, team, rec !== undefined ? rec.nameKey : "");
}

function onMoveFailed(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    const rec: BotRec | undefined = bots[pid];
    if (rec === undefined || rec.dead || rec.inVehicle || rec.approachVid >= 0) {
        return;
    }
    noteMoveFailed(pid, rec.mind, Date.now());
}

// Shot by a live enemy: set the target, a short force-fire burst, and hand the
// bot to the engine's combat AI for BOT_BATTLE_MS (botbrain.enterBattle). Bots
// in a vehicle are left to the vehicle AI.
function onDamaged(victim: mod.Player, damager: mod.Player): void {
    const pid: number = mod.GetObjId(victim);
    const rec: BotRec | undefined = bots[pid];
    if (rec === undefined || rec.dead) {
        return;
    }
    if (!mod.IsValid(damager)) {
        return;
    }
    if (!isEnemyTeam(teamIdOf(damager), rec.team)) {
        return;
    }
    try {
        if (!rec.inVehicle) {
            // A fight cancels a walk to a vehicle.
            endApproach(rec);
            enterBattle(victim, rec.mind, Date.now());
        }
        mod.AISetTarget(victim, damager);
        mod.AIForceFire(victim, 2);
    } catch (e) {
        log("bots", "retaliate failed pid=" + pid + ": " + String(e));
    }
}

// Bot position, read from PlayerLocations' per-tick cache instead of
// mod.GetSoldierState. This is the module the utils docs are explicit about for
// hot loops: the engine call is made once per tick for every connected player,
// and everything after that is a typed-array read. The bot sweep runs 12 times a
// second across 48 bots, so this removes the single largest recurring FFI cost
// in the bot path without changing behaviour.
//
// Returns false when the bot is not currently active, which covers a soldier
// between spawn and deploy, and a bot that has already been recycled this tick.
function readPos(pid: number): boolean {
    const v = PlayerLocations.getPosition(pid, posScratch);
    return v !== null && v !== undefined;
}

// Vehicles: existing ones only. mod.AllVehicles() returns an opaque mod.Array
// and costs an FFI to build, so the candidate list is rebuilt once per
// BOT_VEHICLE_SCAN_MS for the whole population. A candidate exists and has
// fewer than BOT_VEHICLE_FREE_SEATS occupants, the same availability test
// CustomConquest V15 AI_VehicleDeploy uses.
const vehicleCand: mod.Vehicle[] = [];
const vScratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };
let vehicleScannedAt: number = 0;
// Vehicle ObjId -> pid of the bot walking to it, so a crowd does not all head
// for the same tank.
const vehicleReservedBy: { [vid: number]: number } = {};

function scanVehicles(nowMs: number): void {
    if (nowMs - vehicleScannedAt < BOT_VEHICLE_SCAN_MS) {
        return;
    }
    vehicleScannedAt = nowMs;
    vehicleCand.length = 0;
    humanRides.length = 0;
    const seen: { [vid: number]: Vectors.Vector3 } = {};
    let arr: mod.Array | undefined;
    try {
        arr = mod.AllVehicles();
    } catch (e) {
        return;
    }
    if (arr === undefined) {
        return;
    }
    const n: number = mod.CountOf(arr);
    for (let i: number = 0; i < n; i++) {
        try {
            const v: mod.Vehicle = mod.ValueInArray(arr, i) as mod.Vehicle;
            if (!mod.IsValid(v)) {
                continue;
            }
            const occ: number = mod.CountOf(mod.GetAllPlayersInVehicle(v));
            noteHumanRide(v, occ, seen);
            if (occ >= BOT_VEHICLE_FREE_SEATS) {
                continue;
            }
            vehicleCand.push(v);
        } catch (e) {
        }
    }
    ridePrev = seen;
    if (willLogDebug() && vehicleCand.length > 0) {
        log("bots", "vehicle scan: " + vehicleCand.length + " with a free seat");
    }
}

// Vehicles a human drives that have a free seat and are nearly still (landed,
// or hovering low), rebuilt by scanVehicles. Bots near one get in as
// passengers whatever their job (maybeJoinPlayer). The normal candidate list
// leaves out any vehicle with two people in it and is only used for long
// attack trips, so in the third 2026-10-02 playtest bots almost never got into
// the owner's helicopter.
interface HumanRide {
    v: mod.Vehicle;
    vid: number;
    team: number;
    x: number;
    y: number;
    z: number;
    free: number;
}
const humanRides: HumanRide[] = [];
// Human-driven vehicle ObjId -> its position at the previous scan.
let ridePrev: { [vid: number]: Vectors.Vector3 } = {};
// Vehicle ObjId -> seat count, dropped on OnVehicleSpawned like airByVid.
const seatsByVid: { [vid: number]: number } = {};

function seatCount(v: mod.Vehicle, vid: number): number {
    const cached: number | undefined = seatsByVid[vid];
    if (cached !== undefined) {
        return cached;
    }
    let n: number = 0;
    try {
        n = mod.GetVehicleSeatCount(v);
    } catch (e) {
        log("bots", "seat count failed for vehicle " + vid + ": " + String(e));
    }
    seatsByVid[vid] = n;
    return n;
}

// True when a human (not a bot) is in seat 0.
function humanDriven(v: mod.Vehicle): boolean {
    try {
        if (!mod.IsValid(v) || !mod.IsVehicleSeatOccupied(v, 0)) {
            return false;
        }
        const d: mod.Player = mod.GetPlayerFromVehicleSeat(v, 0);
        return mod.IsValid(d) && !isBotPid(mod.GetObjId(d));
    } catch (e) {
        return false;
    }
}

function noteHumanRide(v: mod.Vehicle, occ: number, seen: { [vid: number]: Vectors.Vector3 }): void {
    if (!mod.IsVehicleSeatOccupied(v, 0)) {
        return;
    }
    const d: mod.Player = mod.GetPlayerFromVehicleSeat(v, 0);
    if (!mod.IsValid(d) || isBotPid(mod.GetObjId(d))) {
        return;
    }
    const vid: number = mod.GetObjId(v);
    const free: number = seatCount(v, vid) - occ;
    if (free <= 0 || !vehiclePos(v)) {
        return;
    }
    seen[vid] = { x: vScratch.x, y: vScratch.y, z: vScratch.z };
    const prev: Vectors.Vector3 | undefined = ridePrev[vid];
    if (prev === undefined) {
        // Speed needs two scans.
        return;
    }
    const dx: number = vScratch.x - prev.x;
    const dy: number = vScratch.y - prev.y;
    const dz: number = vScratch.z - prev.z;
    if (dx * dx + dy * dy + dz * dz > BOT_RIDE_SLOW_M * BOT_RIDE_SLOW_M) {
        return;
    }
    humanRides.push({
        v: v, vid: vid, team: teamIdOf(d), x: vScratch.x, y: vScratch.y, z: vScratch.z, free: free
    });
}

// Bots already walking to this ride.
function rideWalkers(vid: number): number {
    let n: number = 0;
    for (const pid of botOrder) {
        const r: BotRec | undefined = bots[pid];
        if (r !== undefined && !r.dead && r.approachRide && r.approachVid === vid) {
            n++;
        }
    }
    return n;
}

// A bot on foot near a player's vehicle on its own team walks to it to get in
// as a passenger. True when it set off.
function maybeJoinPlayer(rec: BotRec, x: number, y: number, z: number, nowMs: number): boolean {
    if (humanRides.length === 0 || rec.approachVid >= 0 || inBattle(rec.mind, nowMs)) {
        return false;
    }
    const rSq: number = BOT_RIDE_RADIUS_M * BOT_RIDE_RADIUS_M;
    for (const r of humanRides) {
        if (r.team !== rec.team || (r.vid === rec.rideBanVid && nowMs < rec.rideBanUntil)) {
            continue;
        }
        const dx: number = r.x - x;
        const dy: number = r.y - y;
        const dz: number = r.z - z;
        if (dx * dx + dy * dy + dz * dz > rSq || rideWalkers(r.vid) >= r.free) {
            continue;
        }
        try {
            rec.approachVeh = r.v;
            rec.approachVid = r.vid;
            rec.approachUntil = nowMs + BOT_VEHICLE_APPROACH_MS;
            rec.approachRide = true;
            mod.AIMoveToBehavior(rec.player, mod.CreateVector(r.x, r.y, r.z));
            mod.AISetMoveSpeed(rec.player, mod.MoveSpeed.Sprint);
            rec.mind.state = -1;
            if (BOT_TRACE) {
                log("bots", "pid=" + rec.pid + " heads for player vehicle " + r.vid);
            }
            return true;
        } catch (e) {
            endApproach(rec);
            return false;
        }
    }
    return false;
}

// Seated as a passenger behind a human: remembered as a ride.
function startRide(rec: BotRec, v: mod.Vehicle, vid: number, x: number, y: number, z: number, nowMs: number): void {
    rec.rideVeh = v;
    rec.rideVid = vid;
    rec.boardX = x;
    rec.boardZ = z;
    rec.rideX = x;
    rec.rideY = y;
    rec.rideZ = z;
    rec.rideCheckAt = nowMs + BOT_RIDE_STILL_MS;
    rec.rideReseats = 0;
}

const RIDE_DROP: string = "dropped off by a player";

// A passenger behind a human: stays aboard while the vehicle moves or waits
// where the bot got in; gets out once the player has carried it
// BOT_RIDE_DELIVER_M and stopped. A player who got out of the driver seat
// hands it back to the ordinary seated checks. True when ejected.
function handleRide(rec: BotRec, nowMs: number): boolean {
    const v: mod.Vehicle | undefined = rec.rideVeh;
    if (v === undefined || !humanDriven(v)) {
        rec.rideVeh = undefined;
        return false;
    }
    if (nowMs < rec.rideCheckAt) {
        return false;
    }
    const x: number = posScratch.x;
    const y: number = posScratch.y;
    const z: number = posScratch.z;
    const dx: number = x - rec.rideX;
    const dy: number = y - rec.rideY;
    const dz: number = z - rec.rideZ;
    rec.rideX = x;
    rec.rideY = y;
    rec.rideZ = z;
    rec.rideCheckAt = nowMs + BOT_RIDE_STILL_MS;
    if (dx * dx + dy * dy + dz * dz >= BOT_VEHICLE_STUCK_M * BOT_VEHICLE_STUCK_M) {
        return false;
    }
    const bx: number = x - rec.boardX;
    const bz: number = z - rec.boardZ;
    if (bx * bx + bz * bz < BOT_RIDE_DELIVER_M * BOT_RIDE_DELIVER_M) {
        return false;
    }
    rec.rideBanVid = rec.rideVid;
    rec.rideBanUntil = nowMs + BOT_RIDE_BAN_MS;
    rec.rideVeh = undefined;
    return ejectFromVehicle(rec, RIDE_DROP, nowMs);
}

// A passenger found on foot beside the player's vehicle it was riding in, that
// we did not eject: seated again once, with the idle behavior so the
// battlefield AI does not walk it out again. The third 2026-10-02 playtest had
// passengers leave the owner's helicopter seconds after boarding. True when
// re-seated.
function tryRejoinRide(rec: BotRec, nowMs: number): boolean {
    const v: mod.Vehicle | undefined = rec.rideVeh;
    rec.rideVeh = undefined;
    if (v === undefined || rec.rideReseats >= BOT_RESEAT_TRIES) {
        return false;
    }
    try {
        if (!humanDriven(v) || !vehiclePos(v)) {
            return false;
        }
        const dx: number = vScratch.x - posScratch.x;
        const dy: number = vScratch.y - posScratch.y;
        const dz: number = vScratch.z - posScratch.z;
        if (dx * dx + dy * dy + dz * dz > BOT_VEHICLE_SEAT_M * BOT_VEHICLE_SEAT_M * 4) {
            return false;
        }
        if (mod.CountOf(mod.GetAllPlayersInVehicle(v)) >= seatCount(v, rec.rideVid)) {
            return false;
        }
        rec.rideReseats++;
        mod.ForcePlayerToSeat(rec.player, v, -1);
        mod.AIIdleBehavior(rec.player);
        rec.rideVeh = v;
        rec.inVehicle = true;
        rec.reseatUntil = nowMs + 1500;
        rec.rideCheckAt = nowMs + BOT_RIDE_STILL_MS;
        if (BOT_TRACE) {
            log("bots", "pid=" + rec.pid + " got out of player vehicle " + rec.rideVid + " after "
                + String(Math.round((nowMs - rec.seatedAt) / 1000)) + "s, re-seated (try " + rec.rideReseats + ")");
        }
        return true;
    } catch (e) {
        return false;
    }
}

// Aircraft in VehicleList. A bot is never ejected from one: it would drop out
// of the sky. Bots fly them well enough (2026-10-02 playtest).
const AIR_TYPES: mod.VehicleList[] = [
    mod.VehicleList.AH64, mod.VehicleList.AH6M, mod.VehicleList.AH6M_Pax, mod.VehicleList.Eurocopter,
    mod.VehicleList.F_74A_Seacat, mod.VehicleList.F_74A_Seacat_Pax, mod.VehicleList.F16,
    mod.VehicleList.F22, mod.VehicleList.FA_81F_Super_Spectre, mod.VehicleList.FA_81F_Super_Spectre_Pax,
    mod.VehicleList.JAS39, mod.VehicleList.SU57, mod.VehicleList.UH60, mod.VehicleList.UH60_Pax
];
// Vehicle ObjId -> aircraft. Up to 14 CompareVehicleName calls once per
// vehicle; the entry is dropped on OnVehicleSpawned because ids are reused.
const airByVid: { [vid: number]: boolean } = {};

function isAircraft(v: mod.Vehicle, vid: number): boolean {
    const cached: boolean | undefined = airByVid[vid];
    if (cached !== undefined) {
        return cached;
    }
    let air: boolean = false;
    for (const t of AIR_TYPES) {
        try {
            if (mod.CompareVehicleName(v, t)) {
                air = true;
                break;
            }
        } catch (e) {
        }
    }
    airByVid[vid] = air;
    return air;
}

// A bot riding in a vehicle a human drives stays put: the human decides where
// it goes, so it is not ejected for standing still or riding too long.
function ridesWithHuman(rec: BotRec): boolean {
    try {
        if (mod.GetPlayerVehicleSeat(rec.player) === 0) {
            return false;
        }
        return humanDriven(mod.GetVehicleFromPlayer(rec.player));
    } catch (e) {
        return false;
    }
}

const PARKED_AIRCRAFT: string = "parked aircraft";
// An aircraft within this height of where it was boarded has not taken off.
const AIR_GROUND_DY_M: number = 4;

// True when the bot's vehicle has nobody in seat 0.
function pilotless(rec: BotRec): boolean {
    try {
        const v: mod.Vehicle = mod.GetVehicleFromPlayer(rec.player);
        return mod.IsValid(v) && !mod.IsVehicleSeatOccupied(v, 0);
    } catch (e) {
        return false;
    }
}

function endApproach(rec: BotRec): void {
    if (rec.approachVid >= 0 && vehicleReservedBy[rec.approachVid] === rec.pid) {
        delete vehicleReservedBy[rec.approachVid];
    }
    rec.approachVeh = undefined;
    rec.approachVid = -1;
    rec.approachUntil = 0;
    rec.approachRide = false;
}

function resetSeat(rec: BotRec): void {
    rec.seatedAt = 0;
    rec.seatVeh = undefined;
    rec.seatCheckAt = 0;
    rec.driveObj = -1;
    rec.driveD = 0;
    rec.driveCheckAt = 0;
}

// Reads a vehicle's position into vScratch. False when the read throws.
function vehiclePos(v: mod.Vehicle): boolean {
    try {
        Vectors.toVector3(mod.GetVehicleState(v, mod.VehicleStateVector.VehiclePosition), vScratch);
        return true;
    } catch (e) {
        return false;
    }
}

// After a think: a bot walking to a far attack target heads for a free vehicle
// near it instead - walk there, then seat (the bf6-portal-bots-brain pattern),
// rather than being teleported into a seat. Short trips stay on foot.
function maybeApproachVehicle(rec: BotRec, x: number, y: number, z: number, nowMs: number): void {
    const mind: BotMind = rec.mind;
    if (vehicleCand.length === 0 || mind.state !== JOB_ATTACK || mind.obj < 0 || inBattle(mind, nowMs)
        || nowMs < rec.vehicleBanUntil) {
        return;
    }
    if (distSqTo(mind.obj, x, y, z) < BOT_VEHICLE_MIN_TRIP_M * BOT_VEHICLE_MIN_TRIP_M) {
        return;
    }
    const rSq: number = BOT_VEHICLE_RADIUS_M * BOT_VEHICLE_RADIUS_M;
    for (const v of vehicleCand) {
        try {
            const vid: number = mod.GetObjId(v);
            const owner: number | undefined = vehicleReservedBy[vid];
            if (owner !== undefined && owner !== rec.pid) {
                const holder: BotRec | undefined = bots[owner];
                if (holder !== undefined && !holder.dead && holder.approachVid === vid) {
                    continue;
                }
            }
            if (!vehiclePos(v)) {
                continue;
            }
            const dx: number = vScratch.x - x;
            const dy: number = vScratch.y - y;
            const dz: number = vScratch.z - z;
            if (dx * dx + dy * dy + dz * dz > rSq) {
                continue;
            }
            vehicleReservedBy[vid] = rec.pid;
            rec.approachVeh = v;
            rec.approachVid = vid;
            rec.approachUntil = nowMs + BOT_VEHICLE_APPROACH_MS;
            // Plain MoveTo: the validated variant may stop short of a vehicle.
            mod.AIMoveToBehavior(rec.player, mod.CreateVector(vScratch.x, vScratch.y, vScratch.z));
            mod.AISetMoveSpeed(rec.player, mod.MoveSpeed.Sprint);
            // The objective intent is re-issued after the vehicle trip.
            mind.state = -1;
            if (BOT_TRACE) {
                log("bots", "pid=" + rec.pid + " heads for vehicle " + vid
                    + " (target " + objectiveLabel(mind.obj) + ")");
            }
            return;
        } catch (e) {
        }
    }
}

// Walking to a reserved vehicle: seat once close, give up on timeout or if the
// vehicle is gone or full. Returns true while the approach continues.
function tickApproach(rec: BotRec, x: number, y: number, z: number, nowMs: number): boolean {
    const v: mod.Vehicle | undefined = rec.approachVeh;
    if (v === undefined) {
        endApproach(rec);
        return false;
    }
    let why: string = "";
    if (nowMs > rec.approachUntil) {
        why = "timeout";
    } else if (!mod.IsValid(v) || !vehiclePos(v)) {
        why = "vehicle gone";
    } else if (mod.CountOf(mod.GetAllPlayersInVehicle(v))
        >= (rec.approachRide ? seatCount(v, rec.approachVid) : BOT_VEHICLE_FREE_SEATS)) {
        why = "vehicle full";
    } else if (rec.approachRide && !humanDriven(v)) {
        why = "player got out";
    }
    if (why !== "") {
        if (BOT_TRACE) {
            log("bots", "pid=" + rec.pid + " drops vehicle " + rec.approachVid + " (" + why + ")");
        }
        if (!rec.approachRide) {
            rec.vehicleBanUntil = nowMs + BOT_VEHICLE_BAN_MS;
        }
        endApproach(rec);
        return false;
    }
    const dx: number = vScratch.x - x;
    const dy: number = vScratch.y - y;
    const dz: number = vScratch.z - z;
    if (dx * dx + dy * dy + dz * dz > BOT_VEHICLE_SEAT_M * BOT_VEHICLE_SEAT_M) {
        if (rec.approachRide) {
            // A player's vehicle may have shifted since the order: follow it.
            try {
                mod.AIMoveToBehavior(rec.player, mod.CreateVector(vScratch.x, vScratch.y, vScratch.z));
            } catch (e) {
            }
        }
        return true;
    }
    const vid: number = rec.approachVid;
    const driver: boolean = !mod.IsVehicleSeatOccupied(v, 0);
    const ride: boolean = !driver && humanDriven(v);
    endApproach(rec);
    // Battlefield AI first, then the seat: the CustomConquest V15
    // AI_DeployVehicle order.
    mod.AIBattlefieldBehavior(rec.player);
    mod.ForcePlayerToSeat(rec.player, v, driver ? 0 : -1);
    rec.inVehicle = true;
    rec.ejectTries = 0;
    rec.reseatFails = 0;
    rec.seatedAt = nowMs;
    rec.seatX = vScratch.x;
    rec.seatY = vScratch.y;
    rec.seatZ = vScratch.z;
    rec.boardY = vScratch.y;
    rec.seatCheckAt = nowMs + BOT_VEHICLE_STUCK_MS;
    rec.seatAir = isAircraft(v, vid);
    rec.seatVeh = v;
    if (ride) {
        startRide(rec, v, vid, vScratch.x, vScratch.y, vScratch.z, nowMs);
    }
    const obj: number = rec.mind.obj;
    if (driver && obj >= 0) {
        steerDriver(rec, v, vid, obj, nowMs);
    }
    if (BOT_TRACE) {
        log("bots", "pid=" + rec.pid + " boarded vehicle " + vid
            + (driver ? " as driver" : ride ? " as a player's passenger" : " as passenger"));
    }
    return false;
}

// Driver steering, as bf6-portal-bots-brain does it (BehaviorSelector moveto):
// take the driver out, wait two ticks, put it back in seat 0, then
// AIDefendPositionBehavior on the destination, which the vehicle AI drives to.
// Without the exit and re-seat no driven vehicle moved at all (first
// 2026-10-02 playtest); with it an AH64 flew 789 m to its objective (second).
// bots-brain does this only when the destination changes, so the same vehicle
// and objective are steered once per BOT_STEER_REPEAT_MS: repeating it on
// every think left boat drivers standing beside their boat. The vehicle handle
// is captured here, so the timers never call GetVehicleFromPlayer on a bot that
// is no longer seated (the one engine exception in that log).
// handleSeated still checks progress and falls back to battlefield AI.
function steerDriver(rec: BotRec, v: mod.Vehicle, vid: number, obj: number, nowMs: number): void {
    rec.driveObj = obj;
    rec.driveD = Math.sqrt(distSqTo(obj, rec.seatX, 0, rec.seatZ));
    rec.driveCheckAt = nowMs + BOT_DRIVE_CHECK_MS;
    if (rec.steerVid === vid && rec.steerObj === obj && nowMs - rec.steerAt < BOT_STEER_REPEAT_MS) {
        // Already exited and re-seated for this; only give the order again,
        // since an on-foot think may have replaced it in between.
        try {
            mod.AIDefendPositionBehavior(rec.player, objectiveVector(obj), 10, 20);
        } catch (e) {
        }
        return;
    }
    rec.steerVeh = v;
    rec.steerVid = vid;
    rec.steerObj = obj;
    rec.steerAt = nowMs;
    rec.reseatFails = 0;
    rec.reseatUntil = nowMs + 1500;
    const anchor: mod.Vector = objectiveVector(obj);
    const pid: number = rec.pid;
    Timers.setTimeout(() => {
        safe("bots.steer.exit", () => {
            const r: BotRec | undefined = bots[pid];
            if (r === undefined || r.dead || r.steerVid !== vid || !mod.IsValid(r.player) || !mod.IsValid(v)) {
                return;
            }
            mod.ForcePlayerExitVehicle(r.player, v);
            // Two ticks, as bots-brain's two Wait(0). A 0 ms timer created
            // inside a timer can run in the same tick, so 1 ms each.
            Timers.setTimeout(() => {
                Timers.setTimeout(() => {
                    safe("bots.steer.seat", () => {
                        const r2: BotRec | undefined = bots[pid];
                        if (r2 === undefined || r2.dead || r2.steerVid !== vid
                            || !mod.IsValid(r2.player) || !mod.IsValid(v)) {
                            return;
                        }
                        mod.ForcePlayerToSeat(r2.player, v, 0);
                        mod.AIDefendPositionBehavior(r2.player, anchor, 10, 20);
                    });
                }, 1);
            }, 1);
        });
    }, 150);
    if (BOT_TRACE) {
        log("bots", "pid=" + pid + " driving to " + objectiveLabel(obj)
            + " (" + String(Math.round(rec.driveD)) + "m)");
    }
}

// A steer exits and re-seats the driver. When the bot is found on foot beside
// the vehicle it was steering, it is seated again directly, without another
// exit, up to BOT_RESEAT_TRIES times. True when it was re-seated.
function tryReseat(rec: BotRec, nowMs: number): boolean {
    const v: mod.Vehicle | undefined = rec.steerVeh;
    if (v === undefined || rec.driveObj < 0 || rec.reseatFails >= BOT_RESEAT_TRIES
        || nowMs - rec.steerAt > BOT_STEER_REPEAT_MS) {
        return false;
    }
    if (distSqTo(rec.driveObj, posScratch.x, 0, posScratch.z) < BOT_VEHICLE_DISMOUNT_M * BOT_VEHICLE_DISMOUNT_M) {
        // Got out at its objective: that is arrival, not a failed re-seat.
        return false;
    }
    try {
        if (!mod.IsValid(v) || mod.IsVehicleSeatOccupied(v, 0) || !vehiclePos(v)) {
            return false;
        }
        const dx: number = vScratch.x - posScratch.x;
        const dy: number = vScratch.y - posScratch.y;
        const dz: number = vScratch.z - posScratch.z;
        if (dx * dx + dy * dy + dz * dz > BOT_VEHICLE_SEAT_M * BOT_VEHICLE_SEAT_M) {
            return false;
        }
        rec.reseatFails++;
        mod.ForcePlayerToSeat(rec.player, v, 0);
        mod.AIDefendPositionBehavior(rec.player, objectiveVector(rec.driveObj), 10, 20);
        rec.reseatUntil = nowMs + 1500;
        if (BOT_TRACE) {
            log("bots", "pid=" + rec.pid + " re-seated in vehicle " + rec.steerVid
                + " (try " + rec.reseatFails + ")");
        }
        return true;
    } catch (e) {
        return false;
    }
}

// Returns true when the bot was told to get out. The player-only overload of
// ForcePlayerExitVehicle never got a bot out in the 2026-10-02 playtest (41
// ejects logged for one bot), so this passes the vehicle as bots-brain does.
// After two ejects that did not take, the bot is left to the vehicle AI rather
// than retried every 15 s.
function ejectFromVehicle(rec: BotRec, why: string, nowMs: number): boolean {
    if (why !== PARKED_AIRCRAFT && why !== RIDE_DROP) {
        // Never out of an aircraft in the air, whatever the cached seat state
        // says (it is read once per seating). isAircraft is cached per vehicle.
        try {
            const cur: mod.Vehicle = mod.GetVehicleFromPlayer(rec.player);
            if (mod.IsValid(cur) && isAircraft(cur, mod.GetObjId(cur))) {
                rec.seatAir = true;
                rec.seatCheckAt = nowMs + BOT_VEHICLE_STUCK_MS;
                return false;
            }
        } catch (e) {
        }
    }
    if (rec.ejectTries >= 2) {
        if (rec.ejectTries === 2) {
            rec.ejectTries++;
            log("bots", "pid=" + rec.pid + " will not leave its vehicle, leaving it to the vehicle AI");
            try {
                mod.AIBattlefieldBehavior(rec.player);
            } catch (e) {
            }
        }
        rec.driveObj = -1;
        rec.seatCheckAt = nowMs + BOT_VEHICLE_MAX_MS;
        return false;
    }
    rec.ejectTries++;
    try {
        const v: mod.Vehicle = mod.GetVehicleFromPlayer(rec.player);
        if (mod.IsValid(v)) {
            mod.ForcePlayerExitVehicle(rec.player, v);
        } else {
            mod.ForcePlayerExitVehicle(rec.player);
        }
    } catch (e) {
    }
    if (BOT_TRACE) {
        log("bots", "pid=" + rec.pid + " ejected (" + why + ")");
    }
    rec.inVehicle = false;
    rec.ejectPending = true;
    rec.vehicleBanUntil = nowMs + BOT_VEHICLE_BAN_MS;
    leftVehicle(rec);
    return true;
}

// Back on foot (ejected, or got out on its own): stuck tracking restarts and
// the objective intent is re-picked next think.
function leftVehicle(rec: BotRec): void {
    resetSeat(rec);
    rec.reseatUntil = 0;
    rec.lastX = 0;
    rec.lastY = 0;
    rec.lastZ = 0;
    rec.stillSince = 0;
    rec.strikes = 0;
    clearIntent(rec.pid, rec.mind);
}

// A seated bot: eject when the vehicle has not moved (CustomConquest V15: 15 s,
// 3 m), after BOT_VEHICLE_MAX_MS, or when a driver reaches its objective. A
// driver that is not closing on its objective falls back to battlefield AI.
// Never ejected from an aircraft, and a passenger is not ejected for standing
// still or riding too long while a human drives. posScratch holds the bot's
// cached position, which for a seated soldier is the vehicle's position.
//
// Returns true when the bot was ejected, so the caller gives it an objective in
// the same sweep. Left alone for a few seconds, the battlefield AI walked it
// straight back into the seat.
function handleSeated(rec: BotRec, nowMs: number): boolean {
    const x: number = posScratch.x;
    const z: number = posScratch.z;
    if (nowMs < rec.reseatUntil) {
        return false;
    }
    if (rec.seatedAt === 0) {
        // Seated without our boarding: it got in on its own, a player put it in
        // (the 2026-10-02 tank that never moved), or our eject did not take.
        rec.seatedAt = nowMs;
        rec.seatCheckAt = nowMs + BOT_VEHICLE_STUCK_MS;
        rec.seatX = x;
        rec.seatY = posScratch.y;
        rec.seatZ = z;
        rec.boardY = posScratch.y;
        let v: mod.Vehicle | undefined = undefined;
        let vid: number = -1;
        let seat: number = -1;
        try {
            const got: mod.Vehicle = mod.GetVehicleFromPlayer(rec.player);
            if (mod.IsValid(got)) {
                v = got;
                vid = mod.GetObjId(got);
            }
            seat = mod.GetPlayerVehicleSeat(rec.player);
        } catch (e) {
        }
        rec.seatAir = v !== undefined && isAircraft(v, vid);
        rec.seatVeh = v;
        if (rec.ejectPending) {
            // Seen seated before the sweep ever saw it out: our eject did not
            // take. ejectTries keeps counting, so the limit in
            // ejectFromVehicle can trigger however rarely the bot is thought.
            if (BOT_TRACE) {
                log("bots", "pid=" + rec.pid + " eject did not take (try " + rec.ejectTries + ")");
            }
            return false;
        }
        rec.ejectTries = 0;
        if (seat !== 0 && v !== undefined && humanDriven(v)) {
            startRide(rec, v, vid, x, posScratch.y, z, nowMs);
            return false;
        }
        if (seat === 0 && v !== undefined) {
            // The same vehicle it was steering keeps its objective; otherwise
            // its own attack target, or the nearest enemy objective.
            const m: BotMind = rec.mind;
            const obj: number = rec.steerVid === vid && rec.steerObj >= 0
                && nowMs - rec.steerAt < BOT_STEER_REPEAT_MS ? rec.steerObj
                : m.obj >= 0 && m.state === JOB_ATTACK ? m.obj
                    : nearestEnemyObjective(rec.team, x, z);
            if (obj >= 0) {
                steerDriver(rec, v, vid, obj, nowMs);
            }
        }
        return false;
    }
    if (rec.rideVeh !== undefined) {
        const ejected: boolean = handleRide(rec, nowMs);
        if (ejected || rec.rideVeh !== undefined) {
            return ejected;
        }
    }
    if (rec.seatAir) {
        // The one safe way out of an aircraft: parked on the ground. It has not
        // moved (height included, so a falling one does not count) and either
        // nobody is flying it or it is still at the height it was boarded at,
        // that is it never took off - a bot pilot sitting on a shop pad
        // would otherwise block that pad for the rest of the match.
        if (nowMs >= rec.seatCheckAt) {
            const dx: number = x - rec.seatX;
            const dy: number = posScratch.y - rec.seatY;
            const dz: number = z - rec.seatZ;
            const still: boolean = dx * dx + dy * dy + dz * dz < BOT_VEHICLE_STUCK_M * BOT_VEHICLE_STUCK_M;
            if (still && !ridesWithHuman(rec)
                && (pilotless(rec) || Math.abs(posScratch.y - rec.boardY) < AIR_GROUND_DY_M)) {
                return ejectFromVehicle(rec, PARKED_AIRCRAFT, nowMs);
            }
            rec.seatX = x;
            rec.seatY = posScratch.y;
            rec.seatZ = z;
            rec.seatCheckAt = nowMs + BOT_VEHICLE_STUCK_MS;
        }
        // A pilot over its objective is handed to the vehicle AI to fight
        // around it, rather than dropped out of the sky.
        if (rec.driveObj >= 0 && distSqTo(rec.driveObj, x, 0, z) < BOT_VEHICLE_DISMOUNT_M * BOT_VEHICLE_DISMOUNT_M) {
            if (BOT_TRACE) {
                log("bots", "pid=" + rec.pid + " over " + objectiveLabel(rec.driveObj) + " - battlefield AI");
            }
            rec.driveObj = -1;
            try {
                mod.AIBattlefieldBehavior(rec.player);
            } catch (e) {
            }
        }
        return false;
    }
    if (nowMs - rec.seatedAt > BOT_VEHICLE_MAX_MS) {
        if (ridesWithHuman(rec)) {
            rec.seatedAt = nowMs;
            return false;
        }
        return ejectFromVehicle(rec, "max time", nowMs);
    }
    if (nowMs >= rec.seatCheckAt) {
        const dx: number = x - rec.seatX;
        const dz: number = z - rec.seatZ;
        if (dx * dx + dz * dz < BOT_VEHICLE_STUCK_M * BOT_VEHICLE_STUCK_M && !ridesWithHuman(rec)) {
            return ejectFromVehicle(rec, "vehicle stuck", nowMs);
        }
        rec.seatX = x;
        rec.seatZ = z;
        rec.seatCheckAt = nowMs + BOT_VEHICLE_STUCK_MS;
    }
    if (rec.driveObj < 0) {
        return false;
    }
    const d: number = Math.sqrt(distSqTo(rec.driveObj, x, posScratch.y, z));
    if (d < BOT_VEHICLE_DISMOUNT_M) {
        return ejectFromVehicle(rec, "arrived at " + objectiveLabel(rec.driveObj), nowMs);
    }
    if (nowMs >= rec.driveCheckAt) {
        if (rec.driveD - d < BOT_DRIVE_PROGRESS_M) {
            if (BOT_TRACE) {
                log("bots", "pid=" + rec.pid + " steering made no progress to "
                    + objectiveLabel(rec.driveObj) + " (" + String(Math.round(d)) + "m) - battlefield AI");
            }
            rec.driveObj = -1;
            try {
                mod.AIBattlefieldBehavior(rec.player);
            } catch (e) {
            }
            return false;
        }
        rec.driveD = d;
        rec.driveCheckAt = nowMs + BOT_DRIVE_CHECK_MS;
    }
    return false;
}

// One FFI per think per bot; keeps the in-vehicle flag honest whoever put the
// bot in or took it out.
function syncVehicleState(rec: BotRec): void {
    try {
        rec.inVehicle = mod.GetSoldierState(rec.player, mod.SoldierStateBool.IsInVehicle);
    } catch (e) {
        rec.inVehicle = false;
    }
    if (!rec.inVehicle && rec.seatedAt !== 0 && stillAboard(rec)) {
        rec.inVehicle = true;
    }
}

// A bot seated in a vehicle that IsInVehicle reports as out. The third
// 2026-10-02 playtest had passengers in the owner's helicopter on foot about
// 10 s after boarding; if the flag was wrong, treating them as out handed them
// a walking order that made them climb out for real. Checks the vehicle's own
// occupant list (only for bots we think are seated, so rarely) and logs which
// case it was.
function stillAboard(rec: BotRec): boolean {
    const v: mod.Vehicle | undefined = rec.seatVeh;
    if (v === undefined) {
        return false;
    }
    try {
        if (!mod.IsValid(v)) {
            return false;
        }
        const arr: mod.Array = mod.GetAllPlayersInVehicle(v);
        const n: number = mod.CountOf(arr);
        for (let i: number = 0; i < n; i++) {
            if (mod.GetObjId(mod.ValueInArray(arr, i) as mod.Player) === rec.pid) {
                if (BOT_TRACE && Date.now() - rec.seatedAt < 20000) {
                    log("bots", "pid=" + rec.pid + " IsInVehicle false but still aboard vehicle "
                        + mod.GetObjId(v));
                }
                return true;
            }
        }
    } catch (e) {
    }
    return false;
}

let traceAt: number = 0;

// BOT_TRACE: one line per team, e.g.
//   "t1 plan: bunker1 A3, site2 H5 | walk-veh 1, in-veh 2, fight 4, idle 0"
// (H hold, A attack, D defend, C capture; roam counts bots with nothing to
// pick), so a playtest log shows whether bots split up.
function tracePlan(nowMs: number): void {
    if (!BOT_TRACE || nowMs - traceAt < BOT_TRACE_MS) {
        return;
    }
    traceAt = nowMs;
    const letters: string = "HADC";
    for (let team: number = 1; team <= 2; team++) {
        const counts: { [key: string]: number } = {};
        const order: string[] = [];
        let veh: number = 0;
        let walkVeh: number = 0;
        let fight: number = 0;
        let idle: number = 0;
        let roam: number = 0;
        for (const pid of botOrder) {
            const rec: BotRec | undefined = bots[pid];
            if (rec === undefined || rec.dead || rec.team !== team) {
                continue;
            }
            if (rec.inVehicle) {
                veh++;
                continue;
            }
            if (rec.approachVid >= 0) {
                walkVeh++;
                continue;
            }
            if (inBattle(rec.mind, nowMs)) {
                fight++;
                continue;
            }
            const m: BotMind = rec.mind;
            if (m.state === JOB_ROAM) {
                roam++;
                continue;
            }
            if (m.obj < 0 || m.obj >= objectiveCount() || m.state < 0) {
                idle++;
                continue;
            }
            const key: string = objectiveLabel(m.obj) + " " + letters.charAt(m.state);
            if (counts[key] === undefined) {
                counts[key] = 0;
                order.push(key);
            }
            counts[key]++;
        }
        const parts: string[] = [];
        for (const k of order) {
            parts.push(k + String(counts[k]));
        }
        log("bots", "t" + team + " plan: " + (parts.length > 0 ? parts.join(", ") : "-")
            + " | walk-veh " + walkVeh + ", in-veh " + veh + ", fight " + fight + ", roam " + roam
            + ", idle " + idle);
    }
}

// The waypoint link a routed bot is walking right now, as [from, to] graph
// nodes, or undefined when it is not on a link (walking direct, or still
// heading for the first waypoint from wherever it stood).
function currentLink(m: BotMind): number[] | undefined {
    if (m.legFrom < 0) {
        return undefined;
    }
    if (m.leg >= 0) {
        return [m.legFrom, m.leg];
    }
    if (m.obj >= 0 && m.navObj === m.obj) {
        return [m.legFrom, objectiveNode(m.obj)];
    }
    return undefined;
}

// One FFI per think for a bot walking to an objective. After two thinks in the
// water: log it (BOT_TRACE), and if the bot is on a waypoint link, make that
// link expensive for every bot so routes go round over land from then on.
// Runs only with waypoints on the map or BOT_TRACE on.
function checkSwim(rec: BotRec, x: number, z: number, nowMs: number): void {
    const m: BotMind = rec.mind;
    if (m.state !== JOB_ATTACK || m.obj < 0 || inBattle(m, nowMs)) {
        rec.wetFor = 0;
        return;
    }
    let wet: boolean = false;
    try {
        wet = mod.GetSoldierState(rec.player, mod.SoldierStateBool.IsInWater);
    } catch (e) {
    }
    if (!wet) {
        rec.wetFor = 0;
        return;
    }
    rec.wetFor++;
    if (rec.wetFor !== 2) {
        return;
    }
    if (BOT_TRACE) {
        log("bots", "pid=" + rec.pid + " t" + rec.team + " swimming to " + objectiveLabel(m.obj)
            + " at (" + String(Math.round(x)) + ", " + String(Math.round(z)) + "), "
            + String(Math.round(Math.sqrt(distSqTo(m.obj, x, 0, z)))) + "m to go");
    }
    const link: number[] | undefined = currentLink(m);
    if (link !== undefined) {
        penalizeLink(link[0], link[1], BOT_NAV_WATER_PENALTY, "bot swam");
        m.state = -1;
        m.navObj = -1;
    }
}

// A routed bot reaching its waypoint must not wait up to four sweeps for its
// next think, so every sweep checks all routed or roaming bots against their
// waypoint (cached positions, no FFI) and re-thinks the ones that arrived.
function advanceLegs(nowMs: number): void {
    const reachSq: number = BOT_NAV_REACH_M * BOT_NAV_REACH_M;
    for (const pid of botOrder) {
        const rec: BotRec | undefined = bots[pid];
        if (rec === undefined || rec.dead || rec.inVehicle || rec.approachVid >= 0) {
            continue;
        }
        const m: BotMind = rec.mind;
        if (m.leg < 0 || inBattle(m, nowMs) || !readPos(pid)) {
            continue;
        }
        if (nodeDistSq(m.leg, posScratch.x, posScratch.z) >= reachSq) {
            continue;
        }
        try {
            thinkBot(rec.player, pid, rec.team, posScratch.x, posScratch.y, posScratch.z, m, nowMs);
        } catch (e) {
            log("bots", "leg advance failed pid=" + pid + ": " + String(e));
        }
    }
}

// Persistent bots, every BOT_MAINTAIN_MS: deploys a bot that has been dead too
// long, tops a team up to its target (BOT_TEAM_SLOTS less its humans, at most
// BOT_COUNT_PER_TEAM) when a bot left the game, and makes room when a human
// joined a full team. A persistent AI cannot be removed directly, so its
// team's spawners unspawn on death for a moment while one bot is killed.
let maintainAt: number = 0;
let trimUntil: number = 0;

function queuedFor(team: number): number {
    let n: number = 0;
    for (const q of spawnQueue) {
        if (q.team === team) {
            n++;
        }
    }
    return n;
}

function maintainPopulation(nowMs: number): void {
    if (!BOT_PERSISTENT || nowMs - maintainAt < BOT_MAINTAIN_MS) {
        return;
    }
    maintainAt = nowMs;
    for (const pid of botOrder) {
        const rec: BotRec | undefined = bots[pid];
        if (rec === undefined || !rec.dead || rec.deadAt === 0 || nowMs - rec.deadAt < BOT_REDEPLOY_WATCHDOG_MS) {
            continue;
        }
        // Retried every 10 s while it stays dead.
        rec.deadAt = nowMs - BOT_REDEPLOY_WATCHDOG_MS + 10000;
        try {
            if (mod.IsValid(rec.player)) {
                mod.DeployPlayer(rec.player);
                log("bots", "pid=" + pid + " t" + rec.team + " not redeployed, deploying by force");
            }
        } catch (e) {
            log("bots", "pid=" + pid + " force deploy failed: " + String(e));
        }
    }
    if (trimUntil !== 0) {
        if (nowMs < trimUntil) {
            return;
        }
        trimUntil = 0;
        for (const t of [1, 2]) {
            for (const sp of spawnerByTeam[t]) {
                try {
                    mod.AISetUnspawnOnDead(sp, false);
                } catch (e) {
                }
            }
        }
    }
    countHumans();
    for (const team of [1, 2]) {
        if (spawnerByTeam[team].length === 0) {
            continue;
        }
        const target: number = Math.min(BOT_COUNT_PER_TEAM, BOT_TEAM_SLOTS - humansScratch[team]);
        const have: number = presentCount(team);
        const missing: number = target - have - queuedFor(team);
        for (let i: number = 0; i < missing; i++) {
            queueSpawn(team, "");
        }
        if (have > target && trimBot(team)) {
            return;
        }
    }
}

// Removes one bot from a team that is over its slots: a live bot on foot is
// killed while its team's spawners unspawn on death. (A dead one is not used:
// whether the flag still applies to a death that already happened is
// unknown.)
function trimBot(team: number): boolean {
    let pick: BotRec | undefined = undefined;
    for (const pid of botOrder) {
        const rec: BotRec | undefined = bots[pid];
        if (rec !== undefined && rec.team === team && !rec.dead && !rec.inVehicle) {
            pick = rec;
            break;
        }
    }
    if (pick === undefined) {
        return false;
    }
    for (const sp of spawnerByTeam[team]) {
        try {
            mod.AISetUnspawnOnDead(sp, true);
        } catch (e) {
        }
    }
    trimUntil = Date.now() + BOT_CORPSE_SECONDS * 1000 + 2000;
    log("bots", "team " + team + " over its slots, removing pid=" + pick.pid);
    try {
        mod.Kill(pick.player);
    } catch (e) {
    }
    return true;
}

// Rewrites every live bot's scoreboard row each BOT_ROW_REFRESH_MS, and once a
// minute logs how many writes worked, the last error, how many bots have no
// name (so no score record across lives) and one bot with score, so the log
// tells a failing write from a score that is never counted.
let rowsAt: number = 0;
let rowsLogAt: number = 0;
let rowsOk: number = 0;
let rowsFail: number = 0;
let rowErr: string = "";

function refreshBotRows(nowMs: number): void {
    if (nowMs - rowsAt < BOT_ROW_REFRESH_MS) {
        return;
    }
    rowsAt = nowMs;
    let unnamed: number = 0;
    let sample: string = "";
    for (const pid of botOrder) {
        const rec: BotRec | undefined = bots[pid];
        if (rec === undefined || rec.dead || !mod.IsValid(rec.player)) {
            continue;
        }
        if (rec.nameKey === "") {
            unnamed++;
        }
        const err: string = writeRow(rec.player);
        if (err !== "") {
            rowsFail++;
            rowErr = err;
            continue;
        }
        rowsOk++;
        const s: PlayerStats = statsOf(pid);
        if (sample === "" && s.score + s.kills + s.deaths > 0) {
            sample = "pid=" + pid + " " + rec.team + ":" + rec.nameKey + " score " + s.score
                + " k " + s.kills + " d " + s.deaths;
        }
    }
    if (nowMs - rowsLogAt < 60000) {
        return;
    }
    rowsLogAt = nowMs;
    log("scoreboard", "bot rows: " + rowsOk + " written, " + rowsFail + " failed"
        + (rowErr !== "" ? " (last error: " + rowErr + ")" : "")
        + ", " + unnamed + " bots without a name"
        + (sample !== "" ? ", e.g. " + sample : ", no bot has any score yet"));
    rowsOk = 0;
    rowsFail = 0;
    rowErr = "";
}

function sweep(): void {
    maintainPopulation(Date.now());
    drainSpawns();
    refreshBotRows(Date.now());
    if (ownersNeedRefresh()) {
        refreshOwners();
        markFullRethink();
    }
    // Degraded engine: keep the population correct, skip the thinking.
    // Same 0.7 gate the Rorsch probe uses.
    if (healthFactor() < 0.7) {
        return;
    }
    const nowMs: number = Date.now();
    scanVehicles(nowMs);
    // Owner and enemy pressure for the scorer, once per sweep per team. Claims
    // are kept live by the ledger as bots pick during the sweep.
    refreshScoreSnapshot(1);
    refreshScoreSnapshot(2);
    tracePlan(nowMs);
    const n: number = botOrder.length;
    if (n === 0) {
        return;
    }
    const count: number = fullRethink ? n : Math.min(BOT_SLICE, n);
    for (let k: number = 0; k < count; k++) {
        const pid: number = botOrder[cursor % n];
        cursor++;
        const rec: BotRec | undefined = bots[pid];
        if (rec === undefined || rec.dead) {
            continue;
        }
        try {
            if (!mod.IsValid(rec.player)) {
                continue;
            }
            if (!readPos(pid)) {
                continue;
            }
            syncVehicleState(rec);
            if (!rec.inVehicle) {
                rec.ejectPending = false;
            }
            if (rec.inVehicle) {
                // Position-based stuck detection cannot tell a parked bot from a
                // driver, so seated bots have their own checks.
                endApproach(rec);
                if (!handleSeated(rec, nowMs)) {
                    continue;
                }
            } else if (rec.seatedAt !== 0) {
                if (nowMs < rec.reseatUntil) {
                    // Mid exit-and-reseat for steering.
                    continue;
                }
                if (tryRejoinRide(rec, nowMs) || tryReseat(rec, nowMs)) {
                    continue;
                }
                // Out of the vehicle without our eject (vehicle destroyed, the
                // engine, or a steer re-seat that did not take): on foot for a
                // while, so it does not walk straight back into the same seat.
                if (BOT_TRACE) {
                    log("bots", "pid=" + rec.pid + " left its vehicle on its own after "
                        + String(Math.round((nowMs - rec.seatedAt) / 1000)) + "s");
                }
                leftVehicle(rec);
                rec.ejectTries = 0;
                rec.vehicleBanUntil = nowMs + BOT_VEHICLE_BAN_MS;
            }
            if (BOT_TRACE || navActive()) {
                checkSwim(rec, posScratch.x, posScratch.z, nowMs);
            }
            if (rec.approachVid >= 0) {
                if (tickApproach(rec, posScratch.x, posScratch.y, posScratch.z, nowMs) || rec.inVehicle) {
                    continue;
                }
            }
            if (handleStuck(rec, posScratch.x, posScratch.y, posScratch.z, nowMs)) {
                // Recycled: mod.Kill routes it through the ordinary death and
                // respawn path, so it comes back at a spawner instead of
                // wedged. Skip this think, the body is going away.
                continue;
            }
            if (maybeJoinPlayer(rec, posScratch.x, posScratch.y, posScratch.z, nowMs)) {
                continue;
            }
            thinkBot(rec.player, pid, rec.team, posScratch.x, posScratch.y, posScratch.z, rec.mind, nowMs);
            maybeApproachVehicle(rec, posScratch.x, posScratch.y, posScratch.z, nowMs);
        } catch (e) {
            log("bots", "think failed pid=" + pid + ": " + String(e));
        }
    }
    fullRethink = false;
    if (navActive()) {
        advanceLegs(nowMs);
    }
}

function markFullRethink(): void {
    fullRethink = true;
}

// Bunker spawning, the CustomConquest V15 AI_ObjectiveSpawn pattern: bots can
// not spawn on a CapturePoint natively, so every bot spawns at its AI_Spawner
// and BOT_BUNKER_SPAWN_CHANCE of them are then teleported onto the flag of a
// random bunker their team owns (pickSpawnObjective). The rest start at the
// spawner, as in the template. Bunkers only, never the resource or factory
// AreaTriggers.
//
// The teleport runs BOT_TELEPORT_DELAY_MS after deploy, as the template waits
// 0.5 s after OnSpawnerSpawned: done at once from OnPlayerDeployed it was
// logged 69 times in the 2026-10-02 playtest and no bot ever arrived. The
// bunker is picked when the teleport runs, so ownership is current. The
// destination is the native CapturePoint's position, moved 1 m in a per-bot
// direction so a wave of respawns does not land on one exact point.
//
// A team that owns no bunker leaves the bot at its spawner.
function teleportToObjective(team: number, pid: number): void {
    if (Math.random() >= BOT_BUNKER_SPAWN_CHANCE) {
        return;
    }
    const rec: BotRec | undefined = bots[pid];
    if (rec === undefined) {
        return;
    }
    const h: Timers.TimerID | null = Timers.setTimeout(() => {
        safe("bots.teleport", () => { teleportNow(rec, pid); });
    }, BOT_TELEPORT_DELAY_MS);
    if (h === null) {
        log("bots", "pid=" + pid + " t" + team + " bunker teleport skipped, no timer");
    }
}

function teleportNow(rec: BotRec, pid: number): void {
    if (bots[pid] !== rec || rec.dead || rec.inVehicle || !mod.IsValid(rec.player)) {
        return;
    }
    const team: number = rec.team;
    const idx: number = pickSpawnObjective(team, Math.random());
    if (idx < 0) {
        if (willLogDebug()) {
            log("bots", "pid=" + pid + " stays at spawner, team owns no bunker");
        }
        return;
    }
    try {
        const cp: mod.CapturePoint | undefined = bunkerCapturePoint(idx);
        if (cp === undefined) {
            log("bots", "pid=" + pid + " bunker " + objectiveKey(idx) + " has no CapturePoint");
            return;
        }
        // Orientation 0: the template also passes a fixed 1. Bots re-aim on their
        // first think, so this only decides which way they face as they land.
        const ang: number = (((pid * 2654435761) >>> 0) % 360) * Math.PI / 180;
        const target: mod.Vector = mod.Add(mod.GetObjectPosition(cp),
            mod.CreateVector(Math.cos(ang), 0, Math.sin(ang)));
        mod.Teleport(rec.player, target, 0);
        // The mind thinks it is at the spawner, so a stale intent would walk
        // it straight back out. Clear it and let the next sweep re-decide.
        rec.mind.state = -1;
        rec.mind.obj = idx;
        rec.mind.speed = -1;
        rec.mind.age = 0;
        rec.mind.navObj = -1;
        rec.mind.leg = -1;
        rec.mind.legFrom = -1;
        endApproach(rec);
        rec.lastX = 0;
        rec.lastY = 0;
        rec.lastZ = 0;
        if (BOT_TRACE) {
            log("bots", "pid=" + pid + " t" + team + " teleported to " + objectiveLabel(idx));
            const tv: Vectors.Vector3 = Vectors.toVector3(target);
            Timers.setTimeout(() => {
                safe("bots.teleport.check", () => { checkTeleport(rec, pid, idx, tv.x, tv.z); });
            }, 1500);
        }
    } catch (e) {
        log("bots", "teleport failed pid=" + pid + ": " + String(e));
    }
}

// BOT_TRACE: did the teleport stick? One log line per teleport.
function checkTeleport(rec: BotRec, pid: number, idx: number, tx: number, tz: number): void {
    if (bots[pid] !== rec || rec.dead || !readPos(pid)) {
        return;
    }
    const dx: number = posScratch.x - tx;
    const dz: number = posScratch.z - tz;
    const d: number = Math.round(Math.sqrt(dx * dx + dz * dz));
    if (d <= 15) {
        log("bots", "pid=" + pid + " teleport took (" + objectiveLabel(idx) + ")");
    } else {
        log("bots", "pid=" + pid + " teleport did not take: " + d + "m from " + objectiveLabel(idx)
            + " at (" + String(Math.round(posScratch.x)) + ", " + String(Math.round(posScratch.z)) + ")");
    }
}

// A bot is stuck when it has barely moved across a whole window of thinks while
// walking to an attack target. Only walks count: a holding, capturing or
// defending bot barely moves by design, and the old check killed those as stuck
// (the 18:52 wave in the playtest). An attacker standing near the point but
// outside its volume counts too: it was neither capturing nor checked, so it
// could stand beside a bunker for ever. The ladder, one rung per window:
//   1. jump and re-issue the same move (most stalls are a ledge or a fence);
//   2. jump again; on a waypoint link (not near the goal), make that link more
//      expensive for every bot and re-plan, otherwise give up on the target for
//      this bot (botbrain.giveUp, kept across respawns) so it re-picks;
//   3. the same without the jump;
//   4. kill it, so it respawns at a spawner.
//
// Returns true when the bot was recycled and should not be thought this sweep.
function handleStuck(rec: BotRec, x: number, y: number, z: number, nowMs: number): boolean {
    const mind: BotMind = rec.mind;
    const reach: number = mind.obj >= 0 ? objectiveRadius(mind.obj) + 3 : 0;
    const attacking: boolean = mind.state === JOB_ATTACK && mind.obj >= 0 && !inBattle(mind, nowMs);
    const near: boolean = attacking && distSqTo(mind.obj, x, y, z) <= reach * reach;
    const walking: boolean = attacking && (!near || !isOccupant(mind.obj, rec.pid));
    if (!walking) {
        rec.stillSince = 0;
        rec.strikes = 0;
        return false;
    }
    // No window yet (fresh spawn, teleport, just walked off a stall), or moved
    // away from the window's spot: start a new window here.
    const dx: number = x - rec.lastX;
    const dy: number = y - rec.lastY;
    const dz: number = z - rec.lastZ;
    const fresh: boolean = rec.stillSince === 0 || (rec.lastX === 0 && rec.lastY === 0 && rec.lastZ === 0);
    const movedSq: number = dx * dx + dy * dy + dz * dz;
    if (fresh || movedSq > BOT_STUCK_MIN_M * BOT_STUCK_MIN_M) {
        if (!fresh && movedSq > 9 * BOT_STUCK_MIN_M * BOT_STUCK_MIN_M) {
            // Clearly walked off the stall: a later stall starts the ladder over.
            rec.strikes = 0;
        }
        rec.lastX = x;
        rec.lastY = y;
        rec.lastZ = z;
        rec.stillSince = nowMs;
        return false;
    }
    if (nowMs - rec.stillSince < BOT_STUCK_WINDOW_MS) {
        return false;
    }
    rec.stillSince = nowMs;
    rec.strikes++;
    if (near) {
        // Beside the point but outside its volume: jump and walk in again,
        // never give the point up or recycle the bot for it.
        rec.strikes = 0;
        try {
            mod.SetAiInput(rec.player, mod.AiInput.Jump, BOT_JUMP_S);
        } catch (e) {
        }
        if (BOT_TRACE) {
            log("bots", "pid=" + rec.pid + " stuck beside " + objectiveLabel(mind.obj) + ", jumping");
        }
        mind.state = -1;
        return false;
    }
    if (rec.strikes < BOT_STUCK_STRIKES) {
        if (rec.strikes <= 2) {
            try {
                mod.SetAiInput(rec.player, mod.AiInput.Jump, BOT_JUMP_S);
            } catch (e) {
            }
        }
        if (rec.strikes === 1) {
            if (BOT_TRACE) {
                log("bots", "pid=" + rec.pid + " t" + rec.team + " stuck on the way to " + objectiveLabel(mind.obj)
                    + " at (" + Math.round(x) + ", " + Math.round(y) + ", " + Math.round(z) + "), "
                    + Math.round(Math.sqrt(distSqTo(mind.obj, x, y, z))) + "m to go, jumping");
            }
            // Force the next think to issue the move again.
            mind.state = -1;
            return false;
        }
        // On a waypoint link, blame the link rather than the objective: every
        // bot routes around it from now on, and this one re-plans.
        const link: number[] | undefined = near ? undefined : currentLink(mind);
        if (link !== undefined) {
            penalizeLink(link[0], link[1], BOT_NAV_STUCK_PENALTY, "bot stuck");
            mind.state = -1;
            mind.navObj = -1;
            return false;
        }
        giveUp(rec.pid, mind, nowMs, "stuck");
        return false;
    }
    rec.strikes = 0;
    giveUp(rec.pid, mind, nowMs, "stuck, recycling");
    log("bots", "pid=" + rec.pid + " stuck, recycling");
    try {
        mod.AIIdleBehavior(rec.player);
        mod.Kill(rec.player);
    } catch (e) {
        log("bots", "stuck recycle failed pid=" + rec.pid + ": " + String(e));
    }
    return true;
}

export function initBots(): void {
    if (botsInited) {
        // A second OnGameModeStarted must not append a second copy of every
        // spawner to the pool or re-queue the whole initial burst on top of the
        // live population. initBotObjectives guards its own state, but the
        // spawner arrays and the queue below are module level, so without this
        // they accumulate.
        log("bots", "already initialised, ignoring repeat init");
        return;
    }
    botsInited = true;
    initBotNames();
    initBotObjectives();
    initNav();
    // PlayerLocations is the vetted zero-FFI position cache: it subscribes to
    // its own tick updates on initialize, so the bot sweep can read every
    // bot's position and every proximity query from memory instead of calling
    // mod.GetSoldierState per bot per second. initialize() is idempotent, and it
    // is safe to call here because the module owns its own subscriptions.
    try {
        PlayerLocations.initialize();
    } catch (e) {
        log("bots", "PlayerLocations init failed: " + String(e));
    }
    if (!fixerWired) {
        fixerWired = true;
        // Import-only activation plus quota-safe logging. The fixer re-fires
        // our OnPlayerUndeploy subscriber for bots stuck in deploy limbo;
        // that subscriber is idempotent, as the fixer README requires.
        PlayerUndeployFixer.setLogging((text: string) => {
            try {
                log("undeploy", text);
            } catch (e) {
            }
        }, PlayerUndeployFixer.LogLevel.Warning, false);
    }
    for (const def of AI_SPAWNERS) {
        if (def.spawnerId <= 0) {
            continue;
        }
        try {
            const sp: mod.Spawner = mod.GetSpawner(def.spawnerId);
            if (!mod.IsValid(sp)) {
                log("bots", "spawner " + def.spawnerId + " did not resolve");
                continue;
            }
            spawnerByTeam[def.team].push(sp);
            mod.AISetUnspawnOnDead(sp, !BOT_PERSISTENT);
            mod.SetUnspawnDelayInSeconds(sp, BOT_CORPSE_SECONDS);
            log("bots", "spawner " + def.spawnerId + " bound for team " + def.team);
        } catch (e) {
            log("bots", "spawner " + def.spawnerId + " failed: " + String(e));
        }
    }
    if (spawnerByTeam[1].length === 0 && spawnerByTeam[2].length === 0) {
        log("bots", "no AI spawners configured - bot system idle");
        return;
    }
    try {
        mod.SetAIToHumanDamageModifier(BOT_DAMAGE_MULT);
    } catch (e) {
        log("bots", "damage modifier refused: " + String(e));
    }
    // Initial burst goes through the same drain queue as respawns, so mode
    // start never fires 48 spawns in one tick.
    for (let i: number = 0; i < BOT_COUNT_PER_TEAM; i++) {
        queueSpawn(1, "");
        queueSpawn(2, "");
    }
    if (sweepTimer === null) {
        sweepTimer = Timers.setInterval(() => { safe("bots.sweep", sweep); }, BOT_SWEEP_MS);
        if (sweepTimer === null) {
            logAdmin("bots", "FATAL: Timers pool full, bot sweep not scheduled");
        }
    }
    log("bots", "init: spawners t1=" + spawnerByTeam[1].length
        + " t2=" + spawnerByTeam[2].length
        + " queued=" + spawnQueue.length);
}

export function configureBotEvents(): void {
    Events.OnSpawnerSpawned.subscribe((p: mod.Player) => {
        safe("bots.spawned", () => { onSpawnerSpawned(p); });
    });
    Events.OnPlayerDied.subscribe((victim: mod.Player) => {
        safe("bots.died", () => {
            const pid: number = mod.GetObjId(victim);
            if (isBotPid(pid)) {
                onBotDead(pid);
            }
        });
    });
    Events.OnPlayerUndeploy.subscribe((p: mod.Player) => {
        safe("bots.undeployed", () => {
            const pid: number = mod.GetObjId(p);
            if (isBotPid(pid)) {
                onBotUndeployed(p, pid);
            }
        });
    });
    Events.OnPlayerLeaveGame.subscribe((id: number) => {
        safe("bots.leave", () => {
            if (isBotPid(id)) {
                forgetBot(id);
            }
        });
    });
    Events.OnPlayerDeployed.subscribe((p: mod.Player) => {
        safe("bots.deployed", () => {
            if (!isBotPlayer(p)) {
                return;
            }
            const pid: number = mod.GetObjId(p);
            const team: number = teamIdOf(p);
            if (team !== 1 && team !== 2) {
                return;
            }
            registerBot(p, pid, team, false);
            // Incoming damage scaling has to wait for deployment. Calling it from
            // the spawn event threw PlayerNotDeployed for every one of the 48
            // bots, so the factor was never actually applied.
            //
            // The Rorsch is deliberately NOT stripped here. Bots never receive
            // one (the gadget grant is gated to human players), so RemoveEquipment
            // threw NoSpecifiedWeapon twice per bot for an absent weapon. nuke.ts
            // skips bots with a set lookup, so they can never fire it anyway.
            safe("bots.incoming", () => {
                mod.SetPlayerIncomingDamageFactor(p, BOT_INCOMING_DAMAGE);
            });
            if (BOT_PERSISTENT) {
                safe("bots.redeploy", () => {
                    mod.SetRedeployTime(p, BOT_REDEPLOY_S);
                });
            }
            teleportToObjective(team, pid);
        });
    });
    Events.OnVehicleSpawned.subscribe((v: mod.Vehicle) => {
        safe("bots.vehspawned", () => {
            const vid: number = mod.GetObjId(v);
            delete airByVid[vid];
            delete seatsByVid[vid];
        });
    });
    Events.OnAIMoveToFailed.subscribe((p: mod.Player) => {
        safe("bots.movefail", () => { onMoveFailed(p); });
    });
    Events.OnPlayerDamaged.subscribe((victim: mod.Player, damager: mod.Player) => {
        safe("bots.damaged", () => { onDamaged(victim, damager); });
    });
    // Ownership flips invalidate every brain next sweep. The dirty flag lives
    // in botobjectives; the sweep consumes it (see sweep()).
    markOwnersDirty();
}

// Diagnostics for the DEBUG tab, split into numeric accessors rather than one
// composed string. mod.Message will not substitute a string into a {} slot (it
// renders as <string>), so each value has to be passed as a number. Zero FFI.
export function botLiveCount(team: number): number {
    return liveCount(team);
}

export function botRosterSize(): number {
    return botOrder.length;
}
