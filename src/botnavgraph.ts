// Navigation graph for bots, kept free of mod.* so scripts/test-botnav.js can
// unit-test it in node.
//
// Nodes are the map's navigation waypoints followed by the objectives. Two
// nodes are linked when they are within linkM of each other (horizontal), so the
// map maker only places points and never draws links. Each link carries a cost
// multiplier that starts at 1 and grows when bots have trouble on it (swimming,
// getting stuck), so the whole population learns to route around a bad link.

export interface NavGraph {
    count: number;
    xs: number[];
    zs: number[];
    adj: number[][];
    // Link cost multiplier keyed by linkKey(a, b), absent means 1.
    pen: { [key: number]: number };
}

export const NAV_PENALTY_CAP: number = 100;

export function linkKey(a: number, b: number): number {
    return a < b ? a * 4096 + b : b * 4096 + a;
}

export function buildGraph(xs: number[], zs: number[], linkM: number): NavGraph {
    const n: number = xs.length;
    const adj: number[][] = [];
    for (let i: number = 0; i < n; i++) {
        adj.push([]);
    }
    const maxSq: number = linkM * linkM;
    for (let i: number = 0; i < n; i++) {
        for (let j: number = i + 1; j < n; j++) {
            const dx: number = xs[i] - xs[j];
            const dz: number = zs[i] - zs[j];
            if (dx * dx + dz * dz <= maxSq) {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }
    return { count: n, xs: xs, zs: zs, adj: adj, pen: {} };
}

function dist(g: NavGraph, a: number, b: number): number {
    const dx: number = g.xs[a] - g.xs[b];
    const dz: number = g.zs[a] - g.zs[b];
    return Math.sqrt(dx * dx + dz * dz);
}

export function linkCost(g: NavGraph, a: number, b: number): number {
    const p: number | undefined = g.pen[linkKey(a, b)];
    return dist(g, a, b) * (p === undefined ? 1 : p);
}

// A link's current cost multiplier, 1 when it was never penalized.
export function linkPenalty(g: NavGraph, a: number, b: number): number {
    const p: number | undefined = g.pen[linkKey(a, b)];
    return p === undefined ? 1 : p;
}

// Multiplies a link's cost. Returns the new multiplier.
export function penalize(g: NavGraph, a: number, b: number, factor: number): number {
    const k: number = linkKey(a, b);
    const cur: number = g.pen[k] === undefined ? 1 : g.pen[k];
    const next: number = Math.min(cur * factor, NAV_PENALTY_CAP);
    g.pen[k] = next;
    return next;
}

// Cheapest path from start to goal, both inclusive, or [] when unreachable.
// A* with the straight-line distance as heuristic; the graph is a few hundred
// nodes at most, so a linear scan of the open set is fine.
export function findRoute(g: NavGraph, start: number, goal: number): number[] {
    if (start < 0 || goal < 0 || start >= g.count || goal >= g.count) {
        return [];
    }
    if (start === goal) {
        return [start];
    }
    const gScore: number[] = [];
    const fScore: number[] = [];
    const from: number[] = [];
    const open: boolean[] = [];
    const closed: boolean[] = [];
    for (let i: number = 0; i < g.count; i++) {
        gScore.push(Infinity);
        fScore.push(Infinity);
        from.push(-1);
        open.push(false);
        closed.push(false);
    }
    gScore[start] = 0;
    fScore[start] = dist(g, start, goal);
    open[start] = true;
    let openCount: number = 1;
    while (openCount > 0) {
        let cur: number = -1;
        for (let i: number = 0; i < g.count; i++) {
            if (open[i] && (cur < 0 || fScore[i] < fScore[cur])) {
                cur = i;
            }
        }
        if (cur === goal) {
            const path: number[] = [];
            let at: number = goal;
            while (at >= 0) {
                path.unshift(at);
                at = from[at];
            }
            return path;
        }
        open[cur] = false;
        openCount--;
        closed[cur] = true;
        for (const nb of g.adj[cur]) {
            if (closed[nb]) {
                continue;
            }
            const tentative: number = gScore[cur] + linkCost(g, cur, nb);
            if (tentative < gScore[nb]) {
                from[nb] = cur;
                gScore[nb] = tentative;
                fScore[nb] = tentative + dist(g, nb, goal);
                if (!open[nb]) {
                    open[nb] = true;
                    openCount++;
                }
            }
        }
    }
    return [];
}

// Nearest node with index below limit (pass g.count for any node), or -1.
export function nearestNode(g: NavGraph, x: number, z: number, limit: number): number {
    let best: number = -1;
    let bestSq: number = 0;
    const n: number = Math.min(limit, g.count);
    for (let i: number = 0; i < n; i++) {
        const dx: number = g.xs[i] - x;
        const dz: number = g.zs[i] - z;
        const dSq: number = dx * dx + dz * dz;
        if (best < 0 || dSq < bestSq) {
            best = i;
            bestSq = dSq;
        }
    }
    return best;
}

// Route for a bot at (x, z) to node goal: the nodes to walk through in order,
// goal excluded (the bot walks to the objective itself last), starting at the
// node nearest the bot. [] means walk direct. Where on the route to start is
// routeStart's job.
export function planLegs(g: NavGraph, x: number, z: number, goal: number): number[] {
    const start: number = nearestNode(g, x, z, g.count);
    if (start < 0 || start === goal) {
        return [];
    }
    const path: number[] = findRoute(g, start, goal);
    if (path.length < 2) {
        return [];
    }
    path.pop();
    return path;
}

function distSqTo(g: NavGraph, node: number, x: number, z: number): number {
    const dx: number = g.xs[node] - x;
    const dz: number = g.zs[node] - z;
    return dx * dx + dz * dz;
}

// Index into path (from planLegs, toward goal) of the node a bot at (x, z)
// should walk to first:
//   - the index of curLeg, the node it is already walking to, when that is
//     still on the route, so a re-plan never turns a bot around mid-link;
//   - 1 when the bot is already past path[0], that is nearer to the next node
//     than path[0] itself is (halfway along the first link, path[0] is behind
//     it); the bot is then on the link path[0] - next;
//   - 0 otherwise.
// The old rule, "nearer to path[1] than to path[0]", could never hold because
// path[0] is the node nearest the bot, so bots walked back to it.
export function routeStart(g: NavGraph, path: number[], goal: number, x: number, z: number, curLeg: number): number {
    if (path.length === 0) {
        return 0;
    }
    if (curLeg >= 0) {
        const at: number = path.indexOf(curLeg);
        if (at >= 0) {
            return at;
        }
    }
    const next: number = path.length >= 2 ? path[1] : goal;
    if (next < 0 || next >= g.count) {
        return 0;
    }
    const first: number = path[0];
    const dx: number = g.xs[next] - g.xs[first];
    const dz: number = g.zs[next] - g.zs[first];
    return distSqTo(g, next, x, z) < dx * dx + dz * dz ? 1 : 0;
}

// Nodes with no link at all, for the placement report.
export function isolatedNodes(g: NavGraph, limit: number): number[] {
    const out: number[] = [];
    for (let i: number = 0; i < Math.min(limit, g.count); i++) {
        if (g.adj[i].length === 0) {
            out.push(i);
        }
    }
    return out;
}
