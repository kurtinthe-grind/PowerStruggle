import { Events } from "bf6-portal-utils/events";
import { Timers } from "bf6-portal-utils/timers";
import { log, safe, invokeSubscriber, willLogDebug } from "./util/log";
import { CAPTURE_SECONDS, CAPTURE_TICK_HZ, CAPTURE_DECAY } from "./config";
import { allAreaBuildings, isConfigured, AreaBuildingDef } from "./objids";
import { playerById, teamIdOf } from "./util/roster";
import { playSfxPlayer, SfxKey } from "./audio";
import { notifyPlayer } from "./notify";

export interface BuildingState {
    def: AreaBuildingDef;
    trigger: mod.AreaTrigger;
    occupants: number[];
    occupantTeam: { [id: number]: number };
    progress: { 1: number; 2: number };
    owner: number;
    contested: boolean;
    ticking: boolean;
    tickAccum: number;
}

// occupants is the AreaTrigger's live occupant list, captured at the instant
// the point flipped. Only those players are paid, not the whole team.
export type CaptureListener = (def: AreaBuildingDef, newOwner: number, occupants: number[]) => void;

const byTrigger: { [triggerId: number]: BuildingState } = {};
const states: BuildingState[] = [];
const listeners: CaptureListener[] = [];

let timer: Timers.TimerID | null = null;

const perSecond: number = 1 / CAPTURE_SECONDS;

function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function onCaptured(fn: CaptureListener): void {
    listeners.push(fn);
}

function fireCaptured(def: AreaBuildingDef, owner: number, occupants: number[]): void {
    for (const fn of listeners) {
        invokeSubscriber(fn, def, owner, occupants, undefined, "capture." + def.id);
    }
}

export function initCapture(): void {
    for (const def of allAreaBuildings()) {
        if (!isConfigured(def.areaTriggerId)) {
            log("capture", "skip " + def.id + " (AreaTrigger id 0 - unconfigured)");
            continue;
        }
        const trigger: mod.AreaTrigger = mod.GetAreaTrigger(def.areaTriggerId);
        if (!mod.IsValid(trigger)) {
            log("capture", "FAIL " + def.id + " trigger " + def.areaTriggerId + " did not resolve");
            continue;
        }
        const st: BuildingState = {
            def: def,
            trigger: trigger,
            occupants: [],
            occupantTeam: {},
            progress: { 1: 0, 2: 0 },
            owner: 0,
            contested: false,
            ticking: false,
            tickAccum: 0
        };
        states.push(st);
        byTrigger[def.areaTriggerId] = st;
        log("capture", "bound " + def.id + " trigger=" + def.areaTriggerId + " kind=" + def.kind);
    }
    if (states.length === 0) {
        log("capture", "no AreaTrigger buildings configured - capture system idle");
        return;
    }
    timer = Timers.setInterval(() => { safe("capture.tick", tick); }, Math.floor(1000 / CAPTURE_TICK_HZ));
    if (timer === null) {
        log("capture", "FATAL: Timers pool full, capture tick not scheduled");
    }
}

function tick(): void {
    const dt: number = 1 / CAPTURE_TICK_HZ;
    tickClock = tickClock + dt;
    for (const st of states) {
        if (st.occupants.length === 0) {
            continue;
        }
        let n1: number = 0;
        let n2: number = 0;
        for (const id of st.occupants) {
            const t: number = st.occupantTeam[id];
            if (t === 1) {
                n1++;
            } else if (t === 2) {
                n2++;
            }
        }

        st.contested = n1 > 0 && n2 > 0;
        if (st.contested) {
            if (!st.ticking) {
                st.ticking = true;
                    // Contested is a both-teams event, so it used to be playSfxAll:
                    // every player in the match heard it, including people nowhere
                    // near the point, and with bots contesting points constantly it
                    // was a repeating stinger. Now routed per team, behind a shared
                    // cooldown, and only for a team with a human on the point.
                          contestedAt = contestedAt + dt;
                      if (contestedAt >= CONTESTED_INTERVAL) {
                          contestedAt = 0;
                          for (const p of occupantPlayers(st, 1)) {
                              playSfxPlayer("capContested", p, 0.4);
                          }
                          for (const p of occupantPlayers(st, 2)) {
                              playSfxPlayer("capContested", p, 0.4);
                          }
                      }
            }
            continue;
        }

        if (n1 > 0) {
            if (st.owner === 1 && st.progress[1] >= 1) {
                st.ticking = false;
                continue;
            }
            st.progress[1] = clamp01(st.progress[1] + perSecond * Math.min(n1, 3) * dt);
            st.progress[2] = clamp01(st.progress[2] - perSecond * CAPTURE_DECAY * dt);
            beginTick(st, 1);
        } else if (n2 > 0) {
            if (st.owner === 2 && st.progress[2] >= 1) {
                st.ticking = false;
                continue;
            }
            st.progress[2] = clamp01(st.progress[2] + perSecond * Math.min(n2, 3) * dt);
            st.progress[1] = clamp01(st.progress[1] - perSecond * CAPTURE_DECAY * dt);
            beginTick(st, 2);
        } else {
            st.ticking = false;
        }
        resolveOwner(st);
    }
}

