import { Events } from "bf6-portal-utils/events";
import { Timers } from "bf6-portal-utils/timers";
import { log, safe } from "./util/log";
import {
    VEHICLE_LATE_MATCH_MS, VEHICLE_RUNTIME_SPAWNERS_MAX, VEHICLE_SLOT_RADIUS_M, VEHICLE_SPAWN_CONFIRM_MS
} from "./config";
import { Vectors } from "bf6-portal-utils/vectors";

// Factory vehicle pads and the spawners on them. The only module that touches
// a VehicleSpawner.
//
// A VehicleSpawner silently refuses to spawn while the vehicle it spawned last
// is still alive, wherever that vehicle is now. In the 2026-10-02 playtest that
// locked the aviation factory: three AH64s flying around held all three
// spawners, and nothing else (the UH60 included) could be bought until they
// died. So a pad is only refused when it is physically blocked:
//
//   - each pad is a placed spawner's position and rotation;
//   - a purchase uses the placed spawner when it holds no live vehicle,
//     otherwise a runtime duplicate on the same pad (SpawnObject of
//     RuntimeSpawn_Common.VehicleSpawner, the pattern of the official
//     AcePursuit mod). Duplicates are reused once their vehicle dies;
//   - OnVehicleSpawned pairs the new vehicle with the nearest pending spawn
//     (31-34 ms after the call in the playtest), and OnVehicleDestroyed frees
//     the spawner again;
//   - a placed spawner that produces nothing is retried once with a duplicate
//     on the same pad (war1 spawner 4200 refused every M2Bradley for no
//     visible reason), and only then reported as failed so the shop refunds.
//
// A pad is blocked while any vehicle is parked on it (within
// VEHICLE_SLOT_RADIUS_M) or a spawn on it is in flight. Vehicle positions are
// read with GetVehicleState(VehiclePosition); GetObjectPosition on a vehicle
// never placed one near a pad.

type Pad = {
    placedId: number;
    x: number;
    y: number;
    z: number;
    rot: mod.Vector;
};

type Runtime = {
    key: number;
    pad: number;
    sp: mod.VehicleSpawner;
};

type Factory = {
    pads: Pad[];
    runtime: Runtime[];
};

type Pending = {
    facId: string;
    pad: number;
    // Placed spawner ObjId, or a negative key for a runtime duplicate.
    key: number;
    x: number;
    y: number;
    z: number;
    at: number;
    // Vehicles already near the pad when the spawn was issued; the timeout
    // fallback must not mistake one of them for the new vehicle.
    near: number[];
    veh: mod.VehicleList;
    label: string;
    retried: boolean;
    done: (ok: boolean) => void;
};

export type BuyResult = {
    ok: boolean;
    // Why ok is false, for the log: every pad blocked, or no spawner (the
    // duplicate cap was reached or the spawn call failed).
    reason: string;
    pad: number;
    runtime: boolean;
    // Pads not physically blocked, and live vehicles on the map, for the log.
    open: number;
    vehicles: number;
};

const factories: { [facId: string]: Factory } = {};
// Spawner key -> ObjId of the live vehicle it spawned.
const ownedBy: { [key: number]: number } = {};
const pending: Pending[] = [];
// Spawns already reported as failed, still matchable for VEHICLE_LATE_MATCH_MS.
const late: Pending[] = [];
let nextRuntimeKey: number = -1;
// Placed spawner ObjId -> time until which it is skipped. A placed spawner that
// produced nothing (war1 4200 refused every M2Bradley) would otherwise cost
// every purchase on its pad a 4 s wait before the runtime retry.
const suspectUntil: { [key: number]: number } = {};
const SUSPECT_MS: number = 300000;
let eventsWired: boolean = false;

const PARK_SQ: number = VEHICLE_SLOT_RADIUS_M * VEHICLE_SLOT_RADIUS_M;
// A spawned vehicle lands on its pad; anything further than this from every
// pending pad came from somewhere else (a map spawner, a respawn).
const PAIR_RADIUS_SQ: number = 15 * 15;

const vScratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

function vehiclePos(v: mod.Vehicle): boolean {
    try {
        Vectors.toVector3(mod.GetVehicleState(v, mod.VehicleStateVector.VehiclePosition), vScratch);
        return true;
    } catch (e) {
        return false;
    }
}

function wireEvents(): void {
    if (eventsWired) {
        return;
    }
    eventsWired = true;
    Events.OnVehicleSpawned.subscribe((v: mod.Vehicle) => {
        safe("slots.spawned", () => { onVehicleSpawned(v); });
    });
    Events.OnVehicleDestroyed.subscribe((v: mod.Vehicle) => {
        safe("slots.destroyed", () => { onVehicleDestroyed(v); });
    });
}

function keyName(key: number): string {
    return key < 0 ? "runtime spawner " + String(-key) : "spawner " + String(key);
}

function dropExpiredLate(now: number): void {
    for (let i: number = late.length - 1; i >= 0; i--) {
        if (now - late[i].at > VEHICLE_SPAWN_CONFIRM_MS + VEHICLE_LATE_MATCH_MS) {
            late.splice(i, 1);
        }
    }
}

// Index of the entry in list nearest to vScratch within the pairing radius,
// or -1.
function nearestEntry(list: Pending[]): number {
    let best: number = -1;
    let bestSq: number = PAIR_RADIUS_SQ;
    for (let i: number = 0; i < list.length; i++) {
        const pe: Pending = list[i];
        const dx: number = vScratch.x - pe.x;
        const dy: number = vScratch.y - pe.y;
        const dz: number = vScratch.z - pe.z;
        const dSq: number = dx * dx + dy * dy + dz * dz;
        if (dSq <= bestSq) {
            best = i;
            bestSq = dSq;
        }
    }
    return best;
}

function onVehicleSpawned(v: mod.Vehicle): void {
    if (pending.length === 0 && late.length === 0) {
        return;
    }
    if (!vehiclePos(v)) {
        return;
    }
    const now: number = Date.now();
    dropExpiredLate(now);
    const vid: number = mod.GetObjId(v);
    let at: number = nearestEntry(pending);
    if (at >= 0) {
        const pe: Pending = pending[at];
        pending.splice(at, 1);
        ownedBy[pe.key] = vid;
        delete suspectUntil[pe.key];
        log("shop", keyName(pe.key) + " (" + pe.facId + " pad " + pe.pad + ") spawned vehicle " + vid
            + " after " + String(now - pe.at) + "ms");
        pe.done(true);
        return;
    }
    at = nearestEntry(late);
    if (at >= 0) {
        const pe: Pending = late[at];
        late.splice(at, 1);
        ownedBy[pe.key] = vid;
        log("shop", "late spawn: " + keyName(pe.key) + " (" + pe.facId + " pad " + pe.pad + ") vehicle " + vid
            + " after " + String(now - pe.at) + "ms, already refunded");
    }
}

function onVehicleDestroyed(v: mod.Vehicle): void {
    const vid: number = mod.GetObjId(v);
    for (const k in ownedBy) {
        if (ownedBy[k] === vid) {
            delete ownedBy[k];
            log("shop", keyName(Number(k)) + " free again (vehicle " + vid + " destroyed)");
        }
    }
}

// True while the vehicle this spawner made is still alive. A handle that no
// longer resolves frees the spawner, in case a destroy event was missed.
function holdsVehicle(key: number): boolean {
    const vid: number | undefined = ownedBy[key];
    if (vid === undefined) {
        return false;
    }
    try {
        if (mod.IsValid(mod.GetVehicle(vid))) {
            return true;
        }
    } catch (e) {
    }
    delete ownedBy[key];
    return false;
}

function isOwned(vid: number): boolean {
    for (const k in ownedBy) {
        if (ownedBy[k] === vid) {
            return true;
        }
    }
    return false;
}

function keyPending(key: number): boolean {
    for (const pe of pending) {
        if (pe.key === key) {
            return true;
        }
    }
    return false;
}

