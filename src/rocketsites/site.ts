import { PerformanceStats } from "bf6-portal-utils/performance-stats";
import { Timers } from "bf6-portal-utils/timers";
import {
    ALARM_AMP, ALARM_LINGER_MS, ALARM_RANGE_M, ASSET, BEEP_AMP, BEEP_RANGE_M, BURST_LIFETIME_MS,
    LOCK_MS, MAX_ROCKETS_AIRBORNE, PILLAR_MAX_MS, PILLAR_MS, POS_MATCH_M, RADAR_DRIVE,
    RADAR_HEALTH_MIN, RADAR_HITS, RADAR_IDLE_UPDATE_MS, RADAR_TRACK_UPDATE_MS, RADAR_MIN_STEP_DEG, RADAR_SLEW_DEG_PER_S, RADAR_SWEEP_DEG_PER_S, RADAR_TRACE_EVERY_MS, RADAR_TRACE_READS,
    RADAR_TURN_PILLAR, RADAR_WRECK_DELAY_MS, RADAR_YAW_OFFSET_DEG, SILO_RELOAD_MS, SITE_COOLDOWN_MS, VFX_LIFETIME_MS,
    WRECK_LIFETIME_MS
} from "./config";
import { DEG, M3, PartPose, V3, aimDeg, dist, stepAngleDeg, wrapDeg, yawPart } from "./geom";
import { AlarmLinger, Intruder, LockCore, SiteClaims, busyFromOthers, memberAction, nextReadySilo } from "./lockcore";
import { LOG_EVENTS, LOG_TRACE, fmt, log, logOn, safe, tryGet } from "./log";
import { moveSfx, playAt, readPos, readRot, setTransform, soldierPos, spawnSfx, spawnVfx, stopSfx, stopVfx } from "./fx";
import { RadarHealth } from "./shotcore";
import { engFromRad } from "./rot";
import { airborne, busyKeys, launchRocket, newestAim, rocketTargets } from "./rocket";
import { SITES, SiteDef, SiloDef } from "./sitemap";

// Every rocket site in sitemap.ts runs on its own: enemies of the site's
// team in its zone set off the alarm at its silo grid centre; its radar locks
// the nearest one for LOCK_MS; then its next ready silo plays the shockwave
// and smoke pillar and launches (no lid animation: owner, 2026-10-03).
// RADAR_HITS launcher hits on its radar take that site offline for the rest
// of the round.

// The radar is several objects (the spatial export flattens Godot's
// parenting), so each part is placed every update from its rest pose in
// sitemap.ts turned about the pillar's vertical axis.
interface RadarPart {
    id: number;
    name: string;
    obj: mod.SpatialObject;
    rest: V3;
    basis: M3;
}

interface Seen {
    pid: number;
    p: mod.Player;
    pos: V3;
    vehicle: mod.Vehicle | undefined;
}

// A live radar a launcher can shoot at (launcher.ts).
export interface RadarTarget {
    n: number;
    team: number;
    pos: V3;
}

let radarTraceLeft: number = RADAR_TRACE_READS;
let nextRadarTraceAt: number = 0;

class Site {
    readonly def: SiteDef;
    readonly n: number;
    readonly team: number;
    private readonly silos: SiloDef[];
    private readonly radarAt: V3;           // the pillar: the pivot
    private readonly radarParts: RadarPart[] = [];
    private radarYaw: number = 0;           // degrees turned from the Godot pose (which faces +Z)
    private drawnYaw: number | undefined;
    private nextDrawAt: number;
    private readonly siloReadyAt: number[];
    private readonly pillars: (mod.VFX | undefined)[];
    private nextSilo: number = 0;
    private readonly intruders: { [pid: number]: mod.Player } = {};
    private readonly watchers: Set<number> = new Set<number>();   // players in the animation zone, any team
    private readonly lock: LockCore = new LockCore(LOCK_MS, SITE_COOLDOWN_MS);
    private readonly alarmLinger: AlarmLinger = new AlarmLinger(ALARM_LINGER_MS);
    private alarm: mod.SFX | undefined;
    private lockBeep: mod.SFX | undefined;
    private lockBeepFor: mod.Player | undefined;
    readonly health: RadarHealth = new RadarHealth(RADAR_HITS);

