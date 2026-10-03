import { Events } from "bf6-portal-utils/events";
import { Vectors } from "bf6-portal-utils/vectors";
import { PlayerLocations } from "bf6-portal-utils/player-locations";
import { log, safe } from "./util/log";
import { isBotPid } from "./bots";
import {
    NUKE_ALARM_RANGE_M, NUKE_BLACK_HOLD_MS, NUKE_BLACK_MS, NUKE_BLAST_DMG_FAR, NUKE_BLAST_DMG_NEAR,
    NUKE_BURN_DPS, NUKE_BURN_M, NUKE_BURN_S, NUKE_CARRIER_DROP_M, NUKE_FOLLOW_MAX, NUKE_FX_MS, NUKE_KILL_M,
    NUKE_PLUME_MS, NUKE_SHOCK_SCALE, NUKE_WHITE_FADE_MS, NUKE_WHITE_HOLD_MS, NUKE_WITNESS_M
} from "./config";
import { onRorschOwnerGone, pollRorsch } from "./rorschammo";

// The Rorsch impact as a small tactical nuke (agreed with the mode owner,
// 2026-10-03). Every impact, anywhere, friendly fire included:
//
//   world    two Carrier explosions, four Huge Horizon blasts in a ring, the
//            Med Horizon multi-blast, a smoke plume (removed after
//            NUKE_PLUME_MS, it loops forever) and a ring of dirt shockwaves;
//            the gas-station collapse close and distant. Nothing is left.
//   kill     inside NUKE_KILL_M: a black screen for NUKE_BLACK_MS (humans),
//            then death credited to the shooter.
//   burn     to NUKE_BURN_M: blast damage, burning for NUKE_BURN_S, and for
//            humans the full sequence below.
//   witness  to NUKE_WITNESS_M: a short thermal flash (humans).
//
// Close-player sequence (ms after impact): 0 white screen, held
// NUKE_WHITE_HOLD_MS then faded over NUKE_WHITE_FADE_MS, plus the Thermal BHOT
// effect; 400 remote-turret damage effect; 800 VL7 gas mask; 1200 the
// death-warning drone; 1500 thermal flash; 2000 the adrenaline "making sense
// of it" sound; 6000 the calm: VL7 and the drone off, Saturated and the
// adrenaline effect; 10000 Saturated off. In a vehicle the drone out-of-range
// distortion replaces the world-object screen effects.
//
// The "screen effect" VFX are world objects: spawned 3 m in front of the eyes
// they look like screen effects, but stay where they were spawned (the reason
// the flashbang effect "stopped working" when the owner moved). They are moved
// in front of the player's eyes every tick, for at most NUKE_FOLLOW_MAX
// players per blast; VL7 and Saturated are real per-player effects.
//
// Everything is driven by one step queue run from the per-tick hook, so a
// blast costs no timers from the shared pool.

// ------------------------------------------------------------------- helpers

let zeroVec: mod.Vector | undefined = undefined;
let oneVec: mod.Vector | undefined = undefined;

function zero(): mod.Vector {
    if (zeroVec === undefined) {
        zeroVec = mod.CreateVector(0, 0, 0);
    }
    return zeroVec;
}

function one(): mod.Vector {
    if (oneVec === undefined) {
        oneVec = mod.CreateVector(1, 1, 1);
    }
    return oneVec;
}

interface Step {
    at: number;
    fn: () => void;
}

const steps: Step[] = [];

function after(ms: number, fn: () => void): void {
    steps.push({ at: Date.now() + ms, fn: fn });
}

const sfxCache: { [key: string]: mod.SFX } = {};

function sfxObj(key: string, asset: mod.RuntimeSpawn_Common): mod.SFX | undefined {
    let s: mod.SFX | undefined = sfxCache[key];
    if (s !== undefined) {
        return s;
    }
    try {
        s = mod.SpawnObject(asset, zero(), zero()) as mod.SFX;
        sfxCache[key] = s;
        return s;
    } catch (e) {
        log("nuke", "sound spawn failed for " + key + ": " + String(e));
        return undefined;
    }
}

