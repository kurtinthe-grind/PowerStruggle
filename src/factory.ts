import { log, invokeSubscriber } from "./util/log";
import {
    CHARGE_BASE_SECONDS, CHARGE_REQUIRES_FACTORY, CHARGE_UNLOCK_50, CHARGE_UNLOCK_100,
    POWER_MILESTONES
} from "./config";
import { powerVal } from "./state";
import { buildingsOfKind, BuildingState, onCaptured } from "./capture";
import { energyMultiplier } from "./energy";
import { AreaBuildingDef } from "./objids";

export type ChargeListener = (team: number, before: number, after: number) => void;

const listeners: ChargeListener[] = [];

// Fired whenever banked charge moves so the HUD can repaint and milestones can
// be announced. The charge itself advances here every frame, so nothing else
// in the codebase would notice it.
export function onCharge(fn: ChargeListener): void {
    listeners.push(fn);
}

function fireCharge(team: number, before: number, after: number): void {
    for (const fn of listeners) {
        invokeSubscriber(fn, team, before, after, undefined, "factory.charge");
    }
}

// The set of buildings is frozen after initCapture, so the proto owner and the
// per-team charge rate only change when an objective flips. They are recomputed
// on capture instead of being re-derived from buildingsOfKind on every tick.
let cachedOwner: number = -1;
const rateCache: { [t: number]: number } = { 1: 0, 2: 0 };

function refreshCaches(): void {
    cachedOwner = 0;
    for (const s of buildingsOfKind("proto")) {
        if (s.owner === 1 || s.owner === 2) {
            cachedOwner = s.owner;
            break;
        }
    }
    rateCache[1] = computeRate(1);
    rateCache[2] = computeRate(2);
}

function computeRate(team: number): number {
    if (CHARGE_REQUIRES_FACTORY && cachedOwner !== team) {
        return 0;
    }
    const mult: number = energyMultiplier(team);
    if (mult <= 0) {
        return 0;
    }
    return mult / CHARGE_BASE_SECONDS * 100;
}

export function factoryOwner(): number {
    if (cachedOwner < 0) {
        refreshCaches();
    }
    return cachedOwner;
}

export function chargePercent(team: number): number {
    return powerVal[team];
}

export function chargeRatePerSec(team: number): number {
    if (cachedOwner < 0) {
        refreshCaches();
    }
    return rateCache[team] === undefined ? 0 : rateCache[team];
}

function crossedMilestone(before: number, after: number): boolean {
    if (Math.round(before) !== Math.round(after)) {
        return true;
    }
    for (const at of POWER_MILESTONES) {
        if (before < at && after >= at) {
            return true;
        }
    }
    return false;
}

// Driven from index.ts onOngoingGlobal so charge advances smoothly every frame
// instead of jumping in large steps from a separate timer.
export function tickCharge(dtSeconds: number): void {
    tick(dtSeconds);
}

function tick(dt: number): void {
    for (const team of [1, 2]) {
        const rate: number = chargeRatePerSec(team);
        if (rate <= 0) {
            continue;
        }
        const before: number = powerVal[team];
        let after: number = before + rate * dt;
        if (after > 100) {
            after = 100;
        }
        if (after === before) {
            continue;
        }
        powerVal[team] = after;
        const unlocked: boolean = before < CHARGE_UNLOCK_100 && after >= CHARGE_UNLOCK_100;
        // The fractional charge keeps advancing every tick, but firing the
        // listener on every frame meant SetScoreboardHeader ran at frame rate.
        // Only speak up when the displayed whole number moves or a milestone
        // (50/75/100) is crossed, so the scoreboard and the HUD stay in step.
        if (unlocked || crossedMilestone(before, after)) {
            fireCharge(team, before, after);
        }
    }
}

export function initFactory(): void {
    const f: BuildingState[] = buildingsOfKind("proto");
    log("factory", "proto factories bound: " + f.length);
    if (f.length === 0) {
        log("factory", "no proto factory configured - charge system idle");
        refreshCaches();
        return;
    }
    // Prime the owner/rate caches now that initCapture has populated the
    // building states, instead of relying on the first lazy read happening to
    // land after initialisation.
    refreshCaches();
    // Charge is advanced from onOngoingGlobal (see tickCharge).
    onCaptured((def: AreaBuildingDef, owner: number) => {
        if (def.kind === "proto" || def.kind === "energy") {
            // Either objective changes the rate, so the caches are rebuilt here
            // rather than per tick.
            refreshCaches();
        }
        if (def.kind === "proto") {
            log("factory", def.id + " -> team " + owner + " (rate " + chargeRatePerSec(owner) + "%/s)");
        }
    });
}

export function moacUnlocked(team: number): boolean {
    return chargePercent(team) >= CHARGE_UNLOCK_50;
}

export function nukeUnlocked(team: number): boolean {
    return chargePercent(team) >= CHARGE_UNLOCK_100;
}

export function shutdownFactory(): void {
    // No dedicated timer: charge is driven by tickCharge.
}
