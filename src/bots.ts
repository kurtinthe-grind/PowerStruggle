import { Events } from "bf6-portal-utils/events";
import { Timers } from "bf6-portal-utils/timers";
import { Vectors } from "bf6-portal-utils/vectors";
import { PlayerLocations } from "bf6-portal-utils/player-locations";
import { PlayerUndeployFixer } from "bf6-portal-utils/player-undeploy-fixer";
import { log, logAdmin, safe, willLogDebug } from "./util/log";
import { healthFactor } from "./util/perf";
import { isEnemyTeam, teamIdOf } from "./util/roster";
import { teamHandle } from "./teams";
import { AI_SPAWNERS } from "./objids";
import { claimBotName, initBotNames, releaseBotName, takeBotName } from "./botnames";
import {
    BOT_ARRIVE_M, BOT_CORPSE_SECONDS, BOT_COUNT_PER_TEAM, BOT_DAMAGE_MULT, BOT_DRIVE_CHECK_MS,
    BOT_DRIVE_PROGRESS_M, BOT_INCOMING_DAMAGE, BOT_RESPAWN_DELAY_MS, BOT_SLICE,
    BOT_SPAWN_PER_SWEEP, BOT_STUCK_MIN_M, BOT_STUCK_STRIKES, BOT_STUCK_WINDOW_SWEEPS,
    BOT_SWEEP_MS, BOT_TRACE, BOT_TRACE_MS, BOT_VEHICLE_APPROACH_MS, BOT_VEHICLE_DISMOUNT_M,
    BOT_VEHICLE_FREE_SEATS, BOT_VEHICLE_MAX_MS, BOT_VEHICLE_MIN_TRIP_M, BOT_VEHICLE_RADIUS_M,
    BOT_VEHICLE_SCAN_MS, BOT_VEHICLE_SEAT_M, BOT_VEHICLE_STUCK_M, BOT_VEHICLE_STUCK_MS
} from "./config";
import {
    bunkerCapturePoint, distSqTo, dropOccupant, initBotObjectives, markOwnersDirty,
    objectiveCount, objectiveKey, objectiveLabel, objectiveVector, ownersNeedRefresh,
    pickSpawnObjective, refreshOwners, refreshScoreSnapshot, releaseClaim
} from "./botobjectives";
import {
    BotMind, clearIntent, enterBattle, giveUp, inBattle, newMind, noteMoveFailed, thinkBot
} from "./botbrain";
import { JOB_ATTACK } from "./botscore";

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
    // Stuck tracking. lastX/Y/Z is the previous think position, stillFor counts
    // consecutive thinks that moved less than BOT_STUCK_MIN_M, strikes counts
    // windows that have passed without the bot escaping.
    lastX: number;
    lastY: number;
    lastZ: number;
    stillFor: number;
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
    seatZ: number;
    seatCheckAt: number;
    // Driver steering toward an objective: -1 when not steering. driveD is the
    // vehicle's distance to it at the last progress check.
    driveObj: number;
    driveD: number;
    driveCheckAt: number;
}

const respawnPending: { [pid: number]: boolean } = {};

const bots: { [pid: number]: BotRec } = {};
const botOrder: number[] = [];
const botPidSet: { [pid: number]: boolean } = {};
const spawnerByTeam: { [team: number]: mod.Spawner[] } = { 1: [], 2: [] };
const spawnQueue: number[] = [];

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

function queueSpawn(team: number): void {
    if (team !== 1 && team !== 2) {
        return;
    }
    spawnQueue.push(team);
}

