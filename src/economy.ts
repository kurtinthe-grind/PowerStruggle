import { Events } from "bf6-portal-utils/events";
import { log, safe, invokeSubscriber } from "./util/log";
import { PRESTIGE_ON_DEPLOY } from "./config";
import { pPrestige } from "./state";

export type PrestigeListener = (id: number, total: number, gained: number) => void;

const listeners: PrestigeListener[] = [];

export function onPrestige(fn: PrestigeListener): void {
    listeners.push(fn);
}

function fire(id: number, total: number, gained: number): void {
    for (const fn of listeners) {
        invokeSubscriber(fn, id, total, gained, undefined, "economy.prestige");
    }
}

export function prestigeOf(id: number): number {
    const v: number | undefined = pPrestige[id];
    return v === undefined ? 0 : v;
}

export function addPrestige(id: number, delta: number): void {
    const before: number = prestigeOf(id);
    const after: number = before + delta < 0 ? 0 : before + delta;
    if (after === before) {
        return;
    }
    pPrestige[id] = after;
    log("economy", "prestige " + id + " " + before + " -> " + after);
    fire(id, after, after - before);
}

export function spendPrestige(id: number, cost: number): boolean {
    if (cost <= 0) {
        return true;
    }
    if (prestigeOf(id) < cost) {
        return false;
    }
    addPrestige(id, -cost);
    return true;
}

export function canAfford(id: number, cost: number): boolean {
    return prestigeOf(id) >= cost;
}

// Kill, assist, death and capture payouts live in stats.ts so that the
// self-kill and redeploy filters can run before anything is awarded. Only the
// deploy bonus is handled here.
export function configureEconomyEvents(): void {
    Events.OnPlayerDeployed.subscribe((p: mod.Player) => {
        safe("eco.deploy", () => {
            if (PRESTIGE_ON_DEPLOY > 0) {
                addPrestige(mod.GetObjId(p), PRESTIGE_ON_DEPLOY);
            }
        });
    });
}
