import { Events } from "bf6-portal-utils/events";
import { log, safe, willLogDebug } from "./util/log";
import { HQ_TARGETS, isConfigured } from "./objids";
import { HQ_HIT_RADIUS_M, RAY_MAX_DIST_M, RAY_START_OFFSET_M, RAY_PASS_M, RAY_PASS_TRIES, RORSCH_TRACE, RORSCH_MIN_CHARGE_MS, RORSCH_PITCH_FIX_RAD } from "./config";
import { isRorschActive } from "./weapons";
import { configureNukeFxEvents, detonate, startChargeAlarm, stopChargeAlarm } from "./nukefx";
import { isRorschCarrier, onRorschShot } from "./rorschammo";
import { isBotPid } from "./bots";
import { teamIdOf } from "./util/roster";
import { hitHq } from "./hq";
import { hqOpenFor, raygunAtRadars } from "./sitewire";
import { Raycast } from "bf6-portal-utils/raycast";
import { Vectors } from "bf6-portal-utils/vectors";
import { holdStep, HoldResult, HoldState } from "./rorschshot";

interface PendingRay {
    pid: number;
    // The shooter, for the nuke's kill credit.
    player: mod.Player;
    team: number;
    start: Vectors.Vector3;
    // Wall-clock cast time, so a ray that never reports back is visible in
    // the RORSCH_TRACE "RAY skipped" line.
    castMs: number;
    // Normalised ray direction, set at cast, for the radar path test.
    dir: Vectors.Vector3 | undefined;
    // Where the current cast started (the first one RAY_START_OFFSET_M ahead
    // of the eyes), its distance along the aim from the eyes, and how many
    // times it was cast again past an obstacle.
    from: Vectors.Vector3 | undefined;
    u: number;
    tries: number;
}

const inFlight: { [pid: number]: PendingRay } = {};
// Per-player trigger hold while carrying the Rorsch; see
// rorschshot.ts for why the shot is the IsFiring falling edge after a charge.
const hold: { [pid: number]: HoldState } = {};
// RORSCH_TRACE only: last IsReloading value, to log its edges.
const wasReloading: { [pid: number]: boolean } = {};
// RORSCH_TRACE only: time of the last Rorsch press, kept past release.
const lastPressMs: { [pid: number]: number } = {};
// RORSCH_TRACE only: when IsReloading last turned on, to time the reload.
const reloadOnMs: { [pid: number]: number } = {};

function sincePress(pid: number, nowMs: number): string {
    const pressed: number | undefined = lastPressMs[pid];
    return pressed === undefined ? "(no press seen)" : "+" + String(nowMs - pressed) + "ms after press";
}

// Diagnostic, one cheap soldier-state read per tick for players in a fire zone
// with the Rorsch. Logs both IsReloading edges with the time since the press
// and the trigger state, to test whether the reload marks the actual shot and
// whether IsFiring drops during the reload while the trigger is still held.
function traceReload(p: mod.Player, pid: number, nowMs: number, firing: boolean): void {
    let reloading: boolean;
    try {
        reloading = mod.GetSoldierState(p, mod.SoldierStateBool.IsReloading);
    } catch (e) {
        return;
    }
    const was: boolean = wasReloading[pid] === true;
    if (reloading && !was) {
        reloadOnMs[pid] = nowMs;
        log("nuke", "TRACE pid=" + pid + " IsReloading ON " + sincePress(pid, nowMs)
            + " firing=" + String(firing));
    } else if (!reloading && was) {
        const on: number | undefined = reloadOnMs[pid];
        log("nuke", "TRACE pid=" + pid + " IsReloading OFF after "
            + (on === undefined ? "?" : String(nowMs - on)) + "ms, " + sincePress(pid, nowMs)
            + " firing=" + String(firing));
    }
    wasReloading[pid] = reloading;
}

// RORSCH_TRACE only, read once per press: which inventory slot is active.
// isRorschInHand is HasEquipment, which is true whenever the Rorsch is carried,
// so this shows whether a press came from the Rorsch or from another weapon.
function traceSlot(p: mod.Player): string {
    try {
        return "slot pri=" + String(mod.IsInventorySlotActive(p, mod.InventorySlots.PrimaryWeapon))
            + " sec=" + String(mod.IsInventorySlotActive(p, mod.InventorySlots.SecondaryWeapon))
            + " misc=" + String(mod.IsInventorySlotActive(p, mod.InventorySlots.MiscGadget));
    } catch (e) {
        return "slot read threw " + String(e);
    }
}

