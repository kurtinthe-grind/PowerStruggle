// Unit test for the bot objective scorer in src/botscore.ts.
// Evidence (playtest 2026-10-01 18:48): every bot on a team walked to the same
// nearest objective, because the old crowd penalty only counted bots standing
// inside a trigger (zero at game start), and a bot that could not reach a
// bunker was recycled and walked straight back to it.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "botscore.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const { pickBest, JOB_ATTACK, JOB_DEFEND, JOB_HOLD } = m.exports;

let failed = 0;
function ok(label, cond, detail) {
    if (!cond) failed++;
    console.log((cond ? "  ok   " : "  FAIL ") + label + (detail === undefined ? "" : " -> " + detail));
}

const P = {
    wAttack: 10, wDefend: 10, wPerThreat: 3, wHold: 3, wQuota: 15, wCrowd: 0.15,
    wStick: 1.5, wJitter: 0.5, distM: 100, maxPathM: 500, roamMs: 22000, threatMin: 2
};
function obj(x, z, owner, extra) {
    return Object.assign({ x: x, y: 0, z: z, owner: owner, weight: 1, claims: 0, pressure: 0, quota: 0 }, extra || {});
}
function bot(pid, x, z, extra) {
    return Object.assign({ pid: pid, team: 1, x: x, y: 0, z: z, cur: -1, sinceMs: 0, failUntil: {} }, extra || {});
}

console.log("24 bots at one spawn split across enemy objectives (claims count bots en route):");
{
    const objs = [obj(200, 0, 2), obj(0, 210, 2), obj(-220, 0, 0), obj(0, -230, 2), obj(160, 160, 0), obj(-170, -170, 2)];
    const per = [0, 0, 0, 0, 0, 0];
    for (let pid = 1; pid <= 24; pid++) {
        const r = pickBest(objs, bot(pid, 0, 0), 1000, P);
        per[r.obj]++;
        objs[r.obj].claims++;
    }
    const used = per.filter((n) => n > 0).length;
    ok("uses >= 4 objectives", used >= 4, JSON.stringify(per));
    ok("no objective gets > 8 bots", Math.max.apply(null, per) <= 8, JSON.stringify(per));
}

console.log("an owned objective under pressure pulls defenders until they cover it:");
{
    const objs = [obj(100, 0, 1, { pressure: 3 }), obj(150, 0, 2)];
    const jobs = [];
    for (let pid = 1; pid <= 6; pid++) {
        const r = pickBest(objs, bot(pid, 0, 0), 1000, P);
        jobs.push(r.obj === 0 ? "D" : "A");
        objs[r.obj].claims++;
    }
    ok("first 3 defend", jobs.slice(0, 3).join("") === "DDD", jobs.join(""));
    ok("then attack", jobs.slice(3).indexOf("A") >= 0, jobs.join(""));
    const r = pickBest([obj(100, 0, 1, { pressure: 3 })], bot(9, 0, 0), 1000, P);
    ok("job is DEFEND", r.job === JOB_DEFEND, String(r.job));
}

console.log("a failed objective is skipped until its stamp expires:");
{
    const objs = [obj(100, 0, 2), obj(400, 0, 2)];
    const b = bot(3, 0, 0, { failUntil: { 0: 5000 } });
    ok("skipped at t=1000", pickBest(objs, b, 1000, P).obj === 1);
    ok("picked again at t=6000", pickBest(objs, b, 6000, P).obj === 0);
}

console.log("holding an owned point too long roams elsewhere:");
{
    const objs = [obj(0, 0, 1), obj(120, 0, 1)];
    const fresh = pickBest(objs, bot(4, 0, 0, { cur: 0, sinceMs: 1000 }), 5000, P);
    ok("fresh hold stays", fresh.obj === 0 && fresh.job === JOB_HOLD, JSON.stringify(fresh));
    const stale = pickBest(objs, bot(4, 0, 0, { cur: 0, sinceMs: 1000 }), 30000, P);
    ok("stale hold roams to the other point", stale.obj === 1, JSON.stringify(stale));
    const alone = pickBest([obj(0, 0, 1)], bot(4, 0, 0, { cur: 0, sinceMs: 1000 }), 30000, P);
    ok("only point: keeps holding", alone.obj === 0, JSON.stringify(alone));
}

