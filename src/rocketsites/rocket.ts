import {
    ASSET, BEEP_AMP, BEEP_FAST_MS, BEEP_RANGE_M, BEEP_SLOW_MS, BURST_LIFETIME_MS, DAMAGE_ENABLED, FLIGHT_AMP,
    FLIGHT_RANGE_M, HIT_RADIUS_M, SOUND_MOVE_MS, MAX_FLIGHT_MS, ROCKET_ACCEL, ROCKET_CLOSE_RANGE_M, ROCKET_MODE, ROCKET_RISE_SECS,
    ROCKET_SPAWN_UP_M, ROCKET_SPEED_MAX, ROCKET_SPEED_START, ROCKET_TURN_DEG_PER_S, SEGMENT_MS,
    TARGET_AIM_UP_M, TRAIL_PITCH_OFFSET_DEG, TRAIL_YAW_OFFSET_DEG, VEHICLE_DAMAGE, VFX_LIFETIME_MS
} from "./config";
import { KinParams, RocketKin, V3, beepIntervalMs, dirToEulerDeg, dist, newRocket, segmentHits, stepRocket } from "./geom";
import { HitState, chaseVerdict, wetHit } from "./hitcore";
import { LOG_EVENTS, LOG_TRACE, logAt, safe, tryGet } from "./log";
import { moveSfx, moveVfx, playAt, restartFor, soldierPos, spawnSfx, spawnVfx, stopSfx, stopVfx } from "./fx";
import { engAim } from "./rot";
import { SiloDef } from "./sitemap";

// The script owns each rocket's position (one homing integrator, geom.ts);
// ROCKET_MODE only changes how it is drawn. The hit and the damage are
// scripted at the target, so the kill never depends on the VFX. A target
// alive at MAX_FLIGHT_MS is hit anyway; only a target that died some other
// way or left the game gets a mid-air burst (and is never damaged).
// DAMAGE_ENABLED off (owner's test setting): the hit explodes, nobody dies.

const KIN: KinParams = {
    riseSecs: ROCKET_RISE_SECS,
    speedStart: ROCKET_SPEED_START,
    accel: ROCKET_ACCEL,
    speedMax: ROCKET_SPEED_MAX,
    turnDegPerSec: ROCKET_TURN_DEG_PER_S,
    closeRangeM: ROCKET_CLOSE_RANGE_M
};

interface Rocket {
    n: number;
    key: string;
    pid: number;
    target: mod.Player;
    site: number;                   // the rocket site that launched it
    siloId: number;
    kin: RocketKin;
    aim: V3;
    startDist: number;
    launchedAt: number;
    trail: mod.VFX | undefined;
    segments: mod.VFX[];
    flight: mod.SFX | undefined;
    beep: mod.SFX | undefined;
    nextBeepAt: number;
    nextSegAt: number;
    nextSoundMoveAt: number;
    dead: boolean;
}

const rockets: Rocket[] = [];
let launches: number = 0;

export function airborneAll(): number {
    return rockets.length;
}

export function airborne(site: number): number {
    return rockets.filter(r => r.site === site).length;
}

export function busyKeys(site: number, into: Set<string>): void {
    for (const r of rockets) {
        if (r.site === site) {
            into.add(r.key);
        }
    }
}

export function rocketTargets(site: number): number[] {
    return rockets.filter(r => r.site === site).map(r => r.pid);
}

export function newestAim(site: number): V3 | undefined {
    for (let i = rockets.length - 1; i >= 0; i--) {
        if (rockets[i].site === site) {
            return rockets[i].aim;
        }
    }
    return undefined;
}

// OnPlayerDied / OnPlayerLeaveGame: the rocket bursts instead of killing the
// player again after a redeploy.
export function markDead(pid: number): void {
    for (const r of rockets) {
        if (r.pid === pid) {
            r.dead = true;
        }
    }
}

function aimPoint(p: mod.Player): V3 | undefined {
    const pos: V3 | undefined = soldierPos(p);
    return pos === undefined ? undefined : [pos[0], pos[1] + TARGET_AIM_UP_M, pos[2]];
}

