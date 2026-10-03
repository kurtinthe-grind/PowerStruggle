import { Timers } from "bf6-portal-utils/timers";
import {
    ALLOWED_LAUNCHERS, LAUNCHER_RANGE_M, LAUNCHER_REQUIRE_ACTIVE_SLOT, LAUNCHER_ROCKET_SPEED_MPS,
    LAUNCHER_TRACE_PRESSES, RADAR_HIT_SHAPE, RAY_MAX_DIST_M, RAY_OWN_ROCKET_M, RAY_RESULT_TIMEOUT_MS,
    RAY_START_OFFSET_M
} from "./config";
import { V3, add, dist, norm, scale } from "./geom";
import { LOG_EVENTS, LOG_TRACE, log, logAt, logOn, safe, tryGet } from "./log";
import { toV3, vec } from "./fx";
import { pickRadar } from "./raygeom";
import { ownRocketStop, pressed, rayExpired } from "./shotcore";
import { deployedNow } from "./players";
import { RadarTarget, liveRadars, radarHitBy } from "./site";

// Launcher shots at the radar, the PowerStruggle Rorsch-turret method: on
// the shot, cast mod.RayCast along the shooter's aim; the radar is hit when
// the ray's path crosses an upright cylinder around it (RayCast can pass
// through models) or the ray stops next to it. A launcher fires on the
// press, so the shot is IsFiring's rising edge with an allowed launcher up.
// The ray starts RAY_START_OFFSET_M out, past the shooter's own rocket, and
// the path is judged from the eye so close shots still count. With several
// sites, the shot is judged against every enemy radar in range that still
// stands, and the nearest one on the shot's path takes the hit.

interface PendingRay {
    eye: V3;
    dir: V3;
    launcher: string;
    sentAt: number;
    radars: RadarTarget[];          // enemy radars in range when the shot went off
}

const firingWas: { [pid: number]: boolean } = {};
const inFlight: { [pid: number]: PendingRay } = {};
let traced: number = 0;

function slotActive(p: mod.Player, slot: mod.InventorySlots): boolean {
    return tryGet("launch.slot", () => mod.IsInventorySlotActive(p, slot)) === true;
}

// The allowed launcher in hand, or undefined. Logs the slot states for the
// first presses so the "in hand" test can be checked against the game.
function launcherInHand(p: mod.Player, pid: number): string | undefined {
    let carried: string | undefined;
    for (const l of ALLOWED_LAUNCHERS) {
        if (tryGet("launch.has", () => mod.HasEquipment(p, l.gadget)) === true) {
            carried = l.name;
            break;
        }
    }
    const g1: boolean = slotActive(p, mod.InventorySlots.GadgetOne);
    const g2: boolean = slotActive(p, mod.InventorySlots.GadgetTwo);
    const cg: boolean = slotActive(p, mod.InventorySlots.ClassGadget);
    const held: boolean = !LAUNCHER_REQUIRE_ACTIVE_SLOT || g1 || g2 || cg;
    if (logOn(LOG_TRACE) && traced < LAUNCHER_TRACE_PRESSES) {
        traced++;
        log("launcher", "PRESS pid " + pid + " carried=" + (carried ?? "none") + " slots gadget1=" + g1
            + " gadget2=" + g2 + " class=" + cg + " primary=" + slotActive(p, mod.InventorySlots.PrimaryWeapon)
            + " -> " + (carried !== undefined && held ? "counts" : "ignored"));
    }
    return carried !== undefined && held ? carried : undefined;
}

// The radars a player could be shooting at: other teams', still standing,
// within LAUNCHER_RANGE_M of the eye.
function enemyRadarsInRange(team: number, eye: V3, standing: RadarTarget[]): RadarTarget[] {
    return standing.filter(r => r.team !== team && dist(eye, r.pos) <= LAUNCHER_RANGE_M);
}