function forgetHold(pid: number): void {
    stopChargeAlarm(pid);
    delete hold[pid];
    delete wasReloading[pid];
    delete lastPressMs[pid];
    delete reloadOnMs[pid];
    delete chargeAim[pid];
}
const deployed: { [pid: number]: boolean } = {};

// Zero FFI: HasEquipment and the other soldier reads throw PlayerNotDeployed
// on a player who is not deployed (rorschammo's poll).
export function isDeployedPid(pid: number): boolean {
    return deployed[pid] === true;
}

let inited: boolean = false;

export function initNuke(): void {
    inited = true;
    cacheHqTargets();
    log("nuke", "ready: ray on discharge (IsFiring off after charge), one ray per player, HQ hit within "
        + String(HQ_HIT_RADIUS_M) + " m once open");
}

function shootRay(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    const pending: PendingRay | undefined = inFlight[pid];
    // A ray still waiting after 4 s lost its result and gives way to the new
    // shot.
    if (pending !== undefined && Date.now() - pending.castMs < 4000) {
        if (RORSCH_TRACE) {
            log("nuke", "RAY skipped pid=" + pid + " - previous ray still in flight ("
                + String(Date.now() - pending.castMs) + "ms)");
        }
        return;
    }
    const team: number = teamIdOf(p);
    // Aim from the last charging tick, before the discharge kick; the live read
    // is only a fallback for a shot with no captured aim.
    const aim: Aim | undefined = chargeAim[pid];
    delete chargeAim[pid];
    // EyePosition is one FFI call and is needed both for the inFlight origin and
    // for the ray start, so it is read exactly once.
    const eye: mod.Vector = aim !== undefined
        ? mod.CreateVector(aim.ex, aim.ey, aim.ez)
        : mod.GetSoldierState(p, mod.SoldierStateVector.EyePosition);
    const pendingRay: PendingRay = {
        pid: pid, player: p, team: team, start: Vectors.toVector3(eye), castMs: Date.now(), dir: undefined,
        from: undefined, u: RAY_START_OFFSET_M, tries: 0
    };
    inFlight[pid] = pendingRay;
    safe("nuke.cast", () => {
        const facing: mod.Vector = aim !== undefined
            ? mod.CreateVector(aim.fx, aim.fy, aim.fz)
            : mod.Normalize(mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection));
        // Start ahead of the soldier. A ray originating at the eye position hits
        // the player's own body/weapon ~0.24 m out (see the 03:29 log), so the
        // hit point never came near a turret and nothing was ever destroyed.
        const e3: Vectors.Vector3 = Vectors.toVector3(eye);
        const f3: Vectors.Vector3 = pitchedDown(Vectors.toVector3(facing), RORSCH_PITCH_FIX_RAD);
        pendingRay.dir = f3;
        castStraight(pendingRay);
        if (RORSCH_TRACE || willLogDebug()) {
            // After the cast, so the extra read adds no latency: the facing on
            // the discharge tick itself, to measure the kick the snapshot avoids.
            const live: Vectors.Vector3 = Vectors.toVector3(mod.Normalize(
                mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection)));
            log("nuke", "CAST pid=" + pid + " team=" + team + " from "
                + String(e3.x) + "," + String(e3.y) + "," + String(e3.z)
                + " dir " + String(f3.x) + "," + String(f3.y) + "," + String(f3.z)
                + (aim !== undefined ? " (charge aim)" : " (live aim, none captured)")
                + " (raw aim y " + String(mod.YComponentOf(facing)) + ", pitched down " + RORSCH_PITCH_FIX_RAD + " rad)"
                + " dischargeTickDirY=" + String(live.y));
        }
    });
}

