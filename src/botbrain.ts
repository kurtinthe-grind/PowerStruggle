import { log, willLogDebug } from "./util/log";
import {
    OBJ_ATTACK, OBJ_DEFEND, OBJ_HOLD,
    distSqTo, objectiveState, objectiveVector, onObjective, pickDefendObjective,
    pickGuardObjective, pickObjective, pickRoamObjective, spreadOffset
} from "./botobjectives";
import {
    BOT_ARRIVE_M, BOT_DEFEND_MAX_M, BOT_DEFEND_MIN_M, BOT_FAIL_COOLDOWN_MS,
    BOT_HOLD_RADIUS_M, BOT_REISSUE_SWEEPS, BOT_RETRY_LIMIT, BOT_ROAM_MS,
    BOT_ROLE_MOD, BOT_SPRINT_DIST_M
} from "./config";

// Per-bot intent state. The brain issues a behavior only when the intent
// changes (or when BOT_REISSUE_SWEEPS elapses, if persistence tests demand
// it) - never on a fixed re-issue loop. This is the opposite of the official
// PortalPerformanceExample, which re-issues AIMoveToBehavior every 50 ms.

export const BOT_ROLE_FIGHT: number = 0;
export const BOT_ROLE_GUARD: number = 1;

export interface BotMind {
    state: number;
    obj: number;
    speed: number;
    age: number;
    retries: number;
    role: number;
    // When the current objective was picked, so a holding bot can be told to
    // relocate once it has been sitting there long enough.
    since: number;
    failUntil: { [obj: number]: number };
}

// Role is derived from the player id, not stored and shuffled, so it is stable
// across the whole life of a soldier: a guard does not become a fighter after a
// respawn cycle, and the same handful of ids per team always takes the guard
// slots. The prototype factory is the objective guards are pinned to, which is
// what stops 3-4 bots from wandering off and leaves the rest of the team free to
// roam and attack.
export function roleOf(pid: number, team: number): number {
    return pid % BOT_ROLE_MOD === team ? BOT_ROLE_GUARD : BOT_ROLE_FIGHT;
}

export function newMind(pid: number, team: number): BotMind {
    return {
        state: -1, obj: -1, speed: -1, age: 0, retries: 0,
        role: roleOf(pid, team), since: 0, failUntil: {}
    };
}

// A failed MoveTo stamps the objective as untouchable for a while, then the
// bot re-picks around it. After BOT_RETRY_LIMIT consecutive failures the bot
// holds the nearest safely-owned point instead of wedging itself.
export function noteMoveFailed(mind: BotMind, nowMs: number): void {
    mind.retries++;
    if (mind.obj >= 0) {
        mind.failUntil[mind.obj] = nowMs + BOT_FAIL_COOLDOWN_MS;
    }
    if (mind.retries > BOT_RETRY_LIMIT) {
        mind.retries = 0;
        // Force a re-pick next think by clearing the recorded intent.
        mind.state = -1;
        mind.obj = -1;
        mind.speed = -1;
    }
    if (willLogDebug()) {
        log("botbrain", "move failed obj=" + mind.obj + " retries=" + mind.retries);
    }
}

export function noteMoveSucceeded(mind: BotMind): void {
    mind.retries = 0;
}

function failedRecently(mind: BotMind, obj: number, nowMs: number): boolean {
    const until: number | undefined = mind.failUntil[obj];
    return until !== undefined && nowMs < until;
}