function play2D(key: string, asset: mod.RuntimeSpawn_Common, p: mod.Player, amp: number): void {
    const s: mod.SFX | undefined = sfxObj(key, asset);
    if (s === undefined) {
        return;
    }
    try {
        mod.PlaySound(s, amp, p);
    } catch (e) {
    }
}

function stop2D(key: string, p: mod.Player): void {
    const s: mod.SFX | undefined = sfxCache[key];
    if (s === undefined) {
        return;
    }
    try {
        mod.StopSound(s, p);
    } catch (e) {
    }
}

function play3D(key: string, asset: mod.RuntimeSpawn_Common, x: number, y: number, z: number,
    amp: number, range: number): void {
    const s: mod.SFX | undefined = sfxObj(key, asset);
    if (s === undefined) {
        return;
    }
    try {
        mod.PlaySound(s, amp, mod.CreateVector(x, y, z), range);
    } catch (e) {
    }
}

function spawnFx(asset: mod.RuntimeSpawn_Common, x: number, y: number, z: number, scale: number): mod.VFX | undefined {
    try {
        const fx: mod.VFX = mod.SpawnObject(asset, mod.CreateVector(x, y, z), zero(), one()) as mod.VFX;
        mod.EnableVFX(fx, true);
        if (scale !== 1) {
            mod.SetVFXScale(fx, scale);
        }
        return fx;
    } catch (e) {
        log("nuke", "effect spawn failed: " + String(e));
        return undefined;
    }
}

function killFx(fx: mod.VFX | undefined): void {
    if (fx === undefined) {
        return;
    }
    try {
        mod.EnableVFX(fx, false);
        mod.UnspawnObject(fx);
    } catch (e) {
    }
}

function isAlive(p: mod.Player): boolean {
    try {
        return mod.IsValid(p) && mod.GetSoldierState(p, mod.SoldierStateBool.IsAlive);
    } catch (e) {
        return false;
    }
}

function hurt(p: mod.Player, amount: number, shooter: mod.Player): void {
    try {
        if (mod.IsValid(shooter)) {
            mod.DealDamage(p, amount, shooter);
        } else {
            mod.DealDamage(p, amount);
        }
    } catch (e) {
    }
}

// Deaths per player id: a step queued in one life never touches the next one
// (persistent bots come back as the same player).
const life: { [pid: number]: number } = {};

function lifeOf(pid: number): number {
    const l: number | undefined = life[pid];
    return l === undefined ? 0 : l;
}

// ---------------------------------------------------- effects on the screen

interface Follow {
    pid: number;
    player: mod.Player;
    fx: mod.VFX;
    until: number;
}

const follows: Follow[] = [];

function eyeFront(p: mod.Player): mod.Vector {
    const eye: mod.Vector = mod.GetSoldierState(p, mod.SoldierStateVector.EyePosition);
    const facing: mod.Vector = mod.Normalize(mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection));
    return mod.Add(eye, mod.Multiply(facing, 3));
}

function attachFx(pid: number, p: mod.Player, asset: mod.RuntimeSpawn_Common, ms: number): void {
    try {
        const at: Vectors.Vector3 = Vectors.toVector3(eyeFront(p));
        const fx: mod.VFX | undefined = spawnFx(asset, at.x, at.y, at.z, 1);
        if (fx !== undefined) {
            follows.push({ pid: pid, player: p, fx: fx, until: Date.now() + ms });
        }
    } catch (e) {
    }
}

function dropFollows(pid: number): void {
    for (let i: number = follows.length - 1; i >= 0; i--) {
        if (follows[i].pid === pid) {
            killFx(follows[i].fx);
            follows.splice(i, 1);
        }
    }
}

function tickFollows(nowMs: number): void {
    for (let i: number = follows.length - 1; i >= 0; i--) {
        const f: Follow = follows[i];
        if (nowMs >= f.until || !mod.IsValid(f.player)) {
            killFx(f.fx);
            follows.splice(i, 1);
            continue;
        }
        try {
            mod.MoveVFX(f.fx, eyeFront(f.player), zero());
        } catch (e) {
        }
    }
}

// A human going through the close or kill sequence. One per player: a second
// blast restarts it.
interface Victim {
    pid: number;
    player: mod.Player;
    ui: mod.UIWidget | undefined;
    vl7: boolean;
    sat: boolean;
    heat: boolean;
    drone: boolean;
    fire: boolean;
}