console.log("hysteresis keeps the current target over a near-equal one:");
{
    const objs = [obj(200, 0, 2, { claims: 1 }), obj(190, 0, 2)];
    const r = pickBest(objs, bot(5, 0, 0, { cur: 0 }), 1000, P);
    ok("stays on current", r.obj === 0 && r.job === JOB_ATTACK, JSON.stringify(r));
}

console.log("objectives beyond the path range are never picked:");
{
    const r = pickBest([obj(900, 0, 2)], bot(6, 0, 0), 1000, P);
    ok("nothing in range -> -1", r.obj === -1, JSON.stringify(r));
}

console.log("an owned objective with a quota keeps that many defenders, then the rest attack:");
{
    // Playtest 2026-10-02: the Prototype Factory must always have 3-4 defenders.
    const objs = [obj(50, 0, 1, { quota: 4 }), obj(120, 0, 2), obj(0, 140, 2)];
    const jobs = [];
    for (let pid = 1; pid <= 8; pid++) {
        const r = pickBest(objs, bot(pid, 0, 0), 1000, P);
        jobs.push(r.obj === 0 ? "P" : "A");
        objs[r.obj].claims++;
    }
    ok("first 4 go to the quota objective", jobs.slice(0, 4).join("") === "PPPP", jobs.join(""));
    ok("no 5th", jobs.slice(4).indexOf("P") < 0, jobs.join(""));
    const stay = pickBest([obj(0, 0, 1, { quota: 4, claims: 4 }), obj(120, 0, 1)],
        bot(7, 0, 0, { cur: 0, sinceMs: 1000 }), 60000, P);
    ok("a quota holder does not roam away", stay.obj === 0, JSON.stringify(stay));
}

console.log("with the production weights, an enemy proto draws its attacker quota first:");
{
    // Parsed from src/config.ts so this follows the shipped tuning.
    const cfg = fs.readFileSync(path.join(__dirname, "..", "src", "config.ts"), "utf8");
    const num = (name) => {
        const mm = new RegExp("export const " + name + ": number = ([0-9.]+);").exec(cfg);
        if (!mm) { throw new Error(name + " not found in config.ts"); }
        return Number(mm[1]);
    };
    const PROD = {
        wAttack: num("BOT_W_ATTACK"), wDefend: num("BOT_W_DEFEND"), wPerThreat: num("BOT_W_PER_THREAT"),
        wHold: num("BOT_W_HOLD"), wQuota: num("BOT_W_QUOTA"), wCrowd: num("BOT_W_CROWD"),
        wStick: num("BOT_W_STICK"), wJitter: num("BOT_W_JITTER"), distM: num("BOT_SCORE_DIST_M"),
        maxPathM: num("BOT_MAX_PATH_M"), roamMs: num("BOT_ROAM_MS"), threatMin: num("BOT_THREAT_MIN")
    };
    const attackers = num("BOT_PROTO_ATTACKERS");
    // Proto (weight 1.5) owned by the enemy 400 m away; an enemy energy site
    // (1.3) and an enemy factory (1.0) much nearer.
    const objs = [obj(400, 0, 2, { quota: attackers, weight: 1.5 }), obj(150, 0, 2, { weight: 1.3 }),
        obj(0, 200, 2, { weight: 1.0 })];
    const jobs = [];
    for (let pid = 1; pid <= 12; pid++) {
        const r = pickBest(objs, bot(pid, 0, 0), 1000, PROD);
        jobs.push(r.obj === 0 ? "P" : "o");
        objs[r.obj].claims++;
    }
    ok("the first " + attackers + " attack the proto", jobs.slice(0, attackers).join("") === "P".repeat(attackers),
        jobs.join(""));
    ok("the rest go elsewhere at first", jobs[attackers] !== "P", jobs.join(""));
    // A neutral proto asks the same attacker quota of both teams.
    const neutral = pickBest([obj(400, 0, 0, { quota: attackers, weight: 1.5 }), obj(150, 0, 2, { weight: 1.3 })],
        bot(20, 0, 0), 1000, PROD);
    ok("a neutral proto below quota is picked", neutral.obj === 0, JSON.stringify(neutral));
}

console.log("distance is horizontal (height does not count):");
{
    const r = pickBest([obj(300, 0, 2, { y: 100 }), obj(310, 0, 2)], bot(8, 0, 0), 1000, P);
    ok("the nearer one in x/z wins", r.obj === 0, JSON.stringify(r));
}

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
