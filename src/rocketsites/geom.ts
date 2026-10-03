// Pure maths for the rocket sites. No mod.* here, so Node can test it.
// Angles are degrees unless a name says otherwise. Yaw 0 faces +Z and yaw 90
// faces +X (Godot's rotation about Y). Pitch is elevation above horizontal.

export type V3 = [number, number, number];
export type RotUnits = "deg" | "rad";

export const DEG: number = Math.PI / 180;

export function add(a: V3, b: V3): V3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: V3, b: V3): V3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: V3, k: number): V3 {
    return [a[0] * k, a[1] * k, a[2] * k];
}

export function dot(a: V3, b: V3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: V3, b: V3): V3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function len(a: V3): number {
    return Math.hypot(a[0], a[1], a[2]);
}

export function dist(a: V3, b: V3): number {
    return len(sub(a, b));
}

export function norm(a: V3): V3 {
    const l: number = len(a);
    return l < 1e-9 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

export function clamp(x: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, x));
}

export function wrapDeg(a: number): number {
    const r: number = (((a + 180) % 360) + 360) % 360 - 180;
    return r === -180 ? 180 : r;
}

// Moves cur toward want by at most maxStep degrees, the short way round.
export function stepAngleDeg(cur: number, want: number, maxStep: number): number {
    const d: number = wrapDeg(want - cur);
    return Math.abs(d) <= maxStep ? cur + d : cur + Math.sign(d) * maxStep;
}

export function aimDeg(from: V3, to: V3): { yaw: number; pitch: number } {
    const d: V3 = sub(to, from);
    return {
        yaw: Math.atan2(d[0], d[2]) / DEG,
        pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) / DEG
    };
}

// Godot-convention Euler degrees [x, y, 0] for a flight direction. A positive
// X rotation tilts +Z downward, so climbing needs a negative X.
export function dirToEulerDeg(d: V3): V3 {
    const a = aimDeg([0, 0, 0], d);
    return [-a.pitch, a.yaw, 0];
}

// Godot-style aim (yaw about world up, then tilt xDeg about the turned X
// axis: M = Ry(yaw) * Rx(x)) as Euler angles in X-Y-Z order
// (M = Rx(a) * Ry(b) * Rz(c)). NOT the engine's order: kept only behind
// ENGINE_EULER_ORDER "XYZ". It was inferred from one readback, but a Y-middle
// readback fits ZYX just as well, and under ZYX this conversion rolls the
// dish (in-game 2026-10-03, second session).
export function yxzToXyzDeg(xDeg: number, yawDeg: number): V3 {
    const cy: number = Math.cos(yawDeg * DEG);
    const sy: number = Math.sin(yawDeg * DEG);
    const cx: number = Math.cos(xDeg * DEG);
    const sx: number = Math.sin(xDeg * DEG);
    // M rows: [cy, sy*sx, sy*cx], [0, cx, -sx], [-sy, cy*sx, cy*cx]
    const m02: number = sy * cx;
    if (Math.abs(m02) > 0.999999) {
        // Gimbal lock: b = +-90; fold all of the remaining turn into a.
        return [Math.atan2(cy * sx, cx) / DEG, Math.sign(m02) * 90, 0];
    }
    return [Math.atan2(sx, cy * cx) / DEG, Math.asin(m02) / DEG, Math.atan2(-sy * sx, cy) / DEG];
}

// The radar rests at X 45 in Godot. Reading that back as ~45 means the engine
// uses degrees, ~0.785 means radians.
export function detectUnits(restX: number, expectDeg: number): RotUnits | "unknown" {
    const x: number = Math.abs(restX);
    const e: number = Math.abs(expectDeg);
    if (Math.abs(x - e) < 2) {
        return "deg";
    }
    if (Math.abs(x - e * DEG) < 0.05) {
        return "rad";
    }
    return "unknown";
}

export function toEngine(deg: number, units: RotUnits): number {
    return units === "rad" ? deg * DEG : deg;
}

export function fromEngine(v: number, units: RotUnits): number {
    return units === "rad" ? v / DEG : v;
}

export interface RocketKin {
    pos: V3;
    dir: V3;
    speed: number;
    age: number;
}

export interface KinParams {
    riseSecs: number;
    speedStart: number;
    accel: number;
    speedMax: number;
    turnDegPerSec: number;
    closeRangeM: number;
}

export function newRocket(origin: V3, p: KinParams): RocketKin {
    return { pos: [origin[0], origin[1], origin[2]], dir: [0, 1, 0], speed: p.speedStart, age: 0 };
}

