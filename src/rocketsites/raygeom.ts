// Ray geometry for launcher shots at the radar, kept free of mod.* so
// scripts/test-shot.js can test it in Node. Same method as PowerStruggle's
// Rorsch turret test (PowerStruggle/src/raygeom.ts): mod.RayCast can pass
// through models, so a hit is the ray's PATH crossing an upright cylinder
// around the target, or its hit point landing next to the target.

// True when the segment start + dir * [0, len] passes through the vertical
// cylinder of the given radius around (cx, cz), spanning cy - below to
// cy + above. dir must be normalised. (Copied from PowerStruggle.)
export function rayThroughUpright(
    sx: number, sy: number, sz: number,
    dx: number, dy: number, dz: number,
    len: number,
    cx: number, cy: number, cz: number,
    radius: number, below: number, above: number
): boolean {
    // Horizontal part: the s range where the ray is within radius of the axis.
    const ox: number = sx - cx;
    const oz: number = sz - cz;
    const a: number = dx * dx + dz * dz;
    const c: number = ox * ox + oz * oz - radius * radius;
    let s0: number;
    let s1: number;
    if (a < 1e-9) {
        // Straight up or down: inside the circle for the whole ray, or never.
        if (c > 0) {
            return false;
        }
        s0 = 0;
        s1 = len;
    } else {
        const b: number = ox * dx + oz * dz;
        const disc: number = b * b - a * c;
        if (disc < 0) {
            return false;
        }
        const root: number = Math.sqrt(disc);
        s0 = (-b - root) / a;
        s1 = (-b + root) / a;
    }
    if (s0 < 0) {
        s0 = 0;
    }
    if (s1 > len) {
        s1 = len;
    }
    if (s0 > s1) {
        return false;
    }
    // Vertical part: y is linear in s, so the highest and lowest points of that
    // stretch are its ends.
    const y0: number = sy + dy * s0;
    const y1: number = sy + dy * s1;
    const lo: number = y0 < y1 ? y0 : y1;
    const hi: number = y0 < y1 ? y1 : y0;
    return hi >= cy - below && lo <= cy + above;
}

export interface RadarHitShape {
    radius: number;
    below: number;
    above: number;
    pointRadius: number;
}

// len is how far the ray got (it stops at cover); hit is where it stopped,
// or undefined when it hit nothing.
export function radarShotHits(
    start: number[], dir: number[], len: number, hit: number[] | undefined, radar: number[], shape: RadarHitShape
): boolean {
    if (rayThroughUpright(start[0], start[1], start[2], dir[0], dir[1], dir[2], len,
        radar[0], radar[1], radar[2], shape.radius, shape.below, shape.above)) {
        return true;
    }
    if (hit === undefined) {
        return false;
    }
    return Math.hypot(hit[0] - radar[0], hit[1] - radar[1], hit[2] - radar[2]) <= shape.pointRadius;
}

// Several radars: the index of the one the shot hits nearest the shooter,
// or -1. A ray that stops at cover cannot reach the radars behind it.
export function pickRadar(
    start: number[], dir: number[], len: number, hit: number[] | undefined, radars: number[][], shape: RadarHitShape
): number {
    let best: number = -1;
    let bestDist: number = Infinity;
    radars.forEach((radar, i) => {
        if (!radarShotHits(start, dir, len, hit, radar, shape)) {
            return;
        }
        const d: number = Math.hypot(radar[0] - start[0], radar[1] - start[1], radar[2] - start[2]);
        if (d < bestDist) {
            best = i;
            bestDist = d;
        }
    });
    return best;
}
