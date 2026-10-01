import { Events } from "bf6-portal-utils/events";
import { InterleavedVectors } from "bf6-portal-utils/interleaved-vectors";
import { Vectors } from "bf6-portal-utils/vectors";
import { log, safe, willLogDebug } from "./util/log";
import { isEnemyTeam, teamIdOf } from "./util/roster";
import { allBunkers, bunkerByCp, onBunkerCaptured } from "./buildings";
import { allStates, onCaptured } from "./capture";
import { isConfigured } from "./objids";
import { PlayerLocations } from "bf6-portal-utils/player-locations";
import { BOT_KIND_WEIGHT, BOT_SPREAD_M, BOT_THREAT_REACH_M } from "./config";
import { ScoreObjective } from "./botscore";

// Unified objective read model for the bot population. Bunkers (native
// CapturePoints) and area buildings (custom AreaTrigger capture) become one
// flat list with a cached world position, a cached mod.Vector handle and an
// event-fed occupant set each.
//
// Cost model: every mod.* call in this file runs once at init. Steady state
// is pure math (sliceToVectorDistanceSquared) plus plain map reads - zero FFI,
// zero allocation per pick. Objective positions never move, so the cache is
// never invalidated; ownership is refreshed from the in-memory buildings /
// capture state, never re-queried from the engine.
//
// This deliberately duplicates capture.ts occupancy rather than sharing it:
// capture's sets are its private simulation state, and bots need a superset
// view that also covers bunkers.

export const OBJ_BUNKER: number = 0;
export const OBJ_ENERGY: number = 1;
export const OBJ_PROTO: number = 2;
export const OBJ_WAR: number = 3;
export const OBJ_AIR: number = 4;
export const OBJ_NAVAL: number = 5;

// Intent states returned alongside a pick.
export const OBJ_HOLD: number = 0;    // owned by us, uncontested - stay
export const OBJ_ATTACK: number = 1;  // not owned by us - take it
export const OBJ_DEFEND: number = 2;  // owned by us but contested - fight for it

const MAX_OBJECTIVES: number = 16;

const objPos: Float32Array = new Float32Array(MAX_OBJECTIVES * 3);
const objVec: mod.Vector[] = [];
const objOwner: number[] = [];
const objKind: number[] = [];
const objKey: string[] = [];
const occByIdx: number[][] = [];
const idxByTrigger: { [triggerId: number]: number } = {};
const idxByCp: { [cpId: number]: number } = {};
const occTeam: { [pid: number]: number } = {};
// Native CapturePoint handle per objective, bunkers only. Held so deployment
// can teleport onto a freshly read bunker position (mod.GetObjectPosition on
// the CapturePoint) instead of a cached anchor, matching CustomConquest V15
// AI_ObjectiveSpawn.
const objCp: (mod.CapturePoint | undefined)[] = [];

let objCount: number = 0;
let ownersDirty: boolean = true;
let inited: boolean = false;

// Scratch reused by every pick. Never stored, never returned.
const scratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

function kindOf(kind: string): number {
    if (kind === "energy") {
        return OBJ_ENERGY;
    }
    if (kind === "proto") {
        return OBJ_PROTO;
    }
    if (kind === "war") {
        return OBJ_WAR;
    }
    if (kind === "air") {
        return OBJ_AIR;
    }
    if (kind === "naval") {
        return OBJ_NAVAL;
    }
    return OBJ_PROTO;
}

function addObjective(key: string, kind: number, owner: number, vec: mod.Vector): void {
    if (objCount >= MAX_OBJECTIVES) {
        log("botobj", "pool full, dropping " + key);
        return;
    }
    const idx: number = objCount;
    objCount++;
    objKey[idx] = key;
    objKind[idx] = kind;
    objOwner[idx] = owner;
    objVec[idx] = vec;
    occByIdx[idx] = [];
    // Single boundary conversion per objective, at init only.
    Vectors.toVector3(vec, scratch);
    InterleavedVectors.setSlice(objPos, idx, scratch.x, scratch.y, scratch.z);
}

