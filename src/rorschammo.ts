import { Timers } from "bf6-portal-utils/timers";
import { log, safe } from "./util/log";
import { RORSCH_GROUND_MS, RORSCH_SHOTS, RORSCH_TRACE } from "./config";
import { RORSCH } from "./weapons";
import { isBotPid } from "./bots";
import { allPlayers } from "./util/roster";
import { isDeployedPid } from "./nuke";

// Rorsch ammo: RORSCH_SHOTS rounds per purchase. The Rorsch is a battle
// pickup, not a slot item, so the slot ammo calls do not reach it: on
// PrimaryWeapon they changed some other weapon and the Rorsch kept its own
// 1/10 (test 2026-10-03). The limit is therefore counted here: every discharge
// (nuke.ts) takes a shot off, and the weapon is taken away once none are left.
// The shots left travel with the weapon: a drop remembers them and the next
// pickup without a purchase gets them, so a dropped Rorsch cannot come back
// full. The on-screen count still shows the engine's own ammo.
//
// Who carries one is known, not polled for (owner, 2026-10-04): the shop and
// the Debug tab register the buyer. The only Rorsch nobody registered is one
// lying on the ground, and that only happens when a carrier with shots left
// dies or leaves, so the pickup check runs only while one is on the ground.
//
// RORSCH_TRACE logs every slot's ammo at purchase, to find out whether any
// slot reads the Rorsch's 1/10 after all.

const shotsLeft: { [pid: number]: number } = {};
const carriers: { [pid: number]: mod.Player } = {};
// The carriers' ids, for the shot probe's per-tick loop (nuke.ts).
const carrierIds: number[] = [];
const boughtAt: { [pid: number]: number } = {};
// Each carrier's position at the last poll, for where a dropped Rorsch lies.
const lastPos: { [pid: number]: { x: number; y: number; z: number } } = {};

// A Rorsch on the ground: its shots, when it dropped and where (known is false
// when the carrier's position was never read).
interface Ground {
    shots: number;
    at: number;
    x: number;
    y: number;
    z: number;
    known: boolean;
}
const ground: Ground[] = [];
let pollAt: number = 0;
// Time between the last discharge and taking the weapon away, so the shot
// itself plays out.
const REMOVE_AFTER_MS: number = 1500;

// Zero FFI, for the shot probe.
export function isRorschCarrier(pid: number): boolean {
    return carriers[pid] !== undefined;
}

export function rorschCarrierCount(): number {
    return carrierIds.length;
}

export function rorschCarrierId(i: number): number {
    return carrierIds[i];
}

export function rorschCarrier(pid: number): mod.Player | undefined {
    return carriers[pid];
}

export function rorschOnGround(): number {
    return ground.length;
}

function addCarrier(pid: number, p: mod.Player, shots: number): void {
    if (carriers[pid] === undefined) {
        carrierIds.push(pid);
    }
    carriers[pid] = p;
    shotsLeft[pid] = shots;
}

function removeCarrier(pid: number): void {
    if (carriers[pid] === undefined) {
        return;
    }
    delete carriers[pid];
    delete shotsLeft[pid];
    delete boughtAt[pid];
    delete lastPos[pid];
    const at: number = carrierIds.indexOf(pid);
    if (at >= 0) {
        carrierIds.splice(at, 1);
    }
}

// Callins and MiscGadget throw GetAmmoRequest, so they are left out.
const SLOT_NAMES: string[] = ["PrimaryWeapon", "SecondaryWeapon", "GadgetOne", "GadgetTwo"];
const SLOTS: mod.InventorySlots[] = [
    mod.InventorySlots.PrimaryWeapon, mod.InventorySlots.SecondaryWeapon, mod.InventorySlots.GadgetOne,
    mod.InventorySlots.GadgetTwo
];

