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
    BOT_CORPSE_SECONDS, BOT_COUNT_PER_TEAM, BOT_DAMAGE_MULT, BOT_INCOMING_DAMAGE,
    BOT_RESPAWN_DELAY_MS, BOT_SLICE, BOT_SPAWN_PER_SWEEP, BOT_STUCK_MIN_M,
    BOT_STUCK_STRIKES, BOT_STUCK_WINDOW_SWEEPS, BOT_SWEEP_MS,
    BOT_VEHICLE_FREE_SEATS, BOT_VEHICLE_MOD, BOT_VEHICLE_RADIUS_M, BOT_VEHICLE_SCAN_MS
} from "./config";
import {
    bunkerCapturePoint, dropOccupant, initBotObjectives, markOwnersDirty, objectiveKey,
    ownersNeedRefresh, pickSpawnObjective, refreshOwners
} from "./botobjectives";
import { BotMind, newMind, noteMoveFailed, noteMoveSucceeded, thinkBot } from "./botbrain";

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
            pid: pid, team: team, player: p, mind: newMind(pid, team), dead: false, nameKey: "",
            lastX: 0, lastY: 0, lastZ: 0, stillFor: 0, strikes: 0, inVehicle: false
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
    }
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
    }
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
    if (rec === undefined) {
        return;
    }
    noteMoveFailed(rec.mind, Date.now());
}

function onMoveSucceeded(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    const rec: BotRec | undefined = bots[pid];
    if (rec === undefined) {
        return;
    }
    noteMoveSucceeded(rec.mind);
}

// Retaliation only: bots never hunt, they answer. One target set plus a short
// force-fire burst when damaged by a live enemy.
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

// Vehicle boarding. mod.AllVehicles() returns an opaque mod.Array and costs an
// FFI to build, so the candidate list is rebuilt once per BOT_VEHICLE_SCAN_MS
// for the whole population rather than once per bot per sweep. Each candidate
// is a vehicle that exists and still has a free seat, which is the same
// availability test CustomConquest V15 AI_VehicleDeploy performs before it
// commits a bot to a seat.
const vehicleCand: mod.Vehicle[] = [];
const vScratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };
let vehicleScannedAt: number = 0;

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

// Try to put this bot in a nearby free vehicle. Bots only do this while they are
// on foot, and a bot already in a seat skips the whole thing.
//
// Boarding is CQ's AI_VehicleDeploy pair, both Tier 0: AIBattlefieldBehavior
// hands the bot to the normal vehicle AI, then ForcePlayerToSeat puts it in seat
// -1, which is the engine's "any free seat" seat. Seat -1 rather than a seat
// index is deliberate: it is what the template uses, and it means a bot does not
// fail because the driver slot was taken between the scan and the board.
function tryBoardVehicle(rec: BotRec, x: number, y: number, z: number): boolean {
    if (rec.inVehicle || vehicleCand.length === 0) {
        return false;
    }
    // Only a slice of the population ever tries, so a parked tank is not
    // stripped by every bot within earshot in the same second.
    if (rec.pid % BOT_VEHICLE_MOD !== rec.team) {
        return false;
    }
    const rSq: number = BOT_VEHICLE_RADIUS_M * BOT_VEHICLE_RADIUS_M;
    for (const v of vehicleCand) {
        try {
            Vectors.toVector3(
                mod.GetVehicleState(v, mod.VehicleStateVector.VehiclePosition), vScratch
            );
            const dx: number = vScratch.x - x;
            const dy: number = vScratch.y - y;
            const dz: number = vScratch.z - z;
            if (dx * dx + dy * dy + dz * dz > rSq) {
                continue;
            }
            mod.AIBattlefieldBehavior(rec.player);
            mod.ForcePlayerToSeat(rec.player, v, -1);
            rec.inVehicle = true;
            if (willLogDebug()) {
                log("bots", "pid=" + rec.pid + " boarded a vehicle");
            }
            return true;
        } catch (e) {
        }
    }
    return false;
}

// Keep the in-vehicle flag honest. Only bots that are allowed to board pay for
// this, so it is one FFI for a fraction of the population, and it means a bot
// that got out again is back under stuck detection instead of being treated as
// permanently seated.
function syncVehicleState(rec: BotRec): void {
    if (rec.pid % BOT_VEHICLE_MOD !== rec.team) {
        rec.inVehicle = false;
        return;
    }
    try {
        rec.inVehicle = mod.GetSoldierState(rec.player, mod.SoldierStateBool.IsInVehicle);
    } catch (e) {
        rec.inVehicle = false;
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
                // A bot driving a vehicle is not walking, so position-based stuck
                // detection would read it as frozen and recycle it out of the
                // seat. The vehicle AI is in charge from here.
                continue;
            }
            if (tryBoardVehicle(rec, posScratch.x, posScratch.y, posScratch.z)) {
                continue;
            }
            if (handleStuck(rec, posScratch.x, posScratch.y, posScratch.z)) {
                // Recycled: mod.Kill routes it through the ordinary death and
                // respawn path, so it comes back at a spawner instead of
                // wedged. Skip this think, the body is going away.
                continue;
            }
            thinkBot(rec.player, pid, rec.team, posScratch.x, posScratch.y, posScratch.z, rec.mind, nowMs);
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

// A bot is stuck when it has barely moved across a whole window of thinks. The
// first window only forces a re-pick (clearing the recorded intent makes the
// next think pick something else); a bot that is still stuck after
// BOT_STUCK_STRIKES windows is killed so the respawn path replaces it. Without
// this, a bot that ended up against a wall, or whose behavior expired silently,
// stood there for the rest of the match - which is what the playtest showed.
//
// Returns true when the bot was recycled and should not be thought this sweep.
function handleStuck(rec: BotRec, x: number, y: number, z: number): boolean {
    // First think after spawn has no baseline to compare against.
    if (rec.stillFor === 0 && rec.lastX === 0 && rec.lastY === 0 && rec.lastZ === 0) {
        rec.lastX = x;
        rec.lastY = y;
        rec.lastZ = z;
        return false;
    }
    const dx: number = x - rec.lastX;
    const dy: number = y - rec.lastY;
    const dz: number = z - rec.lastZ;
    rec.lastX = x;
    rec.lastY = y;
    rec.lastZ = z;
    const minSq: number = BOT_STUCK_MIN_M * BOT_STUCK_MIN_M;
    if (dx * dx + dy * dy + dz * dz > minSq) {
        rec.stillFor = 0;
        rec.strikes = 0;
        return false;
    }
    rec.stillFor++;
    if (rec.stillFor < BOT_STUCK_WINDOW_SWEEPS) {
        return false;
    }
    rec.stillFor = 0;
    rec.strikes++;
    if (rec.strikes < BOT_STUCK_STRIKES) {
        // First offence: break the dirty-check by clearing the intent, so the
        // next think issues a fresh behavior toward a re-picked objective.
        rec.mind.state = -1;
        rec.mind.obj = -1;
        rec.mind.speed = -1;
        rec.mind.failUntil = {};
        return false;
    }
    rec.strikes = 0;
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
    Events.OnAIMoveToSucceeded.subscribe((p: mod.Player) => {
        safe("bots.movesok", () => { onMoveSucceeded(p); });
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