// Only players near an enemy radar (by the shared per-tick position) have
// their eye and trigger read.
export function tickLaunchers(now: number, tickNo: number): void {
    expireRays(now);
    const standing: RadarTarget[] = liveRadars();
    if (standing.length === 0) {
        return;
    }
    for (const d of deployedNow(tickNo)) {
        const p: mod.Player = d.p;
        const pid: number = d.pid;
        const team: number = d.team;
        if (enemyRadarsInRange(team, d.pos, standing).length === 0) {
            firingWas[pid] = false;
            continue;
        }
        const eye: V3 | undefined = tryGet("launch.eye", () => toV3(mod.GetSoldierState(p, mod.SoldierStateVector.EyePosition)));
        const radars: RadarTarget[] = eye === undefined ? [] : enemyRadarsInRange(team, eye, standing);
        if (eye === undefined || radars.length === 0) {
            firingWas[pid] = false;
            continue;
        }
        const firing: boolean = tryGet("launch.firing", () => mod.GetSoldierState(p, mod.SoldierStateBool.IsFiring)) === true;
        const press: boolean = pressed(firingWas[pid], firing);
        firingWas[pid] = firing;
        if (!press) {
            continue;
        }
        const launcher: string | undefined = launcherInHand(p, pid);
        if (launcher !== undefined) {
            cast(p, pid, eye, launcher, radars, now);
        }
    }
}

// A ray with no answer is judged along its path rather than left to block
// that shooter's later shots.
function expireRays(now: number): void {
    for (const k of Object.keys(inFlight)) {
        const pid: number = Number(k);
        const ray: PendingRay = inFlight[pid];
        if (rayExpired(ray.sentAt, now, RAY_RESULT_TIMEOUT_MS)) {
            delete inFlight[pid];
            log("launcher", "pid " + pid + " ray never answered; judged along its path");
            judge(pid, ray, RAY_MAX_DIST_M, undefined, "no answer");
        }
    }
}

function cast(p: mod.Player, pid: number, eye: V3, launcher: string, radars: RadarTarget[], now: number): void {
    if (inFlight[pid] !== undefined) {
        return;
    }
    const facing: V3 | undefined = tryGet("launch.facing", () => toV3(mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection)));
    if (facing === undefined) {
        return;
    }
    const dir: V3 = norm(facing);
    const start: V3 = add(eye, scale(dir, RAY_START_OFFSET_M));
    const end: V3 = add(eye, scale(dir, RAY_MAX_DIST_M));
    inFlight[pid] = { eye, dir, launcher, sentAt: now, radars };
    if (!safe("launch.cast", () => mod.RayCast(p, vec(start), vec(end)))) {
        delete inFlight[pid];
        return;
    }
    logAt(LOG_EVENTS, "launcher", () => "SHOT pid " + pid + " " + launcher + ", enemy radars in range: "
        + radars.map(r => "site " + r.n + " " + dist(eye, r.pos).toFixed(0) + " m").join(", "));
}

// lenFromEye: how far along the aim the ray got; hit: where it stopped.
function judge(pid: number, ray: PendingRay, lenFromEye: number, hit: V3 | undefined, why: string): void {
    const where: string = why + (hit === undefined ? "" : ", stopped " + lenFromEye.toFixed(0) + " m out");
    const idx: number = pickRadar(ray.eye, ray.dir, lenFromEye, hit, ray.radars.map(r => r.pos), RADAR_HIT_SHAPE);
    if (idx < 0) {
        logAt(LOG_EVENTS, "launcher", () => "pid " + pid + " missed every radar (ray " + where + ")");
        return;
    }
    const radar: RadarTarget = ray.radars[idx];
    const delayMs: number = (dist(ray.eye, radar.pos) / LAUNCHER_ROCKET_SPEED_MPS) * 1000;
    logAt(LOG_EVENTS, "launcher", () => "pid " + pid + " on target: site " + radar.n + " radar (ray " + where + "), impact in " + delayMs.toFixed(0) + " ms");
    const land = (): void => {
        safe("launch.land", () => radarHitBy(radar.n, pid, ray.launcher));
    };
    if (Timers.setTimeout(land, delayMs) === null) {
        land();
    }
}

export function onRayHit(p: mod.Player, point: mod.Vector): void {
    const pid: number = mod.GetObjId(p);
    const ray: PendingRay | undefined = inFlight[pid];
    if (ray === undefined) {
        return;
    }
    delete inFlight[pid];
    const hit: V3 = toV3(point);
    const fromEye: number = dist(ray.eye, hit);
    if (ownRocketStop(fromEye, RAY_OWN_ROCKET_M)) {
        judge(pid, ray, RAY_MAX_DIST_M, undefined, "stopped " + fromEye.toFixed(1) + " m out on the own rocket, judged as clear");
        return;
    }
    judge(pid, ray, fromEye, hit, "hit");
}

export function onRayMiss(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    const ray: PendingRay | undefined = inFlight[pid];
    if (ray === undefined) {
        return;
    }
    delete inFlight[pid];
    judge(pid, ray, RAY_MAX_DIST_M, undefined, "clear");
}
