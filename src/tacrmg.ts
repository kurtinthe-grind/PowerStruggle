import { Events } from "bf6-portal-utils/events";
import { log, safe } from "./util/log";
import { TAC_RMG_ROUND_MS } from "./config";
import { MOAC } from "./weapons";
import { castTacRound } from "./nuke";
import { roundStep, RoundState, RoundResult } from "./rorschshot";

// MP-RMG TAC: debug only, for fun (owner, 2026-10-04: removed for the final
// build). The Debug tab hands out the ordinary MP-RMG and marks the buyer here;
// every round it fires is the Rorsch's ray and nuke, explosion only (no radar
// or HQ effect). A round is each trigger press and one every TAC_RMG_ROUND_MS
// while it stays held (see roundStep). The mark goes on death, undeploy,
// leaving, or once the MP-RMG is gone; an MP-RMG bought anywhere else is a
// normal gun.

const carriers: { [pid: number]: mod.Player } = {};
const rounds: { [pid: number]: RoundState } = {};
// A press made with another weapon in hand: nothing fires until release.
const ignoredPress: { [pid: number]: boolean } = {};
let checkAt: number = 0;

export function markTacRmg(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    carriers[pid] = p;
    log("tacrmg", "pid=" + pid + " has the MP-RMG TAC");
}

export function clearTacRmg(pid: number): void {
    if (carriers[pid] === undefined) {
        return;
    }
    delete carriers[pid];
    delete rounds[pid];
    delete ignoredPress[pid];
    log("tacrmg", "pid=" + pid + " no longer has the MP-RMG TAC");
}

// The MP-RMG in hand: carried, and no sidearm or gadget slot active. A battle
// pickup reports no active slot while held (the Rorsch, test 2026-10-03).
function rmgInHand(p: mod.Player): boolean {
    return mod.HasEquipment(p, MOAC)
        && !mod.IsInventorySlotActive(p, mod.InventorySlots.SecondaryWeapon)
        && !mod.IsInventorySlotActive(p, mod.InventorySlots.GadgetOne)
        && !mod.IsInventorySlotActive(p, mod.InventorySlots.GadgetTwo);
}

export function tickTacRmg(): void {
    const keys: string[] = Object.keys(carriers);
    if (keys.length === 0) {
        return;
    }
    const nowMs: number = Date.now();
    const check: boolean = nowMs >= checkAt;
    if (check) {
        checkAt = nowMs + 1000;
    }
    for (const k of keys) {
        const pid: number = Number(k);
        const p: mod.Player = carriers[pid];
        safe("tacrmg.tick", () => {
            if (!mod.IsValid(p)) {
                clearTacRmg(pid);
                return;
            }
            if (check && !mod.HasEquipment(p, MOAC)) {
                clearTacRmg(pid);
                return;
            }
            const firing: boolean = mod.GetSoldierState(p, mod.SoldierStateBool.IsFiring);
            if (!firing) {
                delete rounds[pid];
                delete ignoredPress[pid];
                return;
            }
            if (ignoredPress[pid] === true) {
                return;
            }
            if (rounds[pid] === undefined && !rmgInHand(p)) {
                ignoredPress[pid] = true;
                return;
            }
            const r: RoundResult = roundStep(rounds[pid], true, nowMs, TAC_RMG_ROUND_MS);
            if (r.next !== undefined) {
                rounds[pid] = r.next;
            }
            if (r.fire) {
                castTacRound(p, pid);
            }
        });
    }
}

export function configureTacRmgEvents(): void {
    Events.OnPlayerDied.subscribe((victim: mod.Player) => {
        safe("tacrmg.died", () => { clearTacRmg(mod.GetObjId(victim)); });
    });
    Events.OnPlayerUndeploy.subscribe((p: mod.Player) => {
        safe("tacrmg.undeploy", () => { clearTacRmg(mod.GetObjId(p)); });
    });
    Events.OnPlayerLeaveGame.subscribe((pid: number) => {
        safe("tacrmg.leave", () => { clearTacRmg(pid); });
    });
}
