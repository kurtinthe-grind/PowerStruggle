import { Events } from "bf6-portal-utils/events";
import { log, safe } from "./util/log";
import { isBotPid } from "./bots";
import { notifyPlayer, notifyTeam } from "./notify";
import { teamIdOf } from "./util/roster";
import { SITES_TO_OPEN_HQ } from "./config";
import { SITES, SiteDef } from "./rocketsites/sitemap";
import {
    RadarTarget, destroyRadarBy, initSites, liveRadars, onEnter, onExit, onGone, onRadarDestroyed, tickSites
} from "./rocketsites/site";
import { markDeployed, markUndeployed } from "./rocketsites/players";
import { markDead, rocketDamageOn, setRocketDamage, tickRockets } from "./rocketsites/rocket";
import { tickLaunchers } from "./rocketsites/launcher";
import { newTick, sweepVfx } from "./rocketsites/fx";
import { pickRadar } from "./rocketsites/raygeom";
import { RADAR_HIT_SHAPE } from "./rocketsites/config";

// PowerStruggle's side of the rocket sites (src/rocketsites/, which replaced
// the HQ turrets). Owner decisions, 2026-10-03:
//   - the sites lock and fire at humans only: bots never enter the system, so
//     their deploys, zone entries and launcher shots are not passed on;
//   - an enemy HQ takes Rorsch hits once SITES_TO_OPEN_HQ of its team's sites
//     are down (fewer when the team has fewer sites; none placed = open);
//   - the Rorsch destroys an enemy radar in one shot when its ray's path goes
//     through it (the launcher test, from anywhere); own sites are immune;
//   - a site going down is announced to both teams, and the HQ opening too;
//   - a human entering a live enemy site's kill zone gets the old turret
//     zone warning;
//   - rocket damage starts off and is switched from the debug menu.

let ready: boolean = false;
let tickNo: number = 0;
let lastMs: number = 0;

function teamSites(team: number): number {
    let n: number = 0;
    for (const s of SITES) {
        if (s.team === team) {
            n++;
        }
    }
    return n;
}

function sitesUp(team: number): number {
    let n: number = 0;
    for (const r of liveRadars()) {
        if (r.team === team) {
            n++;
        }
    }
    return n;
}

function sitesNeeded(team: number): number {
    return Math.min(SITES_TO_OPEN_HQ, teamSites(team));
}

export function sitesDown(team: number): number {
    return teamSites(team) - sitesUp(team);
}

// Whether team base's HQ takes Rorsch hits.
export function hqOpenFor(base: number): boolean {
    return sitesDown(base) >= sitesNeeded(base);
}

export function initSiteWire(): void {
    if (SITES.length === 0) {
        log("sites", "no rocket sites on the map: both HQs are open");
        return;
    }
    initSites();
    ready = true;
    log("sites", "team 1 has " + teamSites(1) + " sites, team 2 " + teamSites(2) + "; "
        + SITES_TO_OPEN_HQ + " down open an HQ; rocket damage " + (rocketDamageOn() ? "ON" : "OFF"));
}

function onSiteDown(n: number, team: number, pid: number): void {
    const down: number = sitesDown(team);
    const total: number = teamSites(team);
    const needed: number = sitesNeeded(team);
    log("sites", "site " + n + " (team " + team + ") destroyed by pid " + pid + ": " + down + "/" + total
        + " down, " + needed + " open the HQ");
    notifyTeam(3 - team, "siteDestroyed", down, total);
    notifyTeam(team, "siteLost", down, total);
    if (down === needed) {
        notifyTeam(3 - team, "losOpen", 0, 0);
        notifyTeam(team, "hqExposed", 0, 0);
    }
}

function liveEnemyZone(at: mod.AreaTrigger, team: number): SiteDef | undefined {
    const id: number = mod.GetObjId(at);
    for (const s of SITES) {
        if (s.zoneId !== id || s.team === team) {
            continue;
        }
        for (const r of liveRadars()) {
            if (r.n === s.n) {
                return s;
            }
        }
    }
    return undefined;
}

function human(pid: number): boolean {
    return pid >= 0 && !isBotPid(pid);
}

function gone(pid: number): void {
    markUndeployed(pid);
    onGone(pid);
    markDead(pid);
}

export function configureSiteEvents(): void {
    onRadarDestroyed(onSiteDown);
    Events.OnPlayerDeployed.subscribe((p: mod.Player) => {
        safe("sites.deployed", () => {
            if (ready && human(mod.GetObjId(p))) {
                markDeployed(p);
            }
        });
    });
    Events.OnPlayerDied.subscribe((p: mod.Player) => {
        safe("sites.died", () => {
            if (ready) {
                gone(mod.GetObjId(p));
            }
        });
    });
    Events.OnPlayerUndeploy.subscribe((p: mod.Player) => {
        safe("sites.undeploy", () => {
            if (ready) {
                gone(mod.GetObjId(p));
            }
        });
    });
    Events.OnPlayerLeaveGame.subscribe((pid: number) => {
        safe("sites.leave", () => {
            if (ready) {
                gone(pid);
            }
        });
    });
    Events.OnPlayerEnterAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("sites.enter", () => {
            if (!ready || !human(mod.GetObjId(p))) {
                return;
            }
            onEnter(p, at);
            if (liveEnemyZone(at, teamIdOf(p)) !== undefined) {
                notifyPlayer(p, "killZone", 0, 0);
            }
        });
    });
    Events.OnPlayerExitAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("sites.exit", () => {
            if (ready && human(mod.GetObjId(p))) {
                onExit(p, at);
            }
        });
    });
}

// Every tick: launchers, sites, rockets, then the effect sweep, each guarded
// so one failing step cannot freeze the others.
export function tickSiteWire(): void {
    if (!ready) {
        return;
    }
    const now: number = Date.now();
    const dt: number = lastMs === 0 ? 0 : Math.min(0.1, (now - lastMs) / 1000);
    lastMs = now;
    tickNo++;
    newTick();
    safe("sites.launchers", () => { tickLaunchers(now, tickNo); });
    safe("sites.sites", () => { tickSites(now, dt); });
    safe("sites.rockets", () => { tickRockets(now, dt); });
    safe("sites.vfx", () => { sweepVfx(now); });
}

export interface P3 {
    x: number;
    y: number;
    z: number;
}

// A Rorsch shot (nuke.ts): the nearest enemy radar its ray's path goes through
// goes down. len is how far the ray got from the eye: to its hit point, or its
// full length on a miss, so a wall in front of a radar shields it.
export function raygunAtRadars(team: number, pid: number, eye: P3, dir: P3, len: number, hit: P3 | undefined): void {
    if (!ready) {
        return;
    }
    const enemy: RadarTarget[] = liveRadars().filter((r: RadarTarget) => r.team !== team);
    if (enemy.length === 0) {
        return;
    }
    const idx: number = pickRadar([eye.x, eye.y, eye.z], [dir.x, dir.y, dir.z], len,
        hit === undefined ? undefined : [hit.x, hit.y, hit.z], enemy.map((r: RadarTarget) => r.pos), RADAR_HIT_SHAPE);
    if (idx < 0) {
        return;
    }
    destroyRadarBy(enemy[idx].n, pid, "Rorsch");
}

export function siteDamageOn(): boolean {
    return rocketDamageOn();
}

export function toggleSiteDamage(): void {
    setRocketDamage(!rocketDamageOn());
}
