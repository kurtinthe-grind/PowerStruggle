import { Events } from "bf6-portal-utils/events";

// Who sits in a vehicle, and who drives, kept from the engine's vehicle and
// seat events instead of reading IsInVehicle every tick. Each event reads the
// seat once, so a seat switch inside a vehicle is followed too.

const seatOf: { [pid: number]: number } = {};
type SeatListener = (pid: number, inVehicle: boolean, driver: boolean) => void;
const listeners: SeatListener[] = [];

// Told whenever a player's vehicle state changes (fakeslot.ts hides its box
// in the driver seat).
export function onSeatChange(fn: SeatListener): void {
    listeners.push(fn);
}

export function inVehicle(pid: number): boolean {
    return seatOf[pid] !== undefined;
}

export function isDriver(pid: number): boolean {
    return seatOf[pid] === 0;
}

function set(pid: number, seat: number | undefined): void {
    const was: number | undefined = seatOf[pid];
    if (was === seat) {
        return;
    }
    if (seat === undefined) {
        delete seatOf[pid];
    } else {
        seatOf[pid] = seat;
    }
    for (const fn of listeners) {
        try {
            fn(pid, seat !== undefined, seat === 0);
        } catch (e) {
        }
    }
}

// Reads the player's seat now: -1 seat numbers and failed reads count as out.
function refresh(p: mod.Player): void {
    let pid: number = -1;
    let seat: number | undefined = undefined;
    try {
        pid = mod.GetObjId(p);
        if (mod.GetSoldierState(p, mod.SoldierStateBool.IsInVehicle)) {
            const s: number = mod.GetPlayerVehicleSeat(p);
            seat = s >= 0 ? s : undefined;
        }
    } catch (e) {
        seat = undefined;
    }
    if (pid >= 0) {
        set(pid, seat);
    }
}

Events.OnPlayerEnterVehicle.subscribe((p: mod.Player) => {
    refresh(p);
});
Events.OnPlayerEnterVehicleSeat.subscribe((p: mod.Player) => {
    refresh(p);
});
Events.OnPlayerExitVehicleSeat.subscribe((p: mod.Player) => {
    refresh(p);
});
Events.OnPlayerExitVehicle.subscribe((p: mod.Player) => {
    try {
        set(mod.GetObjId(p), undefined);
    } catch (e) {
    }
});
Events.OnPlayerDied.subscribe((p: mod.Player) => {
    try {
        set(mod.GetObjId(p), undefined);
    } catch (e) {
    }
});
Events.OnPlayerUndeploy.subscribe((p: mod.Player) => {
    try {
        set(mod.GetObjId(p), undefined);
    } catch (e) {
    }
});
Events.OnPlayerLeaveGame.subscribe((pid: number) => {
    set(pid, undefined);
});