    constructor(def: SiteDef, staggerMs: number) {
        this.def = def;
        this.n = def.n;
        this.team = def.team;
        this.silos = def.silos;
        this.radarAt = def.radarPos;
        this.siloReadyAt = def.silos.map(() => 0);
        this.pillars = def.silos.map(() => undefined);
        this.nextDrawAt = Date.now() + staggerMs;
    }

    // Always printed: startup problems and the radar destroyed.
    private log(msg: string): void {
        log("site", "site " + this.n + ": " + msg);
    }

    // Printed at LOG_LEVEL >= level; the message is only built then.
    private say(level: number, msg: () => string): void {
        if (logOn(level)) {
            this.log(msg());
        }
    }

    init(): void {
        this.initRadar();
        this.say(LOG_EVENTS, () => "ready: team " + this.team + ", zone " + this.def.zoneId + ", " + this.silos.length + " silos, radar "
            + this.radarParts.length + "/" + this.def.radarParts.length + " parts (" + RADAR_DRIVE + ")");
    }

    private initRadar(): void {
        for (const d of this.def.radarParts) {
            if (d.id === this.def.radarId && !RADAR_TURN_PILLAR) {
                continue;
            }
            const map: V3 = [d.x, d.y, d.z];
            const o: mod.SpatialObject | undefined = tryGet("site.getRadarPart", () => mod.GetSpatialObject(d.id));
            const p: V3 | undefined = o === undefined ? undefined : readPos(o);
            if (o === undefined || p === undefined || dist(p, map) > POS_MATCH_M) {
                this.log("radar part " + d.id + " (" + d.name + ") not resolved (reads " + fmt(p) + "); it stays still");
                continue;
            }
            this.radarParts.push({ id: d.id, name: d.name, obj: o, rest: map, basis: d.basis });
        }
    }

    owns(at: mod.AreaTrigger): boolean {
        return mod.GetObjId(at) === this.def.zoneId;
    }

    // The radar animation zone (x01): the radar is culled from view past
    // ~190 m (owner, 2026-10-03), so it only turns while someone is inside.
    ownsAnim(at: mod.AreaTrigger): boolean {
        return mod.GetObjId(at) === this.def.animZoneId;
    }

    watch(pid: number, inside: boolean): void {
        const was: number = this.watchers.size;
        if (inside) {
            this.watchers.add(pid);
        } else {
            this.watchers.delete(pid);
        }
        if (was === 0 && this.watchers.size > 0) {
            this.say(LOG_EVENTS, () => "radar awake (pid " + pid + " entered the animation zone)");
        } else if (was > 0 && this.watchers.size === 0) {
            this.say(LOG_EVENTS, () => "radar asleep (animation zone empty)");
        }
    }

    enter(p: mod.Player): void {
        const pid: number = mod.GetObjId(p);
        if (teamOf(p) === this.team) {
            this.say(LOG_TRACE, () => "pid " + pid + " entered the zone (site's own team, ignored)");
            return;
        }
        this.intruders[pid] = p;
        this.say(LOG_TRACE, () => "pid " + pid + " entered the zone");
    }

    exit(p: mod.Player): void {
        const pid: number = mod.GetObjId(p);
        if (this.intruders[pid] !== undefined) {
            delete this.intruders[pid];
            this.say(LOG_TRACE, () => "pid " + pid + " left the zone");
        }
    }

    gone(pid: number): void {
        delete this.intruders[pid];
        if (this.watchers.has(pid)) {
            this.watch(pid, false);
        }
    }