function traceSlots(p: mod.Player, why: string): void {
    let line: string = "";
    for (let i: number = 0; i < SLOTS.length; i++) {
        let v: string;
        try {
            v = mod.GetInventoryMagazineAmmo(p, SLOTS[i]) + "/" + mod.GetInventoryAmmo(p, SLOTS[i])
                + (mod.IsInventorySlotActive(p, SLOTS[i]) ? "*" : "");
        } catch (e) {
            v = "x";
        }
        line += (line === "" ? "" : " ") + SLOT_NAMES[i] + "=" + v;
    }
    log("rorsch", "pid=" + mod.GetObjId(p) + " slots (" + why + "): " + line);
}

// The on-screen count, when the primary slot turns out to hold the Rorsch.
// Its own ammo is 1 loaded and 9+ spare, which no ordinary primary has, so a
// slot reading magazine 1 with a reserve of 9 or more is taken to be it; any
// other reading is left alone, so no other weapon's ammo is touched.
function trySetCount(p: mod.Player, pid: number, why: string): void {
    const shots: number | undefined = shotsLeft[pid];
    if (shots === undefined) {
        return;
    }
    try {
        const slot: mod.InventorySlots = mod.InventorySlots.PrimaryWeapon;
        const mag: number = mod.GetInventoryMagazineAmmo(p, slot);
        const res: number = mod.GetInventoryAmmo(p, slot);
        if (mag !== 1 || res < 9) {
            if (RORSCH_TRACE) {
                log("rorsch", "pid=" + pid + " primary reads " + mag + "/" + res + " (" + why
                    + "), not the Rorsch, count left alone");
            }
            return;
        }
        mod.SetInventoryAmmo(p, slot, Math.max(0, shots - 1));
        log("rorsch", "pid=" + pid + " count set (" + why + "): " + mag + "/" + res + " -> "
            + mod.GetInventoryMagazineAmmo(p, slot) + "/" + mod.GetInventoryAmmo(p, slot));
    } catch (e) {
        log("rorsch", "pid=" + pid + " count set failed (" + why + "): " + String(e));
    }
}

// Called by the shop right after AddEquipment.
export function onRorschBought(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    addCarrier(pid, p, RORSCH_SHOTS);
    boughtAt[pid] = Date.now();
    log("rorsch", "pid=" + pid + " bought the Rorsch, " + RORSCH_SHOTS + " shots");
    Timers.setTimeout(() => {
        safe("rorsch.count", () => {
            if (mod.IsValid(p) && isDeployedPid(pid)) {
                if (RORSCH_TRACE) {
                    traceSlots(p, "bought");
                }
                trySetCount(p, pid, "bought");
            }
        });
    }, 500);
}

// Debug menu "replenish": the carried Rorsch back to its full shots.
export function refillRorsch(pid: number): boolean {
    if (carriers[pid] === undefined) {
        return false;
    }
    shotsLeft[pid] = RORSCH_SHOTS;
    return true;
}

// One discharge of the Rorsch (nuke.ts). The last one takes the weapon away.
export function onRorschShot(p: mod.Player, pid: number): void {
    const s: number | undefined = shotsLeft[pid];
    if (s === undefined) {
        return;
    }
    const left: number = Math.max(0, s - 1);
    shotsLeft[pid] = left;
    log("rorsch", "pid=" + pid + " fired, " + left + " shots left");
    if (left > 0) {
        return;
    }
    Timers.setTimeout(() => {
        safe("rorsch.empty", () => {
            if (!mod.IsValid(p) || !isDeployedPid(pid) || shotsLeft[pid] !== 0) {
                return;
            }
            if (mod.HasEquipment(p, RORSCH)) {
                mod.RemoveEquipment(p, RORSCH);
                log("rorsch", "pid=" + pid + " out of shots, Rorsch removed");
            }
            dropped(pid, false);
        });
    }, REMOVE_AFTER_MS);
}

// The weapon drops when its owner dies or leaves.
export function onRorschOwnerGone(pid: number): void {
    if (carriers[pid] === undefined) {
        return;
    }
    dropped(pid, true);
}

