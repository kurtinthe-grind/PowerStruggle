// Rorsch shot detection, kept free of mod.* so scripts/test-rorsch.js can
// unit-test it in node.
//
// The Rorsch charges for about a second while fire is held, then fires once;
// the player must release and press again for the next shot.
//
// Evidence from the 2026-10-01 playtest, do not re-try these:
//   - IsFiring is true for the WHOLE hold (2-4 s), so its rising edge is the
//     press, not the shot.
//   - GetInventoryMagazineAmmo / GetInventoryAmmo never change for the Rorsch
//     in any slot, and the MiscGadget slot throws GetAmmoRequest every call.
//
// So a shot is a press held continuously for chargeMs, counted once per press.
// Wall-clock time, not ticks, so lag or a skipped probe tick cannot stretch it.

export interface HoldState {
    pressMs: number;
    shot: boolean;
}

export interface HoldResult {
    next: HoldState | undefined;
    fire: boolean;
}

export function holdStep(st: HoldState | undefined, firing: boolean, nowMs: number, chargeMs: number): HoldResult {
    if (!firing) {
        return { next: undefined, fire: false };
    }
    if (st === undefined) {
        return { next: { pressMs: nowMs, shot: false }, fire: false };
    }
    if (st.shot || nowMs - st.pressMs < chargeMs) {
        return { next: st, fire: false };
    }
    return { next: { pressMs: st.pressMs, shot: true }, fire: true };
}
