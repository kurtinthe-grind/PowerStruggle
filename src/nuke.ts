import { Events } from "bf6-portal-utils/events";
import { log, safe, willLogDebug } from "./util/log";
import { TURRETS, HQ_TARGETS, HQ_GATES, isConfigured, TurretDef } from "./objids";
import { TURRET_HIT_RADIUS_M, HQ_HIT_RADIUS_M, RAY_MAX_DIST_M, RAY_START_OFFSET_M, RAY_MIN_HIT_DIST_M, RORSCH_TRACE, RORSCH_CHARGE_MS } from "./config";
import { isRorschInHand } from "./weapons";
import { isBotPid } from "./bots";
import { teamIdOf } from "./util/roster";
import {
    destroyTurret, hitHq, turretIsDestroyed, losOpenFor, turretDistSq, turretResolvedAt
} from "./turrets";
import { Vectors } from "bf6-portal-utils/vectors";
import { holdStep, HoldResult, HoldState } from "./rorschshot";

interface PendingRay {
    pid: number;
    team: number;
    start: Vectors.Vector3;
}

const inFlight: { [pid: number]: PendingRay } = {};
// Per-player trigger hold while in an HQ fire zone with the Rorsch; see
// rorschshot.ts for why the shot is a timed hold.
const hold: { [pid: number]: HoldState } = {};
// RORSCH_TRACE only: last IsReloading value, to log its edges.
const wasReloading: { [pid: number]: boolean } = {};
// RORSCH_TRACE only: time of the last Rorsch press, kept past release.
const lastPressMs: { [pid: number]: number } = {};

// Diagnostic, one cheap soldier-state read per tick for players in a fire zone
// with the Rorsch. Logs when IsReloading turns on, with the time since the
// press, to test whether the reload marks the actual shot.
function traceReload(p: mod.Player, pid: number, nowMs: number): void {
    let reloading: boolean;
    try {
        reloading = mod.GetSoldierState(p, mod.SoldierStateBool.IsReloading);
    } catch (e) {
        return;
    }
    if (reloading && wasReloading[pid] !== true) {
        const pressed: number | undefined = lastPressMs[pid];
        log("nuke", "TRACE pid=" + pid + " IsReloading ON "
            + (pressed === undefined ? "(no press seen)" : "+" + String(nowMs - pressed) + "ms after press"));
    }
    wasReloading[pid] = reloading;
}

function forgetHold(pid: number): void {
    delete hold[pid];
    delete wasReloading[pid];
    delete lastPressMs[pid];
}
const gateOccupants: { [gateId: number]: number[] } = {};
const gateHandles: { [gateId: number]: mod.AreaTrigger } = {};
const playerGate: { [pid: number]: number } = {};
const deployed: { [pid: number]: boolean } = {};

let inited: boolean = false;

export function initNuke(): void {
    inited = true;
    cacheHqTargets();
    let gates: number = 0;
    for (const g of HQ_GATES) {
        if (!isConfigured(g)) {
            continue;
        }
        const trigger: mod.AreaTrigger = mod.GetAreaTrigger(g);
        if (!mod.IsValid(trigger)) {
            log("nuke", "FAIL gate " + g + " did not resolve");
            continue;
        }
        gateOccupants[g] = [];
        gateHandles[g] = trigger;
        gates++;
    }
    log("nuke", "ready: Rorsch-gated, timed hold (charge), one ray per player, gates="
        + String(gates) + "/" + String(HQ_GATES.length));
}

// Exact ObjId only - see the note in capture.ts about the removed mod.Equals
// fallback, which mis-routed gates and turret zones.
function gateIdFor(at: mod.AreaTrigger): number {
    const id: number = mod.GetObjId(at);
    return gateOccupants[id] !== undefined ? id : 0;
}

function onGateEnter(p: mod.Player, at: mod.AreaTrigger): void {
    const gid: number = gateIdFor(at);
    const list: number[] | undefined = gateOccupants[gid];
    const pid: number = mod.GetObjId(p);
    if (list === undefined) {
        if (willLogDebug()) {
            log("nuke", "UNMATCHED gate ENTER trigger=" + mod.GetObjId(at) + " pid=" + pid);
        }
        return;
    }
    if (pid < 0) {
        return;
    }
    if (list.indexOf(pid) < 0) {
        list.push(pid);
    }
    playerGate[pid] = gid;
    log("nuke", "gate ENTER id=" + gid + " pid=" + pid);
}

