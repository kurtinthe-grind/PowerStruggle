import { log, safe } from "./util/log";
import { Vectors } from "bf6-portal-utils/vectors";
import { isConfigured, BUNKERS, allAreaBuildings, HQ_TARGETS, AreaBuildingDef } from "./objids";
import { buildingById as captureById, BuildingState, onCaptured } from "./capture";
import { bunkerById, BunkerState, onBunkerCaptured } from "./buildings";

export type LocationState = "friendly" | "enemy" | "neutral" | "destroyed";

export interface StrategicLocation {
    // Stable index into the flat position array, assigned at registration.
    index: number;
    id: string;
    kind: string;
    label: string;
    state: LocationState;
    worldIconId: number;
    parentKind: "capturePoint" | "areaTrigger" | "spatial";
    parentId: number;
}

const locations: StrategicLocation[] = [];
const byId: { [id: string]: StrategicLocation } = {};

// Flat x,y,z per registered location. The parents are static map geometry, so
// resolving one inside distanceMeters cost an FFI call per menu row per
// location. A NaN triple marks a parent that failed to resolve.
const locXYZ: number[] = [];
const highlighted: { [pid: number]: string } = {};
const highlightIcons: { [pid: number]: mod.WorldIcon } = {};

export function highlightedFor(pid: number): string {
    const v: string | undefined = highlighted[pid];
    return v === undefined ? "" : v;
}

const ICON_BY_KIND: { [kind: string]: mod.WorldIconImages } = {
    bunker: mod.WorldIconImages.Flag,
    energy: mod.WorldIconImages.Bomb,
    proto: mod.WorldIconImages.Cross,
    war: mod.WorldIconImages.Alert,
    air: mod.WorldIconImages.Assist,
    naval: mod.WorldIconImages.DangerPing,
    hq: mod.WorldIconImages.Explosion
};

export function initWorldIcons(): void {
    for (const b of BUNKERS) {
        if (!isConfigured(b.capturePointId)) {
            continue;
        }
        addLocation(b.id, "bunker", b.worldIconId, "capturePoint", b.capturePointId);
    }
    for (const a of allAreaBuildings()) {
        if (!isConfigured(a.areaTriggerId)) {
            continue;
        }
        addLocation(a.id, a.kind, a.worldIconId, "areaTrigger", a.areaTriggerId);
    }
    for (const base of [0, 1]) {
        const t: number = HQ_TARGETS[base];
        if (isConfigured(t)) {
            addLocation("hq" + String(base + 1), "hq", 0, "spatial", t);
        }
    }
    log("worldicons", "strategic locations: " + locations.length);
    onCaptured((def: AreaBuildingDef, owner: number) => {
        safe("worldicons.capture", () => {
            refreshLocation(def.id, owner);
        });
    });
    onBunkerCaptured((def, owner) => {
        safe("worldicons.bunker", () => {
            refreshLocation(def.id, owner);
        });
    });
}

function addLocation(
    id: string,
    kind: string,
    worldIconId: number,
    parentKind: "capturePoint" | "areaTrigger" | "spatial",
    parentId: number
): void {
    if (byId[id] !== undefined) {
        return;
    }
    const loc: StrategicLocation = {
        index: locations.length,
        id: id,
        kind: kind,
        label: labelForId(id),
        state: "neutral",
        worldIconId: worldIconId,
        parentKind: parentKind,
        parentId: parentId
    };
    // One-time position snapshot for the distance read path. NaN marks a parent
    // that could not be resolved, which distanceMeters treats as unknown.
    const parent: mod.Object | undefined = resolveParent(loc);
    if (parent === undefined) {
        locXYZ.push(NaN, NaN, NaN);
    } else {
        try {
            const v: Vectors.Vector3 = Vectors.toVector3(mod.GetObjectPosition(parent));
            locXYZ.push(v.x, v.y, v.z);
        } catch (e) {
            locXYZ.push(NaN, NaN, NaN);
        }
    }
    locations.push(loc);
    byId[id] = loc;
}

function refreshLocation(id: string, owner: number): void {
    const loc: StrategicLocation | undefined = byId[id];
    if (!loc) {
        return;
    }
    loc.state = owner === 1 || owner === 2 ? "friendly" : "neutral";
}

// Reused scratch for toVector3. Passing no out param allocates a fresh Vector3
// on every call, and this runs once per tactical row per refresh.
const eyeScratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

