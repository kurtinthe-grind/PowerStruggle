// The fake 4th gadget slot's trigger, kept free of mod.* so
// scripts/test-fakeslot.js can unit-test it in node.
//
// Scripts see no key presses, only which inventory slots are active. The
// 2026-10-04 14:02 slot trace showed that pressing 3 while slot 3 is in hand
// puts it away and returns to the weapon held before it (pri -> g1 -> pri),
// while scrolling goes on to slot 4 (g1 -> g2). So "3 again" is slot 3 (g1)
// closing back onto the exact set that was active before it opened, without
// the item having been used in between (the Portal Gadget's menu opened, a
// rocket fired): after use, going back to the gun is just going back.
//
// Pressing 1 looks the same as 3 when slot 3 was drawn from the primary; it is
// told apart only when it was drawn from something else (the sidearm).

export interface SlotWatch {
    // Active slots last seen, e.g. "pri", "g1", "none" (joined with "+").
    set: string;
    // The set active just before slot 3 opened.
    before: string;
    // The item in slot 3 was used during this hold.
    used: boolean;
    // Changes before this time come from our own swap and never trigger one.
    busyUntil: number;
}

export interface SlotResult {
    next: SlotWatch;
    swap: boolean;
}

function hasG1(set: string): boolean {
    return ("+" + set + "+").indexOf("+g1+") >= 0;
}

export function newWatch(set: string): SlotWatch {
    return { set: set, before: "none", used: false, busyUntil: 0 };
}

export function markUsed(w: SlotWatch): SlotWatch {
    return { set: w.set, before: w.before, used: true, busyUntil: w.busyUntil };
}

export function markSwapped(w: SlotWatch, nowMs: number, busyMs: number): SlotWatch {
    return { set: w.set, before: w.before, used: false, busyUntil: nowMs + busyMs };
}

export function slotStep(w: SlotWatch, set: string, nowMs: number): SlotResult {
    if (set === w.set) {
        return { next: w, swap: false };
    }
    const wasG1: boolean = hasG1(w.set);
    const isG1: boolean = hasG1(set);
    if (!wasG1 && isG1) {
        return { next: { set: set, before: w.set, used: false, busyUntil: w.busyUntil }, swap: false };
    }
    const swap: boolean = wasG1 && !isG1 && nowMs >= w.busyUntil && !w.used
        && w.before !== "none" && set === w.before;
    return { next: { set: set, before: w.before, used: w.used, busyUntil: w.busyUntil }, swap: swap };
}
