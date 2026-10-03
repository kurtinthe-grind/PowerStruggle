import { Timers } from "bf6-portal-utils/timers";
import { log, safe } from "./util/log";
import { RORSCH_SHOTS, RORSCH_TRACE } from "./config";
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
// RORSCH_TRACE logs every slot's ammo at purchase, to find out whether any
// slot reads the Rorsch's 1/10 after all.

const shotsLeft: { [pid: number]: number } = {};
const carrying: { [pid: number]: boolean } = {};
const boughtAt: { [pid: number]: number } = {};
// Shots left in the most recently dropped Rorsch, for whoever picks one up.
let droppedShots: number = 1;
let pollAt: number = 0;
// Time between the last discharge and taking the weapon away, so the shot
// itself plays out.
const REMOVE_AFTER_MS: number = 1500;

// Zero FFI, for the shot probe.
export function isRorschCarrier(pid: number): boolean {
    return carrying[pid] === true;
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
    shotsLeft[pid] = RORSCH_SHOTS;
    carrying[pid] = true;
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
            dropped(pid);
        });
    }, REMOVE_AFTER_MS);
}

// The weapon drops when its owner dies.
export function onRorschOwnerGone(pid: number): void {
    if (carrying[pid] !== true) {
        return;
    }
    dropped(pid);
}

function dropped(pid: number): void {
    const s: number | undefined = shotsLeft[pid];
    if (s !== undefined && s > 0) {
        droppedShots = s;
    }
    log("rorsch", "pid=" + pid + " no longer carries the Rorsch (" + (s === undefined ? "?" : String(s))
        + " shots left)");
    delete carrying[pid];
    delete shotsLeft[pid];
    delete boughtAt[pid];
}

// Once a second: who carries the Rorsch (deployed humans only), pickups and
// drops.
export function pollRorsch(nowMs: number): void {
    if (nowMs - pollAt < 1000) {
        return;
    }
    pollAt = nowMs;
    for (const p of allPlayers()) {
        const pid: number = mod.GetObjId(p);
        if (pid < 0 || isBotPid(pid) || !isDeployedPid(pid)) {
            continue;
        }
        let has: boolean = false;
        try {
            has = mod.HasEquipment(p, RORSCH);
        } catch (e) {
            continue;
        }
        if (has && carrying[pid] !== true) {
            carrying[pid] = true;
            if (shotsLeft[pid] === undefined) {
                shotsLeft[pid] = droppedShots > 0 ? droppedShots : 1;
                log("rorsch", "pid=" + pid + " picked up a Rorsch with " + shotsLeft[pid] + " shots");
                trySetCount(p, pid, "picked up");
            }
        } else if (!has && carrying[pid] === true) {
            // The equipment may not show yet right after the purchase.
            const bought: number | undefined = boughtAt[pid];
            if (bought === undefined || nowMs - bought > 2000) {
                dropped(pid);
            }
        }
    }
}
