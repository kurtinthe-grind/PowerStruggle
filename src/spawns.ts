import { Events } from "bf6-portal-utils/events";
import { log, safe } from "./util/log";
import { BUNKERS, isConfigured, BunkerDef } from "./objids";
import { teamNumOf } from "./teams";

const deployed: { [defId: string]: boolean } = {};

function enableDeploying(def: BunkerDef, on: boolean): void {
    if (!isConfigured(def.capturePointId)) {
        return;
    }
    const cp: mod.CapturePoint = mod.GetCapturePoint(def.capturePointId);
    if (cp === undefined) {
        log("spawns", def.id + " capture point " + def.capturePointId + " did not resolve");
        return;
    }
    try {
        mod.EnableCapturePointDeploying(cp, on);
        log("spawns", def.id + " deploying=" + String(on));
    } catch (e) {
        log("spawns", def.id + " enable failed: " + String(e));
    }
}

export function initSpawns(): void {
    let any: number = 0;
    for (const def of BUNKERS) {
        if (!isConfigured(def.capturePointId)) {
            log("spawns", "skip " + def.id + " (CapturePoint id 0 - unconfigured)");
            continue;
        }
        any++;
        enableDeploying(def, true);
    }
    if (any === 0) {
        log("spawns", "no bunkers configured - native deploy mode idle");
        return;
    }
    try {
        mod.SetSpawnMode(mod.SpawnModes.Deploy);
        log("spawns", "spawn mode = Deploy across " + any + " bunker(s)");
    } catch (e) {
        log("spawns", "SetSpawnMode failed: " + String(e));
    }
}

export function onBunkerOwnerChanged(def: BunkerDef, owner: number): void {
    if (deployed[def.id] === undefined) {
        deployed[def.id] = true;
    }
    if (owner === 1 || owner === 2) {
        log("spawns", def.id + " now available to team " + owner);
    } else {
        log("spawns", def.id + " neutral - spawns unavailable");
    }
}

export function refreshSpawnAvailability(): void {
    for (const def of BUNKERS) {
        if (isConfigured(def.capturePointId)) {
            enableDeploying(def, true);
        }
    }
}

export function configureSpawnEvents(): void {
    Events.OnPlayerJoinGame.subscribe(() => {
        safe("spawn.join", () => { refreshSpawnAvailability(); });
    });
}

export function currentOwnerOfCapturePoint(cpId: number): number {
    if (!isConfigured(cpId)) {
        return 0;
    }
    try {
        return teamNumOf(mod.GetCurrentOwnerTeam(mod.GetCapturePoint(cpId)));
    } catch (e) {
        return 0;
    }
}