// The facing turned down by rad, keeping its yaw.
function pitchedDown(f: Vectors.Vector3, rad: number): Vectors.Vector3 {
    if (rad === 0) {
        return f;
    }
    const h: number = Math.sqrt(f.x * f.x + f.z * f.z);
    if (h < 1e-6) {
        return f;
    }
    const pitch: number = Math.atan2(f.y, h) - rad;
    const c: number = Math.cos(pitch);
    return { x: f.x / h * c, y: Math.sin(pitch), z: f.z / h * c };
}

// The straight ray (the Rorsch is a raygun), from ray.u along the aim (the
// first cast starts RAY_START_OFFSET_M out, past the shooter's own body) to the
// full range. Cast through the bf6-portal-utils Raycast queue, shared with the
// rocket-site launchers: each result comes back to this ray's own callback
// (the engine reports results per player with no ray id), and the queue keeps
// to one engine ray per player per tick.
function castStraight(ray: PendingRay): void {
    const d: Vectors.Vector3 | undefined = ray.dir;
    if (d === undefined) {
        return;
    }
    const s: Vectors.Vector3 = ray.start;
    const u1: number = RAY_START_OFFSET_M + RAY_MAX_DIST_M;
    const from: Vectors.Vector3 = { x: s.x + d.x * ray.u, y: s.y + d.y * ray.u, z: s.z + d.z * ray.u };
    ray.from = from;
    const id = Raycast.cast(from, { x: s.x + d.x * u1, y: s.y + d.y * u1, z: s.z + d.z * u1 },
        (hit: boolean, point?: Raycast.Vector3) => {
            if (inFlight[ray.pid] !== ray) {
                return;
            }
            delete inFlight[ray.pid];
            if (hit && point !== undefined) {
                safe("nuke.hit", () => { resolveHit(ray, { x: point.x, y: point.y, z: point.z }); });
            } else {
                safe("nuke.miss", () => { resolveMiss(ray); });
            }
        },
        { priority: Raycast.Priority.Critical });
    if (id === null) {
        log("nuke", "RAY rejected by the Raycast queue pid=" + ray.pid);
        delete inFlight[ray.pid];
    }
}

// Aim captured on every tick the Rorsch is charging, used for the shot. By the
// tick the discharge is seen, the weapon's kick has already pitched the view
// up. (The charging facing is still ~0.057 rad high: RORSCH_PITCH_FIX_RAD.)
// Plain numbers, so no engine handle is held across ticks.
interface Aim {
    ex: number;
    ey: number;
    ez: number;
    fx: number;
    fy: number;
    fz: number;
}

const chargeAim: { [pid: number]: Aim } = {};

function captureAim(p: mod.Player, pid: number): void {
    try {
        const e: Vectors.Vector3 = Vectors.toVector3(
            mod.GetSoldierState(p, mod.SoldierStateVector.EyePosition));
        const f: Vectors.Vector3 = Vectors.toVector3(mod.Normalize(
            mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection)));
        chargeAim[pid] = { ex: e.x, ey: e.y, ez: e.z, fx: f.x, fy: f.y, fz: f.z };
    } catch (e) {
        // Keep the previous tick's aim, if any.
    }
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

