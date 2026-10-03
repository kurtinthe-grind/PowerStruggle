import { log } from "./util/log";
import {
    claimObjective, distSqTo, isOccupant, objectiveLabel, objectiveRadius, releaseClaim,
    scoreSnapshot, targetVector
} from "./botobjectives";
import { JOB_ATTACK, JOB_DEFEND, JOB_HOLD, pickBest, ScoreBot, ScoreParams, ScorePick } from "./botscore";
import { navActive, navVersion, nodeDistSq, nodeVector, roamWaypoint, routeStartAt, routeTo } from "./botnav";
import {
    BOT_BATTLE_MS, BOT_FAIL_COOLDOWN_MS, BOT_FAIL_GRACE_MS, BOT_LEASH_MIN_M, BOT_MAX_PATH_M,
    BOT_NAV_MIN_M, BOT_NAV_REACH_M, BOT_NAV_ROAM_M,
    BOT_REISSUE_SWEEPS, BOT_ROAM_MS, BOT_SCORE_DIST_M, BOT_SPRINT_DIST_M, BOT_THREAT_MIN, BOT_TRACE,
    BOT_W_ATTACK, BOT_W_CROWD, BOT_W_DEFEND, BOT_W_HOLD, BOT_W_JITTER, BOT_W_PER_THREAT, BOT_W_QUOTA,
    BOT_W_STICK
} from "./config";

// Brain-only states on top of botscore's JOB_*: CAPTURE is an attack that has
// arrived (stand inside the volume until it flips), ROAM is the engine's own
// battlefield AI when no objective can be picked at all.
export const JOB_CAPTURE: number = 3;
export const JOB_ROAM: number = 4;

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
    // Waypoint route (botnav) toward navObj, planned at graph version navVer:
    // route[navI] is the waypoint being walked to. leg is the graph node the
    // last behavior was aimed at (-1: aimed at the objective itself), legFrom
    // the node the bot came from (-1: its own position). While roaming, leg is
    // the roam waypoint.
    navObj: number;
    navVer: number;
    route: number[];
    navI: number;
    leg: number;
    legFrom: number;
    // Key of this bot's fail memory: "team:nameKey" once it has a name (set by
    // bots.registerBot), so it follows the bot across respawns. Empty means
    // fall back to the player id.
    failKey: string;
}

export function newMind(): BotMind {
    return {
        state: -1, obj: -1, speed: -1, age: 0, since: 0, issuedAt: 0, battleUntil: 0,
        navObj: -1, navVer: -1, route: [], navI: 0, leg: -1, legFrom: -1, failKey: ""
    };
}

// Objectives each bot could not reach, with the time the ban lifts. Module level,
// so it survives forgetBot, and keyed by team and name rather than player id:
// a dead bot leaves the game and its respawn is a new player that usually gets
// a different id (sometimes one from the other team), but it keeps its name, so
// it must not walk straight back to the same unreachable bunker.
const failMemory: { [key: string]: { [obj: number]: number } } = {};

function failMapOf(pid: number, mind: BotMind): { [obj: number]: number } {
    const key: string = mind.failKey !== "" ? mind.failKey : "pid:" + String(pid);
    let m: { [obj: number]: number } | undefined = failMemory[key];
    if (m === undefined) {
        m = {};
        failMemory[key] = m;
    }
    return m;
}

// Forget the current intent so the next think re-picks from scratch.
export function clearIntent(pid: number, mind: BotMind): void {
    mind.state = -1;
    mind.obj = -1;
    mind.speed = -1;
    mind.age = 0;
    mind.navObj = -1;
    mind.leg = -1;
    mind.legFrom = -1;
    releaseClaim(pid);
}