// Position source preference: WorldIcon first (a real world-positioned
// object), AreaTrigger as fallback. This also resolves the open PS_ObjIds
// 6.2 question for the bot path: whichever source binds is logged here.
function resolveAreaVec(
    key: string, worldIconId: number, triggerId: number
): mod.Vector | undefined {
    if (isConfigured(worldIconId)) {
        try {
            const icon: mod.WorldIcon = mod.GetWorldIcon(worldIconId);
            if (mod.IsValid(icon)) {
                const vec: mod.Vector = mod.GetObjectPosition(icon);
                log("botobj", key + " anchored on WorldIcon " + worldIconId);
                return vec;
            }
        } catch (e) {
        }
    }
    if (isConfigured(triggerId)) {
        try {
            const trigger: mod.AreaTrigger = mod.GetAreaTrigger(triggerId);
            if (mod.IsValid(trigger)) {
                const vec: mod.Vector = mod.GetObjectPosition(trigger);
                log("botobj", key + " anchored on AreaTrigger " + triggerId + " (icon missing)");
                return vec;
            }
        } catch (e) {
        }
    }
    return undefined;
}

export function initBotObjectives(): void {
    if (inited) {
        return;
    }
    inited = true;
    for (const b of allBunkers()) {
        if (!isConfigured(b.def.capturePointId)) {
            continue;
        }
    try {
            const vec: mod.Vector = mod.GetObjectPosition(b.capturePoint);
            addObjective("bunker:" + b.def.id, OBJ_BUNKER, b.owner, vec);
            const idx: number = objCount - 1;
            idxByCp[b.def.capturePointId] = idx;
            objCp[idx] = b.capturePoint;
        } catch (e) {
            log("botobj", "bunker " + b.def.id + " position failed: " + String(e));
        }
    }
    for (const st of allStates()) {
        const vec: mod.Vector | undefined = resolveAreaVec(
            "area:" + st.def.id, st.def.worldIconId, st.def.areaTriggerId
        );
        if (vec === undefined) {
            log("botobj", "area " + st.def.id + " has no anchor, skipped");
            continue;
        }
        addObjective("area:" + st.def.id, kindOf(st.def.kind), st.owner, vec);
        idxByTrigger[st.def.areaTriggerId] = objCount - 1;
    }
    log("botobj", "bound " + objCount + " objectives");
    configureBotObjectiveEvents();
}

export function objectiveCount(): number {
    return objCount;
}

export function objectiveKey(idx: number): string {
    return objKey[idx] === undefined ? "?" : objKey[idx];
}

export function objectiveVector(idx: number): mod.Vector {
    return objVec[idx];
}

// Deployment placement. Bots must land in a bunker, so this only ever considers
// OBJ_BUNKER objectives - the energy, proto, war, air and naval AreaTriggers are
// attack targets, not spawn targets, and a playtest showed bots landing on
// resource points because those were in the same candidate list.
//
// The position is read from the native CapturePoint at deploy time with
// mod.GetObjectPosition, matching CustomConquest V15 AI_ObjectiveSpawn, rather
// than from the cached anchor, so a bunker that moves with its deployment keeps
// spawning bots where it actually is.
//
// Within the bunkers this team owns, the emptiest is preferred and the roll
// breaks ties, so 24 spawning bots distribute across the team's bunkers instead
// of all landing on the same one. Returns -1 when the team owns no bunker, and
// the caller then leaves the bot at its spawner rather than dumping it on a
// contested point.
export function pickSpawnObjective(team: number, roll: number): number {
    let minOcc: number = -1;
    for (let i: number = 0; i < objCount; i++) {
        if (objKind[i] !== OBJ_BUNKER || objOwner[i] !== team) {
            continue;
        }
        const occ: number = occupancy(i);
        if (minOcc < 0 || occ < minOcc) {
            minOcc = occ;
        }
    }
    if (minOcc < 0) {
        return -1;
    }
    let n: number = 0;
    for (let i: number = 0; i < objCount; i++) {
        if (objKind[i] === OBJ_BUNKER && objOwner[i] === team && occupancy(i) === minOcc) {
            n++;
        }
    }
    if (n === 0) {
        return -1;
    }
    let at: number = Math.floor(roll * n);
    if (at < 0) {
        at = 0;
    }
    if (at >= n) {
        at = n - 1;
    }
    for (let i: number = 0; i < objCount; i++) {
        if (objKind[i] === OBJ_BUNKER && objOwner[i] === team && occupancy(i) === minOcc) {
            if (at === 0) {
                return i;
            }
            at--;
        }
    }
    return -1;
}