function resolveHit(ray: PendingRay, hit: Vectors.Vector3): void {
    const pid: number = ray.pid;
    const p: mod.Player = ray.player;
    const team: number = ray.team;
    if (team !== 1 && team !== 2) {
        return;
    }
    const travelled: number = dist(ray.start, hit);
    if (ray.from !== undefined && ray.dir !== undefined && dist(ray.from, hit) < RAY_PASS_M) {
        if (ray.tries >= RAY_PASS_TRIES) {
            log("nuke", "HIT ignored pid=" + pid + " - still blocked at " + String(travelled.toFixed(2))
                + "m after " + ray.tries + " retries");
            return;
        }
        // Cast again from just past the obstacle (the queue sends it next tick).
        ray.u = ray.u + dist(ray.from, hit) + RAY_PASS_M;
        ray.tries++;
        inFlight[pid] = ray;
        castStraight(ray);
        if (RORSCH_TRACE || willLogDebug()) {
            log("nuke", "HIT pid=" + pid + " blocked at " + String(travelled.toFixed(2))
                + "m, cast again past it (" + ray.tries + ")");
        }
        return;
    }
    if (RORSCH_TRACE || willLogDebug()) {
        log("nuke", "HIT pid=" + pid + " team=" + team + " dist=" + String(travelled.toFixed(1))
            + " at " + String(hit.x) + "," + String(hit.y) + "," + String(hit.z));
    }

    safe("nuke.detonate", () => { detonate(hit.x, hit.y, hit.z, p); });
    const d3: Vectors.Vector3 | undefined = ray.dir;
    if (d3 !== undefined) {
        safe("nuke.radars", () => { raygunAtRadars(team, pid, ray.start, d3, travelled, hit); });
    }

    for (const base of [1, 2]) {
        if (base === team) {
            continue;
        }
        const target: number = HQ_TARGETS[base - 1];
        if (!isConfigured(target)) {
            continue;
        }
        const losOk: boolean = hqOpenFor(base);
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
        // "still protected" and "out of range" need different fixes.
        log("nuke", "hq base " + base + " dist=" + String(d.toFixed(1))
            + " range=" + String(HQ_HIT_RADIUS_M)
            + " inRange=" + String(inRange) + " open=" + String(losOk)
            + (inRange && losOk ? " -> HIT" : (inRange ? " -> protected by its rocket sites" : " -> out of range")));
    }
}

// A ray that hit nothing: the radar path test still runs over its full length,
// since RayCast passes through models.
function resolveMiss(ray: PendingRay): void {
    if (RORSCH_TRACE) {
        log("nuke", "RAY miss pid=" + ray.pid + " - nothing hit within " + String(RAY_MAX_DIST_M) + "m");
    }
    const d3: Vectors.Vector3 | undefined = ray.dir;
    if (d3 !== undefined && (ray.team === 1 || ray.team === 2)) {
        raygunAtRadars(ray.team, ray.pid, ray.start, d3, RAY_START_OFFSET_M + RAY_MAX_DIST_M, undefined);
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
            // Zero-FFI filter first: a player is only read while carrying the
            // Rorsch (rorschammo's 1 Hz poll).
            if (!isRorschCarrier(pid)) {
                if (hold[pid] !== undefined) {
                    forgetHold(pid);
                }
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
                if (!isRorschActive(p)) {
                    logNukeOnce(pid, "noRorsch");
                    if (RORSCH_TRACE) {
                        log("nuke", "PRESS pid=" + pid + " ignored - Rorsch not carried, " + traceSlot(p));
                    }
                    hold[pid] = { pressMs: nowMs, ignored: true };
                    continue;
                }
                logNukeOnce(pid, "charging");
                lastPressMs[pid] = nowMs;
                startChargeAlarm(p, pid);
                log("nuke", "PRESS pid=" + pid + " charging, discharge counts after "
                    + String(RORSCH_MIN_CHARGE_MS) + "ms held"
                    + (RORSCH_TRACE ? ", " + traceSlot(p) : ""));
            }
            const r: HoldResult = holdStep(st, firing, nowMs, RORSCH_MIN_CHARGE_MS);
            if (r.next === undefined) {
                delete hold[pid];
            } else {
                hold[pid] = r.next;
                if (!r.next.ignored) {
                    captureAim(p, pid);
                }
            }
            if (r.fire) {
                // Cast first, in the same tick the discharge is seen; the logs
                // and the reload trace come after so they add no latency.
                shootRay(p);
                stopChargeAlarm(pid);
                onRorschShot(p, pid);
                logNukeOnce(pid, "fired");
                log("nuke", "SHOT pid=" + pid + " discharge after "
                    + String(nowMs - (st === undefined ? nowMs : st.pressMs)) + "ms - ray cast");
            } else if (r.next === undefined && st !== undefined && !st.ignored) {
                stopChargeAlarm(pid);
                log("nuke", "RELEASED pid=" + pid + " after "
                    + String(nowMs - st.pressMs) + "ms - charge cancelled, no shot");
            }
            if (RORSCH_TRACE) {
                traceReload(p, pid, nowMs, firing);
            }
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
        + " deployed=" + String(deployed[pid] === true));
}

export function configureNukeEvents(): void {
    configureNukeFxEvents();
    Events.OnPlayerLeaveGame.subscribe((pid: number) => {
        safe("nuke.leave", () => {
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
