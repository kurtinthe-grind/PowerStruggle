import { log } from "./util/log";

// Portal teams are addressed 1 and 2 (NATO and PAX). mod.GetTeam takes the team
// id, not a zero-based index - the previous GetTeam(0)/GetTeam(1) pair was wrong,
// though dormant because these handles were never resolved.
let teamOne: mod.Team | undefined;
let teamTwo: mod.Team | undefined;

export function initTeams(): void {
    resolve(1);
    resolve(2);
    if (teamOne === undefined || teamTwo === undefined) {
        log("teams", "WARNING - could not resolve both team handles");
        return;
    }
    log("teams", "resolved t1=" + String(mod.GetObjId(teamOne))
        + " t2=" + String(mod.GetObjId(teamTwo)));
}

function resolve(n: number): void {
    try {
        const t: mod.Team = mod.GetTeam(n);
        if (!mod.IsValid(t)) {
            return;
        }
        if (n === 1) {
            teamOne = t;
        } else if (n === 2) {
            teamTwo = t;
        }
    } catch (e) {
        log("teams", "team " + n + " handle unavailable");
    }
}

export function teamNumOf(t: mod.Team): number {
    return mod.GetObjId(t);
}

export function foeOf(team: number): number {
    return team === 1 ? 2 : team === 2 ? 1 : 0;
}

export function teamHandle(n: number): mod.Team | undefined {
    if (n === 1) {
        return teamOne;
    }
    if (n === 2) {
        return teamTwo;
    }
    return undefined;
}

// teamIdOf and isConfiguredTeam deliberately do NOT live here. They are owned
// by util/roster, the single source of truth for team predicates, so import
// them from there instead.
//
// Two bundler traps are now recorded here after they cost this module:
//   1. Do not re-export from this file. The Portal bundler cannot resolve a
//      pure re-export and drops the whole module.
//   2. Do not put a backtick inside a comment. The bundler's strip-comments
//      pass mangles the line and swallows everything after it, which deleted
//      every function below and shipped a bundle full of 'Cannot find name'
//      errors that tsc cannot catch, because tsc resolves both fine.
// npm run build now type-checks the emitted bundle to catch that class of bug.
