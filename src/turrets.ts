import { Events } from "bf6-portal-utils/events";
import { Timers } from "bf6-portal-utils/timers";
import { log, safe, logAdmin, willLogDebug, invokeSubscriber } from "./util/log";
import { TURRETS, HQ_EXPLOSION, isConfigured, TurretDef } from "./objids";
import { TURRET_WARNING_SECS, TURRET_CLUSTER_REQ, HQ_HITS_REQUIRED } from "./config";
import { teamIdOf } from "./util/roster";
import { playSfxAll, playSfxTeam } from "./audio";
import { notifyTeam } from "./notify";
import { winnerForDestroyedBase, winMessageKey, hqHitKeys, HqHitKeys } from "./winner";
import { Vectors } from "bf6-portal-utils/vectors";

const turretByZone: { [zoneId: number]: TurretDef } = {};
const zoneHandles: { [zoneId: number]: mod.AreaTrigger } = {};
const destroyed: { [emplId: number]: boolean } = {};
const playerZones: { [pid: number]: number[] } = {};
const pending: { [pid: number]: Timers.TimerID | null } = {};
const clusterDestroyed: { [key: string]: number } = {};
const losOpen: { [base: string]: boolean } = {};

let hqHp: number[] = [0, 0, 0];
let matchOver: boolean = false;

// HQ damage listeners: (base, hits, required). index.ts uses this to drive the
// HUD's HQ health, which turrets.ts cannot reach directly.
export type HqHitListener = (base: number, hits: number, required: number) => void;
const hqHitListeners: HqHitListener[] = [];

export function onHqHit(fn: HqHitListener): void {
    hqHitListeners.push(fn);
}

export function initTurrets(): void {
    let zones: number = 0;
    for (let ti: number = 0; ti < TURRETS.length; ti++) {
        const t: TurretDef = TURRETS[ti];
        if (!isConfigured(t.zoneId)) {
            log("turrets", "skip turret " + t.emplId + " (zone id 0)");
            continue;
        }
        zones++;
        turretByZone[t.zoneId] = t;
        const zone: mod.AreaTrigger = mod.GetAreaTrigger(t.zoneId);
        if (!mod.IsValid(zone)) {
            log("turrets", "FAIL zone " + t.zoneId + " did not resolve");
            delete turretByZone[t.zoneId];
            zones--;
            continue;
        }
        // One-time position snapshot so the per-hit read path is FFI-free.
        cacheTurretPos(ti, t);
        zoneHandles[t.zoneId] = zone;
        if (isConfigured(t.vfxId)) {
            safe("turret.vfxhide", () => {
                mod.EnableVFX(mod.GetVFX(t.vfxId), false);
            });
        }
    }
    log("turrets", "zones bound: " + zones + "/" + TURRETS.length);
    if (zones === 0) {
        log("turrets", "no turret zones configured - kill zones idle");
    }
    resetMatch();
}

export function resetMatch(): void {
    hqHp = [0, 0, 0];
    matchOver = false;
    losOpen["1"] = false;
    losOpen["2"] = false;
    for (const k of Object.keys(clusterDestroyed)) {
        delete clusterDestroyed[k];
    }
    for (const k of Object.keys(destroyed)) {
        delete destroyed[Number(k)];
    }
    for (const t of TURRETS) {
        if (isConfigured(t.vfxId)) {
            safe("turret.vfxreset", () => {
                mod.EnableVFX(mod.GetVFX(t.vfxId), false);
            });
        }
        if (isConfigured(t.emplId)) {
            safe("turret.modelreset", () => {
                const o: mod.SpatialObject = mod.GetSpatialObject(t.emplId);
                if (mod.IsType(o, mod.Types.SpatialObject)) {
                    log("turret", "model " + t.emplId + " is a SpatialObject");
                }
            });
        }
    }
}

// Turret zone positions never move: the trigger layout in objids is static and
// the AreaTriggers are fixed map geometry. Resolving each one cost a
// GetAreaTrigger plus GetObjectPosition plus three component reads, and
// resolveHit called this sixteen times per ray. They are resolved once into a
// flat Float32Array at init, so the read path contains zero mod.* calls.
//
// Index layout is position * 3, with the y offset already applied.
const turretXYZ: Float32Array = new Float32Array(TURRETS.length * 3);
const turretResolved: { [index: number]: boolean } = {};

function cacheTurretPos(index: number, t: TurretDef): void {
    const base: number = index * 3;
    try {
        const v: Vectors.Vector3 = Vectors.toVector3(
            mod.GetObjectPosition(mod.GetAreaTrigger(t.zoneId))
        );
        turretXYZ[base] = v.x;
        turretXYZ[base + 1] = v.y + t.yOffset;
        turretXYZ[base + 2] = v.z;
        turretResolved[index] = true;
    } catch (e) {
        turretResolved[index] = false;
        log("turrets", "pos failed for turret " + t.emplId + ": " + String(e));
    }
}