function drainSpawns(): void {
    let n: number = 0;
    while (n < BOT_SPAWN_PER_SWEEP && spawnQueue.length > 0) {
        const team: number = spawnQueue[0];
        if (liveCount(team) >= BOT_COUNT_PER_TEAM) {
            spawnQueue.shift();
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
        const nameKey: string = takeBotName(team);
        try {
            mod.SpawnAIFromAISpawner(sp, cls, mod.Message(nameKey), handle);
        } catch (e) {
            releaseBotName(team, nameKey);
            log("bots", "spawn failed team " + team + ": " + String(e));
        }
    }
}

function registerBot(p: mod.Player, pid: number, team: number): BotRec {
    let rec: BotRec | undefined = bots[pid];
    if (rec === undefined) {
        rec = {
            pid: pid, team: team, player: p, mind: newMind(), dead: false, nameKey: "",
            lastX: 0, lastY: 0, lastZ: 0, stillFor: 0, strikes: 0, inVehicle: false,
            approachVeh: undefined, approachVid: -1, approachUntil: 0,
            seatedAt: 0, seatX: 0, seatZ: 0, seatCheckAt: 0,
            driveObj: -1, driveD: 0, driveCheckAt: 0
        };
        bots[pid] = rec;
        botOrder.push(pid);
        log("bots", "registered pid=" + pid + " team=" + team);
    } else {
        rec.player = p;
        rec.team = team;
        rec.dead = false;
        rec.stillFor = 0;
        rec.strikes = 0;
        rec.inVehicle = false;
        endApproach(rec);
        resetSeat(rec);
    }
    botPidSet[pid] = true;
    // The name was queued by drainSpawns before the engine spawned this
    // soldier, so claiming it here pairs the key with the real player id.
    const claimed: string = claimBotName(team);
    if (claimed !== "") {
        rec.nameKey = claimed;
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
    // The claim goes; the per-pid fail memory in botbrain deliberately stays,
    // because the respawned bot comes back with the same pid.
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
    const team: number = teamIdOf(p);
    if (team !== 1 && team !== 2) {
        return;
    }
    registerBot(p, pid, team);
    if (willLogDebug()) {
        log("bots", "spawned pid=" + pid + " team=" + team + " live=" + liveCount(team));
    }
}

function onBotDead(pid: number): void {
    const rec: BotRec | undefined = bots[pid];
    if (rec !== undefined) {
        if (!rec.dead) {
            rec.dead = true;
            scheduleRespawn(pid, rec.team);
        }
        endApproach(rec);
        resetSeat(rec);
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
function scheduleRespawn(pid: number, team: number): void {
    if (team !== 1 && team !== 2) {
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
                queueSpawn(team);
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
    scheduleRespawn(pid, team);
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
            if (mod.CountOf(mod.GetAllPlayersInVehicle(v)) >= BOT_VEHICLE_FREE_SEATS) {
                continue;
            }
            vehicleCand.push(v);
        } catch (e) {
        }
    }
    if (willLogDebug() && vehicleCand.length > 0) {
        log("bots", "vehicle scan: " + vehicleCand.length + " with a free seat");
    }
}

function endApproach(rec: BotRec): void {
    if (rec.approachVid >= 0 && vehicleReservedBy[rec.approachVid] === rec.pid) {
        delete vehicleReservedBy[rec.approachVid];
    }
    rec.approachVeh = undefined;
    rec.approachVid = -1;
    rec.approachUntil = 0;
}

function resetSeat(rec: BotRec): void {
    rec.seatedAt = 0;
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
    if (vehicleCand.length === 0 || mind.state !== JOB_ATTACK || mind.obj < 0 || inBattle(mind, nowMs)) {
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
    } else if (mod.CountOf(mod.GetAllPlayersInVehicle(v)) >= BOT_VEHICLE_FREE_SEATS) {
        why = "vehicle full";
    }
    if (why !== "") {
        if (BOT_TRACE) {
            log("bots", "pid=" + rec.pid + " drops vehicle " + rec.approachVid + " (" + why + ")");
        }
        endApproach(rec);
        return false;
    }
    const dx: number = vScratch.x - x;
    const dy: number = vScratch.y - y;
    const dz: number = vScratch.z - z;
    if (dx * dx + dy * dy + dz * dz > BOT_VEHICLE_SEAT_M * BOT_VEHICLE_SEAT_M) {
        return true;
    }
    const vid: number = rec.approachVid;
    const driver: boolean = !mod.IsVehicleSeatOccupied(v, 0);
    endApproach(rec);
    mod.ForcePlayerToSeat(rec.player, v, driver ? 0 : -1);
    rec.inVehicle = true;
    rec.seatedAt = nowMs;
    rec.seatX = vScratch.x;
    rec.seatZ = vScratch.z;
    rec.seatCheckAt = nowMs + BOT_VEHICLE_STUCK_MS;
    const obj: number = rec.mind.obj;
    if (driver && obj >= 0) {
        steerDriver(rec, obj, vScratch.y, nowMs);
    } else {
        mod.AIBattlefieldBehavior(rec.player);
    }
    if (BOT_TRACE) {
        log("bots", "pid=" + rec.pid + " boarded vehicle " + vid + (driver ? " as driver" : " as passenger"));
    }
    return false;
}

// Driver steering, from bf6-portal-bots-brain: a driver given
// AIDefendPositionBehavior on a point makes the vehicle AI drive there. Issued a
// moment after the seat change so it lands on the seated soldier. Unverified on
// PS_Isolated, so handleSeated checks progress and falls back to battlefield AI.
function steerDriver(rec: BotRec, obj: number, y: number, nowMs: number): void {
    const anchor: mod.Vector = objectiveVector(obj);
    rec.driveObj = obj;
    rec.driveD = Math.sqrt(distSqTo(obj, rec.seatX, y, rec.seatZ));
    rec.driveCheckAt = nowMs + BOT_DRIVE_CHECK_MS;
    const pid: number = rec.pid;
    Timers.setTimeout(() => {
        safe("bots.steer", () => {
            const r: BotRec | undefined = bots[pid];
            if (r === undefined || r.dead || !mod.IsValid(r.player) || r.driveObj !== obj) {
                return;
            }
            mod.AIDefendPositionBehavior(r.player, anchor, 10, 20);
        });
    }, 150);
    if (BOT_TRACE) {
        log("bots", "pid=" + pid + " driving to " + objectiveLabel(obj)
            + " (" + String(Math.round(rec.driveD)) + "m)");
    }
}

function ejectFromVehicle(rec: BotRec, why: string): void {
    try {
        mod.ForcePlayerExitVehicle(rec.player);
    } catch (e) {
    }
    if (BOT_TRACE) {
        log("bots", "pid=" + rec.pid + " ejected (" + why + ")");
    }
    rec.inVehicle = false;
    leftVehicle(rec);
}

// Back on foot (ejected, or got out on its own): stuck tracking restarts and
// the objective intent is re-picked next think.
function leftVehicle(rec: BotRec): void {
    resetSeat(rec);
    rec.lastX = 0;
    rec.lastY = 0;
    rec.lastZ = 0;
    rec.stillFor = 0;
    rec.strikes = 0;
    clearIntent(rec.pid, rec.mind);
}

// A seated bot: eject when the vehicle has not moved (CustomConquest V15: 15 s,
// 3 m), after BOT_VEHICLE_MAX_MS, or when a driver reaches its objective. A
// driver that is not closing on its objective falls back to battlefield AI.
// posScratch holds the bot's cached position, which for a seated soldier is
// the vehicle's position.
function handleSeated(rec: BotRec, nowMs: number): void {
    const x: number = posScratch.x;
    const z: number = posScratch.z;
    if (rec.seatedAt === 0) {
        // Seated by something other than us, e.g. a player's squad call.
        rec.seatedAt = nowMs;
        rec.seatCheckAt = nowMs + BOT_VEHICLE_STUCK_MS;
        rec.seatX = x;
        rec.seatZ = z;
        return;
    }
    if (nowMs - rec.seatedAt > BOT_VEHICLE_MAX_MS) {
        ejectFromVehicle(rec, "max time");
        return;
    }
    if (nowMs >= rec.seatCheckAt) {
        const dx: number = x - rec.seatX;
        const dz: number = z - rec.seatZ;
        if (dx * dx + dz * dz < BOT_VEHICLE_STUCK_M * BOT_VEHICLE_STUCK_M) {
            ejectFromVehicle(rec, "vehicle stuck");
            return;
        }
        rec.seatX = x;
        rec.seatZ = z;
        rec.seatCheckAt = nowMs + BOT_VEHICLE_STUCK_MS;
    }
    if (rec.driveObj < 0) {
        return;
    }
    const d: number = Math.sqrt(distSqTo(rec.driveObj, x, posScratch.y, z));
    if (d < BOT_VEHICLE_DISMOUNT_M) {
        ejectFromVehicle(rec, "arrived at " + objectiveLabel(rec.driveObj));
        return;
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
            return;
        }
        rec.driveD = d;
        rec.driveCheckAt = nowMs + BOT_DRIVE_CHECK_MS;
    }
}

// One FFI per think per bot; keeps the in-vehicle flag honest whoever put the
// bot in or took it out.
function syncVehicleState(rec: BotRec): void {
    try {
        rec.inVehicle = mod.GetSoldierState(rec.player, mod.SoldierStateBool.IsInVehicle);
    } catch (e) {
        rec.inVehicle = false;
    }
}

let traceAt: number = 0;

// BOT_TRACE: one line per team, e.g.
//   "t1 plan: bunker1 A3, site2 H5 | walk-veh 1, in-veh 2, fight 4, idle 0"
// (A attack, H hold, D defend), so a playtest log shows whether bots split up.
function tracePlan(nowMs: number): void {
    if (!BOT_TRACE || nowMs - traceAt < BOT_TRACE_MS) {
        return;
    }
    traceAt = nowMs;
    const letters: string = "HAD";
    for (let team: number = 1; team <= 2; team++) {
        const counts: { [key: string]: number } = {};
        const order: string[] = [];
        let veh: number = 0;
        let walkVeh: number = 0;
        let fight: number = 0;
        let idle: number = 0;
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
            + " | walk-veh " + walkVeh + ", in-veh " + veh + ", fight " + fight + ", idle " + idle);
    }
}

function sweep(): void {
    drainSpawns();
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
            if (rec.inVehicle) {
                // Position-based stuck detection cannot tell a parked bot from a
                // driver, so seated bots have their own checks.
                endApproach(rec);
                handleSeated(rec, nowMs);
                continue;
            }
            if (rec.seatedAt !== 0) {
                // Out of the vehicle without our eject (vehicle destroyed, engine).
                leftVehicle(rec);
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
            thinkBot(rec.player, pid, rec.team, posScratch.x, posScratch.y, posScratch.z, rec.mind, nowMs);
            maybeApproachVehicle(rec, posScratch.x, posScratch.y, posScratch.z, nowMs);
        } catch (e) {
            log("bots", "think failed pid=" + pid + ": " + String(e));
        }
    }
    fullRethink = false;
}

