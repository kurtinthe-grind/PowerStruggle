// Bot objective scoring, kept free of mod.* so scripts/test-botscore.js can
// unit-test it in node.
//
// Every think, a bot scores every objective and takes the best. There are no
// fixed roles: attacking, defending and holding all come out of the same score.
//
// Evidence from the 2026-10-01 18:48 playtest: the old picker penalised
// crowding only by bots standing inside a trigger, which is zero at game start,
// so every bot on a team walked to the same nearest objective. The crowd term
// here counts claims - bots that have picked the objective, including the ones
// still walking there.
//
// 2026-10-02 playtest: the whole match was spent on the two or three nearest
// objectives. Anything beyond 500 m was never even scored, and a bot that gave
// up on everything in range stood still. Distances are now horizontal (an
// energy site's icon floats 23 m up) and the range cap is the whole map.
// Objectives can also ask for a minimum crew (quota): the Prototype Factory
// keeps defenders while owned and draws attackers while not.

export const JOB_HOLD: number = 0;
export const JOB_ATTACK: number = 1;
export const JOB_DEFEND: number = 2;

// One objective as seen by one team. claims and pressure are for that team.
export interface ScoreObjective {
    x: number;
    y: number;
    z: number;
    owner: number;
    // Kind weight, e.g. bunkers worth more than a naval factory.
    weight: number;
    // Bots of this team that have this objective as their target.
    claims: number;
    // Enemy players near the objective.
    pressure: number;
    // Bots this team wants on the objective at all times, 0 for none. Below the
    // quota the objective gets wQuota on top of its normal score.
    quota: number;
}

export interface ScoreBot {
    pid: number;
    team: number;
    x: number;
    y: number;
    z: number;
    // Current target index, or -1.
    cur: number;
    // When the current target was picked.
    sinceMs: number;
    // Objectives this bot could not reach, with the time the ban lifts.
    failUntil: { [obj: number]: number };
}

export interface ScoreParams {
    wAttack: number;
    wDefend: number;
    wPerThreat: number;
    wHold: number;
    wQuota: number;
    wCrowd: number;
    wStick: number;
    wJitter: number;
    distM: number;
    maxPathM: number;
    roamMs: number;
    threatMin: number;
}

export interface ScorePick {
    obj: number;
    job: number;
}

// Stable per-bot, per-objective tie breaker in [-1, 1], so bots that spawn on
// the same spot do not all make the same choice.
function jitter(pid: number, idx: number): number {
    const h: number = ((pid * 2654435761 + idx * 40503) >>> 0) % 10007;
    return (h / 10007) * 2 - 1;
}

export function pickBest(objs: ScoreObjective[], bot: ScoreBot, nowMs: number, P: ScoreParams): ScorePick {
    const maxSq: number = P.maxPathM * P.maxPathM;
    let best: number = -1;
    let bestJob: number = JOB_HOLD;
    let bestScore: number = 0;
    // Used only when roaming leaves nothing else: keep holding where we are.
    let fallback: number = -1;
    for (let i: number = 0; i < objs.length; i++) {
        const o: ScoreObjective = objs[i];
        const until: number | undefined = bot.failUntil[i];
        if (until !== undefined && nowMs < until) {
            continue;
        }
        const dx: number = o.x - bot.x;
        const dz: number = o.z - bot.z;
        const dSq: number = dx * dx + dz * dz;
        if (dSq > maxSq) {
            continue;
        }
        // The bot's own claim on its current target is not crowding.
        let claims: number = o.claims - (i === bot.cur ? 1 : 0);
        if (claims < 0) {
            claims = 0;
        }
        const short: boolean = o.quota > 0 && claims < o.quota;
        let job: number;
        let base: number;
        if (o.owner !== bot.team) {
            job = JOB_ATTACK;
            base = P.wAttack;
        } else if (o.pressure >= P.threatMin) {
            job = JOB_DEFEND;
            const need: number = o.pressure - claims;
            // Covered points still count, but far less than one that needs help.
            base = need > 0 ? P.wDefend + P.wPerThreat * need : P.wDefend * 0.4;
        } else {
            job = JOB_HOLD;
            base = P.wHold;
            if (i === bot.cur && !short && nowMs - bot.sinceMs > P.roamMs) {
                // Held long enough: move on, the way CQ's AI_Scouting rotates
                // bots between points instead of parking them.
                fallback = i;
                continue;
            }
        }
        const score: number = base * o.weight
            + (short ? P.wQuota : 0)
            - Math.sqrt(dSq) / P.distM
            - P.wCrowd * claims * claims
            + (i === bot.cur ? P.wStick : 0)
            + jitter(bot.pid, i) * P.wJitter;
        if (best < 0 || score > bestScore) {
            best = i;
            bestJob = job;
            bestScore = score;
        }
    }
    if (best < 0 && fallback >= 0) {
        return { obj: fallback, job: JOB_HOLD };
    }
    return { obj: best, job: bestJob };
}
