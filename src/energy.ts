import { log, safe } from "./util/log";
import { siteState } from "./state";
import { buildingsOfKind, BuildingState, onCaptured } from "./capture";
import { AreaBuildingDef } from "./objids";
import { CHARGE_MINUTES_BY_SITES } from "./config";

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

// Charge speed in percent per second for a team holding the Prototype Factory.
export function chargePercentPerSec(team: number): number {
    const held: number = energySitesHeld(team);
    const last: number = CHARGE_MINUTES_BY_SITES.length - 1;
    const minutes: number = CHARGE_MINUTES_BY_SITES[held < last ? held : last];
    if (!(minutes > 0)) {
        return 0;
    }
    return 100 / (minutes * 60);
}

export function initEnergy(): void {
    const sites: BuildingState[] = buildingsOfKind("energy");
    log("energy", "energy sites bound: " + sites.length);
    onCaptured((def: AreaBuildingDef, owner: number) => {
        if (def.kind === "energy") {
            safe("energy.capture", () => {
                log("energy", def.id + " -> team " + owner + " (" + energySitesHeld(owner) + " sites, charge " + chargePercentPerSec(owner).toFixed(3) + "%/s with the factory)");
            });
        }
    });
}
