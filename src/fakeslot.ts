import { Events } from "bf6-portal-utils/events";
import { log, safe } from "./util/log";
import {
    FAKE_SLOT_BOTTOM, FAKE_SLOT_BUSY_MS, FAKE_SLOT_CARD, FAKE_SLOT_FORCE_MS, FAKE_SLOT_H, FAKE_SLOT_RIGHT,
    FAKE_SLOT_POLL_TICKS, FAKE_SLOT_TRACE, FAKE_SLOT_W
} from "./config";
import { isDriver, onSeatChange } from "./util/seats";
import { markSwapped, markUsed, newWatch, SlotResult, slotStep, SlotWatch } from "./fakeslotcore";

// The fake 4th gadget slot (owner, 2026-10-04). The Portal Gadget can only
// live in slot 3 (asking for the misc slot put it there anyway, 14:02 log),
// where it took the class's own gadget, e.g. the engineer's RPG-7. Now slot 3
// holds one of the two and pressing 3 again, before using what is in hand,
// swaps them (see fakeslotcore.ts for how "3 again" is detected). A box the
// size of the game's gadget boxes, just left of them, shows the card of the
// item not in slot 3.
//
// Which gadget the Portal Gadget replaced is found at deploy: the gadgets the
// soldier carries are listed before and after the grant, and the one that
// went missing is it. Its ammo is kept while it is swapped out, so swapping
// cannot refill it.

const PORTAL: mod.Gadgets = mod.Gadgets.Misc_PortalGadget;

// Gadgets that can sit in slot 3, with a name for the log.
const SLOT3_GADGETS: [mod.Gadgets, string][] = [
    [mod.Gadgets.Launcher_Unguided_Rocket, "RPG-7"],
    [mod.Gadgets.Launcher_Aim_Guided, "aim-guided launcher"],
    [mod.Gadgets.Launcher_Air_Defense, "air defense launcher"],
    [mod.Gadgets.Launcher_Auto_Guided, "auto-guided launcher"],
    [mod.Gadgets.Launcher_Breaching_Projectile, "breaching launcher"],
    [mod.Gadgets.Launcher_High_Explosive, "HE launcher"],
    [mod.Gadgets.Launcher_IGLA, "IGLA"],
    [mod.Gadgets.Launcher_Incendiary_Airburst, "incendiary airburst"],
    [mod.Gadgets.Launcher_Long_Range, "long range launcher"],
    [mod.Gadgets.Launcher_Smoke_Grenade, "smoke launcher"],
    [mod.Gadgets.Launcher_Thermobaric_Grenade, "thermobaric launcher"],
    [mod.Gadgets.Deployable_Cover, "deployable cover"],
    [mod.Gadgets.Deployable_Deploy_Beacon, "deploy beacon"],
    [mod.Gadgets.Deployable_EOD_Bot, "EOD bot"],
    [mod.Gadgets.Deployable_Grenade_Intercept_System, "grenade intercept"],
    [mod.Gadgets.Deployable_Missile_Intercept_System, "missile intercept"],
    [mod.Gadgets.Deployable_Portable_Mortar, "portable mortar"],
    [mod.Gadgets.Deployable_Recon_Drone, "recon drone"],
    [mod.Gadgets.Deployable_Vehicle_Supply_Crate, "vehicle supply crate"],
    [mod.Gadgets.Misc_Acoustic_Sensor_AV_Mine, "acoustic AV mine"],
    [mod.Gadgets.Misc_Anti_Personnel_Mine, "AP mine"],
    [mod.Gadgets.Misc_Anti_Vehicle_Mine, "AV mine"],
    [mod.Gadgets.Misc_Assault_Ladder, "assault ladder"],
    [mod.Gadgets.Misc_Defibrillator, "defibrillator"],
    [mod.Gadgets.Misc_Demolition_Charge, "demolition charge"],
    [mod.Gadgets.Misc_Incendiary_Round_Shotgun, "incendiary rounds"],
    [mod.Gadgets.Misc_Laser_Designator, "laser designator"],
    [mod.Gadgets.Misc_Sniper_Decoy, "sniper decoy"],
    [mod.Gadgets.Misc_Supply_Pouch, "supply pouch"],
    [mod.Gadgets.Misc_Suppression, "suppression"],
    [mod.Gadgets.Misc_Tracer_Dart, "tracer dart"],
    [mod.Gadgets.Misc_Tripwire_Sensor_AV_Mine, "tripwire AV mine"],
    [mod.Gadgets.Class_Adrenaline_Injector, "adrenaline injector"],
    [mod.Gadgets.Class_Handheld_Jammer, "handheld jammer"],
    [mod.Gadgets.Class_Motion_Sensor, "motion sensor"],
    [mod.Gadgets.Class_Repair_Tool, "repair tool"],
    [mod.Gadgets.Class_Supply_Bag, "supply bag"],
];

