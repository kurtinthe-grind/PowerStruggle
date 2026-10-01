import { log } from "./util/log";
import {
    claimObjective, distSqTo, objectiveLabel, objectiveVector, releaseClaim, scoreSnapshot,
    spreadOffset
} from "./botobjectives";
import { JOB_ATTACK, JOB_DEFEND, JOB_HOLD, pickBest, ScoreBot, ScoreParams, ScorePick } from "./botscore";
import {
    BOT_ARRIVE_M, BOT_BATTLE_MS, BOT_DEFEND_MAX_M, BOT_DEFEND_MIN_M, BOT_FAIL_COOLDOWN_MS,
    BOT_FAIL_GRACE_MS, BOT_HOLD_RADIUS_M, BOT_MAX_PATH_M, BOT_REISSUE_SWEEPS, BOT_ROAM_MS,
    BOT_SCORE_DIST_M, BOT_SPRINT_DIST_M, BOT_THREAT_MIN, BOT_TRACE, BOT_W_ATTACK, BOT_W_CROWD,
    BOT_W_DEFEND, BOT_W_HOLD, BOT_W_JITTER, BOT_W_PER_THREAT, BOT_W_STICK
} from "./config";

// Per-bot intent. Every think scores all objectives (botscore.pickBest) and the
// brain issues a behavior only when the intent changes, or every
// BOT_REISSUE_SWEEPS sweeps so a silently expired behavior cannot wedge a bot.
// There are no fixed roles: attack, defend and hold all come from the score.

export interface BotMind {
    // JOB_* of the last issued behavior, -1 for none.
    state: number;
    // Objective index of the last issued behavior, -1 for none.
    obj: number;
    speed: number;
    age: number;
    // When the current hold started (or the objective was picked), for roaming.
    since: number;
    // When the last behavior was issued, so a MoveTo failure caused by the engine
    // cancelling the previous move is not counted as a real failure.
    issuedAt: number;
    // Combat interrupt end time, 0 when not fighting.
    battleUntil: number;
}

export function newMind(): BotMind {
    return { state: -1, obj: -1, speed: -1, age: 0, since: 0, issuedAt: 0, battleUntil: 0 };
}

// Objectives each bot could not reach, with the time the ban lifts. Module level
// and keyed by pid, so it survives forgetBot: a recycled bot comes back with the
// same pid (18:48 log) and must not walk straight back to the same bunker.
const failMemory: { [pid: number]: { [obj: number]: number } } = {};

function failMapOf(pid: number): { [obj: number]: number } {
    let m: { [obj: number]: number } | undefined = failMemory[pid];
    if (m === undefined) {
        m = {};
        failMemory[pid] = m;
    }
    return m;
}

// Forget the current intent so the next think re-picks from scratch.
export function clearIntent(pid: number, mind: BotMind): void {
    mind.state = -1;
    mind.obj = -1;
    mind.speed = -1;
    mind.age = 0;
    releaseClaim(pid);
}

// This bot gives up on an objective for BOT_FAIL_COOLDOWN_MS and re-picks.
export function giveUp(pid: number, mind: BotMind, nowMs: number, reason: string): void {
    const obj: number = mind.obj;
    if (obj >= 0) {
        failMapOf(pid)[obj] = nowMs + BOT_FAIL_COOLDOWN_MS;
        if (BOT_TRACE) {
            log("bots", "pid=" + pid + " gives up on " + objectiveLabel(obj) + " for "
                + String(BOT_FAIL_COOLDOWN_MS / 1000) + "s (" + reason + ")");
        }
    }
    clearIntent(pid, mind);
}

// OnAIMoveToFailed: the engine stopped trying to reach the destination. Only
// an attack walk counts, and not within the grace window after a new behavior,
// where the "failure" is the previous move being replaced.
export function noteMoveFailed(pid: number, mind: BotMind, nowMs: number): void {
    if (mind.state !== JOB_ATTACK || nowMs - mind.issuedAt < BOT_FAIL_GRACE_MS) {
        return;
    }
    giveUp(pid, mind, nowMs, "moveFailed");
}

// Combat interrupt (idea from bf6-portal-bots-brain's BattleSensor): a bot shot
// by an enemy hands over to the engine's own combat AI for BOT_BATTLE_MS, then
// thinkBot re-issues its objective.
export function enterBattle(p: mod.Player, mind: BotMind, nowMs: number): void {
    if (mind.battleUntil <= nowMs) {
        mod.AIBattlefieldBehavior(p);
    }
    mind.battleUntil = nowMs + BOT_BATTLE_MS;
}

export function inBattle(mind: BotMind, nowMs: number): boolean {
    return mind.battleUntil > nowMs;
}

