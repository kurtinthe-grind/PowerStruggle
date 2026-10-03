import { log } from "./util/log";
import { NAV_WAYPOINT_FIRST_ID, NAV_WAYPOINT_LAST_ID } from "./objids";
import {
    BOT_NAV_LINK_M, BOT_NAV_MISS_STOP, BOT_NAV_SHOW, BOT_TRACE
} from "./config";
import { objectiveCount, objectiveLabel, objectiveX, objectiveY, objectiveZ } from "./botobjectives";
import { buildGraph, isolatedNodes, linkPenalty, NavGraph, penalize, planLegs, routeStart } from "./botnavgraph";
import { NAV_POINTS } from "./navpoints";
import { Vectors } from "bf6-portal-utils/vectors";

// Navigation waypoints placed by the map maker, ObjIds
// NAV_WAYPOINT_FIRST_ID..NAV_WAYPOINT_LAST_ID, on walkable ground where the
// engine's own pathing is poor. Any object with a position will do: PS_Isolated
// uses tiny props (AmmoChest_Small_Int_01 scaled to 0.001). Waypoints and
// objectives together form one graph (botnavgraph.ts); a bot walking to a far
// objective follows the cheapest route through it, one waypoint at a time.
//
// Positions come from NAV_POINTS, generated at build time from the exported map
// (scripts/gen-navpoints.js). In the 2026-10-02 playtest the props never
// resolved at runtime (GetSpatialObject returned invalid for all 14), so the
// runtime lookup is only a fallback for a build without the map file; a
// WorldIcon found that way is hidden at start unless BOT_NAV_SHOW.
//
// With no waypoints at all the whole module is inert and bots walk direct.
//
// Cost model: the table costs no FFI; the fallback scan runs once at init.
// Routing is plain JS.

let graph: NavGraph | undefined;
let waypointCount: number = 0;
const nodeVec: mod.Vector[] = [];
const waypointId: number[] = [];
// Bumped whenever a link penalty changes, so every bot re-plans.
let version: number = 0;

export function navActive(): boolean {
    return graph !== undefined && waypointCount > 0;
}

export function navVersion(): number {
    return version;
}

// Fallback when the build had no map file: look the waypoints up by ObjId.
function scanWaypoints(xs: number[], zs: number[]): void {
    let misses: number = 0;
    for (let id: number = NAV_WAYPOINT_FIRST_ID; id <= NAV_WAYPOINT_LAST_ID; id++) {
        let obj: mod.Object | undefined = undefined;
        let icon: mod.WorldIcon | undefined = undefined;
        let why: string = "";
        try {
            const so: mod.SpatialObject = mod.GetSpatialObject(id);
            if (mod.IsValid(so)) {
                obj = so;
            } else {
                why = "SpatialObject invalid";
            }
        } catch (e) {
            why = "SpatialObject threw " + String(e);
        }
        if (obj === undefined) {
            try {
                const wi: mod.WorldIcon = mod.GetWorldIcon(id);
                if (mod.IsValid(wi)) {
                    icon = wi;
                    obj = wi;
                } else {
                    why += ", WorldIcon invalid";
                }
            } catch (e) {
                why += ", WorldIcon threw " + String(e);
            }
        }
        if (obj === undefined) {
            if (id === NAV_WAYPOINT_FIRST_ID) {
                log("nav", "ObjId " + id + " did not resolve: " + why);
            }
            // Waypoints are numbered from the first id upward; a long gap means
            // there are no more, so the scan does not probe 200 empty ids.
            misses++;
            if (misses >= BOT_NAV_MISS_STOP) {
                break;
            }
            continue;
        }
        misses = 0;
        try {
            const pos: mod.Vector = mod.GetObjectPosition(obj);
            const v: Vectors.Vector3 = Vectors.toVector3(pos);
            xs.push(v.x);
            zs.push(v.z);
            nodeVec.push(pos);
            waypointId.push(id);
            if (icon !== undefined && !BOT_NAV_SHOW) {
                mod.EnableWorldIconImage(icon, false);
                mod.EnableWorldIconText(icon, false);
            }
        } catch (e) {
            log("nav", "waypoint " + id + " failed: " + String(e));
        }
    }
}