// onGround: the weapon is left lying on the map (not used up).
function dropped(pid: number, onGround: boolean): void {
    const s: number | undefined = shotsLeft[pid];
    const left: boolean = onGround && s !== undefined && s > 0;
    if (left) {
        const at: { x: number; y: number; z: number } | undefined = lastPos[pid];
        ground.push({
            shots: s as number, at: Date.now(), x: at !== undefined ? at.x : 0, y: at !== undefined ? at.y : 0,
            z: at !== undefined ? at.z : 0, known: at !== undefined
        });
    }
    log("rorsch", "pid=" + pid + " no longer carries the Rorsch (" + (s === undefined ? "?" : String(s))
        + " shots left" + (left ? ", on the ground" : "") + ")");
    removeCarrier(pid);
}

function readPos(p: mod.Player): { x: number; y: number; z: number } | undefined {
    try {
        const v: mod.Vector = mod.GetObjectPosition(p);
        return { x: mod.XComponentOf(v), y: mod.YComponentOf(v), z: mod.ZComponentOf(v) };
    } catch (e) {
        return undefined;
    }
}

// The ground Rorsch nearest to where the picker stands (the oldest when no
// position is known), taken off the ground.
function takeGround(p: mod.Player): Ground {
    let best: number = 0;
    const at: { x: number; y: number; z: number } | undefined = readPos(p);
    if (at !== undefined) {
        let bestSq: number = Infinity;
        for (let i: number = 0; i < ground.length; i++) {
            const g: Ground = ground[i];
            if (!g.known) {
                continue;
            }
            const dx: number = g.x - at.x;
            const dy: number = g.y - at.y;
            const dz: number = g.z - at.z;
            const sq: number = dx * dx + dy * dy + dz * dz;
            if (sq < bestSq) {
                bestSq = sq;
                best = i;
            }
        }
    }
    const g: Ground = ground[best];
    ground.splice(best, 1);
    return g;
}

// Once a second. Carriers: where they are (for a drop), and whether they
// still hold it (a carrier who picks up another battle pickup lets it fall).
// Pickups: only while a Rorsch is on the ground, deployed humans who are not
// carriers are checked for one.
export function pollRorsch(nowMs: number): void {
    if (nowMs - pollAt < 1000) {
        return;
    }
    pollAt = nowMs;
    for (let i: number = ground.length - 1; i >= 0; i--) {
        if (nowMs - ground[i].at > RORSCH_GROUND_MS) {
            log("rorsch", "a Rorsch on the ground (" + ground[i].shots + " shots) was not picked up in "
                + String(RORSCH_GROUND_MS) + " ms; no longer watched");
            ground.splice(i, 1);
        }
    }
    for (let i: number = carrierIds.length - 1; i >= 0; i--) {
        const pid: number = carrierIds[i];
        const p: mod.Player = carriers[pid];
        if (!isDeployedPid(pid)) {
            continue;
        }
        let has: boolean = true;
        try {
            has = mod.HasEquipment(p, RORSCH);
        } catch (e) {
            continue;
        }
        const bought: number | undefined = boughtAt[pid];
        if (!has && (bought === undefined || nowMs - bought > 2000)) {
            dropped(pid, true);
            continue;
        }
        const at: { x: number; y: number; z: number } | undefined = readPos(p);
        if (at !== undefined && !(at.x === 0 && at.y === 0 && at.z === 0)) {
            lastPos[pid] = at;
        }
    }
    if (ground.length === 0) {
        return;
    }
    for (const p of allPlayers()) {
        if (ground.length === 0) {
            return;
        }
        const pid: number = mod.GetObjId(p);
        if (pid < 0 || isBotPid(pid) || !isDeployedPid(pid) || carriers[pid] !== undefined) {
            continue;
        }
        let has: boolean = false;
        try {
            has = mod.HasEquipment(p, RORSCH);
        } catch (e) {
            continue;
        }
        if (has) {
            const g: Ground = takeGround(p);
            addCarrier(pid, p, g.shots);
            log("rorsch", "pid=" + pid + " picked up a Rorsch with " + g.shots + " shots");
            trySetCount(p, pid, "picked up");
        }
    }
}