const TICK_INTERVAL: number = 0.5;

// The players actually standing in this objective's AreaTrigger right now,
// filtered to one team.
//
// This is the exact population, not a proximity estimate: the trigger's own
// occupant list already tells us who is inside the polygon volume, and
// bunkers get the same information from mod.GetPlayersOnPoint. Broadcast capture
// feedback to the whole team instead meant 24 bots per team made a player hear
// tick sounds and see capture notices for points on the far side of the map, so
// every capture cue below is delivered only to the players inside the volume.
//
// Returns the occupants that resolve to a live Player, so callers can hand the
// same list to both the sound and the feed.
function occupantPlayers(st: BuildingState, team: number): mod.Player[] {
    const out: mod.Player[] = [];
    for (const id of st.occupants) {
        if (st.occupantTeam[id] !== team) {
            continue;
        }
        const p: mod.Player | undefined = playerById(id);
        if (p !== undefined) {
            out.push(p);
        }
    }
    return out;
}

// Shared across every building, so a screen full of contested points produces
// one sting every CONTESTED_INTERVAL rather than one per building per capture
// episode.
const CONTESTED_INTERVAL: number = 3;
let contestedAt: number = 0;

// One shared cooldown per sound key across every building. beginTick runs once
// per actively-capturing building, so without this N simultaneous captures
// stacked N copies of the same tick on the same 0.5s boundary.
const tickSfxAt: { [k: string]: number } = {};
let tickClock: number = 0;

function beginTick(st: BuildingState, team: number): void {
    if (!st.ticking) {
        st.ticking = true;
        st.tickAccum = 0;
        log("capture", st.def.id + " capture started by team " + team);
        for (const p of occupantPlayers(st, team)) {
            notifyPlayer(p, "capStarted", st.def.factoryName, 0);
        }
    }
    st.tickAccum = st.tickAccum + dt();
    if (st.tickAccum >= TICK_INTERVAL) {
        st.tickAccum = 0;
        const key: SfxKey = team === 1 ? "capTick" : "capTickEnemy";
        if (tickSfxAt[key] === undefined || tickClock - tickSfxAt[key] >= TICK_INTERVAL) {
            tickSfxAt[key] = tickClock;
            // Only to the players inside the volume, not the whole team.
            for (const p of occupantPlayers(st, team)) {
                playSfxPlayer(key, p, 0.55);
            }
        }
    }
}

function dt(): number {
    return 1 / CAPTURE_TICK_HZ;
}

function resolveOwner(st: BuildingState): void {
    if (st.progress[1] >= 1 && st.owner !== 1) {
        st.owner = 1;
        // Latch both bars: leaving the owner's progress at 1 while the loser
        // decayed let the next tick re-enter beginTick, which re-announced the
        // capture and replayed the start/tick sounds indefinitely.
        st.progress[1] = 1;
        st.progress[2] = 0;
        st.ticking = false;
        // Delivered only to the players standing in the volume. The capture
        // itself and its payout are unaffected, so a bot-only capture still
        // completes and is still scored - it just stops interrupting players
        // who are not there.
        for (const p of occupantPlayers(st, 1)) {
            playSfxPlayer("capDone", p, 0.8);
            playSfxPlayer("siteYours", p, 0.6);
            notifyPlayer(p, "capDone", st.def.factoryName, 0);
        }
        log("capture", st.def.id + " captured by team 1");
        fireCaptured(st.def, 1, st.occupants);
    } else if (st.progress[2] >= 1 && st.owner !== 2) {
        st.owner = 2;
        st.progress[2] = 1;
        st.progress[1] = 0;
        st.ticking = false;
        for (const p of occupantPlayers(st, 2)) {
            playSfxPlayer("capDoneEnemy", p, 0.8);
            playSfxPlayer("siteFoe", p, 0.6);
            notifyPlayer(p, "capDone", st.def.factoryName, 0);
        }
        log("capture", st.def.id + " captured by team 2");
        fireCaptured(st.def, 2, st.occupants);
    }
}