function padPending(facId: string, pad: number): boolean {
    for (const pe of pending) {
        if (pe.facId === facId && pe.pad === pad) {
            return true;
        }
    }
    return false;
}

type PadScan = {
    parked: boolean[];
    // Vehicle ObjIds within the pairing radius of each pad.
    near: number[][];
    vehicles: number;
};

// One AllVehicles walk for every pad of a factory. GetObjId is only paid for
// vehicles near some pad.
function scanPads(f: Factory): PadScan {
    const n: number = f.pads.length;
    const scan: PadScan = { parked: [], near: [], vehicles: 0 };
    for (let i: number = 0; i < n; i++) {
        scan.parked.push(false);
        scan.near.push([]);
    }
    let arr: mod.Array;
    try {
        arr = mod.AllVehicles();
    } catch (e) {
        return scan;
    }
    const count: number = mod.CountOf(arr);
    for (let vi: number = 0; vi < count; vi++) {
        const v: mod.Vehicle = mod.ValueInArray(arr, vi) as mod.Vehicle;
        if (!mod.IsValid(v)) {
            continue;
        }
        scan.vehicles++;
        if (!vehiclePos(v)) {
            continue;
        }
        let vid: number = -1;
        for (let i: number = 0; i < n; i++) {
            const pad: Pad = f.pads[i];
            const dx: number = vScratch.x - pad.x;
            const dy: number = vScratch.y - pad.y;
            const dz: number = vScratch.z - pad.z;
            const dSq: number = dx * dx + dy * dy + dz * dz;
            if (dSq > PAIR_RADIUS_SQ) {
                continue;
            }
            if (vid < 0) {
                vid = mod.GetObjId(v);
            }
            scan.near[i].push(vid);
            if (dSq <= PARK_SQ) {
                scan.parked[i] = true;
            }
        }
    }
    return scan;
}

// A new vehicle (not in pe.near) that no spawner owns, nearest to the pad
// within the pairing radius, or -1. Only used when no spawn event arrived.
function newVehicleNear(pe: Pending): number {
    let arr: mod.Array;
    try {
        arr = mod.AllVehicles();
    } catch (e) {
        return -1;
    }
    let best: number = -1;
    let bestSq: number = PAIR_RADIUS_SQ;
    const count: number = mod.CountOf(arr);
    for (let i: number = 0; i < count; i++) {
        const v: mod.Vehicle = mod.ValueInArray(arr, i) as mod.Vehicle;
        if (!mod.IsValid(v) || !vehiclePos(v)) {
            continue;
        }
        const dx: number = vScratch.x - pe.x;
        const dy: number = vScratch.y - pe.y;
        const dz: number = vScratch.z - pe.z;
        const dSq: number = dx * dx + dy * dy + dz * dz;
        if (dSq > bestSq) {
            continue;
        }
        const vid: number = mod.GetObjId(v);
        if (pe.near.indexOf(vid) >= 0 || isOwned(vid)) {
            continue;
        }
        best = vid;
        bestSq = dSq;
    }
    return best;
}

// An idle runtime spawner on this pad, or a new one, or undefined when the
// factory is at VEHICLE_RUNTIME_SPAWNERS_MAX or the spawn failed.
function runtimeFor(facId: string, f: Factory, pad: number): Runtime | undefined {
    for (const r of f.runtime) {
        if (r.pad === pad && !holdsVehicle(r.key) && !keyPending(r.key)) {
            return r;
        }
    }
    if (f.runtime.length >= VEHICLE_RUNTIME_SPAWNERS_MAX) {
        log("shop", facId + " has " + String(f.runtime.length) + " runtime spawners, none idle on pad " + pad);
        return undefined;
    }
    const p: Pad = f.pads[pad];
    try {
        const sp: mod.VehicleSpawner = mod.SpawnObject(
            mod.RuntimeSpawn_Common.VehicleSpawner,
            mod.CreateVector(p.x, p.y, p.z),
            p.rot,
            mod.CreateVector(1, 1, 1)
        ) as mod.VehicleSpawner;
        if (!mod.IsValid(sp)) {
            log("shop", facId + " pad " + pad + ": runtime spawner did not spawn");
            return undefined;
        }
        mod.SetVehicleSpawnerAutoSpawn(sp, false);
        const r: Runtime = { key: nextRuntimeKey, pad: pad, sp: sp };
        nextRuntimeKey--;
        f.runtime.push(r);
        log("shop", facId + " pad " + pad + ": created " + keyName(r.key)
            + " (" + String(f.runtime.length) + " on this factory)");
        return r;
    } catch (e) {
        log("shop", facId + " pad " + pad + ": runtime spawner failed: " + String(e));
        return undefined;
    }
}

