// Portal's mod.Array is opaque: it has no length, no map and no spread, so every
// traversal must go through mod.CountOf / mod.ValueInArray. These helpers mirror
// the sanctioned official SDK runtime helpers in
// main_resources/modlib_original/index.ts (ConvertArray, FilteredArray,
// getTeamId, getPlayersInTeam) and are the only place in this project that is
// allowed to hand-roll the opaque-array walk.

import { Events } from "bf6-portal-utils/events";

// Tier 0: OnPlayerSwitchTeam(eventPlayer, eventTeam) is "This will trigger when a
// Player changes team", which is the only way teamIdOf can go stale.
Events.OnPlayerSwitchTeam.subscribe((p: mod.Player) => {
    try {
        forgetTeamCache(mod.GetObjId(p));
    } catch (e) {
    }
});

export function convertArray(array: mod.Array): any[] {
    const out: any[] = [];
    const n: number = mod.CountOf(array);
    for (let i: number = 0; i < n; i++) {
        out.push(mod.ValueInArray(array, i));
    }
    return out;
}

export function filteredArray(array: mod.Array, cond: (element: any) => boolean): mod.Array {
    let out: mod.Array = mod.EmptyArray();
    const n: number = mod.CountOf(array);
    for (let i: number = 0; i < n; i++) {
        const e: any = mod.ValueInArray(array, i);
        if (cond(e)) {
            mod.AppendToArray(out, e);
        }
    }
    return out;
}

// teamIdOf was two FFI calls (GetTeam then GetObjId) inside a try/catch, and it
// is called from every combat filter, every award, and every zone enter/exit.
// A player's team only changes on OnPlayerSwitchTeam, so it is cached and the
// cache is invalidated by that event.
const teamCache: { [pid: number]: number } = {};

export function teamIdOf(p: mod.Player): number {
    if (!mod.IsValid(p)) {
        return 0;
    }
    const pid: number = mod.GetObjId(p);
    const cached: number | undefined = teamCache[pid];
    if (cached !== undefined) {
        return cached;
    }
    let team: number = 0;
    try {
        team = mod.GetObjId(mod.GetTeam(p));
    } catch (e) {
        team = 0;
    }
    teamCache[pid] = team;
    return team;
}

export function forgetTeamCache(pid: number): void {
    delete teamCache[pid];
}

// True only for a genuine 1 <-> 2 matchup. Returns false for an unknown team so
// an unresolved team can never be treated as an enemy.
export function isEnemyTeam(a: number, b: number): boolean {
    if (!isConfiguredTeam(a) || !isConfiguredTeam(b)) {
        return false;
    }
    return a !== b;
}

export function isConfiguredTeam(n: number): boolean {
    return n === 1 || n === 2;
}

export function allPlayers(): mod.Player[] {
    let array: mod.Array = mod.EmptyArray();
    try {
        array = mod.AllPlayers();
    } catch (e) {
        return [];
    }
    const out: mod.Player[] = [];
    const n: number = mod.CountOf(array);
    for (let i: number = 0; i < n; i++) {
        const p: mod.Player = mod.ValueInArray(array, i) as mod.Player;
        if (mod.IsValid(p)) {
            out.push(p);
        }
    }
    return out;
}

// AreaTriggers track occupants as ObjIds, so the capture payout resolves them
// through mod.GetPlayer. Ids that no longer resolve are dropped rather than
// passed on as an invalid handle.
export function playersFromIds(ids: number[]): mod.Player[] {
    const out: mod.Player[] = [];
    for (const id of ids) {
        try {
            const p: mod.Player = mod.GetPlayer(id);
            if (mod.IsValid(p)) {
                out.push(p);
            }
        } catch (e) {
        }
    }
    return out;
}

// CapturePoints report their own occupants. The result contains BOTH teams, so
// callers filter to the capturing team, exactly as CustomConquest V15 does with
// mod.GetPlayersOnPoint plus a modlib.FilteredArray team comparison.
export function playersOnCapturePoint(cp: mod.CapturePoint): mod.Player[] {
    const out: mod.Player[] = [];
    let array: mod.Array;
    try {
        array = mod.GetPlayersOnPoint(cp);
    } catch (e) {
        return out;
    }
    const n: number = mod.CountOf(array);
    for (let i: number = 0; i < n; i++) {
        const p: mod.Player = mod.ValueInArray(array, i) as mod.Player;
        if (mod.IsValid(p)) {
            out.push(p);
        }
    }
    return out;
}

// Scalar sibling of playersFromIds, for callers that check one id at a time and
// stop early. Returns undefined for an id that no longer resolves.
export function playerById(id: number): mod.Player | undefined {
    if (id < 0) {
        return undefined;
    }
    try {
        const p: mod.Player = mod.GetPlayer(id);
        return mod.IsValid(p) ? p : undefined;
    } catch (e) {
        return undefined;
    }
}

export function playersInTeam(teamId: number): mod.Player[] {
    if (!isConfiguredTeam(teamId)) {
        return [];
    }
    const out: mod.Player[] = [];
    for (const p of allPlayers()) {
        if (teamIdOf(p) === teamId) {
            out.push(p);
        }
    }
    return out;
}