function onGateExit(p: mod.Player, at: mod.AreaTrigger): void {
    const gid: number = gateIdFor(at);
    const list: number[] | undefined = gateOccupants[gid];
    const pid: number = mod.GetObjId(p);
    if (list === undefined) {
        if (willLogDebug()) {
            log("nuke", "UNMATCHED gate EXIT trigger=" + mod.GetObjId(at) + " pid=" + pid);
        }
        return;
    }
    if (list !== undefined) {
        const i: number = list.indexOf(pid);
        if (i >= 0) {
            list.splice(i, 1);
        }
    }
    if (playerGate[pid] === gid) {
        delete playerGate[pid];
    }
    log("nuke", "gate EXIT id=" + gid + " pid=" + pid);
}

function onGateLeave(pid: number): void {
    const gid: number | undefined = playerGate[pid];
    if (gid !== undefined) {
        const list: number[] | undefined = gateOccupants[gid];
        if (list !== undefined) {
            const i: number = list.indexOf(pid);
            if (i >= 0) {
                list.splice(i, 1);
            }
        }
    }
    delete playerGate[pid];
}

export function playerInGate(pid: number): boolean {
    return playerGate[pid] !== undefined;
}

function nearEnemyBase(pid: number): boolean {
    if (Object.keys(gateOccupants).length === 0) {
        return true;
    }
    return playerGate[pid] !== undefined;
}

function shootRay(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    if (pid < 0 || inFlight[pid] !== undefined) {
        return;
    }
    const team: number = teamIdOf(p);
    // EyePosition is one FFI call and is needed both for the inFlight origin and
    // for the ray start, so it is read exactly once.
    const eye: mod.Vector = mod.GetSoldierState(p, mod.SoldierStateVector.EyePosition);
    inFlight[pid] = { pid: pid, team: team, start: Vectors.toVector3(eye) };
    safe("nuke.cast", () => {
        const facing: mod.Vector = mod.Normalize(
            mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection));
        // Start ahead of the soldier. A ray originating at the eye position hits
        // the player's own body/weapon ~0.24 m out (see the 03:29 log), so the
        // hit point never came near a turret and nothing was ever destroyed.
        const start: mod.Vector = mod.Add(eye, mod.Multiply(facing, RAY_START_OFFSET_M));
        const end: mod.Vector = mod.Add(start, mod.Multiply(facing, RAY_MAX_DIST_M));
        mod.RayCast(p, start, end);
        const e3: Vectors.Vector3 = Vectors.toVector3(eye);
        const f3: Vectors.Vector3 = Vectors.toVector3(facing);
        if (willLogDebug()) {
            log("nuke", "CAST pid=" + pid + " team=" + team + " from "
                + String(e3.x) + "," + String(e3.y) + "," + String(e3.z)
                + " dir " + String(f3.x) + "," + String(f3.y) + "," + String(f3.z));
        }
    });
}

// Hot-path comparisons use distanceSquared so they skip the sqrt. dist() is
// kept only where a metre value is actually printed.
// Squared once so the read path compares against a number, not a radius.
const HQ_HIT_RADIUS_SQ: number = HQ_HIT_RADIUS_M * HQ_HIT_RADIUS_M;

// HQ dummy target positions, resolved once at init. The targets are static
// map geometry, so resolving them per shot was two FFI calls for a constant.
// A NaN marks a target that never resolved.
const hqX: number[] = [NaN, NaN];
const hqY: number[] = [NaN, NaN];
const hqZ: number[] = [NaN, NaN];

function cacheHqTargets(): void {
    for (let i: number = 0; i < 2; i++) {
        const target: number = HQ_TARGETS[i];
        if (!isConfigured(target)) {
            continue;
        }
        safe("nuke.hqpos", () => {
            const v: Vectors.Vector3 = Vectors.toVector3(
                mod.GetObjectPosition(mod.GetSpatialObject(target)));
            hqX[i] = v.x;
            hqY[i] = v.y;
            hqZ[i] = v.z;
        });
    }
}

function dist(a: Vectors.Vector3, b: Vectors.Vector3): number {
    return Math.sqrt(Vectors.distanceSquared(a, b));
}

