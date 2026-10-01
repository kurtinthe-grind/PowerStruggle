// Pure end-of-match rules, kept free of mod.* so scripts/test-winner.js can
// unit-test them in node.
//
// "base" throughout turrets.ts and nuke.ts is the team id that OWNS the HQ:
// nuke.ts only lets a shooter hit a base whose id differs from their own team.
// So when an HQ falls, the winner is the other team.

export function winnerForDestroyedBase(base: number): number {
    return base === 1 ? 2 : 1;
}

// Team 1 is NATO, team 2 is PAX (teams.ts).
//   winT1 = "NATO destroyed the PAX HQ"
//   winT2 = "PAX destroyed the NATO HQ"
export function winMessageKey(winner: number): string {
    return winner === 1 ? "winT1" : "winT2";
}

// HQ health shown on the HUD, as a whole percent. 3 required hits paint
// 100 -> 67 -> 33 -> 0.
export function hqHpPercent(hits: number, required: number): number {
    if (required <= 0 || hits >= required) {
        return 0;
    }
    return Math.round(100 * (required - hits) / required);
}

export interface HqHitKeys {
    defender: string;
    attacker: string;
}

// Feed keys for a non-final HQ hit. Defenders are told their HQ is under
// attack, attackers that the enemy HQ took a hit; with one hit left both get
// the critical variant. The final hit returns null: the win message covers it.
export function hqHitKeys(hits: number, required: number): HqHitKeys | null {
    const left: number = required - hits;
    if (left <= 0) {
        return null;
    }
    if (left === 1) {
        return { defender: "hqCritical", attacker: "hqFoeCritical" };
    }
    return { defender: "hqUnderAttack", attacker: "hqHit" };
}