    // Live enemies in the zone. Everyone in one vehicle becomes a single
    // intruder keyed "v<lowest pid aboard>", so a helicopter gets one rocket.
    private liveIntruders(): { list: Intruder[]; byKey: { [key: string]: mod.Player } } {
        const seen: Seen[] = [];
        for (const k of Object.keys(this.intruders)) {
            const pid: number = Number(k);
            const p: mod.Player = this.intruders[pid];
            const valid: boolean | undefined = tryGet("site.valid", () => mod.IsPlayerValid(p));
            const alive: boolean | undefined = valid === true ? tryGet("site.alive", () => mod.GetSoldierState(p, mod.SoldierStateBool.IsAlive)) : undefined;
            const action = memberAction(valid, alive);
            if (action === "drop") {
                delete this.intruders[pid];
            }
            if (action !== "keep") {
                continue;
            }
            const pos: V3 | undefined = soldierPos(p);
            if (pos === undefined) {
                continue;
            }
            const inVehicle: boolean = tryGet("site.inVehicle", () => mod.GetSoldierState(p, mod.SoldierStateBool.IsInVehicle)) === true;
            const vehicle: mod.Vehicle | undefined = inVehicle ? tryGet("site.vehicle", () => mod.GetVehicleFromPlayer(p)) : undefined;
            seen.push({ pid, p, pos, vehicle });
        }
        seen.sort((a, b) => a.pid - b.pid);
        const list: Intruder[] = [];
        const byKey: { [key: string]: mod.Player } = {};
        const vehicleKeys: mod.Vehicle[] = [];
        for (const s of seen) {
            let key: string = "p" + s.pid;
            if (s.vehicle !== undefined) {
                const v: mod.Vehicle = s.vehicle;
                if (vehicleKeys.some(e => tryGet("site.sameVehicle", () => mod.Equals(e, v)) === true)) {
                    continue;
                }
                vehicleKeys.push(v);
                key = "v" + s.pid;
            }
            list.push({ key, pid: s.pid, x: s.pos[0], y: s.pos[1], z: s.pos[2] });
            byKey[key] = s.p;
        }
        return { list, byKey };
    }

    // A launcher rocket reached the radar (launcher.ts schedules this for
    // when the real rocket arrives).
    hitBy(pid: number, launcher: string): void {
        const res = this.health.hit();
        if (res === "ignored") {
            return;
        }
        this.say(LOG_EVENTS, () => "radar hit by pid " + pid + " (" + launcher + "): " + this.health.left + " of " + RADAR_HITS + " hits left");
        if (res === "destroyed") {
            this.destroy(pid);
        }
    }

    // One shot that takes the radar down whatever its health (PowerStruggle's
    // raygun).
    destroyBy(pid: number, weapon: string): void {
        if (!this.health.kill()) {
            return;
        }
        this.log("radar hit by pid " + pid + " (" + weapon + "): destroyed in one shot");
        this.destroy(pid);
    }

    // Owner: explosion, then the wreck effect; the radar stops where it is
    // (it never tilts); the site is offline for the rest of the round.
    // Rockets already in the air finish their flight.
    private destroy(pid: number): void {
        const now: number = Date.now();
        this.log("radar DESTROYED: site offline for the rest of the round");
        for (const fn of destroyListeners) {
            safe("site.destroyed", () => fn(this.n, this.team, pid));
        }
        spawnVfx(ASSET.radarExplosion, this.radarAt, [0, 0, 0], BURST_LIFETIME_MS, now, true);
        const at: V3 = this.radarAt;
        Timers.setTimeout(() => {
            safe("site.wreck", () => {
                spawnVfx(ASSET.radarWreck, at, [0, 0, 0], WRECK_LIFETIME_MS, Date.now(), true);
            });
        }, RADAR_WRECK_DELAY_MS);
        this.updateAlarm(false);
        this.stopLockBeep();
    }

    tick(now: number, dt: number): void {
        if (this.health.destroyed) {
            return;
        }
        const { list, byKey } = this.liveIntruders();
        const flying: number = airborne(this.n);
        this.updateAlarm(this.alarmLinger.wanted(now, list.length > 0 || flying > 0));
        // One site per player: whoever another site is tracking, launching at
        // or has a rocket on is busy here.
        const busy: Set<string> = busyFromOthers(allClaims(), this.n, list);
        busyKeys(this.n, busy);
        const silo: number = nextReadySilo(this.siloReadyAt, now, this.nextSilo);
        const canFire: boolean = silo >= 0 && flying < MAX_ROCKETS_AIRBORNE;
        for (const ev of this.lock.update(now, list, busy, this.radarAt, canFire)) {
            if (ev.kind === "track") {
                this.startTrack(ev.key, ev.pid, byKey[ev.key]);
            } else if (ev.kind === "cancel") {
                this.stopLockBeep();
                this.say(LOG_EVENTS, () => "lock on " + ev.key + " cancelled (left the zone or died)");
            } else {
                this.fire(ev.key, ev.pid, byKey[ev.key], silo, now);
            }
        }
        this.followLockBeep();
        this.driveRadar(byKey, dt, now);
    }

    // The players this site has claimed. A destroyed site's lock no longer
    // counts; its rockets still do until they land.
    claims(): SiteClaims {
        const pids: number[] = rocketTargets(this.n);
        const t: number | null = this.lock.targetPid;
        if (t !== null && !this.health.destroyed) {
            pids.push(t);
        }
        return { site: this.n, pids };
    }