// The waypoint to walk to next on the way to obj, or -1 to walk to the
// objective itself. Plans (or re-plans after a link penalty) as needed and
// skips waypoints already reached. legFrom is the node the bot left last, so
// a swim or a stall can be blamed on the link it is on.
function nextLeg(mind: BotMind, obj: number, x: number, z: number): number {
    if (mind.navObj !== obj || mind.navVer !== navVersion()) {
        // On a re-plan for the same objective the bot keeps walking to its
        // current waypoint when the new route reaches it over the same link.
        // A route that still ends at that waypoint but goes round (the link
        // the bot is on was just penalized) does not count: the bot turns back.
        const curLeg: number = mind.navObj === obj ? mind.leg : -1;
        const route: number[] = routeTo(obj, x, z);
        let at: number = routeStartAt(route, obj, x, z, curLeg);
        let kept: boolean = curLeg >= 0 && at < route.length && route[at] === curLeg;
        if (kept && (at > 0 ? route[at - 1] !== mind.legFrom : mind.legFrom >= 0)) {
            kept = false;
            at = routeStartAt(route, obj, x, z, -1);
        }
        mind.route = route;
        mind.navObj = obj;
        mind.navVer = navVersion();
        mind.navI = at;
        if (!kept) {
            mind.legFrom = at > 0 ? route[at - 1] : -1;
        }
    }
    const reachSq: number = BOT_NAV_REACH_M * BOT_NAV_REACH_M;
    while (mind.navI < mind.route.length && nodeDistSq(mind.route[mind.navI], x, z) < reachSq) {
        mind.legFrom = mind.route[mind.navI];
        mind.navI++;
    }
    if (mind.navI >= mind.route.length) {
        return -1;
    }
    return mind.route[mind.navI];
}

// Nothing to pick: walk between nearby waypoints, or with none on the map hand
// the bot to the engine's own AI. Standing still was the old outcome.
function roam(p: mod.Player, pid: number, mind: BotMind, x: number, z: number, nowMs: number): void {
    const reachSq: number = BOT_NAV_REACH_M * BOT_NAV_REACH_M;
    if (mind.state === JOB_ROAM && (mind.leg < 0 || nodeDistSq(mind.leg, x, z) >= reachSq)) {
        return;
    }
    releaseClaim(pid);
    const node: number = navActive() ? roamWaypoint(x, z, BOT_NAV_REACH_M, BOT_NAV_ROAM_M, Math.random()) : -1;
    if (node >= 0) {
        mod.AIValidatedMoveToBehavior(p, nodeVector(node));
        mod.AISetMoveSpeed(p, mod.MoveSpeed.InvestigateRun);
    } else if (mind.state !== JOB_ROAM) {
        mod.AIBattlefieldBehavior(p);
    }
    mind.state = JOB_ROAM;
    mind.obj = -1;
    mind.speed = -1;
    mind.age = 0;
    mind.issuedAt = nowMs;
    mind.navObj = -1;
    mind.leg = node;
    mind.legFrom = -1;
}