// Turns unit vector cur toward unit vector want by at most maxRad (slerp).
export function turnToward(cur: V3, want: V3, maxRad: number): V3 {
    const c: number = clamp(dot(cur, want), -1, 1);
    const ang: number = Math.acos(c);
    if (ang <= maxRad || ang < 1e-6) {
        return want;
    }
    if (c < -0.9999) {
        let perp: V3 = cross(cur, [1, 0, 0]);
        if (len(perp) < 1e-3) {
            perp = cross(cur, [0, 0, 1]);
        }
        perp = norm(perp);
        return norm(add(scale(cur, Math.cos(maxRad)), scale(perp, Math.sin(maxRad))));
    }
    const t: number = maxRad / ang;
    const s: number = Math.sin(ang);
    return norm(add(scale(cur, Math.sin((1 - t) * ang) / s), scale(want, Math.sin(t * ang) / s)));
}

// One tick: straight up for riseSecs, then turn toward the target. The turn
// rate grows inside closeRangeM so a target beside the silo is not circled.
export function stepRocket(r: RocketKin, target: V3, dt: number, p: KinParams): void {
    r.age += dt;
    r.speed = Math.min(p.speedMax, r.speed + p.accel * dt);
    if (r.age > p.riseSecs) {
        const to: V3 = sub(target, r.pos);
        const boost: number = Math.max(1, p.closeRangeM / Math.max(len(to), 1));
        r.dir = turnToward(r.dir, norm(to), p.turnDegPerSec * boost * DEG * dt);
    }
    r.pos = add(r.pos, scale(r.dir, r.speed * dt));
}

// True when segment a-b passes within radius of c (fast rockets skip past).
export function segmentHits(a: V3, b: V3, c: V3, radius: number): boolean {
    const ab: V3 = sub(b, a);
    const l2: number = dot(ab, ab);
    const t: number = l2 < 1e-12 ? 0 : clamp(dot(sub(c, a), ab) / l2, 0, 1);
    return dist(add(a, scale(ab, t)), c) <= radius;
}

export function beepIntervalMs(d: number, startDist: number, slowMs: number, fastMs: number): number {
    const t: number = startDist <= 0 ? 1 : clamp(1 - d / startDist, 0, 1);
    return Math.round(slowMs + (fastMs - slowMs) * t);
}

export type EulerOrder = "ZYX" | "XYZ";

// The engine's Euler vector (degrees) for a Godot-style aim. The engine uses
// Godot's ZYX order, M = Rz(c) * Ry(b) * Rx(a) (bf6-MultiObjectTransform:
// "set the Rotation Order to ZYX" before copying Godot values; its
// Quaternions.fromEuler is qz*qy*qx), so the aim is simply (x, yaw, 0).
export function engineAimDeg(order: EulerOrder, xDeg: number, yawDeg: number): V3 {
    return order === "XYZ" ? yxzToXyzDeg(xDeg, yawDeg) : [xDeg, yawDeg, 0];
}

// 3x3 rotation matrix, row-major: m[row * 3 + col].
export type M3 = number[];

// A basis from a spatial export's right/up/front vectors (its columns).
export function basisFromAxes(right: V3, up: V3, front: V3): M3 {
    return [right[0], up[0], front[0], right[1], up[1], front[1], right[2], up[2], front[2]];
}

export function mulM3(a: M3, b: M3): M3 {
    const out: M3 = [];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
        }
    }
    return out;
}

export function mulM3V(m: M3, v: V3): V3 {
    return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
}

// Godot's turn about world up: +Z toward +X for a positive angle.
export function rotY(rad: number): M3 {
    const c: number = Math.cos(rad);
    const s: number = Math.sin(rad);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
}

// The engine's Euler vector (radians) for m: m = Rz(c) * Ry(b) * Rx(a).
export function eulerZYX(m: M3): V3 {
    const sb: number = clamp(-m[6], -1, 1);
    if (Math.abs(sb) > 0.999999) {
        // Gimbal lock: b = +-90; fold the Z turn into X.
        return [Math.atan2(-m[5], m[4]), Math.sign(sb) * Math.PI / 2, 0];
    }
    return [Math.atan2(m[7], m[8]), Math.asin(sb), Math.atan2(m[3], m[0])];
}

export interface PartPose {
    pos: V3;
    rot: V3;    // engine Euler, radians
}

// One part of a multi-object model turned yawRad about the vertical axis
// through pivot. The spatial export flattens Godot's parenting into
// separate world-placed objects, so every part is moved by this each tick.
export function yawPart(pivot: V3, restPos: V3, restBasis: M3, yawRad: number): PartPose {
    const r: M3 = rotY(yawRad);
    return { pos: add(pivot, mulM3V(r, sub(restPos, pivot))), rot: eulerZYX(mulM3(r, restBasis)) };
}