// Straight-line metres from the player to the location's parent object.
export function distanceMeters(player: mod.Player, id: string): number {
    const loc: StrategicLocation | undefined = byId[id];
    if (!loc) {
        return -1;
    }
    // The parent position was snapshotted at registration, so this no longer
    // resolves the object or reads its position. Only the player's eye position
    // is read, once per row.
    const base: number = loc.index * 3;
    const bx: number = locXYZ[base];
    if (bx !== bx) {
        // NaN sentinel: the parent never resolved at registration.
        return -1;
    }
    // Scratch reused across calls. toVector3 allocates a fresh Vector3 when no
    // out param is given, and this runs once per tactical row per refresh, so
    // the single reusable object avoids that garbage.
    try {
        const a: Vectors.Vector3 = Vectors.toVector3(
            mod.GetSoldierState(player, mod.SoldierStateVector.EyePosition), eyeScratch);
        const dx: number = a.x - bx;
        const dy: number = a.y - locXYZ[base + 1];
        const dz: number = a.z - locXYZ[base + 2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    } catch (e) {
        return -1;
    }
}

export function stateFor(viewer: number, id: string): LocationState {
    const loc: StrategicLocation | undefined = byId[id];
    if (!loc) {
        return "neutral";
    }
    let owner: number = 0;
    const bunker: BunkerState | undefined = bunkerById(id);
    if (bunker !== undefined) {
        owner = bunker.owner;
    } else {
        const st: BuildingState | undefined = captureById(id);
        if (st !== undefined) {
            owner = st.owner;
        }
    }
    if (owner === 0) {
        return "neutral";
    }
    if (viewer === 0) {
        return owner === 1 ? "friendly" : "enemy";
    }
    return owner === viewer ? "friendly" : "enemy";
}

export function highlightFor(player: mod.Player, locationId: string): void {
    const id: number = mod.GetObjId(player);
    if (id < 0) {
        return;
    }
    const prev: string | undefined = highlighted[id];
    if (prev !== undefined && prev === locationId) {
        clearHighlight(player);
        return;
    }
    if (prev !== undefined) {
        clearHighlight(player);
    }
    const loc: StrategicLocation | undefined = byId[locationId];
    if (!loc) {
        return;
    }
    const parent: mod.Object | undefined = resolveParent(loc);
    if (parent === undefined) {
        log("worldicons", "no parent for " + loc.id + " objId=" + loc.parentId);
        return;
    }
    const added: boolean = safe("worldicons.highlight", () => {
        let position: mod.Vector = mod.GetObjectPosition(parent);
        if (isConfigured(loc.worldIconId)) {
            const baseIcon: mod.WorldIcon = mod.GetWorldIcon(loc.worldIconId);
            if (mod.IsValid(baseIcon)) {
                position = mod.GetObjectPosition(baseIcon);
            }
        }
        position = mod.Add(position, mod.CreateVector(0, 4, 0));
        const icon: mod.WorldIcon = mod.SpawnObject(
            mod.RuntimeSpawn_Common.WorldIcon,
            position,
            mod.CreateVector(0, 0, 0),
            mod.CreateVector(1, 1, 1)
        ) as mod.WorldIcon;
        if (!mod.IsValid(icon)) {
            log("worldicons", "spawn failed for " + loc.id);
            return;
        }
        mod.SetWorldIconOwner(icon, player);
        mod.SetWorldIconImage(icon, ICON_BY_KIND[loc.kind] || mod.WorldIconImages.Flag);
        mod.SetWorldIconColor(icon, mod.CreateVector(1, 0.78, 0.28));
        mod.SetWorldIconText(icon, mod.Message(loc.label));
        mod.EnableWorldIconImage(icon, true);
        mod.EnableWorldIconText(icon, true);
        highlightIcons[id] = icon;
    });
    if (added) {
        highlighted[id] = locationId;
        log("worldicons", "personal world-icon spawned pid=" + id + " location=" + locationId);
    }
}

function resolveParent(loc: StrategicLocation): mod.Object | undefined {
    if (!isConfigured(loc.parentId)) {
        return undefined;
    }
    try {
        let parent: mod.Object;
        if (loc.parentKind === "capturePoint") {
            parent = mod.GetCapturePoint(loc.parentId);
        } else if (loc.parentKind === "areaTrigger") {
            parent = mod.GetAreaTrigger(loc.parentId);
        } else {
            parent = mod.GetSpatialObject(loc.parentId);
        }
        return mod.IsValid(parent) ? parent : undefined;
    } catch (e) {
        return undefined;
    }
}

function labelForId(id: string): string {
    if (id === "bunker1") return "locBunker1";
    if (id === "bunker2") return "locBunker2";
    if (id === "bunker3") return "locBunker3";
    if (id === "site1") return "locSite1";
    if (id === "site2") return "locSite2";
    if (id === "site3") return "locSite3";
    if (id === "proto1") return "locProto";
    if (id === "war1") return "locWar1";
    if (id === "war2") return "locWar2";
    if (id === "air1") return "locAir";
    if (id === "naval1") return "locNaval1";
    if (id === "naval2") return "locNaval2";
    return id;
}

export function clearHighlight(player: mod.Player): void {
    const id: number = mod.GetObjId(player);
    const icon: mod.WorldIcon | undefined = highlightIcons[id];
    if (icon === undefined) {
        return;
    }
    safe("worldicons.clear", () => {
        if (mod.IsValid(icon)) {
            mod.UnspawnObject(icon);
        }
    });
    delete highlightIcons[id];
    delete highlighted[id];
}

export function allLocations(): StrategicLocation[] {
    return locations;
}

export function locationById(id: string): StrategicLocation | undefined {
    return byId[id];
}