// The native CapturePoint behind a bunker objective, or undefined for area
// objectives. Callers use this to read a live position at deploy time.
export function bunkerCapturePoint(idx: number): mod.CapturePoint | undefined {
    return objCp[idx];
}

export function objectiveKind(idx: number): number {
    return objKind[idx] === undefined ? -1 : objKind[idx];
}

export function ownerOf(idx: number): number {
    return objOwner[idx] === undefined ? 0 : objOwner[idx];
}

// Refresh ownership from the in-memory buildings / capture state. Zero FFI:
// both modules own their numbers already, we just copy them over.
export function refreshOwners(): void {
    for (const b of allBunkers()) {
        const idx: number | undefined = idxByCp[b.def.capturePointId];
        if (idx !== undefined) {
            objOwner[idx] = b.owner;
        }
    }
    for (const st of allStates()) {
        const idx: number | undefined = idxByTrigger[st.def.areaTriggerId];
        if (idx !== undefined) {
            objOwner[idx] = st.owner;
        }
    }
    ownersDirty = false;
}

export function markOwnersDirty(): void {
    ownersDirty = true;
}

export function ownersNeedRefresh(): boolean {
    return ownersDirty;
}

function addOccupant(idx: number, pid: number, team: number): void {
    const occ: number[] = occByIdx[idx];
    if (occ === undefined || pid < 0) {
        return;
    }
    if (occ.indexOf(pid) < 0) {
        occ.push(pid);
    }
    occTeam[pid] = team;
}

function removeOccupant(idx: number, pid: number): void {
    const occ: number[] = occByIdx[idx];
    if (occ === undefined) {
        return;
    }
    const at: number = occ.indexOf(pid);
    if (at >= 0) {
        occ.splice(at, 1);
    }
}

// Called by bots.ts when a bot dies or undeploys. A corpse must stop counting
// as an occupant, otherwise the capture sim keeps crediting a dead player.
export function dropOccupant(pid: number): void {
    for (let i: number = 0; i < objCount; i++) {
        removeOccupant(i, pid);
    }
    delete occTeam[pid];
}

// True when both teams stand on the objective right now. Pure map reads.
export function isContested(idx: number): boolean {
    const occ: number[] = occByIdx[idx];
    if (occ === undefined || occ.length < 2) {
        return false;
    }
    let t1: boolean = false;
    let t2: boolean = false;
    for (const pid of occ) {
        const t: number | undefined = occTeam[pid];
        if (t === 1) {
            t1 = true;
        } else if (t === 2) {
            t2 = true;
        }
        if (t1 && t2) {
            return true;
        }
    }
    return false;
}

// Which objective, if any, holds this player right now. Zero FFI.
export function onObjective(pid: number): number {
    for (let i: number = 0; i < objCount; i++) {
        if (occByIdx[i].indexOf(pid) >= 0) {
            return i;
        }
    }
    return -1;
}

// Intent state of an objective for a team: defend a contested owned point
// first, attack what is not ours, hold what is safely ours.
export function objectiveState(idx: number, team: number): number {
    if (objOwner[idx] !== team) {
        return OBJ_ATTACK;
    }
    return isContested(idx) ? OBJ_DEFEND : OBJ_HOLD;
}

// Squared distance from a point to an objective anchor. Zero FFI.
export function distSqTo(idx: number, x: number, y: number, z: number): number {
    scratch.x = x;
    scratch.y = y;
    scratch.z = z;
    return InterleavedVectors.sliceToVectorDistanceSquared(objPos, idx, scratch);
}

