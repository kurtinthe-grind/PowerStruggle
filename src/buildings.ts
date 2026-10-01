import { Events } from "bf6-portal-utils/events";
import { log, safe, invokeSubscriber } from "./util/log";
import { BUNKERS, isConfigured, BunkerDef } from "./objids";
import { teamNumOf } from "./teams";
import { BUNKER_CAPTURE_SECONDS, BUNKER_NEUTRALIZE_SECONDS, BUNKER_CAPTURE_MULTIPLIER } from "./config";

export interface BunkerState {
    def: BunkerDef;
    capturePoint: mod.CapturePoint;
    owner: number;
}

const byCapturePoint: { [cpId: number]: BunkerState } = {};
const bunkers: BunkerState[] = [];

export type BunkerListener = (
    def: BunkerDef,
    newOwner: number,
    prevOwner: number,
    capturePoint: mod.CapturePoint
) => void;

const listeners: BunkerListener[] = [];

export function onBunkerCaptured(fn: BunkerListener): void {
    listeners.push(fn);
}

function fire(def: BunkerDef, owner: number, prevOwner: number, cp: mod.CapturePoint): void {
    for (const fn of listeners) {
        invokeSubscriber(fn, def, owner, prevOwner, cp, "bunker." + def.id);
    }
}

export function initBuildings(): void {
    for (const def of BUNKERS) {
        if (!isConfigured(def.capturePointId)) {
            log("buildings", "skip " + def.id + " (CapturePoint id 0 - unconfigured)");
            continue;
        }
        const capturePoint: mod.CapturePoint = mod.GetCapturePoint(def.capturePointId);
        if (!mod.IsValid(capturePoint)) {
            log("buildings", "FAIL " + def.id + " cp=" + def.capturePointId + " did not resolve");
            continue;
        }
        const st: BunkerState = { def: def, capturePoint: capturePoint, owner: 0 };
        bunkers.push(st);
        byCapturePoint[def.capturePointId] = st;
        configureObjective(capturePoint, def.id);
        log("buildings", "bound " + def.id + " cp=" + def.capturePointId);
    }
    if (bunkers.length === 0) {
        log("buildings", "no bunkers configured - native capture path idle");
    }
}

// A CapturePoint stays inert until the game mode objective is enabled: without
// this the engine never reports OnCapturePointCaptured and GetCurrentOwnerTeam
// stays 0. Tier 0 index.d.ts:33310 and the official template
// mods_original/_StartHere_BasicTemplate/BasicTemplate.ts:72 both call it.
function configureObjective(cp: mod.CapturePoint, defId: string): void {
    safe("buildings.objective", () => {
        mod.EnableGameModeObjective(cp, true);
        mod.SetCapturePointCapturingTime(cp, BUNKER_CAPTURE_SECONDS);
        mod.SetCapturePointNeutralizationTime(cp, BUNKER_NEUTRALIZE_SECONDS);
        mod.SetMaxCaptureMultiplier(cp, BUNKER_CAPTURE_MULTIPLIER);
        mod.EnableCapturePointDeploying(cp, true);
        log("buildings", defId + " objective enabled"
            + " cap=" + String(BUNKER_CAPTURE_SECONDS)
            + " mult=" + String(BUNKER_CAPTURE_MULTIPLIER));
    });
}

export function applyOwner(cp: mod.CapturePoint, owner: number): void {
    let st: BunkerState | undefined = byCapturePoint[mod.GetObjId(cp)];
    if (st === undefined) {
        for (const candidate of bunkers) {
            if (mod.Equals(cp, candidate.capturePoint)) {
                st = candidate;
                break;
            }
        }
    }
    if (!st) {
        log("buildings", "UNMATCHED capture-point event cp=" + mod.GetObjId(cp));
        return;
    }
    const normalizedOwner: number = owner === 1 || owner === 2 ? owner : 0;
    if (st.owner === normalizedOwner) {
        return;
    }
    const prevOwner: number = st.owner;
    st.owner = normalizedOwner;
    log("buildings", st.def.id + " owner -> " + normalizedOwner);
    fire(st.def, normalizedOwner, prevOwner, st.capturePoint);
}

export function syncBunkerOwners(): void {
    for (const st of bunkers) {
        safe("buildings.owner", () => {
            const owner: number = teamNumOf(mod.GetCurrentOwnerTeam(st.capturePoint));
            if (owner !== st.owner) {
                applyOwner(st.capturePoint, owner);
            }
        });
    }
}

export function bunkerByCp(cpId: number): BunkerState | undefined {
    return byCapturePoint[cpId];
}

export function bunkerById(defId: string): BunkerState | undefined {
    for (const st of bunkers) {
        if (st.def.id === defId) {
            return st;
        }
    }
    return undefined;
}

export function allBunkers(): BunkerState[] {
    return bunkers;
}

export function configureBuildingEvents(): void {
    Events.OnCapturePointCaptured.subscribe((cp: mod.CapturePoint) => {
        safe("cp.captured", () => {
            applyOwner(cp, teamNumOf(mod.GetCurrentOwnerTeam(cp)));
        });
    });
    Events.OnCapturePointLost.subscribe((cp: mod.CapturePoint) => {
        safe("cp.lost", () => { applyOwner(cp, 0); });
    });
}