const victims: { [pid: number]: Victim } = {};
let panelSeq: number = 0;

function begin(pid: number, p: mod.Player): Victim {
    const old: Victim | undefined = victims[pid];
    if (old !== undefined) {
        endVictim(old);
    }
    const v: Victim = { pid: pid, player: p, ui: undefined, vl7: false, sat: false, heat: false, drone: false, fire: false };
    victims[pid] = v;
    return v;
}

function current(v: Victim): boolean {
    return victims[v.pid] === v && mod.IsValid(v.player);
}

function removePanel(v: Victim): void {
    if (v.ui === undefined) {
        return;
    }
    try {
        mod.DeleteUIWidget(v.ui);
    } catch (e) {
    }
    v.ui = undefined;
}

function setVl7(v: Victim, on: boolean): void {
    v.vl7 = on;
    try {
        mod.EnableScreenEffect(v.player, mod.ScreenEffects.VL7, on);
        mod.SetSoldierEffect(v.player, mod.SoldierEffects.VL7Effect, on);
    } catch (e) {
    }
}

function setSaturated(v: Victim, on: boolean): void {
    v.sat = on;
    try {
        mod.EnableScreenEffect(v.player, mod.ScreenEffects.Saturated, on);
    } catch (e) {
    }
}

function setHeat(v: Victim, on: boolean): void {
    v.heat = on;
    try {
        mod.SetSoldierEffect(v.player, mod.SoldierEffects.HeatStatusEffect, on);
    } catch (e) {
    }
}

function stopDrone(v: Victim): void {
    if (v.drone) {
        v.drone = false;
        stop2D("drone", v.player);
    }
}

function stopFire(v: Victim): void {
    if (v.fire) {
        v.fire = false;
        stop2D("fireLoop", v.player);
    }
}

// Undoes everything still on for this player: on death, on leaving, when a
// new blast restarts the sequence, and at the end.
function endVictim(v: Victim): void {
    if (victims[v.pid] === v) {
        delete victims[v.pid];
    }
    removePanel(v);
    if (mod.IsValid(v.player)) {
        if (v.vl7) {
            setVl7(v, false);
        }
        if (v.sat) {
            setSaturated(v, false);
        }
        if (v.heat) {
            setHeat(v, false);
        }
        stopDrone(v);
        stopFire(v);
    }
    dropFollows(v.pid);
}

// Full-screen panel for this player, at alpha 1.
function addPanel(pid: number, p: mod.Player, r: number, g: number, b: number): mod.UIWidget | undefined {
    panelSeq++;
    const name: string = "psh_nuke_" + pid + "_" + panelSeq;
    try {
        mod.AddUIContainer(name, zero(), mod.CreateVector(5000, 5000, 0), mod.UIAnchor.Center, mod.GetUIRoot(),
            true, 0, mod.CreateVector(r, g, b), 1, mod.UIBgFill.Solid, mod.UIDepth.AboveGameUI, p);
        return mod.FindUIWidgetWithName(name);
    } catch (e) {
        log("nuke", "flash panel failed for pid=" + pid + ": " + String(e));
        return undefined;
    }
}

function panel(v: Victim, r: number, g: number, b: number): void {
    removePanel(v);
    v.ui = addPanel(v.pid, v.player, r, g, b);
}

// Fades a panel out in 200 ms steps starting at holdMs, then deletes it. ok()
// says whether the panel is still wanted (a new blast may have replaced it).
function fadePanel(w: mod.UIWidget, holdMs: number, fadeMs: number, ok: () => boolean): void {
    const n: number = Math.max(1, Math.round(fadeMs / 200));
    for (let k: number = 1; k <= n; k++) {
        const alpha: number = 1 - k / n;
        after(holdMs + k * 200, () => {
            if (!ok()) {
                return;
            }
            try {
                if (alpha <= 0) {
                    mod.DeleteUIWidget(w);
                } else {
                    mod.SetUIWidgetBgAlpha(w, alpha);
                }
            } catch (e) {
            }
        });
    }
}

// Black panels that outlive their owner's death, per player, so a second
// blast or leaving the game can still remove them.
const blackPanels: { [pid: number]: mod.UIWidget } = {};