    private updateAlarm(on: boolean): void {
        const at: V3 = this.def.gridCentre;
        if (on && this.alarm === undefined) {
            this.alarm = spawnSfx(ASSET.alarm, at, true);
            if (this.alarm !== undefined) {
                playAt(this.alarm, at, ALARM_AMP, ALARM_RANGE_M);
                this.say(LOG_TRACE, () => "alarm on");
            }
        } else if (!on && this.alarm !== undefined) {
            stopSfx(this.alarm);
            this.alarm = undefined;
            this.say(LOG_TRACE, () => "alarm off");
        }
    }

    // Bomb beeping for a vehicle target only, heard by that player only.
    private startTrack(key: string, pid: number, p: mod.Player | undefined): void {
        this.say(LOG_EVENTS, () => "tracking " + key + " (pid " + pid + "), lock in " + LOCK_MS + " ms");
        this.stopLockBeep();
        if (p === undefined || key.charAt(0) !== "v") {
            return;
        }
        const pos: V3 | undefined = soldierPos(p);
        if (pos === undefined) {
            return;
        }
        this.lockBeep = spawnSfx(ASSET.lockBeep, pos, true);
        if (this.lockBeep !== undefined) {
            playAt(this.lockBeep, pos, BEEP_AMP, BEEP_RANGE_M, p);
            this.lockBeepFor = p;
        }
    }

    private followLockBeep(): void {
        if (this.lockBeep === undefined || this.lockBeepFor === undefined) {
            return;
        }
        const pos: V3 | undefined = soldierPos(this.lockBeepFor);
        if (pos !== undefined) {
            moveSfx(this.lockBeep, pos);
        }
    }

    private stopLockBeep(): void {
        if (this.lockBeep !== undefined) {
            stopSfx(this.lockBeep);
        }
        this.lockBeep = undefined;
        this.lockBeepFor = undefined;
    }

    private fire(key: string, pid: number, p: mod.Player | undefined, idx: number, now: number): void {
        this.stopLockBeep();
        if (p === undefined || idx < 0) {
            return;
        }
        const s: SiloDef = this.silos[idx];
        this.nextSilo = (idx + 1) % this.silos.length;
        this.siloReadyAt[idx] = now + SILO_RELOAD_MS;
        spawnVfx(ASSET.shockwave, this.def.gridCentre, [0, 0, 0], VFX_LIFETIME_MS, now, true);
        this.pillars[idx] = spawnVfx(ASSET.pillar, [s.x, s.y, s.z], [0, 0, 0], PILLAR_MAX_MS, now, true);
        this.say(LOG_EVENTS, () => "fire at " + key + " from silo " + s.siloId);
        launchRocket(this.n, s, p, pid, key, now);
        Timers.setTimeout(() => {
            safe("site.pillar", () => this.stopPillar(idx));
        }, PILLAR_MS);
    }

    private stopPillar(idx: number): void {
        const v: mod.VFX | undefined = this.pillars[idx];
        if (v !== undefined) {
            stopVfx(v);
        }
        this.pillars[idx] = undefined;
    }

    // Tracks the locked target, else the newest rocket's target, else
    // sweeps. Turns only (no tilt). Each draw sets every part of the radar,
    // so a tracking radar is drawn every RADAR_TRACK_UPDATE_MS and a sweeping
    // one (or any, while the server struggles) every RADAR_IDLE_UPDATE_MS,
    // and only while a player is in the site's animation zone; otherwise the
    // radar holds still.
    private driveRadar(byKey: { [key: string]: mod.Player }, dt: number, now: number): void {
        if (this.radarParts.length === 0 || RADAR_DRIVE === "off" || this.watchers.size === 0) {
            return;
        }
        const key: string | null = this.lock.target;
        let target: V3 | undefined = key !== null && byKey[key] !== undefined ? soldierPos(byKey[key]) : undefined;
        if (target === undefined) {
            target = newestAim(this.n);
        }
        const wantYaw: number = target !== undefined
            ? aimDeg(this.radarAt, target).yaw + RADAR_YAW_OFFSET_DEG
            : this.radarYaw + RADAR_SWEEP_DEG_PER_S * dt;
        this.radarYaw = wrapDeg(stepAngleDeg(this.radarYaw, wantYaw, RADAR_SLEW_DEG_PER_S * dt));
        if (this.drawnYaw !== undefined && Math.abs(wrapDeg(this.radarYaw - this.drawnYaw)) < RADAR_MIN_STEP_DEG) {
            return;
        }
        if (now < this.nextDrawAt) {
            return;
        }
        const struggling: boolean = PerformanceStats.getSpotHealthFactor() < RADAR_HEALTH_MIN;
        this.nextDrawAt = now + (target !== undefined && !struggling ? RADAR_TRACK_UPDATE_MS : RADAR_IDLE_UPDATE_MS);
        this.drawnYaw = this.radarYaw;
        for (const part of this.radarParts) {
            const pose: PartPose = yawPart(this.radarAt, part.rest, part.basis, this.radarYaw * DEG);
            setTransform(part.obj, pose.pos, engFromRad(pose.rot), "site.radarPart");
        }
        this.traceRadar(now);
    }

