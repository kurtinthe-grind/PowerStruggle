// Rorsch discharge detection, kept free of mod.* so scripts/test-rorsch.js can
// unit-test it in node.
//
// The Rorsch charges for about a second while fire is held, then discharges
// once; the player must release and press again for the next shot. IsFiring
// goes true at the PRESS, so it cannot be the shot signal. The discharge is the
// moment the weapon's ammo (magazine + reserve) drops during a hold.

export interface HoldState {
    // Ammo seen at the start of this hold, or the latest higher value.
    baseline: number;
    // This hold has already produced its one shot.
    shot: boolean;
}

export interface HoldResult {
    next: HoldState | undefined;
    fire: boolean;
}

export function holdStep(st: HoldState | undefined, firing: boolean, ammo: number): HoldResult {
    if (!firing) {
        return { next: undefined, fire: false };
    }
    if (st === undefined) {
        return { next: { baseline: ammo, shot: false }, fire: false };
    }
    if (st.shot) {
        return { next: st, fire: false };
    }
    if (ammo < st.baseline) {
        return { next: { baseline: ammo, shot: true }, fire: true };
    }
    if (ammo > st.baseline) {
        return { next: { baseline: ammo, shot: false }, fire: false };
    }
    return { next: st, fire: false };
}