function dropBlack(pid: number): void {
    const w: mod.UIWidget | undefined = blackPanels[pid];
    if (w === undefined) {
        return;
    }
    delete blackPanels[pid];
    try {
        mod.DeleteUIWidget(w);
    } catch (e) {
    }
}

// ------------------------------------------------------------ the blast

function worldEffects(x: number, y: number, z: number): void {
    const made: (mod.VFX | undefined)[] = [];
    made.push(spawnFx(mod.RuntimeSpawn_Common.FX_Carrier_Explosion_Dist, x, y - NUKE_CARRIER_DROP_M, z, 1));
    const plume: mod.VFX | undefined = spawnFx(mod.RuntimeSpawn_Common.FX_BASE_Smoke_Column_XXL, x, y, z, 1);
    made.push(spawnFx(mod.RuntimeSpawn_Common.VFX_Launchers_GroundShockwave_Dirt, x, y, z, NUKE_SHOCK_SCALE + 1));
    after(50, () => {
        for (let i: number = 0; i < 6; i++) {
            const a: number = i * Math.PI / 3;
            made.push(spawnFx(mod.RuntimeSpawn_Common.VFX_Launchers_GroundShockwave_Dirt,
                x + Math.cos(a) * 6, y, z + Math.sin(a) * 6, NUKE_SHOCK_SCALE));
        }
    });
    after(150, () => {
        made.push(spawnFx(mod.RuntimeSpawn_Common.FX_BD_Med_Horizon_Exp_Multi, x, y, z, 1));
    });
    after(250, () => {
        made.push(spawnFx(mod.RuntimeSpawn_Common.FX_Carrier_Explosion_Dist, x, y - NUKE_CARRIER_DROP_M, z, 1));
    });
    for (let i: number = 0; i < 4; i++) {
        const a: number = i * Math.PI / 2 + Math.PI / 4;
        after(i * 100, () => {
            made.push(spawnFx(mod.RuntimeSpawn_Common.FX_BD_Huge_Horizon_Exp,
                x + Math.cos(a) * 8, y, z + Math.sin(a) * 8, 1));
        });
    }
    after(NUKE_PLUME_MS, () => { killFx(plume); });
    after(NUKE_FX_MS, () => {
        for (const fx of made) {
            killFx(fx);
        }
    });
    play3D("blastClose", mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_GasStation_Collapse_OneShot3D,
        x, y, z, 1, 200);
    play3D("blastFar", mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_GasStation_Collapse_Distant_OneShot3D,
        x, y, z, 1, 2000);
}

function killZone(p: mod.Player, pid: number, human: boolean, shooter: mod.Player): void {
    if (!human) {
        hurt(p, 1000, shooter);
        return;
    }
    const v: Victim | undefined = victims[pid];
    if (v !== undefined) {
        endVictim(v);
    }
    dropBlack(pid);
    const w: mod.UIWidget | undefined = addPanel(pid, p, 0, 0, 0);
    const l: number = lifeOf(pid);
    after(NUKE_BLACK_MS, () => {
        if (lifeOf(pid) === l && isAlive(p)) {
            hurt(p, 1000, shooter);
        }
    });
    if (w === undefined) {
        return;
    }
    // Stays up through the death, then fades.
    blackPanels[pid] = w;
    fadePanel(w, NUKE_BLACK_HOLD_MS, 1000, () => blackPanels[pid] === w);
    after(NUKE_BLACK_HOLD_MS + 1200, () => {
        if (blackPanels[pid] === w) {
            delete blackPanels[pid];
        }
    });
}

function burn(p: mod.Player, pid: number, v: Victim | undefined, shooter: mod.Player): void {
    const l: number = lifeOf(pid);
    if (v !== undefined) {
        setHeat(v, true);
        play2D("fireStart", mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Fire_Start_OneShot2D, p, 1);
        play2D("fireLoop", mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Fire_Normal_SimpleLoop2D, p, 0.8);
        v.fire = true;
    }
    for (let s: number = 1; s <= NUKE_BURN_S; s++) {
        after(s * 1000, () => {
            if (lifeOf(pid) === l && isAlive(p)) {
                hurt(p, NUKE_BURN_DPS, shooter);
            }
        });
    }
    if (v !== undefined) {
        after(NUKE_BURN_S * 1000 + 100, () => {
            if (current(v)) {
                setHeat(v, false);
                stopFire(v);
            }
        });
    }
}

