// Unit test for the bot navigation graph in src/botnavgraph.ts.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "botnavgraph.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const { buildGraph, findRoute, penalize, planLegs, isolatedNodes, routeStart, linkPenalty, NAV_PENALTY_CAP } = m.exports;

let failed = 0;
function ok(label, cond, detail) {
    if (!cond) failed++;
    console.log((cond ? "  ok   " : "  FAIL ") + label + (detail === undefined ? "" : " -> " + detail));
}

// A U-shaped land route around a bay: 0 -> 1 -> 2 -> 3, plus a short cut 0 -> 3
// straight across the water that is only 140 m long.
//   1(0,140) ---- 2(140,140)
//   |              |
//   0(0,0)  ~~~~  3(140,0)
const xs = [0, 0, 140, 140, 300];
const zs = [0, 140, 140, 0, 0];

console.log("links are made by distance only:");
{
    const g = buildGraph(xs, zs, 150);
    ok("0 links 1 and 3", g.adj[0].indexOf(1) >= 0 && g.adj[0].indexOf(3) >= 0, JSON.stringify(g.adj[0]));
    ok("0 does not link 2 (198 m)", g.adj[0].indexOf(2) < 0, JSON.stringify(g.adj[0]));
    ok("4 is isolated", JSON.stringify(isolatedNodes(g, 5)) === "[4]", JSON.stringify(isolatedNodes(g, 5)));
}

console.log("shortest route, then a learned penalty moves bots off a bad link:");
{
    const g = buildGraph(xs, zs, 150);
    ok("direct link first", JSON.stringify(findRoute(g, 0, 3)) === "[0,3]", JSON.stringify(findRoute(g, 0, 3)));
    penalize(g, 0, 3, 8);
    ok("after a swim penalty it goes round", JSON.stringify(findRoute(g, 0, 3)) === "[0,1,2,3]",
        JSON.stringify(findRoute(g, 0, 3)));
    ok("unreachable -> []", findRoute(g, 0, 4).length === 0);
}

console.log("legs exclude the goal and start at the node nearest the bot:");
{
    const g = buildGraph(xs, zs, 150);
    penalize(g, 0, 3, 8);
    ok("from node 0", JSON.stringify(planLegs(g, 1, 1, 3)) === "[0,1,2]", JSON.stringify(planLegs(g, 1, 1, 3)));
    ok("at the goal -> walk direct", planLegs(g, 140, 1, 3).length === 0, JSON.stringify(planLegs(g, 140, 1, 3)));
    ok("unreachable goal -> walk direct", planLegs(g, 1, 1, 4).length === 0, JSON.stringify(planLegs(g, 1, 1, 4)));
    const far = planLegs(g, -500, -500, 3);
    ok("far from every node still starts at the nearest", far[0] === 0, JSON.stringify(far));
    const empty = buildGraph([], [], 150);
    ok("empty graph -> walk direct", planLegs(empty, 0, 0, 0).length === 0);
}

console.log("where on the route a bot starts (routeStart):");
{
    const g = buildGraph(xs, zs, 150);
    penalize(g, 0, 3, 8);
    // Route to 3 round the bay is [0,1,2]. At (2, 60) the nearest node is 0,
    // but the bot is already 60 m up the 140 m link to 1.
    const path = planLegs(g, 2, 60, 3);
    ok("route starts at the nearest node", path[0] === 0, JSON.stringify(path));
    ok("past node 0 on the way to 1 -> start at 1", routeStart(g, path, 3, 2, 60, -1) === 1);
    ok("standing on node 0 -> start at 0", routeStart(g, path, 3, 0, 0, -1) === 0);
    ok("behind node 0 -> start at 0", routeStart(g, path, 3, 0, -40, -1) === 0);
    ok("current waypoint still on the route is kept", routeStart(g, path, 3, 0, -40, 2) === 2);
    ok("current waypoint off the route is ignored", routeStart(g, path, 3, 2, 60, 4) === 1);
    // One-node route: past it toward the goal means walk to the goal.
    ok("past the only node -> 1 (walk to goal)", routeStart(g, [1], 2, 100, 140, -1) === 1);
    ok("empty route -> 0", routeStart(g, [], 3, 0, 0, -1) === 0);
}

console.log("penalties are capped and report no change at the cap:");
{
    const g = buildGraph(xs, zs, 150);
    ok("fresh link costs x1", linkPenalty(g, 0, 3) === 1);
    let p = 1;
    for (let i = 0; i < 10; i++) {
        p = penalize(g, 0, 3, 8);
    }
    ok("capped", p === NAV_PENALTY_CAP, String(p));
    const before = linkPenalty(g, 0, 3);
    ok("penalizing a capped link returns the same value", penalize(g, 0, 3, 8) === before);
}

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