// Sets the type, forces the spawn and starts the confirm timer. False when
// the engine call threw.
function issue(
    facId: string, pad: number, key: number, sp: mod.VehicleSpawner, veh: mod.VehicleList,
    near: number[], label: string, retried: boolean, done: (ok: boolean) => void
): boolean {
    try {
        mod.SetVehicleSpawnerVehicleType(sp, veh);
        mod.ForceVehicleSpawnerSpawn(sp);
    } catch (e) {
        log("shop", label + ": " + keyName(key) + " refused the spawn call: " + String(e));
        return false;
    }
    const p: Pad = factories[facId].pads[pad];
    const pe: Pending = {
        facId: facId, pad: pad, key: key, x: p.x, y: p.y, z: p.z, at: Date.now(),
        near: near, veh: veh, label: label, retried: retried, done: done
    };
    pending.push(pe);
    const h: Timers.TimerID | null = Timers.setTimeout(() => {
        safe("slots.confirm", () => { onConfirmTimeout(pe); });
    }, VEHICLE_SPAWN_CONFIRM_MS);
    if (h === null) {
        // No timer: keep the purchase rather than refund blindly.
        const at: number = pending.indexOf(pe);
        if (at >= 0) {
            pending.splice(at, 1);
        }
        done(true);
    }
    return true;
}

function onConfirmTimeout(pe: Pending): void {
    const at: number = pending.indexOf(pe);
    if (at < 0) {
        return;
    }
    pending.splice(at, 1);
    // No spawn event. Look at the pad itself before calling it a failure, in
    // case the event did not fire; only a vehicle that was not there before
    // the purchase counts.
    const vid: number = newVehicleNear(pe);
    if (vid >= 0) {
        ownedBy[pe.key] = vid;
        log("shop", keyName(pe.key) + " has new vehicle " + vid + " on its pad (no OnVehicleSpawned seen)");
        pe.done(true);
        return;
    }
    log("shop", pe.label + ": " + keyName(pe.key) + " (" + pe.facId + " pad " + pe.pad
        + ") produced no vehicle in " + String(VEHICLE_SPAWN_CONFIRM_MS) + "ms");
    late.push(pe);
    if (pe.key > 0) {
        suspectUntil[pe.key] = Date.now() + SUSPECT_MS;
    }
    if (!pe.retried && pe.key > 0 && retryOnRuntime(pe)) {
        return;
    }
    pe.done(false);
}

// A placed spawner that produced nothing may still hold a vehicle nobody
// tracked; a duplicate on the same pad does not.
function retryOnRuntime(pe: Pending): boolean {
    const f: Factory | undefined = factories[pe.facId];
    if (f === undefined) {
        return false;
    }
    const scan: PadScan = scanPads(f);
    if (scan.parked[pe.pad] || padPending(pe.facId, pe.pad)) {
        return false;
    }
    const r: Runtime | undefined = runtimeFor(pe.facId, f, pe.pad);
    if (r === undefined) {
        return false;
    }
    if (!issue(pe.facId, pe.pad, r.key, r.sp, pe.veh, scan.near[pe.pad], pe.label, true, pe.done)) {
        return false;
    }
    log("shop", pe.label + ": retrying on " + keyName(r.key) + " (" + pe.facId + " pad " + pe.pad + ")");
    return true;
}

