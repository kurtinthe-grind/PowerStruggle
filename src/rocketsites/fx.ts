import { MAX_LIVE_VFX, SPAWNS_PER_TICK } from "./config";
import { V3 } from "./geom";
import { safe, tryGet } from "./log";

// Thin wrappers over VFX/SFX/object calls. Non-critical spawns share a
// per-tick budget (the SfxVfx crash: bursts of engine objects in one tick
// are dangerous); force bypasses it for explosions and launch effects.

const ZERO: mod.Vector = mod.CreateVector(0, 0, 0);
const ONE: mod.Vector = mod.CreateVector(1, 1, 1);

interface LiveVfx {
    vfx: mod.VFX;
    killAt: number;
}

const live: LiveVfx[] = [];
let spawnsThisTick: number = 0;
let transforms: number = 0;     // object moves since the last stats line
let vfxMoves: number = 0;
let spawns: number = 0;

export function takeStats(): { transforms: number; vfxMoves: number; spawns: number; liveVfx: number } {
    const out = { transforms, vfxMoves, spawns, liveVfx: live.length };
    transforms = 0;
    vfxMoves = 0;
    spawns = 0;
    return out;
}

// SetObjectTransform, counted for the stats line.
export function setTransform(o: mod.SpatialObject | mod.SFX, pos: V3, rot: V3, tag: string): void {
    transforms++;
    safe(tag, () => mod.SetObjectTransform(o, mod.CreateTransform(vec(pos), vec(rot))));
}

export function vec(p: V3): mod.Vector {
    return mod.CreateVector(p[0], p[1], p[2]);
}

export function toV3(v: mod.Vector): V3 {
    return [mod.XComponentOf(v), mod.YComponentOf(v), mod.ZComponentOf(v)];
}

export function readPos(o: mod.Object): V3 | undefined {
    return tryGet("readPos", () => toV3(mod.GetObjectPosition(o)));
}

export function readRot(o: mod.Object): V3 | undefined {
    return tryGet("readRot", () => toV3(mod.GetObjectRotation(o)));
}

export function soldierPos(p: mod.Player): V3 | undefined {
    return tryGet("soldierPos", () => toV3(mod.GetSoldierState(p, mod.SoldierStateVector.GetPosition)));
}

export function soldierFacing(p: mod.Player): V3 | undefined {
    return tryGet("soldierFacing", () => toV3(mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection)));
}

export function newTick(): void {
    spawnsThisTick = 0;
}

function takeBudget(force: boolean): boolean {
    if (!force && spawnsThisTick >= SPAWNS_PER_TICK) {
        return false;
    }
    spawnsThisTick++;
    spawns++;
    return true;
}

function killVfx(v: mod.VFX): void {
    safe("killVfx", () => {
        mod.EnableVFX(v, false);
        mod.UnspawnObject(v);
    });
}

export function spawnVfx(asset: mod.RuntimeSpawn_Common, pos: V3, rot: V3, lifeMs: number, now: number, force: boolean = false): mod.VFX | undefined {
    if (!takeBudget(force)) {
        return undefined;
    }
    if (live.length >= MAX_LIVE_VFX) {
        const oldest: LiveVfx | undefined = live.shift();
        if (oldest !== undefined) {
            killVfx(oldest.vfx);
        }
    }
    const v: mod.VFX | undefined = tryGet("spawnVfx", () => {
        const o: mod.VFX = mod.SpawnObject(asset, vec(pos), vec(rot), ONE) as mod.VFX;
        mod.EnableVFX(o, true);
        return o;
    });
    if (v !== undefined) {
        live.push({ vfx: v, killAt: now + lifeMs });
    }
    return v;
}

export function moveVfx(v: mod.VFX, pos: V3, rot: V3): void {
    vfxMoves++;
    safe("moveVfx", () => mod.MoveVFX(v, vec(pos), vec(rot)));
}

export function stopVfx(v: mod.VFX): void {
    const i: number = live.findIndex(e => e.vfx === v);
    if (i >= 0) {
        live.splice(i, 1);
    }
    killVfx(v);
}

export function sweepVfx(now: number): void {
    for (let i = live.length - 1; i >= 0; i--) {
        if (now >= live[i].killAt) {
            killVfx(live[i].vfx);
            live.splice(i, 1);
        }
    }
}

export function spawnSfx(asset: mod.RuntimeSpawn_Common, pos: V3, force: boolean = false): mod.SFX | undefined {
    if (!takeBudget(force)) {
        return undefined;
    }
    return tryGet("spawnSfx", () => mod.SpawnObject(asset, vec(pos), ZERO, ONE) as mod.SFX);
}

// 3D sound at pos; with player, only that player hears it.
export function playAt(sfx: mod.SFX, pos: V3, amp: number, range: number, player?: mod.Player): void {
    safe("playAt", () => {
        if (player !== undefined) {
            mod.PlaySound(sfx, amp, vec(pos), range, player);
        } else {
            mod.PlaySound(sfx, amp, vec(pos), range);
        }
    });
}

export function moveSfx(sfx: mod.SFX, pos: V3): void {
    transforms++;
    safe("moveSfx", () => mod.SetObjectTransform(sfx, mod.CreateTransform(vec(pos), ZERO)));
}

// Restarts a loop for one player at pos (used to pulse the incoming beep).
export function restartFor(sfx: mod.SFX, pos: V3, amp: number, range: number, player: mod.Player): void {
    safe("restartFor", () => {
        mod.StopSound(sfx, player);
        mod.SetObjectTransform(sfx, mod.CreateTransform(vec(pos), ZERO));
        mod.PlaySound(sfx, amp, vec(pos), range, player);
    });
}

export function stopSfx(sfx: mod.SFX): void {
    safe("stopSfx", () => {
        mod.StopSound(sfx);
        mod.UnspawnObject(sfx);
    });
}
