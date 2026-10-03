// Rocket hit decisions, free of mod.* so scripts/test-shot.js can test them.

// What the game told us about the target at the hit; undefined = unreadable.
export interface HitState {
    inWater: boolean | undefined;
    diving: boolean | undefined;
    inVehicle: boolean | undefined;
    boat: boolean | undefined;
}

// A wet hit also plays the underwater C4 detonation (owner 2026-10-03). The
// engine has no water flag for vehicles, so a boat counts as in the water.
export function wetHit(s: HitState): boolean {
    if (s.inVehicle === true) {
        return s.boat === true || s.inWater === true;
    }
    return s.inWater === true || s.diving === true;
}

// Whether a rocket keeps chasing. Only a definite end stops it: the death
// event, the player gone from the game, or a read that says not alive. A
// failed read (undefined) keeps it homing on the last aim: treating that as
// "gone" burst rockets mid-air (owner, 2026-10-03).
export function chaseVerdict(diedEvent: boolean, valid: boolean | undefined, alive: boolean | undefined): "chase" | "died" | "left" | "not alive" {
    if (diedEvent) {
        return "died";
    }
    if (valid === false) {
        return "left";
    }
    if (valid === true && alive === false) {
        return "not alive";
    }
    return "chase";
}
