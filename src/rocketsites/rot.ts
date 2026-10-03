import { DEFAULT_UNITS, ENGINE_EULER_ORDER, ENGINE_PITCH_SIGN, ENGINE_YAW_SIGN } from "./config";
import { DEG, RotUnits, V3, engineAimDeg, fromEngine, toEngine } from "./geom";

// Rotation units are detected from the radar's rest X at startup (P1).
let units: RotUnits = DEFAULT_UNITS;

export function setUnits(u: RotUnits): void {
    units = u;
}

export function getUnits(): RotUnits {
    return units;
}

// Godot-convention degrees to the engine's Euler vector.
export function engRot(xDeg: number, yDeg: number, zDeg: number): V3 {
    return [
        toEngine(ENGINE_PITCH_SIGN * xDeg, units),
        toEngine(ENGINE_YAW_SIGN * yDeg, units),
        toEngine(zDeg, units)
    ];
}

// An aim (turn to yawDeg, then tilt xDeg about the turned X axis) as the
// engine's Euler vector. Use this whenever yaw and tilt are both non-zero.
export function engAim(yawDeg: number, xDeg: number): V3 {
    const y: number = ENGINE_YAW_SIGN * yawDeg;
    const x: number = ENGINE_PITCH_SIGN * xDeg;
    const e: V3 = engineAimDeg(ENGINE_EULER_ORDER, x, y);
    return [toEngine(e[0], units), toEngine(e[1], units), toEngine(e[2], units)];
}

export function engToDeg(v: number): number {
    return fromEngine(v, units);
}

// A radians Euler vector (geom's matrix maths) in the engine's units.
export function engFromRad(r: V3): V3 {
    return units === "rad" ? [r[0], r[1], r[2]] : [r[0] / DEG, r[1] / DEG, r[2] / DEG];
}
