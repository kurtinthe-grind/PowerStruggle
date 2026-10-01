import { log, safe, invokeSubscriber } from "./util/log";
import { allPlayers, isEnemyTeam, playersInTeam, teamIdOf } from "./util/roster";
import {
    PRESTIGE_BUNKER, PRESTIGE_ENERGY, PRESTIGE_FACTORY, PRESTIGE_KILL, PRESTIGE_ASSIST,
    SCORE_BUNKER, SCORE_ENERGY, SCORE_FACTORY, SCORE_KILL, SCORE_ASSIST
} from "./config";
import { addPrestige, prestigeOf } from "./economy";
import { isBotPid } from "./bots";
import { powerVal } from "./state";
import { teamHandle } from "./teams";

// Why a player was paid. Drives the prestige amount, the score amount and the
// reason text shown in their personal feed.
//
// "vehicle" is intentionally absent: Tier 0 exposes no damager and no
// OnVehicleDamaged event, so a destroyer cannot be identified. Adding it back
// means either trusting the opposing team wholesale or inferring the killer from
// raycast proximity - see PRESTIGE_VEHICLE in config.ts.
export type AwardKind = "bunker" | "energy" | "factory" | "kill" | "assist";

const PRESTIGE_FOR: { [k: string]: number } = {
    bunker: PRESTIGE_BUNKER,
    energy: PRESTIGE_ENERGY,
    factory: PRESTIGE_FACTORY,
    kill: PRESTIGE_KILL,
    assist: PRESTIGE_ASSIST
};

const SCORE_FOR: { [k: string]: number } = {
    bunker: SCORE_BUNKER,
    energy: SCORE_ENERGY,
    factory: SCORE_FACTORY,
    kill: SCORE_KILL,
    assist: SCORE_ASSIST
};

export function prestigeFor(kind: AwardKind): number {
    return PRESTIGE_FOR[kind];
}

// Fired from inside award() so the notification can never drift away from the
// payout again. It did once: captures paid out silently because only the kill and
// assist handlers remembered to announce themselves.
export type AwardListener = (p: mod.Player, kind: AwardKind, prestige: number) => void;

const awardListeners: AwardListener[] = [];

export function onAward(fn: AwardListener): void {
    awardListeners.push(fn);
}

function fireAward(p: mod.Player, kind: AwardKind, prestige: number): void {
    for (const fn of awardListeners) {
        invokeSubscriber(fn, p, kind, prestige, undefined, "stats.award." + kind);
    }
}

// ------------------------------------------------------------------ the filter
// Single source of truth for "does this combat event count". A self kill, a
// teamkill, a redeploy and a deserting are all worth nothing to anybody: no
// score, no prestige and no counter. The team comparison is the same pattern
// CustomConquest V15 uses and it subsumes the self-kill case, because a player
// killing themselves is trivially on their own team.
export function countsAsCombat(player: mod.Player, victim: mod.Player, deathType?: mod.DeathType): boolean {
    if (!mod.IsValid(player) || !mod.IsValid(victim)) {
        return false;
    }
    if (mod.Equals(player, victim)) {
        return false;
    }
    if (!isEnemyTeam(teamIdOf(player), teamIdOf(victim))) {
        return false;
    }
    if (deathType !== undefined) {
        if (mod.EventDeathTypeCompare(deathType, mod.PlayerDeathTypes.Redeploy)) {
            return false;
        }
        if (mod.EventDeathTypeCompare(deathType, mod.PlayerDeathTypes.Deserting)) {
            return false;
        }
    }
    return true;
}

// A death is only recorded for a real combat death. Friendly fire and suicide
// are not counted; environmental deaths (fall, drowning, an invalid killer) are.
export function countsAsDeath(victim: mod.Player, killer: mod.Player, deathType: mod.DeathType): boolean {
    if (!mod.IsValid(victim)) {
        return false;
    }
    if (mod.EventDeathTypeCompare(deathType, mod.PlayerDeathTypes.Redeploy)) {
        return false;
    }
    if (mod.EventDeathTypeCompare(deathType, mod.PlayerDeathTypes.Deserting)) {
        return false;
    }
    if (mod.IsValid(killer) && !isEnemyTeam(teamIdOf(killer), teamIdOf(victim))) {
        return false;
    }
    return true;
}

// ------------------------------------------------------------------- the stats

export type PlayerStats = {
    score: number;
    kills: number;
    deaths: number;
    assists: number;
};

let stats: { [id: number]: PlayerStats } = {};

export function statsOf(id: number): PlayerStats {
    let s: PlayerStats | undefined = stats[id];
    if (s === undefined) {
        s = { score: 0, kills: 0, deaths: 0, assists: 0 };
        stats[id] = s;
    }
    return s;
}

export function forgetPlayer(id: number): void {
    delete stats[id];
}

export function resetStats(): void {
    // Rebind rather than delete-by-key: Object.keys yields strings while this
    // map is number-keyed, so walking it would need a parse.
    stats = {};
}

