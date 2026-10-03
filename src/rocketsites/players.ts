import { V3 } from "./geom";
import { soldierPos } from "./fx";
import { tryGet } from "./log";

// Players who are deployed (OnPlayerDeployed until OnPlayerDied or leaving).
// Reading a soldier state of a player on the deploy screen throws
// PlayerNotDeployed: 223 of them in the 2026-10-03 14:14 log. The team is
// read once per deploy, and positions once per tick.

interface Deployed {
    p: mod.Player;
    pid: number;
    team: number;
}

export interface Located extends Deployed {
    pos: V3;
}

const deployed: { [pid: number]: Deployed } = {};
let posTick: number = -1;
let located: Located[] = [];

export function markDeployed(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    const team: number = tryGet("players.team", () => mod.GetObjId(mod.GetTeam(p))) ?? 0;
    deployed[pid] = { p, pid, team };
}

export function markUndeployed(pid: number): void {
    delete deployed[pid];
}

export function deployedCount(): number {
    return Object.keys(deployed).length;
}

// Every deployed soldier with its position, read once per tick.
export function deployedNow(tick: number): Located[] {
    if (tick !== posTick) {
        posTick = tick;
        located = [];
        for (const k of Object.keys(deployed)) {
            const d: Deployed = deployed[Number(k)];
            const pos: V3 | undefined = soldierPos(d.p);
            if (pos !== undefined) {
                located.push({ p: d.p, pid: d.pid, team: d.team, pos });
            }
        }
    }
    return located;
}
