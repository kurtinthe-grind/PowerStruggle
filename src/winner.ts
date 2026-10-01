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