// This bot gives up on an objective for BOT_FAIL_COOLDOWN_MS and re-picks.
export function giveUp(pid: number, mind: BotMind, nowMs: number, reason: string): void {
    const obj: number = mind.obj;
    if (obj >= 0) {
        failMapOf(pid, mind)[obj] = nowMs + BOT_FAIL_COOLDOWN_MS;
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
    wHold: BOT_W_HOLD, wQuota: BOT_W_QUOTA, wCrowd: BOT_W_CROWD, wStick: BOT_W_STICK, wJitter: BOT_W_JITTER,
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

// Defend and hold stay on a leash of the capture radius (at least
// BOT_LEASH_MIN_M) around the bot's own spot, so they stay on the point and
// block an enemy capture. On a 2 m bunker spot that leash can reach about 5 m
// from the flag, just past the short side of the volume. The old 5-25 m
// defend ring and 30 m hold radius parked defenders well outside small volumes.
function issueDefend(p: mod.Player, vec: mod.Vector, radius: number): void {
    mod.AIDefendPositionBehavior(p, vec, 0, Math.max(radius, BOT_LEASH_MIN_M));
    mod.AISetMoveSpeed(p, mod.MoveSpeed.InvestigateRun);
}

function issueHold(p: mod.Player, vec: mod.Vector, radius: number): void {
    mod.AIDefendPositionBehavior(p, vec, 0, Math.max(radius, BOT_LEASH_MIN_M));
    mod.AISetMoveSpeed(p, mod.MoveSpeed.Patrol);
}

// Arrived on a point we do not own: stay on a short leash around this bot's
// own spot, which is inside the volume, until the capture flips. This is the
// fix for bots that walked into a bunker and straight back out of it.
function issueCapture(p: mod.Player, vec: mod.Vector, radius: number): void {
    mod.AIDefendPositionBehavior(p, vec, 0, Math.max(radius * 0.5, 1));
    mod.AISetMoveSpeed(p, mod.MoveSpeed.InvestigateRun);
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
    botScratch.failUntil = failMapOf(pid, mind);
    const pick: ScorePick = pickBest(scoreSnapshot(team), botScratch, nowMs, PARAMS);
    if (pick.obj < 0) {
        // Nothing pickable (every objective banned for this bot).
        roam(p, pid, mind, x, z, nowMs);
        return false;
    }
    const wantObj: number = pick.obj;
    let wantState: number = pick.job;
    claimObjective(pid, team, wantObj);
    // Arrival: inside the volume per the trigger, or well inside the capture
    // radius. Stand and capture instead of re-issuing MoveTo every sweep.
    const radius: number = objectiveRadius(wantObj);
    const dSq: number = distSqTo(wantObj, x, y, z);
    const arriveR: number = radius * 0.6;
    let wantSpeed: number = 0;
    // A bot already capturing keeps capturing out to 1.5x the radius, so one
    // shuffle off a 2 m bunker spot does not send it walking again.
    const keepR: number = radius * 1.5;
    const capturing: boolean = mind.state === JOB_CAPTURE && mind.obj === wantObj && dSq < keepR * keepR;
    if (wantState === JOB_ATTACK) {
        if (capturing || isOccupant(wantObj, pid) || dSq < arriveR * arriveR) {
            wantState = JOB_CAPTURE;
        } else {
            wantSpeed = dSq > BOT_SPRINT_DIST_M * BOT_SPRINT_DIST_M ? 1 : 0;
        }
    }
    // Far attack walks follow the waypoint route, one waypoint at a time. A
    // route already under way is followed to the end even inside
    // BOT_NAV_MIN_M, so the last stretch does not cut across water and its
    // link can still be blamed for a swim.
    let leg: number = -1;
    if (wantState === JOB_ATTACK && navActive()
        && (dSq > BOT_NAV_MIN_M * BOT_NAV_MIN_M || mind.navObj === wantObj)) {
        leg = nextLeg(mind, wantObj, x, z);
    } else {
        mind.navObj = -1;
        mind.legFrom = -1;
    }
    if (mind.state === wantState && mind.obj === wantObj && mind.speed === wantSpeed && mind.leg === leg) {
        mind.age++;
        if (BOT_REISSUE_SWEEPS <= 0 || mind.age < BOT_REISSUE_SWEEPS) {
            return false;
        }
    }
    // This bot's own spot inside the volume, so bots on the same objective
    // spread instead of stacking on one metre.
    const vec: mod.Vector = leg >= 0 ? nodeVector(leg) : targetVector(pid, wantObj);
    if (wantState === JOB_ATTACK) {
        issueAttack(p, vec, wantSpeed === 1 || leg >= 0);
    } else if (wantState === JOB_CAPTURE) {
        issueCapture(p, vec, radius);
    } else if (wantState === JOB_DEFEND) {
        issueDefend(p, vec, radius);
    } else {
        issueHold(p, vec, radius);
    }
    // The roam clock measures how long the bot has held this point, so it
    // restarts on a new objective and when a walk turns into a hold.
    if (mind.obj !== wantObj || (wantState === JOB_HOLD && mind.state !== JOB_HOLD)) {
        mind.since = nowMs;
    }
    mind.state = wantState;
    mind.obj = wantObj;
    mind.speed = wantSpeed;
    mind.leg = leg;
    mind.age = 0;
    mind.issuedAt = nowMs;
    return true;
}