export function launchRocket(site: number, s: SiloDef, target: mod.Player, pid: number, key: string, now: number): void {
    const origin: V3 = [s.x, s.y + ROCKET_SPAWN_UP_M, s.z];
    const aim: V3 = aimPoint(target) ?? origin;
    const r: Rocket = {
        n: ++launches, key, pid, target, site, siloId: s.siloId,
        kin: newRocket(origin, KIN), aim, startDist: Math.max(1, dist(origin, aim)), launchedAt: now,
        trail: undefined, segments: [], flight: undefined, beep: undefined, nextBeepAt: now, nextSegAt: now, nextSoundMoveAt: now, dead: false
    };
    rockets.push(r);
    logAt(LOG_TRACE, "rocket", () => "#" + r.n + " site " + site + " launch silo " + s.siloId + " mode=" + ROCKET_MODE + " target=pid " + pid
        + (key.charAt(0) === "v" ? " (vehicle)" : " (foot)") + " dist " + r.startDist.toFixed(0) + "m"
        + (DAMAGE_ENABLED ? "" : " damage off"));
}

export function tickRockets(now: number, dt: number): void {
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r: Rocket = rockets[i];
        const finished: boolean | undefined = tryGet("rocket.step", () => stepOne(r, now, dt));
        if (finished === undefined) {
            cleanup(r);
        }
        if (finished !== false) {
            rockets.splice(i, 1);
        }
    }
}

// "chase" unless the target definitely died or left; a failed read keeps
// the rocket homing on the last aim (hitcore.chaseVerdict). The zone plays
// no part: a rocket follows its target anywhere.
function chaseState(r: Rocket): string {
    const valid: boolean | undefined = r.dead ? undefined : tryGet("rocket.valid", () => mod.IsPlayerValid(r.target));
    const alive: boolean | undefined = valid === true ? tryGet("rocket.alive", () => mod.GetSoldierState(r.target, mod.SoldierStateBool.IsAlive)) : undefined;
    return chaseVerdict(r.dead, valid, alive);
}

function stepOne(r: Rocket, now: number, dt: number): boolean {
    const chase: string = chaseState(r);
    if (chase !== "chase") {
        explode(r, now, false, chase);
        return true;
    }
    const aim: V3 | undefined = aimPoint(r.target);
    if (aim !== undefined) {
        r.aim = aim;
    }
    const prev: V3 = [r.kin.pos[0], r.kin.pos[1], r.kin.pos[2]];
    stepRocket(r.kin, r.aim, dt, KIN);
    if (segmentHits(prev, r.kin.pos, r.aim, HIT_RADIUS_M) || now - r.launchedAt >= MAX_FLIGHT_MS) {
        explode(r, now, true, "");
        return true;
    }
    draw(r, now);
    sound(r, now);
    return false;
}

function trailRot(r: Rocket): V3 {
    const e: V3 = dirToEulerDeg(r.kin.dir);
    return engAim(e[1] + TRAIL_YAW_OFFSET_DEG, e[0] + TRAIL_PITCH_OFFSET_DEG);
}

function draw(r: Rocket, now: number): void {
    if (ROCKET_MODE === "drag") {
        if (r.trail === undefined) {
            r.trail = spawnVfx(ASSET.trail, r.kin.pos, trailRot(r), VFX_LIFETIME_MS, now);
        } else {
            moveVfx(r.trail, r.kin.pos, trailRot(r));
        }
    } else if (now >= r.nextSegAt) {
        const seg: mod.VFX | undefined = spawnVfx(ASSET.trail, r.kin.pos, trailRot(r), VFX_LIFETIME_MS, now);
        if (seg !== undefined) {
            r.segments.push(seg);
            r.nextSegAt = now + SEGMENT_MS;
        }
    }
}