const SLOT_KEYS: string[] = ["pri", "sec", "g1", "g2", "class", "throw", "melee"];
const SLOTS: mod.InventorySlots[] = [
    mod.InventorySlots.PrimaryWeapon, mod.InventorySlots.SecondaryWeapon, mod.InventorySlots.GadgetOne,
    mod.InventorySlots.GadgetTwo, mod.InventorySlots.ClassGadget, mod.InventorySlots.Throwable,
    mod.InventorySlots.MeleeWeapon
];

interface Holder {
    pid: number;
    p: mod.Player;
    // Index into SLOT3_GADGETS of the gadget the Portal Gadget replaced, or -1.
    stash: number;
    // What slot 3 holds now.
    portalIn: boolean;
    // Ammo of the stashed gadget when it was swapped out; -1 = untouched.
    ammo: number;
    mag: number;
    watch: SlotWatch;
    // After a swap, slot 3 is asked for again until it is in hand: the
    // engine's own switch back to the gun (the "3 again" press itself) can
    // override a ForceSwitchInventory sent in the same tick.
    forceUntil: number;
    forceAt: number;
    box: mod.UIWidget | undefined;
    icon: mod.UIWidget | undefined;
    iconSeq: number;
    // In a vehicle's driver seat: the box is hidden, as the game hides its
    // own gadget boxes there (owner, 2026-10-04), and no swap is watched.
    // Kept from the seat events (util/seats.ts), not polled.
    driving: boolean;
    // The buy menu is open: inventory switching is blocked, nothing to watch.
    menuOpen: boolean;
    // Slot 3 was in hand at the last slot read.
    g1Seen: boolean;
}

const holders: { [pid: number]: Holder } = {};

function carried(p: mod.Player): boolean[] {
    const out: boolean[] = [];
    for (const g of SLOT3_GADGETS) {
        let has: boolean = false;
        try {
            has = mod.HasEquipment(p, g[0]);
        } catch (e) {
        }
        out.push(has);
    }
    return out;
}

function activeSet(p: mod.Player): string {
    let s: string = "";
    for (let i: number = 0; i < SLOTS.length; i++) {
        let on: boolean = false;
        try {
            on = mod.IsInventorySlotActive(p, SLOTS[i]);
        } catch (e) {
        }
        if (on) {
            s += (s === "" ? "" : "+") + SLOT_KEYS[i];
        }
    }
    return s === "" ? "none" : s;
}

// ------------------------------------------------------------------ the box

function v(x: number, y: number): mod.Vector {
    return mod.CreateVector(x, y, 0);
}

function deleteWidget(w: mod.UIWidget | undefined): void {
    if (w === undefined) {
        return;
    }
    try {
        mod.DeleteUIWidget(w);
    } catch (e) {
    }
}

function dropBox(h: Holder): void {
    // The card goes with the box.
    deleteWidget(h.box);
    h.box = undefined;
    h.icon = undefined;
}

// Built once per deploy, the size and colour of the game's gadget boxes.
function buildBox(h: Holder): void {
    dropBox(h);
    if (h.stash < 0) {
        return;
    }
    const base: string = "psh_fs_" + h.pid;
    try {
        mod.AddUIContainer(base, v(FAKE_SLOT_RIGHT, FAKE_SLOT_BOTTOM), v(FAKE_SLOT_W, FAKE_SLOT_H),
            mod.UIAnchor.BottomRight, mod.GetUIRoot(), true, 0, mod.CreateVector(0.36, 0.36, 0.36), 0.55,
            mod.UIBgFill.Solid, mod.UIDepth.AboveGameUI, h.p);
        h.box = mod.FindUIWidgetWithName(base);
    } catch (e) {
        log("fakeslot", "box failed for pid=" + h.pid + ": " + String(e));
        dropBox(h);
        return;
    }
    paintBox(h);
}