export function initSlots(facId: string, spawnerIds: number[]): void {
    wireEvents();
    const f: Factory = { pads: [], runtime: [] };
    for (let i: number = 0; i < spawnerIds.length; i++) {
        const sid: number = spawnerIds[i];
        const pad: Pad = { placedId: sid, x: 0, y: 0, z: 0, rot: mod.CreateVector(0, 0, 0) };
        let ok: boolean = false;
        try {
            const sp: mod.VehicleSpawner = mod.GetVehicleSpawner(sid);
            if (mod.IsValid(sp)) {
                const v: Vectors.Vector3 = Vectors.toVector3(mod.GetObjectPosition(sp));
                pad.x = v.x;
                pad.y = v.y;
                pad.z = v.z;
                ok = true;
                try {
                    pad.rot = mod.GetObjectRotation(sp);
                } catch (e) {
                    log("shop", facId + " pad " + i + ": rotation unreadable, duplicates face north");
                }
            }
        } catch (e) {
        }
        if (!ok || (pad.x === 0 && pad.y === 0 && pad.z === 0)) {
            log("shop", facId + " pad " + i + ": spawner " + sid + " position did not resolve");
        } else {
            log("shop", facId + " pad " + i + ": spawner " + sid + " at ("
                + String(Math.round(pad.x)) + ", " + String(Math.round(pad.y)) + ", "
                + String(Math.round(pad.z)) + ")");
        }
        f.pads.push(pad);
    }
    factories[facId] = f;
}

// Buys a vehicle at a factory: picks a pad (wantPad first), a spawner on it
// (the placed one if it is free, otherwise a runtime duplicate) and issues the
// spawn. done(true) runs when the vehicle appears, done(false) when nothing
// appeared even after one retry, so the caller refunds. ok is false, and done
// is never called, when no spawn could be issued: every pad blocked, or no
// spawner for an open pad (see reason).
export function buyVehicle(
    facId: string, wantPad: number, veh: mod.VehicleList, label: string, done: (ok: boolean) => void
): BuyResult {
    const res: BuyResult = { ok: false, reason: "", pad: -1, runtime: false, open: 0, vehicles: 0 };
    const f: Factory | undefined = factories[facId];
    if (f === undefined || f.pads.length === 0) {
        return res;
    }
    const n: number = f.pads.length;
    const scan: PadScan = scanPads(f);
    res.vehicles = scan.vehicles;
    for (let i: number = 0; i < n; i++) {
        if (!scan.parked[i] && !padPending(facId, i)) {
            res.open++;
        }
    }
    res.reason = res.open === 0 ? "every pad blocked" : "no spawner available";
    const now: number = Date.now();
    const start: number = wantPad < 0 ? 0 : wantPad % n;
    for (let off: number = 0; off < n; off++) {
        const pad: number = (start + off) % n;
        if (scan.parked[pad] || padPending(facId, pad)) {
            continue;
        }
        const placedId: number = f.pads[pad].placedId;
        const suspect: boolean = suspectUntil[placedId] !== undefined && suspectUntil[placedId] > now;
        if (!suspect && !holdsVehicle(placedId)) {
            let sp: mod.VehicleSpawner | undefined = undefined;
            try {
                const s: mod.VehicleSpawner = mod.GetVehicleSpawner(placedId);
                if (mod.IsValid(s)) {
                    sp = s;
                }
            } catch (e) {
            }
            if (sp !== undefined && issue(facId, pad, placedId, sp, veh, scan.near[pad], label, false, done)) {
                res.ok = true;
                res.pad = pad;
                return res;
            }
        }
        const r: Runtime | undefined = runtimeFor(facId, f, pad);
        if (r !== undefined && issue(facId, pad, r.key, r.sp, veh, scan.near[pad], label, false, done)) {
            res.ok = true;
            res.pad = pad;
            res.runtime = true;
            return res;
        }
    }
    return res;
}