function closeSequence(v: Victim, inVehicle: boolean, follow: boolean): void {
    const p: mod.Player = v.player;
    const pid: number = v.pid;
    const screenFx: boolean = follow && !inVehicle;
    panel(v, 1, 1, 1);
    if (follow) {
        attachFx(pid, p, inVehicle ? mod.RuntimeSpawn_Common.FX_Gadget_Drone_OutOfRange_Distortion
            : mod.RuntimeSpawn_Common.FX_Gadget_ScreenEffect_Thermal_BHOT, inVehicle ? 4000 : 3000);
    }
    const white: mod.UIWidget | undefined = v.ui;
    if (white !== undefined) {
        fadePanel(white, NUKE_WHITE_HOLD_MS, NUKE_WHITE_FADE_MS, () => {
            if (current(v) && v.ui === white) {
                return true;
            }
            return false;
        });
        after(NUKE_WHITE_HOLD_MS + NUKE_WHITE_FADE_MS + 100, () => {
            if (v.ui === white) {
                v.ui = undefined;
            }
        });
    }
    if (screenFx) {
        after(400, () => {
            if (current(v)) {
                attachFx(pid, p, mod.RuntimeSpawn_Common.FX_Gadget_RemoteTurret_ScreenEffect_Damage, 3000);
            }
        });
        after(1500, () => {
            if (current(v)) {
                attachFx(pid, p, mod.RuntimeSpawn_Common.FX_Gadget_Drone_ThermalVE, 2500);
            }
        });
    }
    after(800, () => {
        if (current(v)) {
            setVl7(v, true);
        }
    });
    after(1200, () => {
        if (current(v)) {
            play2D("drone", mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DeathWarning_SimpleLoop2D, p, 0.8);
            v.drone = true;
        }
    });
    after(2000, () => {
        if (current(v)) {
            play2D("adrenaline", mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Commando_1pExperience_OneShot2D, p, 1);
        }
    });
    after(6000, () => {
        if (!current(v)) {
            return;
        }
        setVl7(v, false);
        stopDrone(v);
        setSaturated(v, true);
        if (screenFx) {
            attachFx(pid, p, mod.RuntimeSpawn_Common.FX_Gadget_AdrenalineShot, 3500);
        }
    });
    after(10000, () => {
        if (current(v)) {
            endVictim(v);
        }
    });
}

function inVehicleNow(p: mod.Player): boolean {
    try {
        return mod.GetSoldierState(p, mod.SoldierStateBool.IsInVehicle);
    } catch (e) {
        return false;
    }
}

interface Hit {
    p: mod.Player;
    pid: number;
    d: number;
}

const idsScratch: number[] = [];
const playersScratch: mod.Player[] = [];
const posScratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

