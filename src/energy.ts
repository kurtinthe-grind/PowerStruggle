import { log, safe } from "./util/log";
import { siteState } from "./state";
import { buildingsOfKind, BuildingState, onCaptured } from "./capture";
import { AreaBuildingDef } from "./objids";
import { CHARGE_PER_SITE } from "./config";

const SITE_SLOTS: number = 3;

export function energySitesHeld(team: number): number {
    const sites: BuildingState[] = buildingsOfKind("energy");
    if (sites.length === 0) {
        const st: number[] = siteState[team] || [];
        let n: number = 0;
        for (let i: number = 0; i < SITE_SLOTS; i++) {
            if (st[i] === team) {
                n++;
            }
        }
        return n;
    }
    let n: number = 0;
    for (const s of sites) {
        if (s.owner === team) {
            n++;
        }
    }
    return n;
}

export function energyMultiplier(team: number): number {
    const held: number = energySitesHeld(team);
    if (held <= 0) {
        return 0;
    }
    return held * CHARGE_PER_SITE;
}

export function initEnergy(): void {
    const sites: BuildingState[] = buildingsOfKind("energy");
    log("energy", "energy sites bound: " + sites.length);
    onCaptured((def: AreaBuildingDef, owner: number) => {
        if (def.kind === "energy") {
            safe("energy.capture", () => {
                log("energy", def.id + " -> team " + owner + " (mult now " + energyMultiplier(owner) + ")");
            });
        }
    });
}