// Squared distance from a hit point to a cached turret. No allocation, no mod.*.
export function turretResolvedAt(index: number): boolean {
    return turretResolved[index] === true;
}
export function turretDistSq(
    index: number,
    px: number,
    py: number,
    pz: number
): number {
    const base: number = index * 3;
    const dx: number = px - turretXYZ[base];
    const dy: number = py - turretXYZ[base + 1];
    const dz: number = pz - turretXYZ[base + 2];
    return dx * dx + dy * dy + dz * dz;
}


function addZone(pid: number, zoneId: number): void {
    let list: number[] = playerZones[pid];
    if (list === undefined) {
        list = [];
        playerZones[pid] = list;
    }
    if (list.indexOf(zoneId) < 0) {
        list.push(zoneId);
    }
}

function removeZone(pid: number, zoneId: number): void {
    const list: number[] | undefined = playerZones[pid];
    if (list === undefined) {
        return;
    }
    const i: number = list.indexOf(zoneId);
    if (i >= 0) {
        list.splice(i, 1);
    }
    if (list.length === 0) {
        delete playerZones[pid];
    }
}

function clearWarning(pid: number): void {
    const h: Timers.TimerID | null = pending[pid];
    if (h !== null && h !== undefined) {
        Timers.clear(h);
        pending[pid] = null;
    }
}

function armWarning(p: mod.Player, intruderTeam: number): void {
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    if (pending[pid] !== undefined && pending[pid] !== null) {
        return;
    }
    const h: Timers.TimerID | null = Timers.setTimeout(() => {
        safe("turret.kill", () => {
            pending[pid] = null;
            const zones: number[] | undefined = playerZones[pid];
            if (zones === undefined || zones.length === 0) {
                return;
            }
            try {
                mod.Kill(p);
                logAdmin("turrets", "KILLED pid " + pid + " in zone " + String(zones[0]));
            } catch (e) {
                log("turrets", "kill failed pid " + pid);
            }
        });
    }, TURRET_WARNING_SECS * 1000);
    if (h !== null) {
        pending[pid] = h;
    }
    playSfxTeam("killZone", intruderTeam, 0.5);
    notifyTeam(intruderTeam, "killZone", 0, 0);
}

function onEnterZone(p: mod.Player, at: mod.AreaTrigger): void {
    const zoneId: number = turretZoneId(at);
    const t: TurretDef | undefined = turretByZone[zoneId];
    if (!t) {
        // Gated: the message calls mod.GetObjId twice more purely to build a
        // string nobody reads at the default log level.
        if (willLogDebug()) {
            log("turrets", "UNMATCHED ENTER trigger=" + mod.GetObjId(at)
                + " pid=" + mod.GetObjId(p));
        }
        return;
    }
    const pid: number = mod.GetObjId(p);
    const team: number = teamIdOf(p);
    if (pid < 0 || team === 0) {
        log("turrets", "ENTER ignored invalid player/team zone=" + zoneId + " pid=" + pid + " team=" + team);
        return;
    }
    if (destroyed[t.emplId]) {
        log("turrets", "ENTER ignored destroyed turret zone=" + zoneId + " pid=" + pid);
        return;
    }
    if (team === t.base) {
        log("turrets", "ENTER friendly zone=" + zoneId + " pid=" + pid + " team=" + team);
        return;
    }
    addZone(pid, zoneId);
    log("turrets", "ENTER zone=" + zoneId + " pid=" + pid + " team=" + team + " base=" + t.base + " secs=" + String(TURRET_WARNING_SECS));
    armWarning(p, team);
}

// Exact ObjId only - see the note in capture.ts about the removed mod.Equals
// fallback, which mis-routed gates and turret zones.
function turretZoneId(at: mod.AreaTrigger): number {
    const id: number = mod.GetObjId(at);
    return turretByZone[id] !== undefined ? id : 0;
}

function onExitZone(p: mod.Player, at: mod.AreaTrigger): void {
    const pid: number = mod.GetObjId(p);
    const zoneId: number = turretZoneId(at);
    if (zoneId === 0) {
        if (willLogDebug()) {
            log("turrets", "UNMATCHED EXIT trigger=" + mod.GetObjId(at) + " pid=" + pid);
        }
        return;
    }
    removeZone(pid, zoneId);
    log("turrets", "EXIT zone=" + zoneId + " pid=" + pid);
    if (playerZones[pid] === undefined) {
        clearWarning(pid);
    }
}