function markFullRethink(): void {
    fullRethink = true;
}

// Move a freshly deployed bot into a bunker its team owns. Bots must appear in
// the bunkers, never on the resource or factory AreaTriggers, so the candidate
// list is bunker-only (see pickSpawnObjective).
//
// The destination is read from the native CapturePoint with
// mod.GetObjectPosition rather than from the cached anchor, which is what
// CustomConquest V15 AI_ObjectiveSpawn does and what the user asked for
// explicitly. It is one extra FFI per deploy, against the alternative of a
// separate AI_Spawner object at every bunker, which would mean editing the map.
//
// A team that owns no bunker yet leaves the bot at its spawner rather than
// dropping it on a contested point.
function teleportToObjective(p: mod.Player, team: number, pid: number): void {
    // Deterministic per-bot roll, so this costs no FFI and is stable for replays.
    const roll: number = ((pid * 2654435761) % 10007) / 10007;
    const idx: number = pickSpawnObjective(team, roll);
    if (idx < 0) {
        if (willLogDebug()) {
            log("bots", "pid=" + pid + " stays at spawner, team owns no bunker");
        }
        return;
    }
    try {
        const cp: mod.CapturePoint | undefined = bunkerCapturePoint(idx);
        // Orientation 0: the template also passes a fixed 1. Bots re-aim on their
        // first think, so this only decides which way they face as they land.
        if (cp === undefined) {
            log("bots", "pid=" + pid + " bunker " + objectiveKey(idx) + " has no CapturePoint");
            return;
        }
        mod.Teleport(p, mod.GetObjectPosition(cp), 0);
        const rec: BotRec | undefined = bots[pid];
        if (rec !== undefined) {
            // The mind thinks it is at the spawner, so a stale intent would walk
            // it straight back out. Clear it and let the next sweep re-decide.
            rec.mind.state = -1;
            rec.mind.obj = idx;
            rec.mind.speed = -1;
            rec.mind.age = 0;
            rec.lastX = 0;
            rec.lastY = 0;
            rec.lastZ = 0;
        }
        if (willLogDebug()) {
            log("bots", "pid=" + pid + " teleported onto " + objectiveKey(idx));
        }
    } catch (e) {
        log("bots", "teleport failed pid=" + pid + ": " + String(e));
    }
}

