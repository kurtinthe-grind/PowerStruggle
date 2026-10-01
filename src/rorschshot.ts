// Rorsch shot detection, kept free of mod.* so scripts/test-rorsch.js can
// unit-test it in node.
//
// Evidence from the 2026-10-01 playtests, do not re-try these:
//   - GetInventoryMagazineAmmo / GetInventoryAmmo never change for the Rorsch
//     in any slot, and the MiscGadget slot throws GetAmmoRequest every call.
//   - IsFiring's rising edge is the trigger press, not the shot.
//   - A fixed timer after the press (1 s) cast the ray ~1.2 s before the beam.
//
// What the 15:20 trace showed: IsFiring goes false 2200-2212 ms after the press
// on every shot, even with the trigger still held, and IsReloading follows. A
// release at 1644 ms got no reload, i.e. no shot. So the discharge is the
// IsFiring falling edge after a full charge; a shorter hold is a cancelled
// charge. Wall-clock time, not ticks, so lag cannot stretch or shrink a hold.

export interface HoldState {
    pressMs: number;
    // A press that must never count, e.g. made with another weapon.
    ignored: boolean;
}

export interface HoldResult {
    next: HoldState | undefined;
    fire: boolean;
}

export function holdStep(st: HoldState | undefined, firing: boolean, nowMs: number, minChargeMs: number): HoldResult {
    if (firing) {
        return { next: st === undefined ? { pressMs: nowMs, ignored: false } : st, fire: false };
    }
    if (st === undefined || st.ignored) {
        return { next: undefined, fire: false };
    }
    return { next: undefined, fire: nowMs - st.pressMs >= minChargeMs };
}