// Claims ledger: which objective each bot has picked, counted per team. This is
// what spreads the population. The old picker penalised crowding only by bots
// standing inside a trigger, which is zero at game start, so the whole team
// walked to the same nearest point (18:48 playtest). Claims include bots still
// walking there. Zero FFI.
const claimOf: { [pid: number]: number } = {};
const claimTeam: { [pid: number]: number } = {};
const claimCount: number[][] = [[], [], []];

export function claimsOn(idx: number, team: number): number {
    if (team !== 1 && team !== 2) {
        return 0;
    }
    const c: number | undefined = claimCount[team][idx];
    return c === undefined ? 0 : c;
}

function setClaims(idx: number, team: number, n: number): void {
    claimCount[team][idx] = n;
    // Keep the score snapshot live, so bots thinking later in the same sweep
    // already see this claim.
    const o: ScoreObjective | undefined = snap[team][idx];
    if (o !== undefined) {
        o.claims = n;
    }
}

export function releaseClaim(pid: number): void {
    const prev: number | undefined = claimOf[pid];
    if (prev === undefined) {
        return;
    }
    const team: number = claimTeam[pid];
    const c: number = claimsOn(prev, team);
    setClaims(prev, team, c > 0 ? c - 1 : 0);
    delete claimOf[pid];
    delete claimTeam[pid];
}

export function claimObjective(pid: number, team: number, idx: number): void {
    if (claimOf[pid] === idx && claimTeam[pid] === team) {
        return;
    }
    releaseClaim(pid);
    if (idx < 0 || idx >= objCount || (team !== 1 && team !== 2)) {
        return;
    }
    claimOf[pid] = idx;
    claimTeam[pid] = team;
    setClaims(idx, team, claimsOn(idx, team) + 1);
}

// Per-team score snapshot handed to botscore.pickBest. Positions and weights are
// set once; owner and pressure are refreshed once per sweep (refreshScoreSnapshot),
// claims are kept live by the ledger above. The objects are reused, so a think
// allocates nothing.
const snap: ScoreObjective[][] = [[], [], []];

export function refreshScoreSnapshot(team: number): void {
    if (team !== 1 && team !== 2) {
        return;
    }
    const arr: ScoreObjective[] = snap[team];
    for (let i: number = 0; i < objCount; i++) {
        let o: ScoreObjective | undefined = arr[i];
        if (o === undefined) {
            const k: number = objKind[i];
            const w: number | undefined = BOT_KIND_WEIGHT[k];
            o = {
                x: objPos[i * 3], y: objPos[i * 3 + 1], z: objPos[i * 3 + 2],
                owner: 0, weight: w === undefined ? 1 : w, claims: 0, pressure: 0
            };
            arr[i] = o;
        }
        o.owner = objOwner[i];
        o.claims = claimsOn(i, team);
        o.pressure = enemyPressure(i, team, BOT_THREAT_REACH_M);
    }
}

export function scoreSnapshot(team: number): ScoreObjective[] {
    return snap[team === 2 ? 2 : 1];
}

// Short label for trace lines: "bunker1", "site2", ...
export function objectiveLabel(idx: number): string {
    const k: string = objectiveKey(idx);
    const at: number = k.indexOf(":");
    return at >= 0 ? k.substring(at + 1) : k;
}

// How many bots currently stand on an objective. Used to spread a crowd across
// objectives instead of stacking all 24 on the single nearest one.
export function occupancy(idx: number): number {
    const occ: number[] = occByIdx[idx];
    return occ === undefined ? 0 : occ.length;
}

// Enemy pressure on an objective for a team: how many enemy players are inside
// the threat radius of the anchor. This is the "they are about to cap that one"
// signal the brain reacts to, and it comes from PlayerLocations' cached
// positions, so it costs no FFI at all - the sphere query walks a prebuilt
// voxel grid in QuickJS memory rather than calling mod.GetSoldierState.
//
// Distinct from isContested, which only reports players standing exactly on the
// trigger. An objective with no one on it but two enemies walking toward it is
// exactly the case that needs a defender sent across, and isContested cannot
// see it.
export function enemyPressure(idx: number, team: number, radius: number): number {
    if (idx < 0 || idx >= objCount || !PlayerLocations.isInitialized()) {
        return 0;
    }
    const ax: number = objPos[idx * 3];
    const ay: number = objPos[idx * 3 + 1];
    const az: number = objPos[idx * 3 + 2];
    return PlayerLocations.findPlayersInSphere(
        ax, ay, az, radius,
        (p: mod.Player) => isEnemyTeam(teamIdOf(p), team)
    );
}