// A bot is stuck when it has barely moved across a whole window of thinks while
// walking to an attack target. Only walks count: a holding or defending bot
// barely moves by design, and the old check killed those as stuck (the 18:52
// wave in the playtest). Each window gives up on the current target for this
// bot (botbrain.giveUp, kept across respawns) so it re-picks somewhere else; a
// bot still stuck after BOT_STUCK_STRIKES windows is killed and respawns.
//
// Returns true when the bot was recycled and should not be thought this sweep.
function handleStuck(rec: BotRec, x: number, y: number, z: number, nowMs: number): boolean {
    const mind: BotMind = rec.mind;
    const reach: number = BOT_ARRIVE_M * 2;
    const walking: boolean = mind.state === JOB_ATTACK && mind.obj >= 0 && !inBattle(mind, nowMs)
        && distSqTo(mind.obj, x, y, z) > reach * reach;
    // First think after spawn has no baseline to compare against.
    const fresh: boolean = rec.lastX === 0 && rec.lastY === 0 && rec.lastZ === 0;
    const dx: number = x - rec.lastX;
    const dy: number = y - rec.lastY;
    const dz: number = z - rec.lastZ;
    rec.lastX = x;
    rec.lastY = y;
    rec.lastZ = z;
    if (!walking) {
        rec.stillFor = 0;
        rec.strikes = 0;
        return false;
    }
    if (fresh || dx * dx + dy * dy + dz * dz > BOT_STUCK_MIN_M * BOT_STUCK_MIN_M) {
        rec.stillFor = 0;
        return false;
    }
    rec.stillFor++;
    if (rec.stillFor < BOT_STUCK_WINDOW_SWEEPS) {
        return false;
    }
    rec.stillFor = 0;
    rec.strikes++;
    if (rec.strikes < BOT_STUCK_STRIKES) {
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
            mod.AISetUnspawnOnDead(sp, true);
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
        queueSpawn(1);
        queueSpawn(2);
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
            registerBot(p, pid, team);
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
            teleportToObjective(p, team, pid);
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