// Pays prestige and score for one action. Kills, deaths and assists must be
// filtered through countsAsCombat / countsAsDeath before this is reached.
export function award(p: mod.Player, kind: AwardKind): boolean {
    if (!mod.IsValid(p)) {
        return false;
    }
    const id: number = mod.GetObjId(p);
    if (id < 0) {
        return false;
    }
    const s: PlayerStats = statsOf(id);
    s.score += SCORE_FOR[kind];
    if (kind === "kill") {
        s.kills++;
    } else if (kind === "assist") {
        s.assists++;
    }
    // Bots earn score (they stay on the scoreboard) but never prestige: with
    // no UI they could never spend it, so paying it would only inflate a dead
    // record. The personal award feed is skipped with it - pushPlayerFeed
    // no-ops for HUD-less players anyway.
    const bot: boolean = isBotPid(id);
    if (!bot) {
        addPrestige(id, PRESTIGE_FOR[kind]);
    }
    pushRow(p);
    if (!bot) {
        fireAward(p, kind, PRESTIGE_FOR[kind]);
    }
    const team: number = teamIdOf(p);
    // Deliberately does NOT print the team total: teamScore() walks the entire
    // roster, costing roughly 400 FFI per award purely to format a string.
    // teamScore() stays exported for diagnostics that are not on a hot path.
    log("stats", "pid=" + id + " team " + String(team) + " " + kind
        + (bot ? " +0 prestige (bot)" : " +" + String(PRESTIGE_FOR[kind]) + " prestige")
        + " +" + String(SCORE_FOR[kind]) + " score (player total " + String(s.score) + ")");
    return true;
}

export function countDeath(p: mod.Player): void {
    if (!mod.IsValid(p)) {
        return;
    }
    statsOf(mod.GetObjId(p)).deaths++;
    pushRow(p);
}

// Pays the listed players only. Captures pass the players who were physically
// on the objective, so a teammate capturing alone no longer funds the team.
//
// Returns how many players actually received PRESTIGE. Bots earn score but no
// prestige, so they must not be counted here: the caller uses this number to
// detect a capture that had bodies on the point yet paid no human, and counting
// bots would make that check permanently unreachable.
export function awardPlayers(players: mod.Player[], kind: AwardKind): number {
    let paid: number = 0;
    for (const p of players) {
        if (!award(p, kind)) {
            continue;
        }
        if (!isBotPid(mod.GetObjId(p))) {
            paid++;
        }
    }
    return paid;
}

// ------------------------------------------------------------------ scoreboard

let headerReady: boolean = false;

export function initScoreboard(): void {
    safe("scoreboard.init", () => {
        mod.SetScoreboardType(mod.ScoreboardType.CustomTwoTeams);
        mod.SetScoreboardColumnNames(
            mod.Message("colScore"),
            mod.Message("colPrestige"),
            mod.Message("colKills"),
            mod.Message("colDeaths"),
            mod.Message("colAssists")
        );
        mod.SetScoreboardColumnWidths(1, 1, 0.75, 0.75, 0.75);
        // Column 1 is score, highest first.
        mod.SetScoreboardSorting(1, false);
        headerReady = true;
        pushHeader();
        log("scoreboard", "custom two-team scoreboard configured");
    });
}

// Team 1 is NATO, team 2 is PAX. CustomTwoTeams has no per-team value call, so
// the banked power percentage is carried in the header name.
//
// Do NOT try to show the team total through mod.SetGameModeScore. That call
// writes the gamemode score, which is the victory condition, so raising it to
// the player score total ended the round the instant the first capture paid
// out. Round victory belongs to mod.EndGameMode in turrets.ts and nowhere
// else. teamScore() below is log-only for that reason.
export function pushHeader(): void {
    if (!headerReady) {
        return;
    }
    safe("scoreboard.header", () => {
        mod.SetScoreboardHeader(
            mod.Message("sbNato", Math.round(powerVal[1])),
            mod.Message("sbPax", Math.round(powerVal[2]))
        );
    });
}

export function pushRow(p: mod.Player): void {
    if (!headerReady || !mod.IsValid(p)) {
        return;
    }
    const id: number = mod.GetObjId(p);
    const s: PlayerStats = statsOf(id);
    safe("scoreboard.row", () => {
        mod.SetScoreboardPlayerValues(p, s.score, prestigeOf(id), s.kills, s.deaths, s.assists);
    });
}

export function pushAllRows(): void {
    if (!headerReady) {
        return;
    }
    for (const p of allPlayers()) {
        pushRow(p);
    }
}

// Log-only team aggregate. Never write this to the gamemode score - see the
// warning above pushHeader().
export function teamScore(team: number): number {
    let sum: number = 0;
    for (const p of playersInTeam(team)) {
        sum += statsOf(mod.GetObjId(p)).score;
    }
    return sum;
}

// Zeroes each team's ticket at round start so nothing carries over between
// rounds. This is an initialiser, not a score write, so it cannot end the
// round on its own.
export function resetTeamScores(): void {
    for (const team of [1, 2]) {
        const handle: mod.Team | undefined = teamHandle(team);
        if (handle === undefined) {
            continue;
        }
        const h: mod.Team = handle;
        safe("scoreboard.reset", () => {
            mod.SetGameModeInitialScore(h, 0);
        });
    }
}
