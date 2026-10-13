import { log } from "./util/log";
import { PERF_LINE_MS } from "./config";
import { smoothedTickRate } from "./util/perf";
import { allPlayers } from "./util/roster";
import { botLiveCount, botRosterSize, isBotPid } from "./bots";
import { rorschCarrierCount, rorschOnGround } from "./rorschammo";
import { nukeFxCounts } from "./nukefx";
import { takeStats } from "./rocketsites/fx";
import { airborneAll } from "./rocketsites/rocket";

// One [perf] line every PERF_LINE_MS: the engine's own frame times (DICE's
// PortalPerformanceExample marks Portal > 3 ms and server > 20 ms as bad),
// the tick rate, and the counts most likely to climb before a crash. Changes
// nothing in game; it shows what each optimisation buys.
let nextAt: number = 0;

export function tickPerfLine(nowMs: number): void {
    if (nowMs < nextAt) {
        return;
    }
    const first: boolean = nextAt === 0;
    nextAt = nowMs + PERF_LINE_MS;
    if (first) {
        return;
    }
    let portalMs: number = -1;
    let serverMs: number = -1;
    try {
        portalMs = mod.GetPortalAverageFrameTime();
        serverMs = mod.GetServerAverageFrameTime();
    } catch (e) {
    }
    let humans: number = 0;
    let soldiers: number = 0;
    for (const p of allPlayers()) {
        soldiers++;
        try {
            if (!isBotPid(mod.GetObjId(p))) {
                humans++;
            }
        } catch (e) {
        }
    }
    let vehicles: number = -1;
    try {
        vehicles = mod.CountOf(mod.GetAllVehicles());
    } catch (e) {
    }
    const sites = takeStats();
    log("perf", "portal " + portalMs.toFixed(2) + " ms, server " + serverMs.toFixed(2) + " ms, "
        + smoothedTickRate().toFixed(1) + " Hz | players " + soldiers + " (" + humans + " human), bots alive "
        + botLiveCount(1) + "/" + botLiveCount(2) + " of " + botRosterSize() + " | vehicles " + vehicles
        + " | rorsch " + rorschCarrierCount() + " carried, " + rorschOnGround() + " on the ground | nuke "
        + nukeFxCounts() + " | sites: " + sites.transforms + " moves, " + sites.liveVfx + " effects, "
        + airborneAll() + " rockets");
}
