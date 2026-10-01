// Ray geometry for the Rorsch turret test, kept free of mod.* so
// scripts/test-raygeom.js can unit-test it in node.
//
// mod.RayCast passes straight through the stationary AA turrets (17:38 log:
// rays aimed at them carried on to the HQ or the sky), so a turret cannot be
// found from the ray's hit point. Instead the ray's path is tested against an
// upright cylinder around the turret's base.

// True when the segment start + dir * [0, len] passes through the vertical
// cylinder of the given radius around (cx, cz), spanning cy - below to
// cy + above. dir must be normalised.
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