// Radius squared, computed once, so the hot loop never squares a literal.
const TURRET_HIT_RADIUS_SQ: number = TURRET_HIT_RADIUS_M * TURRET_HIT_RADIUS_M;

function resolveHit(p: mod.Player, point: mod.Vector): void {
    const pid: number = mod.GetObjId(p);
    const ray: PendingRay | undefined = inFlight[pid];
    if (ray === undefined) {
        return;
    }
    delete inFlight[pid];
    const team: number = ray.team;
    if (team !== 1 && team !== 2) {
        return;
    }
    const hit: Vectors.Vector3 = Vectors.toVector3(point);
    const travelled: number = dist(ray.start, hit);
    if (travelled < RAY_MIN_HIT_DIST_M) {
        if (willLogDebug()) {
        log("nuke", "HIT ignored (self) pid=" + pid + " dist=" + String(travelled.toFixed(2)));
    }
        return;
    }
    if (willLogDebug()) {
        log("nuke", "HIT pid=" + pid + " team=" + team + " dist=" + String(travelled.toFixed(1))
            + " at " + String(hit.x) + "," + String(hit.y) + "," + String(hit.z));
    }

    // One pass destroys and measures. The old second loop omitted the
    // turretIsDestroyed guard, so the log kept reporting already-destroyed
    // turrets as the nearest live one.
    let nearest: string = "none";
    let nearestSq: number = -1;
    for (let ti: number = 0; ti < TURRETS.length; ti++) {
        const t: TurretDef = TURRETS[ti];
        if (!isConfigured(t.zoneId) || turretIsDestroyed(t.emplId) || t.base === team) {
            continue;
        }
        if (!turretResolvedAt(ti)) {
            continue;
        }
        // Cached coordinates: this is the whole point of the snapshot. The old
        // path resolved a fresh mod.Vector per turret per hit, sixteen times a
        // ray, and that dominated the hit cost.
        const sq: number = turretDistSq(ti, hit.x, hit.y, hit.z);
        if (sq <= TURRET_HIT_RADIUS_SQ) {
            destroyTurret(t.emplId);
        }
        if (nearestSq < 0 || sq < nearestSq) {
            nearestSq = sq;
            nearest = String(t.emplId);
        }
    }
    if (nearestSq >= 0 && willLogDebug()) {
        // sqrt only here, where a metre value is actually shown.
        log("nuke", "nearest enemy turret " + nearest + " @ "
            + String(Math.sqrt(nearestSq).toFixed(1)) + "m");
    }

    for (const base of [1, 2]) {
        if (base === team) {
            continue;
        }
        const target: number = HQ_TARGETS[base - 1];
        if (!isConfigured(target)) {
            continue;
        }
        const losOk: boolean = losOpenFor(base);
        let d: number = -1;
        let inRange: boolean = false;
        safe("nuke.hq", () => {
            // Cached: no GetSpatialObject, no GetObjectPosition, no allocation.
            const hx: number = hqX[base - 1];
            const hy: number = hqY[base - 1];
            const hz: number = hqZ[base - 1];
            if (hx !== hx) {
                // NaN sentinel: the target never resolved at init.
                return;
            }
            const dx: number = hit.x - hx;
            const dy: number = hit.y - hy;
            const dz: number = hit.z - hz;
            const sq: number = dx * dx + dy * dy + dz * dz;
            inRange = sq <= HQ_HIT_RADIUS_SQ;
            // d is printed by the always-on log below, so it must hold the real
            // distance. Only the hit test itself (sq) stays sqrt-free, and this
            // runs once per cast, not per frame.
            d = Math.sqrt(sq);
            if (inRange && losOk) {
                hitHq(base);
            }
        });
        // Log every attempt so a miss is distinguishable from a silent failure:
        // "no LOS" and "out of range" need different fixes.
        log("nuke", "hq base " + base + " dist=" + String(d.toFixed(1))
            + " range=" + String(HQ_HIT_RADIUS_M)
            + " inRange=" + String(inRange) + " losOpen=" + String(losOk)
            + (inRange && losOk ? " -> HIT" : (inRange ? " -> blocked by LOS" : " -> out of range")));
    }
}