// The card of the item NOT in slot 3, centred and sized relative to the box
// (FAKE_SLOT_CARD of it), so resizing the box in config resizes the card.
function paintBox(h: Holder): void {
    if (h.box === undefined || h.stash < 0) {
        return;
    }
    const gadget: mod.Gadgets = h.portalIn ? SLOT3_GADGETS[h.stash][0] : PORTAL;
    const cw: number = Math.round(FAKE_SLOT_W * FAKE_SLOT_CARD);
    const ch: number = Math.round(FAKE_SLOT_H * FAKE_SLOT_CARD);
    try {
        deleteWidget(h.icon);
        h.iconSeq++;
        const iconName: string = "psh_fs_" + h.pid + "_i" + h.iconSeq;
        mod.AddUIGadgetImage(iconName, v((FAKE_SLOT_W - cw) / 2, (FAKE_SLOT_H - ch) / 2), v(cw, ch),
            mod.UIAnchor.TopLeft, gadget, h.box, h.p);
        h.icon = mod.FindUIWidgetWithName(iconName);
    } catch (e) {
        log("fakeslot", "card failed for pid=" + h.pid + ": " + String(e));
    }
}

// ----------------------------------------------------------------- the swap

const FORCE_EVERY_MS: number = 150;

function swap(h: Holder, nowMs: number): void {
    const stash: [mod.Gadgets, string] = SLOT3_GADGETS[h.stash];
    const p: mod.Player = h.p;
    try {
        if (h.portalIn) {
            mod.AddEquipment(p, stash[0], mod.InventorySlots.GadgetOne);
            if (h.ammo >= 0) {
                mod.SetInventoryAmmo(p, mod.InventorySlots.GadgetOne, h.ammo);
                mod.SetInventoryMagazineAmmo(p, mod.InventorySlots.GadgetOne, h.mag);
            }
        } else {
            h.ammo = mod.GetInventoryAmmo(p, mod.InventorySlots.GadgetOne);
            h.mag = mod.GetInventoryMagazineAmmo(p, mod.InventorySlots.GadgetOne);
            mod.AddEquipment(p, PORTAL, mod.InventorySlots.GadgetOne);
        }
        mod.ForceSwitchInventory(p, mod.InventorySlots.GadgetOne);
    } catch (e) {
        log("fakeslot", "swap failed for pid=" + h.pid + ": " + String(e));
        return;
    }
    h.forceUntil = nowMs + FAKE_SLOT_FORCE_MS;
    h.forceAt = nowMs + FORCE_EVERY_MS;
    h.portalIn = !h.portalIn;
    h.watch = markSwapped(h.watch, nowMs, FAKE_SLOT_BUSY_MS);
    paintBox(h);
    if (FAKE_SLOT_TRACE) {
        log("fakeslot", "pid=" + h.pid + " slot 3 -> " + (h.portalIn ? "Portal Gadget" : stash[1])
            + (h.portalIn ? " (ammo kept " + h.mag + "/" + h.ammo + ")" : ""));
    }
}

// ---------------------------------------------------------------- the hooks

// Replaces the per-deploy Portal Gadget grant. Slot 3 starts with the Portal
// Gadget; the gadget it pushed out becomes the stash.
export function grantPortalGadget(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    const before: boolean[] = carried(p);
    try {
        mod.AddEquipment(p, PORTAL, mod.InventorySlots.GadgetOne);
    } catch (e) {
        log("fakeslot", "portal gadget grant failed for pid=" + pid + ": " + String(e));
        return;
    }
    const after: boolean[] = carried(p);
    let stash: number = -1;
    for (let i: number = 0; i < SLOT3_GADGETS.length; i++) {
        if (before[i] && !after[i]) {
            stash = i;
            break;
        }
    }
    const old: Holder | undefined = holders[pid];
    if (old !== undefined) {
        dropBox(old);
    }
    const h: Holder = {
        pid: pid, p: p, stash: stash, portalIn: true, ammo: -1, mag: -1, watch: newWatch(activeSet(p)),
        forceUntil: 0, forceAt: 0, box: undefined, icon: undefined, iconSeq: old !== undefined ? old.iconSeq : 0,
        driving: isDriver(pid), menuOpen: false, g1Seen: false
    };
    holders[pid] = h;
    buildBox(h);
    if (h.driving && h.box !== undefined) {
        mod.SetUIWidgetVisible(h.box, false);
    }
    log("fakeslot", "pid=" + pid + " portal gadget in slot 3, swaps with "
        + (stash >= 0 ? SLOT3_GADGETS[stash][1] : "nothing (slot 3 held no known gadget)"));
}

function forget(pid: number): void {
    const h: Holder | undefined = holders[pid];
    if (h === undefined) {
        return;
    }
    dropBox(h);
    delete holders[pid];
}