export function destroyTurret(emplId: number): boolean {
    if (destroyed[emplId]) {
        return false;
    }
    let def: TurretDef | undefined;
    for (const t of TURRETS) {
        if (t.emplId === emplId) {
            def = t;
        }
    }
    if (!def) {
        return false;
    }
    destroyed[emplId] = true;

    if (isConfigured(def.vfxId)) {
        safe("turret.vfxon", () => {
            mod.EnableVFX(mod.GetVFX(def.vfxId), true);
        });
    }
    playSfxAll("turretDown", 0.7);

    if (isConfigured(def.emplId)) {
        // Scene-placed emplacements resolve to an invalid handle (ObjId -1);
        // UnspawnObject on those throws UnspawnObjectInvalidObject. Only try
        // when the handle is genuinely valid, otherwise rely on the VFX above.
        safe("turret.model", () => {
            const model: mod.Object = mod.GetSpatialObject(def.emplId);
            if (mod.IsValid(model)) {
                mod.UnspawnObject(model);
            } else {
                log("turrets", "turret " + emplId + " handle invalid - skipping unspawn");
            }
        });
    }

    const key: string = String(def.base) + "_" + String(def.cluster);
    clusterDestroyed[key] = (clusterDestroyed[key] || 0) + 1;
    log("turrets", "turret " + emplId + " destroyed (cluster " + key + " now " + String(clusterDestroyed[key]) + ")");

    notifyTeam(3 - def.base, "turretDestroyed", 0, 0);

    const bk: string = String(def.base);
    if (!losOpen[bk] && countDestroyed(def.base) >= TURRET_CLUSTER_REQ) {
        losOpen[bk] = true;
        playSfxAll("losOpen", 0.9);
        logAdmin("turrets", "base " + bk + " LINE OF SIGHT OPEN");
        notifyTeam(3 - Number(bk), "losOpen", 0, 0);
    }
    return true;
}

// Number of turrets actually destroyed at this base. This must count individual
// kills, not members of a destroyed cluster: every turret in a base shares one
// cluster, so counting per-cluster members opened the base after a single kill.
function countDestroyed(base: number): number {
    let n: number = 0;
    for (const t of TURRETS) {
        if (t.base === base && destroyed[t.emplId]) {
            n++;
        }
    }
    return n;
}

export function losOpenFor(base: number): boolean {
    return losOpen[String(base)] === true;
}

export function turretIsDestroyed(emplId: number): boolean {
    return destroyed[emplId] === true;
}

export function hqHitsFor(base: number): number {
    return hqHp[base];
}

export function hitHq(base: number): boolean {
    if (matchOver) {
        return false;
    }
    hqHp[base] = (hqHp[base] || 0) + 1;
    playSfxAll("hqHit", 0.9);
    const hits: number = hqHp[base];
    for (const fn of hqHitListeners) {
        invokeSubscriber(fn, base, hits, HQ_HITS_REQUIRED, undefined, "turrets.hqHit");
    }
    // base owns the HQ, so the attackers are the other team. The final hit is
    // announced by endMatchFor instead (keys === null).
    const keys: HqHitKeys | null = hqHitKeys(hits, HQ_HITS_REQUIRED);
    if (keys !== null) {
        const left: number = HQ_HITS_REQUIRED - hits;
        notifyTeam(base, keys.defender, left, HQ_HITS_REQUIRED);
        notifyTeam(winnerForDestroyedBase(base), keys.attacker, left, HQ_HITS_REQUIRED);
    }
    log("turrets", "HQ base " + base + " hit " + String(hqHp[base]) + "/" + String(HQ_HITS_REQUIRED));
    if (hqHp[base] >= HQ_HITS_REQUIRED) {
        matchOver = true;
        endMatchFor(base);
    }
    return true;
}

function endMatchFor(base: number): void {
    safe("turrets.end", () => {
        const idx: number = base === 1 ? 0 : 1;
        const vfx: number = HQ_EXPLOSION[idx];
        if (isConfigured(vfx)) {
            safe("turrets.explosion", () => {
                mod.EnableVFX(mod.GetVFX(vfx), true);
            });
        }
        playSfxAll("nukeFire", 1.0);
        // 'base' is the team that owned the destroyed HQ, so the winner is the
        // other team. The previous GetTeam(base - 1) passed team 0 when HQ 1
        // fell, and EndGameMode(team 0) is a draw (Tier 0). Both teams get the
        // same factual message: "NATO destroyed the PAX HQ" or the reverse.
        const winner: number = winnerForDestroyedBase(base);
        const msg: string = winMessageKey(winner);
        notifyTeam(1, msg, 0, 0);
        notifyTeam(2, msg, 0, 0);
        logAdmin("turrets", "HQ " + base + " destroyed - team " + winner + " WINS - EndGameMode");
        mod.EndGameMode(mod.GetTeam(winner));
    });
}

export function configureTurretEvents(): void {
    Events.OnPlayerEnterAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("turret.enter", () => { onEnterZone(p, at); });
    });
    Events.OnPlayerExitAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("turret.exit", () => { onExitZone(p, at); });
    });
    Events.OnPlayerLeaveGame.subscribe((id: number) => {
        safe("turret.leave", () => {
            clearWarning(id);
            delete playerZones[id];
        });
    });
}

export function playerZoneCount(pid: number): number {
    const l: number[] | undefined = playerZones[pid];
    return l === undefined ? 0 : l.length;
}