    // Logs one moving part's read-back pose against the pose sent, a few
    // times across all sites.
    private traceRadar(now: number): void {
        if (!logOn(LOG_TRACE) || radarTraceLeft <= 0 || now < nextRadarTraceAt) {
            return;
        }
        radarTraceLeft--;
        nextRadarTraceAt = now + RADAR_TRACE_EVERY_MS;
        const part: RadarPart = this.radarParts.find(p => p.id !== this.def.radarId) ?? this.radarParts[0];
        const want: PartPose = yawPart(this.radarAt, part.rest, part.basis, this.radarYaw * DEG);
        this.say(LOG_TRACE, () => "radar yaw " + this.radarYaw.toFixed(0) + ": " + part.name + " reads pos " + fmt(readPos(part.obj)) + " rot " + fmt(readRot(part.obj))
            + " (sent pos " + fmt(want.pos) + " rot " + fmt(engFromRad(want.rot)) + ")");
    }
}

const sites: Site[] = [];

// Told when a radar goes down: (site number, the site's team, the shooter).
export type RadarDestroyedListener = (n: number, team: number, pid: number) => void;
const destroyListeners: RadarDestroyedListener[] = [];

export function onRadarDestroyed(fn: RadarDestroyedListener): void {
    destroyListeners.push(fn);
}

function allClaims(): SiteClaims[] {
    return sites.map(s => s.claims());
}

export function initSites(): void {
    SITES.forEach((def, i) => {
        const site: Site = new Site(def, (RADAR_IDLE_UPDATE_MS * i) / Math.max(1, SITES.length));
        sites.push(site);
        safe("site.init", () => site.init());
    });
    log("site", sites.length + " sites: " + sites.map(s => s.n + " (team " + s.team + ")").join(", "));
}

export function teamOf(p: mod.Player): number {
    return tryGet("site.team", () => mod.GetObjId(mod.GetTeam(p))) ?? 0;
}

export function onEnter(p: mod.Player, at: mod.AreaTrigger): void {
    for (const s of sites) {
        if (s.owns(at)) {
            s.enter(p);
        } else if (s.ownsAnim(at)) {
            s.watch(mod.GetObjId(p), true);
        }
    }
}

export function onExit(p: mod.Player, at: mod.AreaTrigger): void {
    for (const s of sites) {
        if (s.owns(at)) {
            s.exit(p);
        } else if (s.ownsAnim(at)) {
            s.watch(mod.GetObjId(p), false);
        }
    }
}

export function onGone(pid: number): void {
    for (const s of sites) {
        s.gone(pid);
    }
}

// Separate guards: one failing site must not stop the others.
export function tickSites(now: number, dt: number): void {
    for (const s of sites) {
        safe("tick.site" + s.n, () => s.tick(now, dt));
    }
}

// Radars still standing, for launcher.ts.
export function liveRadars(): RadarTarget[] {
    return sites.filter(s => !s.health.destroyed).map(s => ({ n: s.n, team: s.team, pos: s.def.radarPos }));
}

export function radarHitBy(n: number, pid: number, launcher: string): void {
    const s: Site | undefined = sites.find(e => e.n === n);
    if (s !== undefined) {
        s.hitBy(pid, launcher);
    }
}

export function destroyRadarBy(n: number, pid: number, weapon: string): void {
    const s: Site | undefined = sites.find(e => e.n === n);
    if (s !== undefined) {
        s.destroyBy(pid, weapon);
    }
}