export function initNav(): void {
    const xs: number[] = [];
    const zs: number[] = [];
    let source: string = "map file";
    for (let i: number = 0; i + 3 < NAV_POINTS.length; i += 4) {
        waypointId.push(NAV_POINTS[i]);
        xs.push(NAV_POINTS[i + 1]);
        zs.push(NAV_POINTS[i + 3]);
        nodeVec.push(mod.CreateVector(NAV_POINTS[i + 1], NAV_POINTS[i + 2], NAV_POINTS[i + 3]));
    }
    if (xs.length === 0) {
        source = "runtime lookup";
        scanWaypoints(xs, zs);
    }
    waypointCount = xs.length;
    if (waypointCount === 0) {
        log("nav", "no waypoints (ObjId " + NAV_WAYPOINT_FIRST_ID + "-" + NAV_WAYPOINT_LAST_ID
            + ") - bots walk direct");
        return;
    }
    const n: number = objectiveCount();
    for (let i: number = 0; i < n; i++) {
        xs.push(objectiveX(i));
        zs.push(objectiveZ(i));
        nodeVec.push(mod.CreateVector(objectiveX(i), objectiveY(i), objectiveZ(i)));
    }
    const g: NavGraph = buildGraph(xs, zs, BOT_NAV_LINK_M);
    graph = g;
    let links: number = 0;
    for (let i: number = 0; i < g.count; i++) {
        links += g.adj[i].length;
    }
    log("nav", "graph: " + waypointCount + " waypoints (" + source + ") + " + n + " objectives, "
        + String(links / 2) + " links (" + BOT_NAV_LINK_M + " m)");
    // Placement report: anything that cannot be reached from the rest.
    const lonely: number[] = isolatedNodes(g, waypointCount);
    if (lonely.length > 0) {
        const ids: string[] = [];
        for (const i of lonely) {
            ids.push(String(waypointId[i]));
        }
        log("nav", "waypoints with no neighbour within " + BOT_NAV_LINK_M + " m: " + ids.join(", "));
    }
    for (let i: number = 0; i < n; i++) {
        let toWaypoint: boolean = false;
        for (const nb of g.adj[waypointCount + i]) {
            if (nb < waypointCount) {
                toWaypoint = true;
                break;
            }
        }
        if (!toWaypoint) {
            log("nav", objectiveLabel(i) + " has no waypoint within " + BOT_NAV_LINK_M + " m");
        }
    }
}

// Graph node of an objective.
export function objectiveNode(idx: number): number {
    return waypointCount + idx;
}

export function isWaypoint(node: number): boolean {
    return node >= 0 && node < waypointCount;
}

// The nodes to walk through to reach objective idx, objective excluded; []
// means walk direct.
export function routeTo(idx: number, x: number, z: number): number[] {
    if (graph === undefined || waypointCount === 0) {
        return [];
    }
    return planLegs(graph, x, z, objectiveNode(idx));
}

// Where on route (from routeTo, toward objective idx) a bot at (x, z) starts;
// see botnavgraph.routeStart. curLeg is the waypoint it is walking to, or -1.
export function routeStartAt(route: number[], idx: number, x: number, z: number, curLeg: number): number {
    if (graph === undefined) {
        return 0;
    }
    return routeStart(graph, route, objectiveNode(idx), x, z, curLeg);
}

export function nodeVector(node: number): mod.Vector {
    return nodeVec[node];
}

export function nodeDistSq(node: number, x: number, z: number): number {
    if (graph === undefined) {
        return Infinity;
    }
    const dx: number = graph.xs[node] - x;
    const dz: number = graph.zs[node] - z;
    return dx * dx + dz * dz;
}

function nodeName(node: number): string {
    return isWaypoint(node) ? "wp" + String(waypointId[node]) : objectiveLabel(node - waypointCount);
}

// A bot had trouble on the link a -> b (swam, got stuck). Every bot pays more
// for it from now on, and all routes are re-planned.
export function penalizeLink(a: number, b: number, factor: number, why: string): void {
    if (graph === undefined || a < 0 || b < 0) {
        return;
    }
    const before: number = linkPenalty(graph, a, b);
    const p: number = penalize(graph, a, b, factor);
    if (p === before) {
        // Already at the cap: nothing changed, so nobody needs to re-plan.
        return;
    }
    version++;
    if (BOT_TRACE) {
        log("nav", "link " + nodeName(a) + " - " + nodeName(b) + " x" + String(Math.round(p)) + " (" + why + ")");
    }
}

// A random waypoint within maxM of (x, z) but at least minM away, for
// roaming, or -1. seed picks among the candidates so different bots spread
// out; minM keeps a bot from picking the waypoint it is standing on.
export function roamWaypoint(x: number, z: number, minM: number, maxM: number, seed: number): number {
    if (graph === undefined) {
        return -1;
    }
    const maxSq: number = maxM * maxM;
    const minSq: number = minM * minM;
    let n: number = 0;
    for (let i: number = 0; i < waypointCount; i++) {
        const dSq: number = nodeDistSq(i, x, z);
        if (dSq <= maxSq && dSq >= minSq) {
            n++;
        }
    }
    if (n === 0) {
        return -1;
    }
    let at: number = Math.floor(seed * n);
    if (at >= n) {
        at = n - 1;
    }
    for (let i: number = 0; i < waypointCount; i++) {
        const dSq: number = nodeDistSq(i, x, z);
        if (dSq <= maxSq && dSq >= minSq) {
            if (at === 0) {
                return i;
            }
            at--;
        }
    }
    return -1;
}