const PARAMS: ScoreParams = {
    wAttack: BOT_W_ATTACK, wDefend: BOT_W_DEFEND, wPerThreat: BOT_W_PER_THREAT,
    wHold: BOT_W_HOLD, wCrowd: BOT_W_CROWD, wStick: BOT_W_STICK, wJitter: BOT_W_JITTER,
    distM: BOT_SCORE_DIST_M, maxPathM: BOT_MAX_PATH_M, roamMs: BOT_ROAM_MS,
    threatMin: BOT_THREAT_MIN
};

// Reused for every think, never stored.
const botScratch: ScoreBot = { pid: 0, team: 0, x: 0, y: 0, z: 0, cur: -1, sinceMs: 0, failUntil: {} };

function issueAttack(p: mod.Player, vec: mod.Vector, sprint: boolean): void {
    // Validated: the engine walks to the nearest navmesh point near the target,
    // which is what the official CustomBT template uses for scouting. Plain
    // MoveTo into a bunker with bad navmesh left bots standing outside forever.
    mod.AIValidatedMoveToBehavior(p, vec);
    mod.AISetMoveSpeed(p, sprint ? mod.MoveSpeed.Sprint : mod.MoveSpeed.InvestigateRun);
}

function issueDefend(p: mod.Player, vec: mod.Vector): void {
    mod.AIDefendPositionBehavior(p, vec, BOT_DEFEND_MIN_M, BOT_DEFEND_MAX_M);
    mod.AISetMoveSpeed(p, mod.MoveSpeed.InvestigateRun);
}

function issueHold(p: mod.Player, vec: mod.Vector): void {
    mod.AIDefendPositionBehavior(p, vec, 0, BOT_HOLD_RADIUS_M);
    mod.AISetMoveSpeed(p, mod.MoveSpeed.Patrol);
}

// One think step. Returns true when a behavior was issued.
export function thinkBot(
    p: mod.Player, pid: number, team: number,
    x: number, y: number, z: number,
    mind: BotMind, nowMs: number
): boolean {
    if (mind.battleUntil > nowMs) {
        // The engine's combat AI has this bot; leave it alone.
        return false;
    }
    if (mind.battleUntil !== 0) {
        // Fight over: AIBattlefieldBehavior replaced our behavior, so the same
        // intent must be issued again rather than dirty-checked away.
        mind.battleUntil = 0;
        mind.state = -1;
    }
    botScratch.pid = pid;
    botScratch.team = team;
    botScratch.x = x;
    botScratch.y = y;
    botScratch.z = z;
    botScratch.cur = mind.obj;
    botScratch.sinceMs = mind.since;
    botScratch.failUntil = failMapOf(pid);
    const pick: ScorePick = pickBest(scoreSnapshot(team), botScratch, nowMs, PARAMS);
    if (pick.obj < 0) {
        return false;
    }
    const wantObj: number = pick.obj;
    let wantState: number = pick.job;
    claimObjective(pid, team, wantObj);
    // Arrival: close enough that the trigger will take over. Stand and capture
    // instead of re-issuing MoveTo every sweep.
    const dSq: number = distSqTo(wantObj, x, y, z);
    let wantSpeed: number = 0;
    if (wantState === JOB_ATTACK) {
        if (dSq < BOT_ARRIVE_M * BOT_ARRIVE_M) {
            wantState = JOB_HOLD;
        } else {
            wantSpeed = dSq > BOT_SPRINT_DIST_M * BOT_SPRINT_DIST_M ? 1 : 0;
        }
    }
    if (mind.state === wantState && mind.obj === wantObj && mind.speed === wantSpeed) {
        mind.age++;
        if (BOT_REISSUE_SWEEPS <= 0 || mind.age < BOT_REISSUE_SWEEPS) {
            return false;
        }
    }
    // Aim at the anchor nudged by this bot's own stable offset, so bots heading
    // for the same point spread around it instead of stacking on one metre.
    const anchor: mod.Vector = objectiveVector(wantObj);
    const off: mod.Vector = spreadOffset(pid, wantObj);
    const vec: mod.Vector = mod.CreateVector(
        mod.XComponentOf(anchor) + mod.XComponentOf(off),
        mod.YComponentOf(anchor) + mod.YComponentOf(off),
        mod.ZComponentOf(anchor) + mod.ZComponentOf(off));
    if (wantState === JOB_ATTACK) {
        issueAttack(p, vec, wantSpeed === 1);
    } else if (wantState === JOB_DEFEND) {
        issueDefend(p, vec);
    } else {
        issueHold(p, vec);
    }
    // The roam clock measures how long the bot has held this point, so it
    // restarts on a new objective and when a walk turns into a hold.
    if (mind.obj !== wantObj || (wantState === JOB_HOLD && mind.state !== JOB_HOLD)) {
        mind.since = nowMs;
    }
    mind.state = wantState;
    mind.obj = wantObj;
    mind.speed = wantSpeed;
    mind.age = 0;
    mind.issuedAt = nowMs;
    return true;
}
