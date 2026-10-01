import { log, willLogDebug } from "./util/log";
import { VEHICLE_SLOT_RADIUS_M } from "./config";
import { Vectors } from "bf6-portal-utils/vectors";

// A VehicleSpawner silently refuses to spawn while it still holds a vehicle, and
// the engine exposes no way to ask which vehicle a spawner owns. So a slot counts
// as busy when a live vehicle is parked within VEHICLE_SLOT_RADIUS_M of that
// spawner.
//
// Occupancy is measured on demand from AllVehicles() rather than tracked via
// events, because events only fire on a successful spawn and a refused spawn
// produces no signal at all.
//
// Spawner positions are static, so they resolve once into a flat array. Vehicle
// positions do change, so those are snapshotted fresh per decision - but
// exactly once, and each converted once, then tested against every slot in the
// same pass. The previous version re-walked the whole vehicle list once per
// slot, then walked it up to three more times in pickSpawner, and the denial
// path called freeSlots() for another three.
export type SlotState = {
    spawnerIds: number[];
    positions: number[]; // flat x,y,z per slot
};

export type SlotReport = {
    busy: boolean[]; // one entry per slot, length === spawnerIds.length
    free: number;
    vehicleCount: number;
};

const byFactory: { [facId: string]: SlotState } = {};
const RADIUS_SQ: number = VEHICLE_SLOT_RADIUS_M * VEHICLE_SLOT_RADIUS_M;

export function initSlots(facId: string, spawnerIds: number[]): void {
    const st: SlotState = {
        spawnerIds: spawnerIds.slice(),
        positions: []
    };
    for (const sid of st.spawnerIds) {
        let x: number = 0;
        let y: number = 0;
        let z: number = 0;
        try {
            const sp: mod.VehicleSpawner = mod.GetVehicleSpawner(sid);
            if (mod.IsValid(sp)) {
                const v: Vectors.Vector3 = Vectors.toVector3(mod.GetObjectPosition(sp));
                x = v.x;
                y = v.y;
                z = v.z;
            }
        } catch (e) {
        }
        st.positions.push(x, y, z);
    }
    byFactory[facId] = st;
    const report: SlotReport = markBusy(st);
    let occupied: number = 0;
    for (let i: number = 0; i < report.busy.length; i++) {
        if (report.busy[i]) {
            occupied++;
        }
    }
    log("shop", facId + " slots " + String(st.spawnerIds.length)
        + " (" + String(occupied) + " already occupied)");
}

// A single AllVehicles() walk fills the busy flags for every slot at once and
// stops early once every slot is accounted for.
function markBusy(st: SlotState): SlotReport {
    const slots: number = st.spawnerIds.length;
    const busy: boolean[] = [];
    for (let i: number = 0; i < slots; i++) {
        busy.push(false);
    }
    let vehicles: number = 0;
    let remaining: number = slots;
    let arr: mod.Array;
    try {
        arr = mod.AllVehicles();
    } catch (e) {
        return { busy: busy, free: slots, vehicleCount: 0 };
    }
    const n: number = mod.CountOf(arr);
    for (let vi: number = 0; vi < n; vi++) {
        const v: mod.Vehicle = mod.ValueInArray(arr, vi) as mod.Vehicle;
        if (!mod.IsValid(v)) {
            continue;
        }
        vehicles++;
        // Converted once per vehicle, then compared against each free slot.
        const p: Vectors.Vector3 = Vectors.toVector3(mod.GetObjectPosition(v));
        for (let i: number = 0; i < slots; i++) {
            if (busy[i]) {
                continue;
            }
            const base: number = i * 3;
            const dx: number = p.x - st.positions[base];
            const dy: number = p.y - st.positions[base + 1];
            const dz: number = p.z - st.positions[base + 2];
            if (dx * dx + dy * dy + dz * dz <= RADIUS_SQ) {
                busy[i] = true;
                remaining--;
                break;
            }
        }
        if (remaining === 0) {
            break;
        }
    }
    let free: number = 0;
    for (let i: number = 0; i < slots; i++) {
        if (!busy[i]) {
            free++;
        }
    }
    return { busy: busy, free: free, vehicleCount: vehicles };
}

// Picks the spawner for the requested item, preferring the item's own slot but
// falling back to any free one. Returns slot -1 when every slot is busy so the
// purchase can be refused instead of charged for nothing. The free count comes
// from the same single pass, so the denial log needs no second walk.
export type SpawnChoice = { slot: number; free: number; vehicles: number };

export function pickSpawner(facId: string, wantIndex: number): SpawnChoice {
    const st: SlotState | undefined = byFactory[facId];
    if (st === undefined) {
        return { slot: -1, free: 0, vehicles: 0 };
    }
    const slots: number = st.spawnerIds.length;
    if (slots === 0) {
        return { slot: -1, free: 0, vehicles: 0 };
    }
    const report: SlotReport = markBusy(st);
    if (report.free === 0) {
        return { slot: -1, free: 0, vehicles: report.vehicleCount };
    }
    const start: number = wantIndex < 0 ? 0 : wantIndex % slots;
    for (let off: number = 0; off < slots; off++) {
        const idx: number = (start + off) % slots;
        if (!report.busy[idx]) {
            if (willLogDebug()) {
                log("shop", "picked slot " + String(idx) + " of " + String(slots)
                    + " (" + String(report.free) + " free, "
                    + String(report.vehicleCount) + " vehicles)");
            }
            return { slot: idx, free: report.free, vehicles: report.vehicleCount };
        }
    }
    return { slot: -1, free: report.free, vehicles: report.vehicleCount };
}