// Match ONLY by exact ObjId. A mod.Equals fallback was tried and removed: it is
// not discriminating for AreaTrigger handles, so HQ gates (7500/7501) and turret
// zones (7100-7107) were matched to site1, letting the player "capture" an
// energy site while standing in a kill zone. Unknown triggers are reported.
function stateForTrigger(at: mod.AreaTrigger): BuildingState | undefined {
    return byTrigger[mod.GetObjId(at)];
}

function onEnter(p: mod.Player, at: mod.AreaTrigger): void {
    const zoneId: number = mod.GetObjId(at);
    const id: number = mod.GetObjId(p);
    const st: BuildingState | undefined = stateForTrigger(at);
    if (!st) {
        if (willLogDebug()) {
        log("capture", "UNMATCHED ENTER trigger=" + zoneId + " pid=" + id);
    }
        return;
    }
    if (id < 0) {
        log("capture", "ENTER ignored invalid player trigger=" + zoneId);
        return;
    }
    const team: number = teamIdOf(p);
    if (team !== 1 && team !== 2) {
        log("capture", "ENTER ignored invalid team trigger=" + zoneId + " pid=" + id + " team=" + team);
        return;
    }
    if (st.occupants.indexOf(id) < 0) {
        st.occupants.push(id);
    }
    st.occupantTeam[id] = team;
    if (willLogDebug()) {
        log("capture", "ENTER " + st.def.id + " zone=" + zoneId + " pid=" + id
            + " team=" + team + " occ=" + st.occupants.length);
    }
}

function onExit(p: mod.Player, at: mod.AreaTrigger): void {
    const zoneId: number = mod.GetObjId(at);
    const st: BuildingState | undefined = stateForTrigger(at);
    if (!st) {
        if (willLogDebug()) {
            log("capture", "UNMATCHED EXIT trigger=" + zoneId + " pid=" + mod.GetObjId(p));
        }
        return;
    }
    const id: number = mod.GetObjId(p);
    const i: number = st.occupants.indexOf(id);
    if (i >= 0) {
        st.occupants.splice(i, 1);
    }
    delete st.occupantTeam[id];
    if (willLogDebug()) {
        log("capture", "EXIT " + st.def.id + " zone=" + zoneId + " pid=" + id
            + " occ=" + st.occupants.length);
    }
}

function onLeave(id: number): void {
    for (const st of states) {
        const i: number = st.occupants.indexOf(id);
        if (i >= 0) {
            st.occupants.splice(i, 1);
        }
        delete st.occupantTeam[id];
    }
}

export function buildingById(id: string): BuildingState | undefined {
    for (const st of states) {
        if (st.def.id === id) {
            return st;
        }
    }
    return undefined;
}

export function buildingsOfKind(kind: string): BuildingState[] {
    const out: BuildingState[] = [];
    for (const st of states) {
        if (st.def.kind === kind) {
            out.push(st);
        }
    }
    return out;
}

export function allStates(): BuildingState[] {
    return states;
}

export function buildingForPlayer(pid: number): BuildingState | undefined {
    for (const st of states) {
        if (st.occupants.indexOf(pid) >= 0) {
            return st;
        }
    }
    return undefined;
}

export function buildingAtTrigger(triggerId: number): BuildingState | undefined {
    return byTrigger[triggerId];
}

export function configureCaptureEvents(): void {
    Events.OnPlayerEnterAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("area.enter", () => { onEnter(p, at); });
    });
    Events.OnPlayerExitAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("area.exit", () => { onExit(p, at); });
    });
    Events.OnPlayerLeaveGame.subscribe((id: number) => {
        safe("area.leave", () => { onLeave(id); });
    });
}

export function shutdownCapture(): void {
    if (timer !== null) {
        Timers.clear(timer);
        timer = null;
    }
    states.length = 0;
}