// The Rorsch impact at (x, y, z). nuke.ts calls this for every hit.
export function detonate(x: number, y: number, z: number, shooter: mod.Player): void {
    worldEffects(x, y, z);
    const n: number = PlayerLocations.findPlayersInSphere(x, y, z, NUKE_WITNESS_M, undefined, idsScratch, playersScratch);
    const hits: Hit[] = [];
    for (let i: number = 0; i < n; i++) {
        const pid: number = idsScratch[i];
        const got: Vectors.Vector3 | null | undefined = PlayerLocations.getPosition(pid, posScratch);
        if (got === null || got === undefined) {
            continue;
        }
        const dx: number = posScratch.x - x;
        const dy: number = posScratch.y - y;
        const dz: number = posScratch.z - z;
        hits.push({ p: playersScratch[i], pid: pid, d: Math.sqrt(dx * dx + dy * dy + dz * dz) });
    }
    hits.sort((a: Hit, b: Hit) => a.d - b.d);
    let followLeft: number = NUKE_FOLLOW_MAX;
    let killed: number = 0;
    let burned: number = 0;
    let witnessed: number = 0;
    for (const h of hits) {
        if (!mod.IsValid(h.p)) {
            continue;
        }
        const human: boolean = !isBotPid(h.pid);
        if (h.d <= NUKE_KILL_M) {
            killed++;
            killZone(h.p, h.pid, human, shooter);
            continue;
        }
        if (h.d <= NUKE_BURN_M) {
            burned++;
            const f: number = (h.d - NUKE_KILL_M) / (NUKE_BURN_M - NUKE_KILL_M);
            hurt(h.p, Math.round(NUKE_BLAST_DMG_NEAR - f * (NUKE_BLAST_DMG_NEAR - NUKE_BLAST_DMG_FAR)), shooter);
            let v: Victim | undefined = undefined;
            if (human) {
                v = begin(h.pid, h.p);
                const follow: boolean = followLeft > 0;
                if (follow) {
                    followLeft--;
                }
                closeSequence(v, inVehicleNow(h.p), follow);
            }
            burn(h.p, h.pid, v, shooter);
            continue;
        }
        witnessed++;
        if (human && followLeft > 0) {
            followLeft--;
            attachFx(h.pid, h.p, inVehicleNow(h.p) ? mod.RuntimeSpawn_Common.FX_Gadget_Drone_OutOfRange_Distortion
                : mod.RuntimeSpawn_Common.FX_Gadget_Drone_ThermalVE, 2500);
        }
    }
    log("nuke", "DETONATE at " + Math.round(x) + "," + Math.round(y) + "," + Math.round(z)
        + " killzone " + killed + ", burned " + burned + ", witnesses " + witnessed);
}

// ------------------------------------------------------------- charge alarm

const alarmOn: { [pid: number]: boolean } = {};

// The computer alarm loops at the shooter while the Rorsch charges, so
// everyone nearby hears a nuke coming.
export function startChargeAlarm(p: mod.Player, pid: number): void {
    if (alarmOn[pid] === true) {
        return;
    }
    const s: mod.SFX | undefined = sfxObj("alarm" + pid,
        mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_Wreckage_ComputerAlarm_SimpleLoop3D);
    if (s === undefined) {
        return;
    }
    try {
        mod.PlaySound(s, 1, mod.GetSoldierState(p, mod.SoldierStateVector.GetPosition), NUKE_ALARM_RANGE_M);
        alarmOn[pid] = true;
    } catch (e) {
    }
}

export function stopChargeAlarm(pid: number): void {
    if (alarmOn[pid] !== true) {
        return;
    }
    delete alarmOn[pid];
    const s: mod.SFX | undefined = sfxCache["alarm" + pid];
    if (s === undefined) {
        return;
    }
    try {
        mod.StopSound(s);
    } catch (e) {
    }
}

// --------------------------------------------------------------- lifecycle

// Every tick, regardless of engine health: the queued damage and the effects
// that follow the eyes must keep running.
export function tickNukeFx(): void {
    const nowMs: number = Date.now();
    pollRorsch(nowMs);
    if (steps.length > 0) {
        for (let i: number = 0; i < steps.length;) {
            if (steps[i].at <= nowMs) {
                const s: Step = steps[i];
                steps.splice(i, 1);
                safe("nuke.step", s.fn);
            } else {
                i++;
            }
        }
    }
    if (follows.length > 0) {
        tickFollows(nowMs);
    }
}

function forget(pid: number): void {
    life[pid] = lifeOf(pid) + 1;
    const v: Victim | undefined = victims[pid];
    if (v !== undefined) {
        endVictim(v);
    }
    dropFollows(pid);
    stopChargeAlarm(pid);
    onRorschOwnerGone(pid);
}

// Leaving the game also takes the black panel, which a death keeps.
function forgetAll(pid: number): void {
    forget(pid);
    dropBlack(pid);
}

export function configureNukeFxEvents(): void {
    Events.OnPlayerDied.subscribe((victim: mod.Player) => {
        safe("nuke.died", () => { forget(mod.GetObjId(victim)); });
    });
    Events.OnPlayerLeaveGame.subscribe((pid: number) => {
        safe("nuke.leave", () => {
            forgetAll(pid);
            const s: mod.SFX | undefined = sfxCache["alarm" + pid];
            if (s !== undefined) {
                delete sfxCache["alarm" + pid];
                try {
                    mod.UnspawnObject(s);
                } catch (e) {
                }
            }
        });
    });
}