// A per-bot offset around an objective anchor. Without this every bot on a team
// aimed at the same metre, walked to the same metre, and shoved each other off
// it. The offset is a pure function of the player id, so a bot keeps the same
// spot between sweeps instead of jittering. Cached mod.Vector per bot: the
// behavior APIs take a Vector and the spread never changes for a given bot.
const spreadX: { [pid: number]: number } = {};
const spreadZ: { [pid: number]: number } = {};
const spreadVec: { [pid: number]: mod.Vector } = {};

export function spreadOffset(pid: number, idx: number): mod.Vector {
    let vec: mod.Vector = spreadVec[pid];
    if (vec === undefined) {
        // Stable per-pid pseudo-random direction and radius.
        const h: number = (pid * 2654435761 + idx * 40503) % 10007;
        const ang: number = (h / 10007) * Math.PI * 2;
        const rad: number = BOT_SPREAD_M * (0.35 + ((h % 977) / 977) * 0.65);
        spreadX[pid] = Math.cos(ang) * rad;
        spreadZ[pid] = Math.sin(ang) * rad;
        vec = mod.CreateVector(spreadX[pid], 0, spreadZ[pid]);
        spreadVec[pid] = vec;
    }
    return vec;
}

function onEnterTrigger(p: mod.Player, at: mod.AreaTrigger): void {
    const idx: number | undefined = idxByTrigger[mod.GetObjId(at)];
    if (idx === undefined) {
        return;
    }
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    addOccupant(idx, pid, teamIdOf(p));
}

function onExitTrigger(p: mod.Player, at: mod.AreaTrigger): void {
    const idx: number | undefined = idxByTrigger[mod.GetObjId(at)];
    if (idx === undefined) {
        return;
    }
    removeOccupant(idx, mod.GetObjId(p));
}

function onEnterCp(p: mod.Player, cp: mod.CapturePoint): void {
    const st = bunkerByCp(mod.GetObjId(cp));
    if (st === undefined) {
        return;
    }
    const idx: number | undefined = idxByCp[st.def.capturePointId];
    if (idx === undefined) {
        return;
    }
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    addOccupant(idx, pid, teamIdOf(p));
}

function onExitCp(p: mod.Player, cp: mod.CapturePoint): void {
    const st = bunkerByCp(mod.GetObjId(cp));
    if (st === undefined) {
        return;
    }
    const idx: number | undefined = idxByCp[st.def.capturePointId];
    if (idx === undefined) {
        return;
    }
    removeOccupant(idx, mod.GetObjId(p));
}

function configureBotObjectiveEvents(): void {
    Events.OnPlayerEnterAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("botobj.enter", () => { onEnterTrigger(p, at); });
    });
    Events.OnPlayerExitAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("botobj.exit", () => { onExitTrigger(p, at); });
    });
    Events.OnPlayerLeaveGame.subscribe((id: number) => {
        safe("botobj.leave", () => { dropOccupant(id); });
    });
    Events.OnPlayerEnterCapturePoint.subscribe((p: mod.Player, cp: mod.CapturePoint) => {
        safe("botobj.cp.enter", () => { onEnterCp(p, cp); });
    });
    Events.OnPlayerExitCapturePoint.subscribe((p: mod.Player, cp: mod.CapturePoint) => {
        safe("botobj.cp.exit", () => { onExitCp(p, cp); });
    });
    // Ownership invalidation is event-driven, never polled: either listener
    // firing means at least one brain must re-pick next sweep.
    onCaptured(() => {
        markOwnersDirty();
    });
    onBunkerCaptured(() => {
        markOwnersDirty();
    });
    if (willLogDebug()) {
        log("botobj", "occupancy + invalidation subscriptions live");
    }
}