function sound(r: Rocket, now: number): void {
    if (r.flight === undefined) {
        r.flight = spawnSfx(ASSET.flight, r.kin.pos);
        if (r.flight !== undefined) {
            playAt(r.flight, r.kin.pos, FLIGHT_AMP, FLIGHT_RANGE_M);
        }
    } else if (now >= r.nextSoundMoveAt) {
        moveSfx(r.flight, r.kin.pos);
        r.nextSoundMoveAt = now + SOUND_MOVE_MS;
    }
    if (r.beep === undefined) {
        r.beep = spawnSfx(ASSET.incomingBeep, r.aim);
        return;
    }
    if (now >= r.nextBeepAt) {
        restartFor(r.beep, r.aim, BEEP_AMP, BEEP_RANGE_M, r.target);
        r.nextBeepAt = now + beepIntervalMs(dist(r.kin.pos, r.aim), r.startDist, BEEP_SLOW_MS, BEEP_FAST_MS);
    }
}

function explode(r: Rocket, now: number, hit: boolean, why: string): void {
    spawnVfx(hit ? ASSET.hit : ASSET.burst, hit ? r.aim : r.kin.pos, [0, 0, 0], BURST_LIFETIME_MS, now, true);
    let wet: string = "";
    if (hit) {
        const st: HitState = hitState(r.target);
        if (wetHit(st)) {
            spawnVfx(ASSET.hitWet, r.aim, [0, 0, 0], BURST_LIFETIME_MS, now, true);
            wet = " WET";
        }
        wet += " (water " + st.inWater + ", diving " + st.diving + ", vehicle " + st.inVehicle + ", boat " + st.boat + ")";
    }
    if (hit && DAMAGE_ENABLED) {
        damage(r.target);
    }
    cleanup(r);
    const flightMs: number = now - r.launchedAt;
    logAt(LOG_EVENTS, "rocket", () => "#" + r.n + " " + (hit ? "hit" : "burst mid-air (target " + why + ")") + " pid " + r.pid
        + " flight " + (flightMs / 1000).toFixed(1) + "s" + (hit && flightMs >= MAX_FLIGHT_MS ? " (forced at timeout)" : "")
        + (hit && !DAMAGE_ENABLED ? " (damage off)" : "") + wet);
}

function hitState(p: mod.Player): HitState {
    const flag = (tag: string, b: mod.SoldierStateBool): boolean | undefined =>
        tryGet("rocket." + tag, () => mod.GetSoldierState(p, b));
    const inVehicle: boolean | undefined = flag("inVehicle", mod.SoldierStateBool.IsInVehicle);
    const boat: boolean | undefined = inVehicle !== true ? undefined : tryGet("rocket.boat", () => {
        const v: mod.Vehicle = mod.GetVehicleFromPlayer(p);
        return mod.CompareVehicleName(v, mod.VehicleList.RHIB) || mod.CompareVehicleName(v, mod.VehicleList.RCB_90_Patrol_Boat)
            || mod.CompareVehicleName(v, mod.VehicleList.RCB_90_Patrol_Boat_Pax);
    });
    return {
        inWater: flag("inWater", mod.SoldierStateBool.IsInWater),
        diving: flag("diving", mod.SoldierStateBool.IsDiving),
        inVehicle,
        boat
    };
}

// Also removes the rocket's trail (owner, 2026-10-03: the rocket effect
// stayed after the explosion).
function cleanup(r: Rocket): void {
    if (r.trail !== undefined) {
        stopVfx(r.trail);
    }
    for (const seg of r.segments) {
        stopVfx(seg);
    }
    r.trail = undefined;
    r.segments = [];
    if (r.flight !== undefined) {
        stopSfx(r.flight);
    }
    if (r.beep !== undefined) {
        stopSfx(r.beep);
    }
    r.flight = undefined;
    r.beep = undefined;
}

function damage(p: mod.Player): void {
    const inVehicle: boolean = tryGet("rocket.inVehicle", () => mod.GetSoldierState(p, mod.SoldierStateBool.IsInVehicle)) === true;
    if (inVehicle) {
        safe("rocket.vehicleDamage", () => mod.DealDamage(mod.GetVehicleFromPlayer(p), VEHICLE_DAMAGE));
        safe("rocket.vehicleKill", () => mod.Kill(mod.GetVehicleFromPlayer(p)));
    } else {
        safe("rocket.kill", () => mod.Kill(p));
    }
}