function issueAttack(p: mod.Player, vec: mod.Vector, sprint: boolean): void {
    mod.AIMoveToBehavior(p, vec);
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

// One think step. Returns true when a behavior was issued, false when the
// standing intent already covers the situation. nowMs is Date.now() from the
// sweep driver, used only for fail-stamp expiry. pid is passed in because the
// sweep driver already holds it, and re-reading it here cost one FFI per bot per
// sweep for a value the caller has in hand.
export function thinkBot(
    p: mod.Player, pid: number, team: number,
    x: number, y: number, z: number,
    mind: BotMind, nowMs: number
): boolean {
    // Already standing on an objective we own: hold it. The capture sim does
    // the rest, no MoveTo required. This is the cheapest possible outcome -
    // a refreshOwners + set lookup, zero FFI.
    const cur: number = onObjective(pid);
    let wantState: number = -1;
    let wantObj: number = -1;
    let roaming: boolean = false;
    if (mind.role === BOT_ROLE_GUARD) {
        // Guards do not roam and do not chase. They own the factory, so the only
        // thing that can pull them off it is losing it.
        const guard: number = pickGuardObjective(team, x, y, z);
        if (guard >= 0) {
            if (cur === guard) {
                wantState = objectiveState(guard, team) === OBJ_ATTACK ? OBJ_ATTACK : OBJ_HOLD;
                wantObj = guard;
            } else if (guard === mind.obj) {
                // Already walking to the factory; leave the intent alone.
                wantState = mind.state;
                wantObj = mind.obj;
            } else {
                wantState = OBJ_ATTACK;
                wantObj = guard;
            }
        }
    }
    if (wantObj < 0 && cur >= 0 && objectiveState(cur, team) !== OBJ_ATTACK
        && !failedRecently(mind, cur, nowMs)) {
        const holding: number = objectiveState(cur, team);
        if (holding === OBJ_HOLD && nowMs - mind.since > BOT_ROAM_MS
            && !failedRecently(mind, mind.obj, nowMs)) {
            // Held it long enough. Go somewhere else, the way CQ's AI_Scouting
            // rotates a bot between points instead of parking it.
            const roam: number = pickRoamObjective(team, x, y, z, cur);
            if (roam >= 0) {
                wantState = OBJ_HOLD;
                wantObj = roam;
                roaming = true;
            }
        }
        if (wantObj < 0) {
            wantState = holding === OBJ_DEFEND ? OBJ_DEFEND : OBJ_HOLD;
            wantObj = cur;
        }
    }
    if (wantObj < 0 || (wantState === OBJ_HOLD && !roaming && mind.role !== BOT_ROLE_GUARD)) {
        // Nothing to hold. Before the normal pick, check whether one of our own
        // objectives is about to be capped: an owned point with enemies around
        // it and fewer defenders than attackers outranks whatever else is
        // available. This is the "defend the one they are taking" behaviour.
        const help: number = pickDefendObjective(team, x, y, z);
        if (help >= 0 && !failedRecently(mind, help, nowMs)) {
            wantState = OBJ_DEFEND;
            wantObj = help;
        }
    }
    if (wantObj < 0) {
        const idx: number = pickObjective(team, x, y, z);
        if (idx < 0) {
            return false;
        }
        if (failedRecently(mind, idx, nowMs)) {
            return false;
        }
        wantState = objectiveState(idx, team);
        wantObj = idx;
    }
    // Arrival without occupancy: standing close enough that the trigger will
    // claim the bot. Hold instead of re-issuing MoveTo every sweep.
    const arriveSq: number = BOT_ARRIVE_M * BOT_ARRIVE_M;
    const dSq: number = distSqTo(wantObj, x, y, z);
    let wantSpeed: number = 0;
    if (wantState === OBJ_ATTACK) {
        if (dSq < arriveSq) {
            wantState = OBJ_HOLD;
        } else {
            wantSpeed = dSq > BOT_SPRINT_DIST_M * BOT_SPRINT_DIST_M ? 1 : 0;
        }
    }
    // Dirty-check: identical intent is never re-issued. age counts sweeps
    // since the last issue; BOT_REISSUE_SWEEPS > 0 re-issues the same intent
    // on schedule if playtests show behaviors expiring mid-path.
    if (mind.state === wantState && mind.obj === wantObj && mind.speed === wantSpeed) {
        mind.age++;
        if (BOT_REISSUE_SWEEPS <= 0 || mind.age < BOT_REISSUE_SWEEPS) {
            return false;
        }
    }
    // Aim at the objective anchor nudged by this bot's own stable offset, so 24
    // bots heading for the same point spread around it instead of stacking on
    // one metre and shoving each other off.
    const anchor: mod.Vector = objectiveVector(wantObj);
    const off: mod.Vector = spreadOffset(pid, wantObj);
    const vec: mod.Vector = mod.CreateVector(
        mod.XComponentOf(anchor) + mod.XComponentOf(off),
        mod.YComponentOf(anchor) + mod.YComponentOf(off),
        mod.ZComponentOf(anchor) + mod.ZComponentOf(off));
    if (wantState === OBJ_ATTACK) {
        issueAttack(p, vec, wantSpeed === 1);
    } else if (wantState === OBJ_DEFEND) {
        issueDefend(p, vec);
    } else {
        issueHold(p, vec);
    }
    const prevObj: number = mind.obj;
    mind.state = wantState;
    mind.obj = wantObj;
    mind.speed = wantSpeed;
    mind.age = 0;
    if (mind.since === 0 || prevObj !== wantObj) {
        // Roam timer restarts only on a genuine destination change, otherwise a
        // re-issued hold would reset the clock and the bot would never rotate.
        mind.since = nowMs;
    }
    return true;
}