function probe(): void {
    if (!inited) {
        return;
    }
    safe("nuke.probe", () => {
        let arr: mod.Array;
        try {
            arr = mod.AllPlayers();
        } catch (e) {
            return;
        }
        const n: number = mod.CountOf(arr);
        for (let i: number = 0; i < n; i++) {
            const p: mod.Player = mod.ValueInArray(arr, i) as mod.Player;
            const pid: number = mod.GetObjId(p);
            if (pid < 0) {
                continue;
            }
            if (deployed[pid] !== true) {
                continue;
            }
            // Bots never fire the Rorsch: zero-FFI registry test, before any
            // soldier-state read. The Rorsch is also stripped at bot deploy.
            if (isBotPid(pid)) {
                continue;
            }
            // Gate check first: playerGate is a plain map read, so this rejects
            // every player who is not standing in an HQ gate without a single
            // mod.* FFI call. This is the whole point of the reorder.
            if (!nearEnemyBase(pid)) {
                // A hold that started outside the zone restarts on entry.
                forgetHold(pid);
                continue;
            }
            let firing: boolean = false;
            try {
                firing = mod.GetSoldierState(p, mod.SoldierStateBool.IsFiring);
            } catch (e) {
                continue;
            }
            const nowMs: number = Date.now();
            const st: HoldState | undefined = hold[pid];
            if (firing && st === undefined) {
                // New press: check the weapon once per press, not per tick.
                if (!isRorschInHand(p)) {
                    logNukeOnce(pid, "noRorsch");
                    hold[pid] = { pressMs: nowMs, shot: true };
                    continue;
                }
                logNukeOnce(pid, "charging");
                lastPressMs[pid] = nowMs;
                log("nuke", "PRESS pid=" + pid + " charging, shot counts after "
                    + String(RORSCH_CHARGE_MS) + "ms held");
            }
            if (RORSCH_TRACE) {
                traceReload(p, pid, nowMs);
            }
            const r: HoldResult = holdStep(st, firing, nowMs, RORSCH_CHARGE_MS);
            if (r.next === undefined) {
                delete hold[pid];
                if (st !== undefined && !st.shot) {
                    log("nuke", "RELEASED pid=" + pid + " after "
                        + String(nowMs - st.pressMs) + "ms - no shot");
                }
            } else {
                hold[pid] = r.next;
            }
            if (!r.fire) {
                continue;
            }
            logNukeOnce(pid, "fired");
            log("nuke", "SHOT pid=" + pid + " held " + String(nowMs - (st === undefined ? nowMs : st.pressMs)) + "ms - casting ray");
            shootRay(p);
        }
    });
}

const nukeDiag: { [pid: number]: string } = {};

function logNukeOnce(pid: number, reason: string): void {
    if (nukeDiag[pid] === reason) {
        return;
    }
    nukeDiag[pid] = reason;
    log("nuke", "probe pid=" + pid + " -> " + reason
        + " deployed=" + String(deployed[pid] === true)
        + " inGate=" + String(playerInGate(pid)));
}

export function configureNukeEvents(): void {
    Events.OnRayCastHit.subscribe((p: mod.Player, point: mod.Vector, _n: mod.Vector) => {
        safe("nuke.hit", () => { resolveHit(p, point); });
    });
    Events.OnRayCastMissed.subscribe((p: mod.Player) => {
        const pid: number = mod.GetObjId(p);
        delete inFlight[pid];
    });
    Events.OnPlayerEnterAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("nuke.gate.enter", () => { onGateEnter(p, at); });
    });
    Events.OnPlayerExitAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("nuke.gate.exit", () => { onGateExit(p, at); });
    });
    Events.OnPlayerLeaveGame.subscribe((pid: number) => {
        safe("nuke.gate.leave", () => {
            onGateLeave(pid);
            delete inFlight[pid];
            forgetHold(pid);
            delete deployed[pid];
        });
    });
    Events.OnPlayerDeployed.subscribe((p: mod.Player) => {
        safe("nuke.deployed", () => {
            deployed[mod.GetObjId(p)] = true;
        });
    });
    Events.OnPlayerUndeploy.subscribe((p: mod.Player) => {
        safe("nuke.undeployed", () => {
            const pid: number = mod.GetObjId(p);
            deployed[pid] = false;
            forgetHold(pid);
            delete inFlight[pid];
        });
    });
}

export function tickNukeProbe(): void {
    probe();
}

export function inFlightCount(): number {
    return Object.keys(inFlight).length;
}
