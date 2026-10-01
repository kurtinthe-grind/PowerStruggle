// Rorsch discharge detection, kept free of mod.* so scripts/test-rorsch.js can
// unit-test it in node.
//
// The Rorsch charges for about a second while fire is held, then discharges
// once; the player must release and press again for the next shot. IsFiring
// cannot be the shot signal: it goes true at the PRESS, and the 2026-10-01
// playtest showed a hold being seen without any discharge inside it. The shot
// is the tick the weapon's ammo (magazine + reserve) drops, tracked for as long
// as the player is in an HQ fire zone with the Rorsch.

export interface AmmoResult {
    // Baseline for the next tick (undefined until a valid reading).
    next: number | undefined;
    fire: boolean;
}

export function ammoStep(last: number | undefined, ammo: number): AmmoResult {
    if (ammo < 0) {
        return { next: last, fire: false };
    }
    if (last !== undefined && ammo < last) {
        return { next: ammo, fire: true };
    }
    return { next: ammo, fire: false };
}