function hasG1(set: string): boolean {
    return ("+" + set + "+").indexOf("+g1+") >= 0;
}

// The buy menu opened or closed (index.ts setMenuOpen).
export function setFakeSlotMenuOpen(pid: number, open: boolean): void {
    const h: Holder | undefined = holders[pid];
    if (h !== undefined) {
        h.menuOpen = open;
    }
}

function setDriving(h: Holder, driving: boolean): void {
    if (driving === h.driving) {
        return;
    }
    h.driving = driving;
    if (h.box !== undefined) {
        try {
            mod.SetUIWidgetVisible(h.box, !driving);
        } catch (e) {
        }
    }
}

// Tick counter for the staggered slot reads.
let fsTick: number = 0;

// Every tick, but the slots of a player are read only every
// FAKE_SLOT_POLL_TICKS ticks (spread across players by id): a slot switch
// takes hundreds of milliseconds, so 10 reads a second see every press. Right
// after a swap a player is read every tick until slot 3 comes up. The one
// per-tick read is IsFiring, and only while the stashed gadget is in hand: a
// launcher shot can last a single tick, and missing it would turn the
// engine's switch back to the gun into a false "3 again".
export function tickFakeSlot(): void {
    fsTick++;
    const nowMs: number = Date.now();
    for (const k in holders) {
        const h: Holder = holders[Number(k)];
        if (h.stash < 0 || h.driving || h.menuOpen) {
            continue;
        }
        try {
            stepHolder(h, nowMs);
        } catch (e) {
            log("fakeslot", "pid=" + h.pid + " step failed: " + String(e));
        }
    }
}

function stepHolder(h: Holder, nowMs: number): void {
    // The stashed gadget fired (a rocket, a mine thrown) counts as used.
    if (h.g1Seen && !h.portalIn && h.forceUntil === 0 && !h.watch.used
        && mod.GetSoldierState(h.p, mod.SoldierStateBool.IsFiring)) {
        h.watch = markUsed(h.watch);
    }
    if (h.forceUntil === 0 && (fsTick + h.pid) % FAKE_SLOT_POLL_TICKS !== 0) {
        return;
    }
    if (!mod.IsValid(h.p)) {
        forget(h.pid);
        return;
    }
    const set: string = activeSet(h.p);
    const g1In: boolean = hasG1(set);
    h.g1Seen = g1In;
    if (h.forceUntil !== 0) {
        if (g1In || nowMs >= h.forceUntil) {
            if (FAKE_SLOT_TRACE) {
                log("fakeslot", "pid=" + h.pid + (g1In ? " slot 3 in hand" : " slot 3 never came up")
                    + " after the swap");
            }
            h.forceUntil = 0;
        } else if (nowMs >= h.forceAt) {
            h.forceAt = nowMs + FORCE_EVERY_MS;
            mod.ForceSwitchInventory(h.p, mod.InventorySlots.GadgetOne);
        }
    }
    if (FAKE_SLOT_TRACE && set !== h.watch.set) {
        log("fakeslot", "pid=" + h.pid + " active " + h.watch.set + " -> " + set
            + (h.watch.used ? " (used)" : "") + ", before slot 3: " + h.watch.before);
    }
    const r: SlotResult = slotStep(h.watch, set, nowMs);
    h.watch = r.next;
    if (r.swap) {
        swap(h, nowMs);
    }
}

export function configureFakeSlotEvents(): void {
    onSeatChange((pid: number, _inVehicle: boolean, driver: boolean) => {
        const h: Holder | undefined = holders[pid];
        if (h !== undefined) {
            setDriving(h, driver);
        }
    });
    // Opening the buy menu is using the Portal Gadget.
    Events.OnPortalGadgetFireStart.subscribe((p: mod.Player) => {
        safe("fakeslot.portalFire", () => {
            const h: Holder | undefined = holders[mod.GetObjId(p)];
            if (h !== undefined) {
                h.watch = markUsed(h.watch);
            }
        });
    });
    Events.OnPlayerDied.subscribe((p: mod.Player) => {
        safe("fakeslot.died", () => { forget(mod.GetObjId(p)); });
    });
    Events.OnPlayerUndeploy.subscribe((p: mod.Player) => {
        safe("fakeslot.undeploy", () => { forget(mod.GetObjId(p)); });
    });
    Events.OnPlayerLeaveGame.subscribe((pid: number) => {
        safe("fakeslot.leave", () => { forget(pid); });
    });
}
