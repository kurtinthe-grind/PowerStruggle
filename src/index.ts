// PowerStruggle HUD - v0.49

import { Events } from "bf6-portal-utils/events";
import { Timers } from "bf6-portal-utils/timers";
// Import for side effects only. Subscribes to OnPlayerDied/OnPlayerUndeploy/
// OnPlayerLeaveGame and force-triggers OnPlayerUndeploy for a player stuck in
// limbo for 30s, so a dropped engine event cannot leave a live HUD plus a stale
// deployed flag keeping the player in the nuke probe set. Both of our
// OnPlayerUndeploy handlers are idempotent, so the synthetic event is safe.
// Cost: one Uint32Array(100) and a 1 Hz timer that early-returns when no one is
// pending. Not combined with multi-click-detector, which would multiply the
// synthetic event across its own subscribers.
import "bf6-portal-utils/player-undeploy-fixer";
import { log, logAdmin, safe, tickAdminBudget, willLogDebug } from "./util/log";
import {
    initPerf, healthFactor, smoothedTickRate, smoothedTimeoutLagMs,
    spotDeltaMs, spotTickRate
} from "./util/perf";
import { tn, pn, trackT, trackP, tNames, pNames, pMenuNames, beginMenuBuild, endMenuBuild, dropMenu, forgetMenuTab, W, forget, forgetPrefix } from "./util/names";
import { v } from "./util/vec";
import {
    C_GOLD, C_PLAT, C_DARK, C_BLACK,
    FEED_WHITE, FEED_RED, FEED_YEL, FEED_GRN, FEED_BLU,
    MENU_BG, MENU_EDGE, MENU_TITLE, MENU_COST, MENU_LOCKTXT, MENU_HEAD, MENU_TXT,
    MENU_ORANGE_SEL, MENU_ORANGE_HOVER, MENU_HOVER, MENU_PRESS,
    MENU_TAB_PRESS, MENU_TAB_HOVER, P_RING,
    colorFor, lighten
} from "./ui/palette";
import { PRESTIGE_STEP, POWER_MILESTONES, ART_BUDGET, SITE_LETTER, WEAPONS_TAB_FREE } from "./config";
import {
    powerVal, baseVal, dbgMe, siteState, pPrestige,
    getProtoOwner, setProtoOwner
} from "./state";
import { initTeams } from "./teams";
import { playSfxPlayer } from "./audio";
import { initCapture, configureCaptureEvents, onCaptured, buildingForPlayer, BuildingState } from "./capture";
import { initBuildings, configureBuildingEvents, onBunkerCaptured, syncBunkerOwners } from "./buildings";
import { initSpawns, configureSpawnEvents, onBunkerOwnerChanged } from "./spawns";
import { configureEconomyEvents, onPrestige } from "./economy";
import {
    initScoreboard, award, awardPlayers, onAward, countDeath, pushAllRows, pushHeader, pushRow,
    resetTeamScores, resetStats,
    countsAsCombat, countsAsDeath, forgetPlayer, prestigeFor, AwardKind
} from "./stats";
import { playersFromIds, playersOnCapturePoint, teamIdOf } from "./util/roster";
import { initEnergy, energyMultiplier } from "./energy";
import { initFactory, factoryOwner, tickCharge, onCharge } from "./factory";
import { initTurrets, configureTurretEvents, onHqHit } from "./turrets";
import { hqHpPercent } from "./winner";
import { initSlots, pickSpawner, SpawnChoice } from "./slots";
import { factoryBuildings, isConfigured } from "./objids";
import { initNuke, configureNukeEvents, tickNukeProbe } from "./nuke";
import { initWorldIcons, stateFor, highlightFor, highlightedFor, distanceMeters } from "./worldicons";
import { debugWeaponReport, isRorschInHand } from "./weapons";
import { setFeedSink, setPlayerFeedSink } from "./notify";
import { botLiveCount, botRosterSize, configureBotEvents, initBots, isBotPlayer } from "./bots";

const MOCK_DATA: boolean = false;

const PROTO_W: number = 96;
const PROTO_H: number = 96;
const U: number = PROTO_W / 24;
const EMB_H: number = PROTO_H + U;
const PROTO_Y: number = (EMB_H - PROTO_H) / 2;

const SITE: number = U * 10;
const RES_IN: number = U * 7;
const RES_W: number = RES_IN;
const RES_H: number = RES_IN;
const SITE_EDGE: number = U * 0.5;
const SITE_GAP: number = U * 1.5;

const SITE_SLOTS: number = 3;

const SITE_INNER_GAP: number = U * 3;
const SITE_TOP: number = U * 4.5;


const SITE_ALPHA: number = 0.7;

const NPIP: number = 20;
const PIP_W: number = U * 1.25;
const PIP_GAP: number = U * 0.75;
const PIP_Y: number = U * 7;
const PIP_H: number = U * 6;
const BAR_W: number = NPIP * PIP_W + (NPIP - 1) * PIP_GAP;

const HQ_H: number = U * 6;
const HQ_SIZE: number = U * 5.5;
const NUM_Y: number = U * 14;
const NUM_H: number = U * 9;
const NUM_SIZE: number = U * 8;

const CLUSTER: number = SITE * SITE_SLOTS + SITE_GAP * (SITE_SLOTS - 1);
const BAR_L: number = CLUSTER + U * 3;
const PROTO_GAP: number = U * 8;
const BAR_R: number = BAR_L + BAR_W + PROTO_W + PROTO_GAP;

const PROTO_X: number = (BAR_L + BAR_W + BAR_R) / 2 - PROTO_W / 2;
const HUD_W: number = BAR_R + BAR_W + U * 3 + CLUSTER;

const BAR_H: number = Math.max(PROTO_Y + PROTO_H, NUM_Y + NUM_H) + U;

const BAR_Y: number = U * 6;

const FEED_SLOTS: number = 3;

const FEED_W: number = U * 105;
const CHIP_W: number = U * 95;
const CHIP_H: number = U * 7;
const CHIP_PITCH: number = U * 8.5;
const CHIP_INSET: number = U * 7;
const ACCENT_W: number = U * 0.75;
const CHIP_ICON_X: number = U * 3;
const CHIP_TEXT_X: number = U * 9;
const CHIP_ICON: number = U * 3.75;
const CHIP_TEXT: number = U * 4.25;


const FEED_Y: number = BAR_Y + BAR_H + U * 2;

const PFEED_Y: number = FEED_Y + FEED_SLOTS * CHIP_PITCH;

const P_RING_BOX: number = 34;
const P_RING_OUT: number = 27;
const P_RING_IN: number = 25;
const P_RING_D: number = 22;

const P_RING_GAP_HUD: number = 6;
const P_RING_GAP_MENU: number = 7;

const P_GLYPH: number = 13;

const P_RING_P_DX: number = 0;
const P_RING_IN_DX: number = -1;

const P_RING_R: number = P_RING_BOX / 2;

const MENU_W: number = 430;
const MENU_H: number = 670;
const MENU_INSET: number = 10;
const MENU_Y: number = 120;
const TACTICAL_TAB: number = 4;

function tabW(): number {
    return MENU_W / TABS_DATA.length;
}
const TAB_Y: number = 48;
const TAB_H: number = 34;
const CELL_H: number = 44;
const ROW_STEP: number = 48;

function colX(t: number, col: number): number {
    return col * Math.floor(MENU_W / TABS_DATA[t].cols);
}

function pageCount(t: number): number {
    const pages: PshSection[][] | undefined = TABS_DATA[t].pages;
    return pages === undefined ? 1 : pages.length;
}

  function pageSections(t: number, page: number): PshSection[] {
      if (t === FACTORY_TAB) {
          return factorySectionsFor(-1);
      }
      const pages: PshSection[][] | undefined = TABS_DATA[t].pages;
      if (pages !== undefined && page > 0) {
          return pages[page % pages.length];
      }
      return TABS_DATA[t].sections;
  }

  function tabSectionsFor(id: number, t: number): PshSection[] {
      if (t === FACTORY_TAB) {
          return factorySectionsFor(id);
      }
      return pageSections(t, pPage[id] === undefined ? 0 : pPage[id]);
  }
function cellW(t: number): number {
    return Math.floor(MENU_W / TABS_DATA[t].cols) - 6;
}
const SEC_TOP: number = 98;
const SEC_HEAD_H: number = 22;
const SEC_GAP: number = 12;
const SEC_ROW_GAP: number = 6;
const TABS_COLS_DEFAULT: number = 3;
const DONE_H: number = 40;
const DONE_GAP: number = 12;
const DONE_Y: number = MENU_H - DONE_H - DONE_GAP;
const SEC_HEAD_Y: number[] = [];
const SEC_ROW_Y: number[] = [];

function layoutSections(secs: PshSection[], cols: number): void {
    const useCols: number = cols > 0 ? cols : TABS_COLS_DEFAULT;
    SEC_HEAD_Y.length = 0;
    SEC_ROW_Y.length = 0;
    let y: number = SEC_TOP;
    for (let s: number = 0; s < secs.length; s++) {
        SEC_HEAD_Y.push(y);
        SEC_ROW_Y.push(y + SEC_HEAD_H + SEC_ROW_GAP);
        const n: number = secs[s].items.length;
        const rows: number = Math.ceil(n / useCols);
        y = y + SEC_HEAD_H + SEC_ROW_GAP + (rows - 1) * ROW_STEP + CELL_H + SEC_GAP;
    }
    PAGER_Y = y + PAGER_GAP;
}


let PAGER_Y: number = 456;
const PAGER_W: number = 96;
const PAGER_GAP: number = 8;

const MOCK_SITES: { [t: number]: number[] } = { 1: [0, 0, 0], 2: [0, 0, 0] };
const MOCK_NUKE: { [t: number]: number } = { 1: 0, 2: 0 };
const MOCK_BASE: { [t: number]: number } = { 1: 100, 2: 100 };
const MOCK_PROTO: number = 0;
const MOCK_PRESTIGE: number = 740;

const DBG_NUKE_STEPS: number[] = [0, 25, 50, 75, 100];


const DBG_BASE_STEPS: number[] = [100, 75, 50, 25, 0];

function dbgTeam(id: number, side: string): number {
    const me: number = dbgMe[id];
    if (side === "Y") {
        return me;
    }
    return me === 1 ? 2 : 1;
}

function nextIn(steps: number[], cur: number): number {
    for (let i: number = 0; i < steps.length; i++) {
        if (steps[i] > cur) {
            return steps[i];
        }
    }
    return steps[0];
}

function dbgValueMsg(id: number, act: string): mod.Message {
    if (act === "perf:hz") {
        return mod.Message("dbgPerfHzV", Math.round(smoothedTickRate()));
    }
    if (act === "perf:ms") {
        return mod.Message("dbgPerfMsV", Math.round(spotDeltaMs() * 10) / 10, Math.round(spotTickRate()));
    }
    if (act === "perf:health") {
        return mod.Message("dbgPerfHealthV", Math.round(healthFactor() * 100) / 100);
    }
    if (act === "perf:lag") {
        return mod.Message("dbgPerfLagV", Math.round(smoothedTimeoutLagMs()));
    }
    if (act === "bots") {
        // mod.Message substitutes at most 3 values. Roster is the third because
        // it disambiguates the two failure modes: roster 0 means no spawner ever
        // produced a bot, roster greater than live means corpses are stuck.
        return mod.Message("dbgBotsV", botLiveCount(1), botLiveCount(2), botRosterSize());
    }
    if (act === "nuke") {
        return mod.Message(powerVal[dbgTeam(id, "Y")]);
    }
    if (act === "nukeE") {
        return mod.Message(powerVal[dbgTeam(id, "E")]);
    }
    if (act === "base" || act === "baseE") {
        return mod.Message(baseVal[dbgTeam(id, act === "base" ? "Y" : "E")]);
    }
      if (act === "prestige") {
          return mod.Message("dbgStep", PRESTIGE_STEP);
      }
      if (act === "rorsch") {
          const p: any = playerById(id);
          if (p) {
              return mod.Message(isRorschInHand(p) ? "dbgRorschYes" : "dbgRorschNo");
          }
          return mod.Message("dbgAction");
      }
      if (act.substring(0, 4) === "loc:") {
          const p: any = playerById(id);
          const viewer: number = p ? teamId(p) : 0;
          const st: string = stateFor(viewer, act.substring(4));
          if (st === "friendly") {
              return mod.Message("tacFriendly");
          }
          if (st === "enemy") {
              return mod.Message("tacEnemy");
          }
          return mod.Message("tacNeutral");
      }
    if (act === "proto") {
        return mod.Message(dbgOwnerName(getProtoOwner()));
    }
    if (act === "team") {
        const p: any = playerById(id);
        if (p) {
            return mod.Message(dbgOwnerName(teamId(p)));
        }
        return mod.Message("dbgAction");
    }
    if (act === "gotoTac") {
        return mod.Message("dbgGo");
    }
    if (act === "tabstate") {
        const h: number = pHover[id] === undefined ? -1 : pHover[id];
        return mod.Message(h === 1 ? "dbgTab1" : h === 2 ? "dbgTab2" : "dbgAuto");
    }
    if (act === "reset") {
        return mod.Message("dbgAction");
    }

    const slot: number = parseInt(act.substring(2, 3), 10);
    const st: number[] = siteState[dbgTeam(id, act.substring(1, 2))];
    if (!st || slot < 0 || slot >= st.length) {
        return mod.Message("dbgAction");
    }
    return mod.Message(dbgOwnerName(st[slot]));
}

function distanceLabel(id: number, act: string): mod.Message {
    const p: any = playerById(id);
    if (!p) {
        return mod.Message("tacUnknown");
    }
    const metres: number = distanceMeters(p, act.substring(4));
    if (metres < 0) {
        return mod.Message("tacUnknown");
    }
    return mod.Message("tacClickDist", Math.round(metres));
}

function tacticalStateColor(id: number, act: string): mod.Vector {
    if (act.substring(0, 4) !== "loc:") {
        return MENU_COST;
    }
    const p: any = playerById(id);
    const viewer: number = p ? teamId(p) : 0;
    const state: string = stateFor(viewer, act.substring(4));
    if (state === "friendly") {
        return FEED_BLU;
    }
    if (state === "enemy") {
        return FEED_RED;
    }
    return FEED_YEL;
}

function dbgOwnerName(owner: number): string {
    if (owner === 0) {
        return "dbgNeutral";
    }
    return owner === 1 ? "dbgNato" : "dbgPax";
}

// The players physically inside the objective that just changed hands, as
// reported by the AreaTrigger occupant list or mod.GetPlayersOnPoint for a
// bunker. The "you secured it" cue is delivered to exactly these players rather
// than to the whole team, because with 24 bots per team a team-wide broadcast
// means hearing capture feedback for points on the far side of the map. The
// enemy-facing half stays on the team feed: losing a point is intel a player
// needs whether or not they were standing on it.
let captureOnPoint: mod.Player[] = [];

function announceSite(slot: number, from: number, to: number): void {
    safe("announceSite", () => {
        if (from === to) {
            return;
        }

        for (let t: number = 1; t <= 2; t++) {
            if (!tBuilt[t]) {
                continue;
            }

            const key: string = siteFeedKey(t, from, to, slot);
            if (key === "") {
                continue;
            }
            if (t === to) {
                // Only the players actually inside the volume. Bots are dropped
                // by pushPlayerFeed itself, since they have no HUD.
                for (const p of captureOnPoint) {
                    pushPlayerFeed(p, key, 0, 0);
                }
                continue;
            }
            // The enemy took it: always worth telling the whole team.
            pushTeamFeed(t, key, 0, 0);
        }
    });
}

function announceBunker(bunkerId: string, to: number, from: number): void {
    safe("announceBunker", () => {
        if (from === to) {
            return;
        }
        const label: string = bunkerLabelKey(bunkerId);
        for (let t: number = 1; t <= 2; t++) {
            if (!tBuilt[t]) {
                continue;
            }
            // Losing it: only the team that held it needs the bad news.
            if (to === 0) {
                if (t === from) {
                    pushTeamFeed(t, "bunkerLost", label, 0);
                }
                continue;
            }
            // Same rule as announceSite: only the players inside the point get
            // the "you gained it" line; the enemy half is still team-wide.
            if (t === to) {
                for (const p of captureOnPoint) {
                    pushPlayerFeed(p, "bunkerYours", label, 0);
                }
                continue;
            }
            pushTeamFeed(t, "bunkerFoe", label, 0);
        }
    });
}

function bunkerLabelKey(bunkerId: string): string {
    if (bunkerId === "bunker1") {
        return "locBunker1";
    }
    if (bunkerId === "bunker2") {
        return "locBunker2";
    }
    if (bunkerId === "bunker3") {
        return "locBunker3";
    }
    return bunkerId;
}

function announceProto(from: number, to: number): void {
    safe("announceProto", () => {
        if (from === to || to === 0) {
            return;
        }
        for (let t: number = 1; t <= 2; t++) {
            if (!tBuilt[t]) {
                continue;
            }
            pushTeamFeed(t, to === t ? "protoYours" : "protoFoe", 0, 0);
        }
    });
}

function runDebugAct(id: number, act: string): void {
      if (act.substring(0, 1) === "n" && act.length === 3) {
          const slot: number = parseInt(act.substring(2, 3), 10);
          const team: number = dbgTeam(id, act.substring(1, 2));
          const foe: number = team === 1 ? 2 : 1;
          const st: number[] = siteState[team];
          if (st && slot >= 0 && slot < st.length) {
              const cur: number = st[slot] === undefined ? 0 : st[slot];
              // Toggle this side <-> NEUTRAL. Cycling 0 -> 1 -> 2 instead meant
              // "yours" set the site to whichever team came next, so on Team 2 it
              // handed your own site to the enemy and your cluster went dark.
              stateSetSite(team, slot, cur === team ? 0 : team, foe);
          }
          return;
      }

    if (act === "team") {
        const p: any = playerById(id);
        if (!p) {
            log("debug", "team switch: no player");
            return;
        }
        const cur: number = teamId(p);
        const next: number = cur === 1 ? 2 : 1;
        if (menuOpen[id]) {
            setMenuOpen(id, p, false);
        }
        try {
            mod.SetTeam(p, mod.GetTeam(next));
            mod.UndeployPlayer(p);
            log("debug", "team " + cur + " -> " + next + ", redeploying");
        } catch (e) {
            log("debug", "team switch failed: " + String(e));
        }
        return;
    }
    if (act === "nuke" || act === "nukeE") {
        const team: number = dbgTeam(id, act === "nuke" ? "Y" : "E");
        stateSetPower(team, nextIn(DBG_NUKE_STEPS, powerVal[team]));
        return;
    }
    if (act === "base" || act === "baseE") {
        const team: number = dbgTeam(id, act === "base" ? "Y" : "E");
        stateSetBase(team, nextIn(DBG_BASE_STEPS, baseVal[team]));
        return;
    }
    if (act === "proto") {
        stateSetProto((getProtoOwner() + 1) % 3);
        return;
    }
      if (act === "prestige") {
          stateAddPrestige(id, PRESTIGE_STEP);
          return;
      }
      if (act === "rorsch") {
          const p: any = playerById(id);
          if (p) {
              const rep: string = debugWeaponReport(p);
              log("rorsch", "pid=" + id + " " + rep);
              pushPlayerFeed(p, isRorschInHand(p) ? "dbgRorschYes" : "dbgRorschNo", 0, 0);
          }
          return;
      }
      if (act.substring(0, 4) === "loc:") {
          const p: any = playerById(id);
          if (p) {
              const locId: string = act.substring(4);
              const wasActive: string = highlightedFor(id);
              highlightFor(p, locId);
              if (wasActive === locId) {
                  delete highlightedLocation[id];
              } else {
                  highlightedLocation[id] = locId;
              }
              log("tac", "pid=" + id + " toggled " + locId + " active=" + String(highlightedLocation[id] !== undefined));
          }
          return;
      }
    if (act === "gotoTac") {
        const p: any = playerById(id);
        playSfxPlayer("primary", p, 1);
        log("uiButton", "act=gotoTac -> tab " + String(TACTICAL_TAB));
        return;
    }
    if (act === "tabstate") {
        const cur: number = pHover[id] === undefined ? -1 : pHover[id];
        pHover[id] = cur < 0 ? 1 : cur === 1 ? 2 : -1;
        paintTabs(id);
        log("debug", "forced tab hover " + pHover[id]);
        return;
    }
    if (act === "reset") {
        for (let t: number = 1; t <= 2; t++) {
            const st: number[] = siteState[t];
            for (let i: number = 0; i < st.length; i++) {
                stateSetSite(t, i, 0);
            }
            stateSetPower(t, 0);
            stateSetBase(t, 100);
        }
        stateSetProto(0);
        log("debug", "reset to neutral");
        return;
    }
    log("debug", "unknown act " + act);
}

function refreshDebugRows(id: number): void {
    const t: number = pTab[id];
    if (!tabBuilt[id] || !tabBuilt[id][t]) {
        return;
    }
    const secs: PshSection[] = tabSectionsFor(id, t);
    for (let s: number = 0; s < secs.length; s++) {
        const items: PshItem[] = secs[s].items;
        for (let i: number = 0; i < items.length; i++) {
            const act: string | undefined = items[i].act;
            if (act === undefined) {
                continue;
            }
            const w: any = W(pn(id, "v" + cellKey(id, t, s, i)));
            if (w) {
                mod.SetUITextLabel(w, dbgValueMsg(id, act));
                if (act.substring(0, 4) === "loc:") {
                    mod.SetUITextColor(w, tacticalStateColor(id, act));
                }
            }
            if (act.substring(0, 4) === "loc:") {
                const ckey: string = cellKey(id, t, s, i);
                const dw: any = W(pn(id, "d" + ckey));
                if (dw) {
                    mod.SetUITextLabel(dw, distanceLabel(id, act));
                }
                if (highlightedLocation[id] === act.substring(4)) {
                    const cell: any = W(pn(id, ckey));
                    if (cell) {
                        mod.SetUIWidgetBgColor(cell, tacticalStateColor(id, act));
                        mod.SetUIWidgetBgAlpha(cell, 0.2);
                    }
                }
            }
        }
    }
    log("debug", "rows refreshed for pid " + id);
}

function refreshTacticalRowsForAll(): void {
    for (const rawId of Object.keys(pBuilt)) {
        const id: number = Number(rawId);
        if (pTab[id] === TACTICAL_TAB) {
            refreshDebugRows(id);
        }
    }
}

type PshItem = { key: string; sub?: string; cost: number; act?: string; give?: mod.Weapons; vehicle?: mod.VehicleList; spawnerIndex?: number };
type PshSection = { head: string; items: PshItem[] };

type PshTab = { label: string; cols: number; sections: PshSection[]; pages?: PshSection[][] };

type PshButton = { wrap: mod.UIWidget; button: mod.UIWidget };

const TABS_DATA: PshTab[] = [
    {
        label: "tabWeapons",
        cols: 2,
        sections: [
            {
                head: "catProto",
                items: [
                    { key: "itMoac", cost: 300, give: mod.Weapons.BattlePickup_MP_RMG },
                    { key: "itMoar", cost: 450 },
                    { key: "itTacLauncher", cost: 1200 },
                    { key: "itSingularity", cost: 1400 },
                ],
            },
            {
                head: "catStandard",
                items: [
                    { key: "itTacTank", cost: 1600 },
                    { key: "itGauss", cost: 600, give: mod.Weapons.BattlePickup_Rorsch_Mk_2_SMRW },
                    { key: "itAntiAir", cost: 300 },
                    { key: "itSraw", cost: 250 },
                ],
            },
        ],
    },
    {
        label: "tabEquipment",
        cols: 2,
        sections: [
            {
                head: "catTools",
                items: [
                    { key: "itRepairTorch", cost: 150 },
                    { key: "itRadarKit", cost: 200 },
                    { key: "itBinoculars", cost: 100 },
                    { key: "itLockpick", cost: 250 },
                ],
            },
            {
                head: "catDeploy",
                items: [
                    { key: "itParachute", cost: 350 },
                    { key: "itVisor", cost: 200 },
                    { key: "itPouch", cost: 100 },
                    { key: "itEodBot", cost: 200 },
                ],
            },
        ],
    },
    {
        label: "tabAddons",
        cols: 2,
        sections: [
            {
                head: "catAmmo",
                items: [
                    { key: "itAmmoRifle", cost: 5 },
                    { key: "itAmmoSmg", cost: 5 },
                    { key: "itAmmoLmg", cost: 5 },
                    { key: "itGrenades", cost: 25 },
                ],
            },
            {
                head: "catAttach",
                items: [
                    { key: "itReflex", cost: 25 },
                    { key: "itAssaultScope", cost: 50 },
                    { key: "itSniperScope", cost: 100 },
                    { key: "itSilencer", cost: 10 },
                ],
            },
        ],
    },
    {
        label: "tabDebug",
        cols: 3,

        sections: [
            {
                head: "catDbgNodes",
                items: [
                    { key: "dbgYA1", sub: "dbgYA1b", cost: 0, act: "nY0" },
                    { key: "dbgYB1", sub: "dbgYB1b", cost: 0, act: "nY1" },
                    { key: "dbgYC1", sub: "dbgYC1b", cost: 0, act: "nY2" },
                ],
            },
            {
                head: "catDbgSys",
                items: [
                    { key: "dbgNuke", cost: 0, act: "nuke" },
                    { key: "dbgBase", cost: 0, act: "base" },
                    { key: "dbgProto", cost: 0, act: "proto" },
                ],
            },
              {
                  head: "catDbgPerf",
                  items: [
                      { key: "dbgPerfHz", cost: 0, act: "perf:hz" },
                      { key: "dbgPerfMs", cost: 0, act: "perf:ms" },
                      { key: "dbgPerfHealth", cost: 0, act: "perf:health" },
                      { key: "dbgPerfLag", cost: 0, act: "perf:lag" },
                      { key: "dbgBots", cost: 0, act: "bots" },
                  ],
              },
              {
                  head: "catDbgUtil",
                  items: [
                      { key: "dbgTeam", cost: 0, act: "team" },
                      { key: "dbgRorsch", cost: 0, act: "rorsch" },
                      { key: "dbgPrestige", cost: 0, act: "prestige" },
                      { key: "dbgTabState", cost: 0, act: "tabstate" },
                      { key: "dbgReset", cost: 0, act: "reset" },
                  ],
              },
          ],
        pages: [
            [
                {
                    head: "catDbgFoe",
                    items: [
                        { key: "dbgEA1", sub: "dbgEA1b", cost: 0, act: "nE0" },
                        { key: "dbgEB1", sub: "dbgEB1b", cost: 0, act: "nE1" },
                        { key: "dbgEC1", sub: "dbgEC1b", cost: 0, act: "nE2" },
                    ],
                },
                {
                    head: "catDbgSysE",
                    items: [
                        { key: "dbgNukeE", cost: 0, act: "nukeE" },
                        { key: "dbgBaseE", cost: 0, act: "baseE" },
                    ],
                },
            ],
        ],
      },
      {
          label: "tabTactical",
          cols: 2,
          sections: [
              {
                  head: "tacBunkers",
                  items: [
                      { key: "Bunker 1", sub: "tacClick", cost: 0, act: "loc:bunker1" },
                      { key: "Bunker 2", sub: "tacClick", cost: 0, act: "loc:bunker2" },
                      { key: "Bunker 3", sub: "tacClick", cost: 0, act: "loc:bunker3" },
                  ],
              },
              {
                  head: "tacEnergy",
                  items: [
                      { key: "Energy Site 1", sub: "tacClick", cost: 0, act: "loc:site1" },
                      { key: "Energy Site 2", sub: "tacClick", cost: 0, act: "loc:site2" },
                      { key: "Energy Site 3", sub: "tacClick", cost: 0, act: "loc:site3" },
                  ],
              },
              {
                  head: "tacFactories",
                  items: [
                      { key: "PrototypeFactory", sub: "tacClick", cost: 0, act: "loc:proto1" },
                      { key: "WarFactory1", sub: "tacClick", cost: 0, act: "loc:war1" },
                      { key: "WarFactory2", sub: "tacClick", cost: 0, act: "loc:war2" },
                  ],
              },
              {
                  head: "tacMore",
                  items: [
                      { key: "AviationFactory", sub: "tacClick", cost: 0, act: "loc:air1" },
                      { key: "NavalFactory1", sub: "tacClick", cost: 0, act: "loc:naval1" },
                      { key: "NavalFactory2", sub: "tacClick", cost: 0, act: "loc:naval2" },
                  ],
              },
          ],
      },
      {
          label: "tabFactory",
          cols: 2,
          sections: [
              { head: "catStandard", items: [{ key: "dbgNoFactory", cost: 0 }] },
          ],
      },
];

// The WEAPONS tab is a debug tab. Its only gate is the prestige cost (the
// factory check applies to FACTORY_TAB alone), so zeroing the costs here makes
// it fully available without capturing anything. Done once at load, before any
// menu is built, so the cell styling, the afford check and the charge all agree.
const WEAPONS_TAB: number = 0;
if (WEAPONS_TAB_FREE) {
    for (const sec of TABS_DATA[WEAPONS_TAB].sections) {
        for (const item of sec.items) {
            item.cost = 0;
        }
    }
}

const FACTORY_TAB: number = 5;
const activeFactoryKind: { [id: number]: string } = {};

const FACTORY_ITEMS: { [kind: string]: PshItem[] } = {
    proto: [
        { key: "itMoac", cost: 300, give: mod.Weapons.BattlePickup_MP_RMG },
        { key: "itGauss", cost: 600, give: mod.Weapons.BattlePickup_Rorsch_Mk_2_SMRW },
        { key: "itTacLauncher", cost: 1200 },
        { key: "itSingularity", cost: 1400 }
    ],
    war: [
        { key: "itTankLight", cost: 500, vehicle: mod.VehicleList.M2Bradley, spawnerIndex: 0 },
        { key: "itTankFlak", cost: 700, vehicle: mod.VehicleList.Gepard, spawnerIndex: 1 },
        { key: "itTankMain", cost: 1000, vehicle: mod.VehicleList.Abrams, spawnerIndex: 2 }
    ],
    air: [
        { key: "itHeli", cost: 800, vehicle: mod.VehicleList.AH64, spawnerIndex: 0 },
        { key: "itHeliPax", cost: 900, vehicle: mod.VehicleList.UH60_Pax, spawnerIndex: 1 },
    ],
    naval: [
        { key: "itBoat", cost: 450, vehicle: mod.VehicleList.RHIB, spawnerIndex: 0 },
        { key: "itAttackBoat", cost: 900, vehicle: mod.VehicleList.RCB_90_Patrol_Boat, spawnerIndex: 1 }
    ]
};

// Kinds that may expose the buy menu. Energy sites are not factories, so they
// must never resolve to a vehicle/weapon list.
const FACTORY_KINDS: string[] = ["proto", "war", "air", "naval"];

function isFactoryKind(kind: string | undefined): boolean {
    return kind !== undefined && FACTORY_KINDS.indexOf(kind) >= 0;
}

function factorySectionsFor(id: number): PshSection[] {
    const kind: string | undefined = activeFactoryKind[id];
    if (!isFactoryKind(kind) || FACTORY_ITEMS[kind as string] === undefined) {
        return [{ head: "catStandard", items: [{ key: "dbgNoFactory", cost: 0 }] }];
    }
    const items: PshItem[] = FACTORY_ITEMS[kind as string];
    return [{ head: "catStandard", items: items }];
}


function siteFeedKey(viewer: number, from: number, to: number, slot: number): string {
    if (to === 0 || from === to) {
        return "";
    }
    const letter: string = SITE_LETTER[slot];
    if (letter === "") {
        return "";
    }
    if (to === viewer) {
        return "siteYours" + letter;
    }

    if (from === viewer) {
        return "siteLost" + letter;
    }
    return "siteFoe" + letter;
}

const FEED_CHARS_BY_KEY: { [k: string]: number } = {
    siteYoursA: 35,
    siteYoursB: 35,
    siteYoursC: 35,
    siteLostA: 32,
    siteLostB: 32,
    siteLostC: 32,
    siteFoeA: 33,
    siteFoeB: 33,
    siteFoeC: 33,
    nukeReady: 39,
    power50: 38,
    power75: 38,
    power100: 38,

    nukeFoeReady: 41,
    powerFoe50: 30,
    powerFoe75: 30,
    powerFoe100: 31,
    protoYours: 40,
    protoFoe: 40,
    bunkerYours: 34,
    bunkerFoe: 34,
    bunkerLost: 30,
    turretDestroyed: 28,
    pAwarded: 15,
    itemGiven: 34,
    prestigeUp: 26,
    baseHit: 26,
    protoFull: 26,
};

// UI sound assets live in audio.ts and are pooled there. The previous local
// SFX_PRIMARY/SFX_BUY/SFX_CLOSE/SFX_DENY constants plus a second SpawnObject
// cache in this file duplicated audio.ts with identical assets, which meant two
// spawned SFX objects per sound.
const tBuilt: { [t: number]: boolean } = {};
const pBuilt: { [id: number]: boolean } = {};
const pTab: { [id: number]: number } = {};
const pHover: { [id: number]: number } = {};
const pCellHover: { [id: number]: number } = {};
const pDoneHover: { [id: number]: boolean } = {};
const tabBuilt: { [id: number]: boolean[] } = {};
const menuOpen: { [id: number]: boolean } = {};
const menuBuilt: { [id: number]: boolean } = {};


const pPage: { [id: number]: number } = {};




function toArr(a: mod.Array): any[] {
    const out: any[] = [];
    const n: number = mod.CountOf(a);
    for (let i: number = 0; i < n; i++) {
        out.push(mod.ValueInArray(a, i));
    }
    return out;
}

// Direct ObjId lookup. The previous version walked the entire roster with a
// GetObjId per entry, and this is called many times per capture refresh.
function playerById(id: number): mod.Player | undefined {
    try {
        const p: mod.Player = mod.GetPlayer(id);
        return mod.IsValid(p) ? p : undefined;
    } catch (e) {
        return undefined;
    }
}
function teamId(p: mod.Player): number {
    try {
        return mod.GetObjId(mod.GetTeam(p));
    } catch (e) {
        return 0;
    }
}

function mkContainer(
    owner: number,
    isTeam: boolean,
    key: string,
    x: number,
    y: number,
    w: number,
    h: number,
    anchor: mod.UIAnchor,
    parent: mod.UIWidget,
    bg: mod.Vector,
    alpha: number,
    fill: mod.UIBgFill,
    recv: mod.Player | mod.Team,
    visible: boolean = true
): mod.UIWidget {
    const name: string = isTeam ? tn(owner, key) : pn(owner, key);
    mod.AddUIContainer(name, v(x, y, 0), v(w, h, 0), anchor, parent, visible, 0, bg, alpha, fill, mod.UIDepth.AboveGameUI, recv);
    // AddUIContainer returns void, so one search is unavoidable here. It is paid
    // once per widget and the handle is cached, instead of per repaint.
    const handle: mod.UIWidget = mod.FindUIWidgetWithName(name);
    if (isTeam) {
        trackT(owner, name, handle);
    } else {
        trackP(owner, name, handle);
    }
    return handle;
}
function mkText(
    owner: number,
    isTeam: boolean,
    key: string,
    x: number,
    y: number,
    w: number,
    h: number,
    msg: mod.Message,
    size: number,
    color: mod.Vector,
    ta: mod.UIAnchor,
    parent: mod.UIWidget,
    recv: mod.Player | mod.Team,
    visible: boolean = true
): mod.UIWidget {
    const name: string = isTeam ? tn(owner, key) : pn(owner, key);
    mod.AddUIText(
        name,
        v(x, y, 0),
        v(w, h, 0),
        mod.UIAnchor.TopLeft,
        parent,
        visible,
        0,
        C_BLACK,
        0,
        mod.UIBgFill.None,
        msg,
        size,
        color,
        1,
        ta,
        mod.UIDepth.AboveGameUI,
        recv
    );
    const handle: mod.UIWidget = mod.FindUIWidgetWithName(name);
    if (isTeam) {
        trackT(owner, name, handle);
    } else {
        trackP(owner, name, handle);
    }
    return handle;
}

function mkBold(
    owner: number,
    isTeam: boolean,
    key: string,
    x: number,
    y: number,
    w: number,
    h: number,
    msg: mod.Message,
    size: number,
    color: mod.Vector,
    ta: mod.UIAnchor,
    parent: mod.UIWidget,
    recv: mod.Player | mod.Team
): void {
    mkText(owner, isTeam, key, x, y, w, h, msg, size, color, ta, parent, recv);
    mkText(owner, isTeam, key + "b", x + 1, y, w, h, msg, size, color, ta, parent, recv);
}

function mkLabelledButton(
    id: number,
    key: string,
    x: number,
    y: number,
    w: number,
    h: number,
    bg: mod.Vector,
    bgAlpha: number,
    hoverCol: mod.Vector,
    pressCol: mod.Vector,
    parent: mod.UIWidget,
    p: mod.Player
): PshButton {
    const wrap: mod.UIWidget = mkContainer(id, false, key + "W", x, y, w, h, mod.UIAnchor.TopLeft, parent, C_BLACK, 0, mod.UIBgFill.None, p);

    const bname: string = pn(id, key);
    mod.AddUIButton(
        bname,
        v(0, 0, 0),
        v(w, h, 0),
        mod.UIAnchor.TopLeft,
        wrap,
        true,
        0,
        bg,
        bgAlpha,
        mod.UIBgFill.Solid,
        true,
        bg,
        1,
        bg,
        1,
        pressCol,
        1,
        hoverCol,
        1,
        bg,
        1,
        mod.UIDepth.AboveGameUI,
        p
    );
    const button: mod.UIWidget = mod.FindUIWidgetWithName(bname);
    trackP(id, bname, button);

    mod.EnableUIButtonEvent(button, mod.UIButtonEvent.ButtonDown, true);
    mod.EnableUIButtonEvent(button, mod.UIButtonEvent.ButtonUp, true);
    mod.EnableUIButtonEvent(button, mod.UIButtonEvent.FocusIn, true);
    mod.EnableUIButtonEvent(button, mod.UIButtonEvent.FocusOut, true);
    mod.EnableUIButtonEvent(button, mod.UIButtonEvent.HoverIn, true);
    mod.EnableUIButtonEvent(button, mod.UIButtonEvent.HoverOut, true);
    return { wrap: wrap, button: button };
}

function mkButtonLabel(
    id: number,
    key: string,
    x: number,
    y: number,
    w: number,
    h: number,
    msg: mod.Message,
    size: number,
    color: mod.Vector,
    ta: mod.UIAnchor,
    wrap: mod.UIWidget,
    p: mod.Player
): void {
    mkText(id, false, key, x, y, w, h, msg, size, color, ta, wrap, p);
}

function resourceColour(viewer: number, repTeam: number, slot: number): mod.Vector {
    const st: number[] = siteState[repTeam] || [];
    const own: number = slot < st.length ? st[slot] : 0;
    if (own !== repTeam) {
        return C_DARK;
    }
    return colorFor(viewer, repTeam);
}

function queueResource(viewer: number, repTeam: number, cluster: number, slot: number, cx: number, top: number, parent: mod.UIWidget, recv: mod.Team): PshArt {
    const key: string = "rp" + cluster + slot;
  const mark: string = cluster === 1 ? "sR" : "sL";
    const art: PshArt = queueArt(viewer, key, cx - SITE / 2 + (SITE - RES_W) / 2, top + (SITE - RES_H) / 2, RES_W, RES_H, RESOURCE_QUADS, function (): mod.Vector {
        return resourceColour(viewer, repTeam, slot);
    }, parent, recv);
    if (rpArt[viewer] === undefined) {
        rpArt[viewer] = {};
    }
    rpArt[viewer][key] = art;
  art.mark = mark;
    return art;
}

function hollowFrame(cx: number, top: number, w: number, h: number, edge: number, col: mod.Vector, alpha: number, parent: mod.UIWidget, owner: number, isTeam: boolean, key: string, recv: mod.Player | mod.Team): void {
  const x = cx - w / 2;
  mkContainer(owner, isTeam, key + "FT", x, top, w, edge, mod.UIAnchor.TopLeft, parent, col, alpha, mod.UIBgFill.Solid, recv);
  mkContainer(owner, isTeam, key + "FB", x, top + h - edge, w, edge, mod.UIAnchor.TopLeft, parent, col, alpha, mod.UIBgFill.Solid, recv);
  mkContainer(owner, isTeam, key + "FL", x, top, edge, h, mod.UIAnchor.TopLeft, parent, col, alpha, mod.UIBgFill.Solid, recv);
  mkContainer(owner, isTeam, key + "FR", x + w - edge, top, edge, h, mod.UIAnchor.TopLeft, parent, col, alpha, mod.UIBgFill.Solid, recv);
}

function siteMarker(
    owner: number,
    isTeam: boolean,
    key: string,
    cx: number,
    top: number,
    slot: number,
    repTeam: number,
    cluster: number,
    parent: mod.UIWidget,
    recv: mod.Player | mod.Team
): void {
    const viewer: number = owner;
    queueResource(viewer, repTeam, cluster, slot, cx, top, parent, recv as mod.Team);
    hollowFrame(cx, top, SITE, SITE, SITE_EDGE, resourceColour(viewer, repTeam, slot), SITE_ALPHA, parent, owner, isTeam, key, recv);
    if (rpFrame[owner] === undefined) {
        rpFrame[owner] = {};
    }
    const bars: mod.UIWidget[] = [];
    const edges: string[] = ["FT", "FB", "FL", "FR"];
    for (let e: number = 0; e < 4; e++) {
        const w: any = W(tn(owner, key + edges[e]));
        if (w) {
            bars.push(w);
        }
    }
    rpFrame[owner][key] = bars;
}

function paintSlot(viewer: number, key: string, repTeam: number, slot: number, cluster: number): void {
    const bucket: { [k: string]: PshArt } = rpArt[viewer];
    if (bucket === undefined) {
        return;
    }
    tintArt(bucket["rp" + cluster + slot]);
    const fb: { [k: string]: mod.UIWidget[] } = rpFrame[viewer];
    if (fb === undefined) {
        return;
    }
    const col: mod.Vector = resourceColour(viewer, repTeam, slot);
    if (rpFrameCol[key] === col) {
        return;
    }
    rpFrameCol[key] = col;
    const bars: mod.UIWidget[] = fb[key];
    for (let i: number = 0; i < bars.length; i++) {
        mod.SetUIWidgetBgColor(bars[i], col);
    }
}

function refreshSites(team: number): void {
    for (let k: number = 0; k < SITE_SLOTS; k++) {
        paintSlot(team, "sL" + k, team, k, 0);
        paintSlot(team, "sR" + k, team === 1 ? 2 : 1, k, 1);
    }
}

function pRingIcon(
    owner: number,
    isTeam: boolean,
    key: string,
    cx: number,
    cy: number,
    back: mod.Vector,
    backAlpha: number,
    parent: mod.UIWidget,
    recv: mod.Player | mod.Team
): void {
    const x: number = cx - P_RING_R;
    const y: number = cy - P_RING_R;
    mkText(owner, isTeam, key + "ro", x, y, P_RING_BOX, P_RING_BOX, mod.Message("circle"), P_RING_OUT, P_RING, mod.UIAnchor.Center, parent, recv);
    const inner: mod.UIWidget = mkText(owner, isTeam, key + "ri", x + P_RING_IN_DX, y, P_RING_BOX, P_RING_BOX, mod.Message("circle"), P_RING_IN, back, mod.UIAnchor.Center, parent, recv);

    if (backAlpha < 1) {
        mod.SetUITextAlpha(inner, backAlpha);
    }

    mkText(owner, isTeam, key + "rp", x + P_RING_P_DX, y, P_RING_BOX, P_RING_BOX, mod.Message("pMark"), P_GLYPH, C_GOLD, mod.UIAnchor.Center, parent, recv);
}

function protoColour(team: number): mod.Vector {
    if (getProtoOwner() === 0) {
        return C_PLAT;
    }
    const col: mod.Vector = colorFor(team, getProtoOwner());
    return getProtoOwner() === team ? col : lighten(col);
}

const PROTO_PAYLOAD: string = "46,6,4,2;44,7,8,1;42,8,4,1;50,8,4,1;40,9,4,1;52,9,4,1;38,10,4,1;54,10,4,1;36,11,4,1;55,11,5,1;34,12,5,1;57,12,5,1;32,13,5,1;59,13,5,1;30,14,5,1;61,14,5,1;28,15,5,1;63,15,5,1;26,16,5,1;65,16,5,1;24,17,5,1;67,17,5,1;22,18,5,1;69,18,4,1;21,19,4,1;71,19,4,1;19,20,4,1;73,20,4,1;17,21,4,1;47,21,2,2;75,21,4,1;15,22,4,1;46,22,4,1;77,22,4,1;13,23,4,1;45,23,2,1;49,23,2,1;79,23,4,1;11,24,4,1;45,24,1,2;50,24,1,2;81,24,4,1;9,25,4,1;44,25,2,1;51,25,1,4;82,25,5,1;7,26,5,1;44,26,1,3;84,26,5,1;7,27,3,1;86,27,3,1;7,28,2,42;43,28,2,1;52,28,1,6;87,28,2,42;43,29,1,5;42,32,2,2;53,32,1,15;27,33,3,2;66,33,3,2;25,34,10,1;42,34,1,12;61,34,10,1;25,35,1,3;33,35,4,1;58,35,5,1;70,35,1,3;37,36,3,1;56,36,3,1;26,37,1,3;39,37,4,1;54,37,3,1;69,37,2,1;41,38,4,1;51,38,4,1;69,38,1,2;27,39,1,2;44,39,3,1;49,39,3,1;68,39,2,1;28,40,1,2;46,40,4,2;67,40,2,1;29,41,1,2;41,41,2,5;54,41,1,14;66,41,2,1;30,42,1,2;44,42,3,1;49,42,3,1;65,42,2,1;31,43,1,2;43,43,2,1;51,43,4,1;64,43,2,1;32,44,1,2;46,44,4,8;63,44,2,1;33,45,1,1;39,45,4,1;45,45,6,6;55,45,2,1;62,45,2,1;34,46,2,1;38,46,2,1;41,46,1,9;44,46,8,4;56,46,2,1;60,46,2,1;35,47,4,2;57,47,4,2;33,49,3,1;38,49,2,1;42,49,1,15;53,49,2,6;56,49,2,1;60,49,3,1;32,50,2,1;39,50,4,1;55,50,2,1;62,50,2,1;31,51,2,1;63,51,2,1;30,52,2,1;43,52,2,1;51,52,4,1;64,52,2,1;29,53,2,1;44,53,3,1;49,53,3,1;65,53,2,1;28,54,2,1;46,54,4,2;66,54,2,1;27,55,2,1;53,55,1,9;67,55,2,1;26,56,2,1;44,56,3,1;49,56,3,1;68,56,2,1;26,57,1,2;41,57,4,1;51,57,4,1;69,57,1,2;25,58,2,1;39,58,4,1;54,58,3,1;70,58,1,4;25,59,1,3;37,59,3,1;56,59,3,1;33,60,4,1;58,60,5,1;26,61,8,1;61,61,10,1;27,62,3,1;43,62,1,6;52,62,2,2;66,62,3,1;52,64,1,4;44,67,1,4;51,67,2,1;9,68,1,3;51,68,1,3;86,68,3,2;10,69,2,2;84,69,5,1;12,70,2,2;45,70,1,3;50,70,2,1;82,70,5,1;11,71,4,1;50,71,1,2;81,71,4,1;13,72,4,1;46,72,1,2;49,72,2,1;79,72,4,1;15,73,4,1;47,73,3,1;77,73,4,1;17,74,4,1;47,74,2,1;75,74,4,1;19,75,4,1;73,75,4,1;21,76,4,1;71,76,4,1;22,77,5,1;69,77,4,1;24,78,5,1;67,78,5,1;26,79,5,1;65,79,5,1;28,80,5,1;63,80,5,1;30,81,5,1;61,81,5,1;32,82,5,1;59,82,5,1;34,83,5,1;57,83,5,1;36,84,4,1;55,84,5,1;38,85,5,1;53,85,5,1;40,86,4,1;52,86,4,1;42,87,4,1;50,87,4,1;44,88,8,1;46,89,4,1";

const RESOURCE_PAYLOAD: string = "20,1,2,1;19,2,2,2;17,3,4,1;17,4,3,1;15,5,4,2;14,6,5,1;13,7,5,1;12,8,5,2;10,9,7,1;9,10,7,1;8,11,7,5;7,12,17,1;6,13,17,1;4,14,18,1;4,15,17,1;12,16,8,1;11,17,7,1;11,18,6,1;10,19,6,1;10,20,5,1;9,21,5,1;9,22,4,1;8,23,3,1;7,24,3,1;7,25,2,1;6,26,2,1;6,27,1,1";



type PshArt = {
    team: number;
    name: string;
    host: mod.UIWidget;
    recv: mod.Team;
    quads: number[];
    total: number;
    next: number;
    ready: boolean;
    shown: boolean;
    made: mod.UIWidget[];
    // Last colour committed to every quad. commit() returns one of a small fixed
    // set of cached palette vectors, so identity comparison is a correct
    // zero-FFI change detector: same reference means the same colour.
    lastCol?: mod.Vector;
    mark?: string;

    commit: () => mod.Vector;
};

function parseQuads(payload: string): number[] {
    const out: number[] = [];
    const parts: string[] = payload.split(";");
    for (let i: number = 0; i < parts.length; i++) {
        const n: string[] = parts[i].split(",");
        for (let j: number = 0; j < n.length; j++) {
            out.push(Number(n[j]));
        }
    }
    return out;
}

const artQueue: PshArt[] = [];
let artActive: PshArt | undefined = undefined;
const protoArt: { [team: number]: PshArt } = {};

const rpArt: { [team: number]: { [k: string]: PshArt } } = {};
const rpFrame: { [team: number]: { [k: string]: mod.UIWidget[] } } = {};
// Last colour written to each resource frame's edge bars. Same reference-comparison
// trick as PshArt.lastCol: only write when the palette entry actually changed.
const rpFrameCol: { [key: string]: mod.Vector } = {};

const PROTO_QUADS: number[] = parseQuads(PROTO_PAYLOAD);
const RESOURCE_QUADS: number[] = parseQuads(RESOURCE_PAYLOAD);

function queueArt(
    team: number,
    key: string,
    x: number,
    y: number,
    w: number,
    h: number,
    quads: number[],
    commit: () => mod.Vector,
    parent: mod.UIWidget,
    recv: mod.Team
): PshArt {
    const name: string = tn(team, key);
    const host: mod.UIWidget = mkContainer(team, true, key, x, y, w, h, mod.UIAnchor.TopLeft, parent, C_BLACK, 0, mod.UIBgFill.None, recv, false);
    const art: PshArt = {
        team: team,
        name: name,
        host: host,
        recv: recv,
        quads: quads,
        total: quads.length / 4,
        next: 0,
        ready: false,
        shown: false,
        made: [],
        commit: commit,
    };
    artQueue.push(art);
    return art;
}

function queueProto(team: number, parent: mod.UIWidget, recv: mod.Team): PshArt {
    const art: PshArt = queueArt(team, "proto", PROTO_X, PROTO_Y, PROTO_W, PROTO_H, PROTO_QUADS, function (): mod.Vector {
        return protoColour(team);
    }, parent, recv);
    protoArt[team] = art;
    return art;
}

function pumpPixelArt(): void {
    if (artActive === undefined) {
        artActive = artQueue.shift();
    }
    if (artActive === undefined) {
        return;
    }
    const a: PshArt = artActive;
    const stop: number = Math.min(a.total, a.next + artBudgetThisTick);
    while (a.next < stop) {
        const i: number = a.next * 4;
        const nm: string = a.name + "p" + a.next;

        mod.AddUIContainer(
            nm,
            v(a.quads[i], a.quads[i + 1], 0),
            v(a.quads[i + 2], a.quads[i + 3], 0),
            mod.UIAnchor.TopLeft,
            a.host,
            true,
            0,
            a.commit(),
            1,
            mod.UIBgFill.Solid,
            a.recv
        );
        const qw: mod.UIWidget = mod.FindUIWidgetWithName(nm);
        trackT(a.team, nm, qw);
        a.made.push(qw);
        a.next = a.next + 1;
    }
    if (a.next >= a.total) {
        a.ready = true;
        artActive = undefined;

        if (!a.shown) {
            a.shown = true;
            mod.SetUIWidgetVisible(a.host, true);
            if (willLogDebug()) {
        log("art", "team " + a.team + " " + a.name + " ready (" + a.total + " quads)");
    }
        }
        // Tint unconditionally, not just on first show. A colour change that
        // arrives while the quads are still being built would otherwise be
        // dropped and the icon would keep its stale colour forever.
        tintArt(a);
    }
}

function tintArt(a: PshArt): void {
    if (a === undefined || a.made.length === 0) {
        return;
    }
    const col: mod.Vector = a.commit();
    if (a.lastCol === col) {
        // Same palette entry as last time: every quad already carries it.
        return;
    }
    a.lastCol = col;
    for (let i: number = 0; i < a.made.length; i++) {
        const w: any = a.made[i];
        if (w) {
            mod.SetUIWidgetBgColor(w, col);
        }
    }
    if (willLogDebug()) {
        log("paint", "team " + a.team + " " + a.name + " tinted " + a.made.length + " quads");
    }
}

function tintProto(team: number): void {
    tintArt(protoArt[team]);
}

// Per-side repaint state. The pips only change at the boundary between the old
// and new fill level, and the two text widgets only change when the rounded
// number changes, so a steady-state repaint costs a few writes instead of ~40.
type PshSideState = {
    filled: number;
    hqW: any;
    hqLabel: number;
    nW: any;
    nLabel: number;
};const sideState: { [k: string]: PshSideState } = {};

function paintSide(team: number, key: string, col: mod.Vector, baseHp: number, nuke: number): void {
    const sk: string = team + key;
    let st: PshSideState = sideState[sk];
    if (st === undefined) {
        const hqNames: string[] = [key + "hq", key + "hq" + "b"];
        const nNames: string[] = [key + "n", key + "n" + "b"];
        st = {
            filled: -1,
            hqW: W(tn(team, hqNames[0])),
            hqLabel: -1,
            nW: W(tn(team, nNames[0])),
            nLabel: -1
        };
        sideState[sk] = st;
    }
    // Compared on the raw value, not a rounded one, so the label is rewritten
    // with exactly the input the old code passed to mod.Message.
    if (baseHp !== st.hqLabel) {
        st.hqLabel = baseHp;
        for (let j: number = 0; j < 2; j++) {
            const w: any = j === 0 ? st.hqW : W(tn(team, key + "hq" + "b"));
            if (w) {
                mod.SetUITextLabel(w, mod.Message("hq", baseHp));
            }
        }
    }
    const filled: number = Math.round((nuke / 100) * NPIP);
    if (filled !== st.filled) {
        // Only the pips between the two fill levels changed. Widen from whichever
        // side moved, then clamp into range.
        let lo: number = filled < st.filled ? filled : st.filled;
        let hi: number = filled < st.filled ? st.filled : filled;
        if (lo < 0) {
            lo = 0;
        }
        if (hi > NPIP) {
            hi = NPIP;
        }
        for (let i: number = lo; i < hi; i++) {
            const w: any = W(tn(team, key + "p" + i));
            if (w) {
                const on: boolean = i < filled;
                mod.SetUIWidgetBgColor(w, on ? col : C_DARK);
                mod.SetUIWidgetBgAlpha(w, on ? 1 : 0.7);
            }
        }
        st.filled = filled;
    }
    const nn: number = Math.round(nuke);
    if (nn !== st.nLabel) {
        st.nLabel = nn;
        for (let j: number = 0; j < 2; j++) {
            const w: any = j === 0 ? st.nW : W(tn(team, key + "n" + "b"));
            if (w) {
                mod.SetUITextLabel(w, mod.Message(nn));
            }
        }
    }
    if (willLogDebug()) {
        log("paint", "team " + team + " side " + key + " base=" + baseHp
            + " power=" + String(nn));
    }
}

function paintEmblem(team: number): void {
    tintProto(team);
}

function repaintTeamBars(): void {
    for (let t: number = 1; t <= 2; t++) {
        if (!tBuilt[t]) {
            continue;
        }
        const foe: number = t === 1 ? 2 : 1;
        paintSide(t, "L", colorFor(t, t), baseVal[t], powerVal[t]);
        paintSide(t, "R", colorFor(t, foe), baseVal[foe], powerVal[foe]);
        paintEmblem(t);
    }
}

function stateSeed(team: number, foeTeam: number): void {
    if (MOCK_DATA) {
        siteState[team] = (MOCK_SITES[team] || []).slice();
    } else {
        siteState[team] = [];
    }
    if (!siteState[foeTeam]) {
        if (MOCK_DATA) {
            siteState[foeTeam] = (MOCK_SITES[foeTeam] || []).slice();
        } else {
            siteState[foeTeam] = [];
        }
    }
    for (const t of [1, 2]) {
        while (siteState[t].length < SITE_LETTER.length) {
            siteState[t].push(0);
        }
    }
    powerVal[team] = MOCK_DATA ? MOCK_NUKE[team] : 0;
    baseVal[team] = MOCK_DATA ? MOCK_BASE[team] : 100;
    setProtoOwner(MOCK_DATA ? MOCK_PROTO : 0);
}

function stateSetSite(team: number, slot: number, owner: number, mirrorTeam?: number): void {
    if (team !== 1 && team !== 2) {
        return;
    }
    if (!siteState[team]) {
        siteState[team] = [];
    }
    const st: number[] = siteState[team];
    const before: number = st[slot] === undefined ? 0 : st[slot];
    const after: number = owner === 1 || owner === 2 ? owner : 0;
    if (before === after) {
        return;
    }
    st[slot] = after;

    if (mirrorTeam !== undefined && (mirrorTeam === 1 || mirrorTeam === 2)) {
        if (!siteState[mirrorTeam]) {
            siteState[mirrorTeam] = [];
        }
        siteState[mirrorTeam][slot] = after;
    }
    refreshSites(team);
    refreshSites(team === 1 ? 2 : 1);
    announceSite(slot, before, after);
    // Site ownership only changes the charge RATE (see factory.ts). It must not
    // overwrite banked power, so just repaint.
    repaintTeamBars();
    log("state", "site t" + team + " slot " + slot + " " + before + " -> " + after);
}

function powerFeedKey(viewer: number, gaining: number, at: number): string {
    return viewer === gaining ? "power" + at : "powerFoe" + at;
}

function nukeFeedKey(viewer: number, gaining: number): string {
    return viewer === gaining ? "nukeReady" : "nukeFoeReady";
}

// Milestone and nuke-ready feeds for any power change, whether it came from
// the debug stepper or from real time-based charge in factory.ts.
// SetScoreboardHeader is two FFI calls. announcePowerChange fires whenever the
// banked charge moves, which is every frame while a team is charging, so the
// header is only rebuilt when the percentage it displays actually changes.
const shownHeader: { [t: number]: number } = { 1: -1, 2: -1 };

function pushHeaderIfChanged(): void {
    let dirty: boolean = false;
    for (const t of [1, 2]) {
        const r: number = Math.round(powerVal[t]);
        if (shownHeader[t] !== r) {
            shownHeader[t] = r;
            dirty = true;
        }
    }
    if (dirty) {
        pushHeader();
    }
}

function announcePowerChange(team: number, before: number, after: number): void {
    pushHeaderIfChanged();
    for (let k: number = 0; k < POWER_MILESTONES.length; k++) {
        const at: number = POWER_MILESTONES[k];
        if (before < at && after >= at) {
            for (let t: number = 1; t <= 2; t++) {
                if (tBuilt[t]) {
                    pushTeamFeed(t, powerFeedKey(t, team, at), 0, 0);
                }
            }
        }
    }
    if (before < 100 && after >= 100) {
        for (let t: number = 1; t <= 2; t++) {
            if (tBuilt[t]) {
                pushTeamFeed(t, nukeFeedKey(t, team), 0, 0);
            }
        }
    }
}

function stateSetPower(team: number, value: number): void {
    if (team !== 1 && team !== 2) {
        return;
    }
    const before: number = powerVal[team] === undefined ? 0 : powerVal[team];
    const after: number = value < 0 ? 0 : value > 100 ? 100 : value;
    if (before === after) {
        return;
    }
    powerVal[team] = after;
    repaintTeamBars();
    announcePowerChange(team, before, after);
    log("state", "power t" + team + " " + before + " -> " + after);
}

// silent: skip the generic "baseHit" feed line. Real HQ hits pass true because
// turrets.ts already sends the defender/attacker notifications for them.
function stateSetBase(team: number, hp: number, silent: boolean = false): void {
    if (team !== 1 && team !== 2) {
        return;
    }
    const before: number = baseVal[team] === undefined ? 100 : baseVal[team];
    const after: number = hp < 0 ? 0 : hp > 100 ? 100 : hp;
    if (before === after) {
        return;
    }
    baseVal[team] = after;
    repaintTeamBars();
    if (after < before && !silent) {
        pushTeamFeed(team, "baseHit", after, 100);
    }
    log("state", "base t" + team + " " + before + " -> " + after);
}

function stateSetProto(owner: number): void {
    const before: number = getProtoOwner();
    const after: number = owner === 1 || owner === 2 ? owner : 0;
    if (before === after) {
        return;
    }
    setProtoOwner(after);
    repaintTeamBars();
    if (after !== 0) {
        announceProto(before, after);
    }

    log("state", "proto " + before + " -> " + after);
}

function stateAddPrestige(id: number, delta: number): void {
    const before: number = pPrestige[id] === undefined ? 0 : pPrestige[id];
    setPrestige(id, before + delta);
    const gained: number = pPrestige[id] - before;

    const who: mod.Player | undefined = playerById(id);
    if (gained > 0 && who) {
        pushPlayerFeed(who, "prestigeUp", gained, 0);
    }
    log("state", "prestige pid " + id + " " + before + " -> " + pPrestige[id]);
}

function sideOfBar(
    team: number,
    key: string,
    x: number,
    mirror: boolean,
    col: mod.Vector,
    baseHp: number,
    nuke: number,
    parent: mod.UIWidget,
    recv: mod.Team
): void {
    const labAlign: mod.UIAnchor = mirror ? mod.UIAnchor.CenterRight : mod.UIAnchor.CenterLeft;
    const numAlign: mod.UIAnchor = mirror ? mod.UIAnchor.CenterLeft : mod.UIAnchor.CenterRight;
    mkBold(team, true, key + "hq", x, 0, BAR_W, HQ_H, mod.Message("hq", baseHp), HQ_SIZE, col, labAlign, parent, recv);
    const filled: number = Math.round((nuke / 100) * NPIP);
    for (let i: number = 0; i < NPIP; i++) {
        const on: boolean = i < filled;
        const px: number = mirror ? x + i * (PIP_W + PIP_GAP) : x + BAR_W - (i + 1) * (PIP_W + PIP_GAP);
        mkContainer(team, true, key + "p" + i, px, PIP_Y, PIP_W, PIP_H, mod.UIAnchor.TopLeft, parent, on ? col : C_DARK, on ? 1 : 0.7, mod.UIBgFill.Solid, recv);
    }
    mkBold(team, true, key + "n", x, NUM_Y, BAR_W, NUM_H, mod.Message(nuke), NUM_SIZE, col, numAlign, parent, recv);
}

function buildTeamBar(team: number): void {
    safe("buildTeamBar", () => {
        if (tBuilt[team]) {
            return;
        }
        const recv: mod.Team = mod.GetTeam(team);
        if (!recv) {
            log("bar", "team " + team + " unavailable, skipping");
            return;
        }
        const foe: number = team === 1 ? 2 : 1;
        const root: mod.UIWidget = mod.GetUIRoot();
        tNames[team] = [];

        const bar: mod.UIWidget = mkContainer(team, true, "bar", 0, BAR_Y, HUD_W, BAR_H, mod.UIAnchor.TopCenter, root, C_BLACK, 0, mod.UIBgFill.None, recv);

        const foeTeam: number = team === 1 ? 2 : 1;
        stateSeed(team, foeTeam);

        const leftBase: number = BAR_L - SITE_INNER_GAP - SITE / 2;
        const rightBase: number = BAR_R + BAR_W + SITE_INNER_GAP + SITE / 2;
        for (let k: number = 0; k < SITE_SLOTS; k++) {
            const lx: number = leftBase - (SITE_SLOTS - 1 - k) * (SITE + SITE_GAP);
            const rx: number = rightBase + k * (SITE + SITE_GAP);

            siteMarker(team, true, "sL" + k, lx, SITE_TOP, k, team, 0, bar, recv);
            siteMarker(team, true, "sR" + k, rx, SITE_TOP, k, foeTeam, 1, bar, recv);
        }
        sideOfBar(team, "L", BAR_L, false, colorFor(team, team), baseVal[team], powerVal[team], bar, recv);
        sideOfBar(team, "R", BAR_R, true, colorFor(team, foe), baseVal[foe], powerVal[foe], bar, recv);
          queueProto(team, bar, recv);
          buildTeamFeed(team, recv, root);
          refreshSites(team);

    feedSeen[team] = {};
  
          tBuilt[team] = true;
          log("bar", "team " + team + " bar built, widgets=" + tNames[team].length);
    });
}

function destroyTeamBars(): void {
    safe("destroyTeamBars", () => {
        for (let t: number = 1; t <= 2; t++) {
            const refs = tNames[t] || [];
            for (let i: number = refs.length - 1; i >= 0; i--) {
                try {
                    if (refs[i].w) {
                        mod.DeleteUIWidget(refs[i].w);
                    }
                } catch (e) {
                    continue;
                }
            }
            forgetPrefix("pst" + t + "_");
            for (const k of Object.keys(sideState)) {
                // Handles are per-team; drop both sides of every rebuilt bar so a
                // new widget is never mistaken for the old one.
                if (k.charAt(0) === String(t)) {
                    delete sideState[k];
                }
            }
            for (const k of Object.keys(rpFrameCol)) {
                if (k.charAt(0) === String(t)) {
                    delete rpFrameCol[k];
                }
            }
            tNames[t] = [];
            tBuilt[t] = false;

          }
      });
  }

function buildTeamFeed(team: number, recv: mod.Team, root: mod.UIWidget): void {
    const wrap: mod.UIWidget = mkContainer(team, true, "fd", 0, FEED_Y, FEED_W, FEED_SLOTS * CHIP_PITCH, mod.UIAnchor.TopLeft, root, C_BLACK, 0, mod.UIBgFill.None, recv, false);
    for (let i: number = 0; i < FEED_SLOTS; i++) {
        const y: number = i * CHIP_PITCH;
        const line: mod.UIWidget = mkContainer(team, true, "f" + i, CHIP_INSET, y, CHIP_W, CHIP_H, mod.UIAnchor.TopLeft, wrap, C_BLACK, 0.34, mod.UIBgFill.Blur, recv, false);
        mkContainer(team, true, "fa" + i, 0, 0, ACCENT_W, CHIP_H, mod.UIAnchor.TopLeft, line, FEED_WHITE, 1, mod.UIBgFill.Solid, recv, false);
        mkText(team, true, "fi" + i, CHIP_ICON_X, 0, CHIP_ICON, CHIP_H, mod.Message("fslot"), CHIP_ICON, FEED_WHITE, mod.UIAnchor.Center, line, recv, false);

        mkText(team, true, "ft" + i, CHIP_TEXT_X, 0, CHIP_W - CHIP_TEXT_X, CHIP_H, mod.Message("fslot"), CHIP_TEXT, FEED_WHITE, mod.UIAnchor.CenterLeft, line, recv, false);
    }
}

function buildPlayerFeed(id: number, p: mod.Player, root: mod.UIWidget): void {
    const wrap: mod.UIWidget = mkContainer(id, false, "pfd", 0, PFEED_Y, FEED_W, 30, mod.UIAnchor.TopLeft, root, C_BLACK, 0, mod.UIBgFill.None, p, false);
    const line: mod.UIWidget = mkContainer(id, false, "pf0", CHIP_INSET, 0, CHIP_W, CHIP_H, mod.UIAnchor.TopLeft, wrap, C_BLACK, 0.34, mod.UIBgFill.Blur, p, false);
    mkContainer(id, false, "pfa0", 0, 0, ACCENT_W, CHIP_H, mod.UIAnchor.TopLeft, line, FEED_WHITE, 1, mod.UIBgFill.Solid, p, false);
    mkText(id, false, "pfi0", CHIP_ICON_X, 0, CHIP_ICON, CHIP_H, mod.Message("fslot"), CHIP_ICON, FEED_WHITE, mod.UIAnchor.Center, line, p, false);
    mkText(id, false, "pft0", CHIP_TEXT_X, 0, CHIP_W - CHIP_TEXT_X, CHIP_H, mod.Message("fslot"), CHIP_TEXT, FEED_WHITE, mod.UIAnchor.CenterLeft, line, p, false);
}


function buildTabRows(id: number, t: number, p: mod.Player, menu: mod.UIWidget): void {
    const data: PshTab = TABS_DATA[t];
    // Bracket the build so every widget created here is filed as a menu widget
    // and can be torn down when the menu closes.
    beginMenuBuild(id, t);
    const panel: mod.UIWidget = mkContainer(id, false, "tp" + t, 0, 0, MENU_W, MENU_H, mod.UIAnchor.TopLeft, menu, C_BLACK, 0, mod.UIBgFill.None, p);
    const secs: PshSection[] = tabSectionsFor(id, t);
    layoutSections(widestSections(t), data.cols);
    for (let s: number = 0; s < secs.length; s++) {
        const sec: PshSection = secs[s];
        const headY: number = SEC_HEAD_Y[s];
        const rowY: number = SEC_ROW_Y[s];
        const head: mod.UIWidget = mkContainer(id, false, "sh" + t + s, 4, headY, MENU_W - 8, SEC_HEAD_H, mod.UIAnchor.TopLeft, panel, MENU_HEAD, 1, mod.UIBgFill.Solid, p);
        mkText(id, false, "sht" + t + s, 10, 0, MENU_W - 28, SEC_HEAD_H, mod.Message(sec.head), 13, MENU_TXT, mod.UIAnchor.CenterLeft, head, p);
        for (let i: number = 0; i < sec.items.length; i++) {
            const item: PshItem = sec.items[i];
            const afford: boolean = item.cost <= pPrestige[id];

            const cellX: number = colX(t, i % TABS_DATA[t].cols);
            const cellY: number = rowY + Math.floor(i / TABS_DATA[t].cols) * ROW_STEP;
            const cw: number = cellW(t);
            const ckey: string = cellKey(id, t, s, i);
            const tc: mod.Vector = afford ? MENU_TITLE : MENU_LOCKTXT;

            const rowAct: string | undefined = item.act;
            const tail: mod.Message = rowAct !== undefined ? dbgValueMsg(id, rowAct) : mod.Message(item.cost);
            const locationAct: string | undefined = rowAct !== undefined && rowAct.substring(0, 4) === "loc:" ? rowAct : undefined;
            const locationRow: boolean = locationAct !== undefined;
            const tailColor: mod.Vector = locationRow ? tacticalStateColor(id, String(locationAct)) : afford ? MENU_COST : MENU_LOCKTXT;
            // Only the currently highlighted row is tinted. Tinting every location
            // row made the whole Tactical tab look selected (screenshot 1).
            const isActive: boolean = locationAct !== undefined && highlightedLocation[id] === locationAct.substring(4);
            const rowColor: mod.Vector = isActive ? tailColor : afford ? MENU_HEAD : C_BLACK;

            const cb: PshButton = mkLabelledButton(id, ckey, cellX, cellY, cw, CELL_H, rowColor, isActive ? 0.2 : afford ? 0.55 : 0.35, MENU_HOVER, MENU_PRESS, panel, p);
            if (item.sub === undefined || locationRow) {
                // Location rows put the name on the top line and the distance on
                // the sub-line. The generic sub label is skipped for them because
                // it drew "CLICK TO HIGHLIGHT" on the same y as the distance
                // label, stacking two near-identical strings on top of each
                // other.
                mkButtonLabel(id, "n" + ckey, 8, 1, cw - 52, 20, mod.Message(item.key), 14, tc, mod.UIAnchor.CenterLeft, cb.wrap, p);
            } else {
                mkButtonLabel(id, "n" + ckey, 8, 3, cw - 52, 20, mod.Message(item.key), 14, tc, mod.UIAnchor.CenterLeft, cb.wrap, p);
                mkButtonLabel(id, "s" + ckey, 8, 21, cw - 52, 20, mod.Message(item.sub), 12, tc, mod.UIAnchor.CenterLeft, cb.wrap, p);
            }
            if (locationAct !== undefined) {
                mkButtonLabel(id, "d" + ckey, 8, 23, cw - 52, 20, distanceLabel(id, locationAct), 12, MENU_LOCKTXT, mod.UIAnchor.CenterLeft, cb.wrap, p);
            }
            if (rowAct === undefined) {
                mkButtonLabel(id, "p" + ckey, cw - 68, 0, 14, CELL_H, mod.Message("pMark"), 14, afford ? MENU_COST : MENU_LOCKTXT, mod.UIAnchor.Center, cb.wrap, p);
            }
            mkButtonLabel(id, "v" + ckey, cw - 44, 0, 36, CELL_H, tail, 13, tailColor, mod.UIAnchor.Center, cb.wrap, p);
        }
    }
    if (pageCount(t) > 1) {
        buildPager(id, t, p, panel);
    }
    endMenuBuild();
    tabBuilt[id][t] = true;
    log("menu", "pid=" + id + " built tab " + t + " (" + data.label + ")");}

// Last tab-button state per player, so a hover repaint only writes the one tab
// that actually changed instead of all of them.
const tabPaintState: { [id: number]: { sel: number; hov: number } } = {};

function paintTabs(id: number): void {
    const sel: number = pTab[id];
    const hov: number = pHover[id] === undefined ? -1 : pHover[id];
    const prev = tabPaintState[id];
    if (prev !== undefined && prev.sel === sel && prev.hov === hov) {
        return;
    }
    tabPaintState[id] = { sel: sel, hov: hov };
    for (let i: number = 0; i < TABS_DATA.length; i++) {
        const on: boolean = i === sel;
        const hovered: boolean = i === hov;
        const col: mod.Vector = on ? MENU_ORANGE_SEL : hovered ? MENU_ORANGE_HOVER : MENU_TXT;
        const lt: any = W(pn(id, "tbt" + i));
        if (lt) {
            mod.SetUITextColor(lt, col);
        }

        const bb: any = W(pn(id, "tb" + i));
        if (bb) {
            mod.SetUIWidgetBgColor(bb, on || hovered ? col : MENU_BG);
            mod.SetUIWidgetBgAlpha(bb, on ? 0.32 : hovered ? 0.22 : 0.9);
        }
        const un: any = W(pn(id, "tbu" + i));
        if (un) {
            mod.SetUIWidgetVisible(un, on);
            mod.SetUIWidgetBgColor(un, MENU_ORANGE_SEL);
        }
    }
}

function hoverTab(id: number, w: mod.UIWidget, on: boolean): void {
    for (let i: number = 0; i < TABS_DATA.length; i++) {
        if (widgetIs(id, w, "tb" + i)) {
            pHover[id] = on ? i : -1;
            paintTabs(id);
            return;
        }
    }
}

// Last colour/alpha written per cell background, keyed by widget name. Menu
// mouse sweeps re-enter these cells constantly with the same values, so skipping
// identical writes makes a sweep cost zero instead of 2 calls per cell.
const cellBgState: { [n: string]: { col: mod.Vector; alpha: number } } = {};

function paintCellBg(id: number, ckey: string, afford: boolean, hot: boolean): void {
    const name: string = pn(id, ckey);
    const bb: any = W(name);
    if (!bb) {
        return;
    }
    const col: mod.Vector = hot ? MENU_HOVER : afford ? MENU_HEAD : C_BLACK;
    const alpha: number = hot ? 0.85 : afford ? 0.55 : 0.35;
    const prev = cellBgState[name];
    if (prev !== undefined && prev.col === col && prev.alpha === alpha) {
        return;
    }
    cellBgState[name] = { col: col, alpha: alpha };
    mod.SetUIWidgetBgColor(bb, col);
    mod.SetUIWidgetBgAlpha(bb, alpha);
}

// Repaint cell text to match current affordability. paintCellBg only changes
// the background, so without this the name and cost kept the locked styling
// they were baked with at build time.
function repaintCellLabels(id: number, ckey: string, afford: boolean): void {
    const tc: mod.Vector = afford ? MENU_TITLE : MENU_LOCKTXT;
    const cc: mod.Vector = afford ? MENU_COST : MENU_LOCKTXT;
    const parts: string[] = ["n", "s", "v", "p"];
    for (const pre of parts) {
        const w: any = W(pn(id, pre + ckey));
        if (w) {
            mod.SetUITextColor(w, pre === "n" || pre === "s" ? tc : cc);
        }
    }
}

function hoverCell(id: number, w: mod.UIWidget, on: boolean): void {
    if (widgetIs(id, w, "mdone")) {
        const bb: any = W(pn(id, "mdone"));
        if (bb) {
            mod.SetUIWidgetBgColor(bb, on ? MENU_HOVER : MENU_EDGE);
            mod.SetUIWidgetBgAlpha(bb, on ? 0.85 : 0.55);
        }
        return;
    }
    const t: number = pTab[id];
    if (!tabBuilt[id] || !tabBuilt[id][t]) {
        return;
    }
    const secs: PshSection[] = tabSectionsFor(id, t);
    for (let s: number = 0; s < secs.length; s++) {
        const items: PshItem[] = secs[s].items;
        for (let i: number = 0; i < items.length; i++) {
            if (!widgetIs(id, w, cellKey(id, t, s, i))) {
                continue;
            }
            const prev: number = pCellHover[id] === undefined ? -1 : pCellHover[id];
            if (prev >= 0) {
                const ps: number = Math.floor(prev / 100);
                const pi: number = prev % 100;
                const pitems: PshItem[] = tabSectionsFor(id, t)[ps].items;
                paintCellBg(id, cellKey(id, t, ps, pi), pitems[pi].cost <= pPrestige[id], false);
            }
            pCellHover[id] = on ? s * 100 + i : -1;
            paintCellBg(id, cellKey(id, t, s, i), items[i].cost <= pPrestige[id], on);
            return;
        }
    }
}

function buildPager(id: number, t: number, p: mod.Player, panel: mod.UIWidget): void {
    const n: number = pageCount(t);
    const page: number = pPage[id] === undefined ? 0 : pPage[id];
    const total: number = PAGER_W * 3 + PAGER_GAP * 2;
    const x0: number = (MENU_W - total) / 2;
    const atStart: boolean = page <= 0;
    const atEnd: boolean = page >= n - 1;

    const prev: PshButton = mkLabelledButton(id, "pgprev" + t, x0, PAGER_Y, PAGER_W, CELL_H, MENU_EDGE, 0.55, MENU_HOVER, MENU_PRESS, panel, p);
    mkButtonLabel(id, "pgprevt" + t, 0, 0, PAGER_W, CELL_H, mod.Message(atStart ? "dbgNone" : "dbgPrev"), 15, atStart ? MENU_LOCKTXT : MENU_TITLE, mod.UIAnchor.Center, prev.wrap, p);

    const mid: PshButton = mkLabelledButton(id, "pgmid" + t, x0 + PAGER_W + PAGER_GAP, PAGER_Y, PAGER_W, CELL_H, MENU_EDGE, 0.35, MENU_HOVER, MENU_PRESS, panel, p);
    mkButtonLabel(id, "pgmidt" + t, 0, 0, PAGER_W, CELL_H, mod.Message("dbgPage", page + 1, n), 13, MENU_TXT, mod.UIAnchor.Center, mid.wrap, p);

    const next: PshButton = mkLabelledButton(id, "pgnext" + t, x0 + (PAGER_W + PAGER_GAP) * 2, PAGER_Y, PAGER_W, CELL_H, MENU_EDGE, 0.55, MENU_HOVER, MENU_PRESS, panel, p);
    mkButtonLabel(id, "pgnextt" + t, 0, 0, PAGER_W, CELL_H, mod.Message(atEnd ? "dbgNone" : "dbgNext"), 15, atEnd ? MENU_LOCKTXT : MENU_TITLE, mod.UIAnchor.Center, next.wrap, p);
}

function setPage(id: number, t: number, page: number, p: mod.Player): void {
    const n: number = pageCount(t);
    if (n <= 1) {
        return;
    }
    const want: number = page < 0 ? 0 : page > n - 1 ? n - 1 : page;
    if (pPage[id] === want) {
        return;
    }
    pPage[id] = want;
    const old: any = W(pn(id, "tp" + t));
    if (old) {
        mod.DeleteUIWidget(old);
        forget(pn(id, "tp" + t));
    }
    // Deleting the panel takes its rows with it, so drop their refs too.
    forgetMenuTab(id, t);
    tabBuilt[id][t] = false;
    const menu: any = W(pn(id, "menu"));
    if (menu) {
        buildTabRows(id, t, p, menu);
    }
    log("page", "pid=" + id + " tab=" + t + " page " + (want + 1) + "/" + n);
}

// Drop a built tab so the next setTab rebuilds it. Required when the data a tab
// renders from changes (e.g. moving from the proto factory to aviation), or the
// player keeps seeing the previous factory's item list.
function rebuildIfCurrent(id: number, t: number): void {
    if (pTab[id] !== t) {
        return;
    }
    const pl: mod.Player | undefined = playerById(id);
    const mnu: any = W(pn(id, "menu"));
    if (pl !== undefined && mnu && menuBuilt[id]) {
        buildTabRows(id, t, pl, mnu);
    }
}

function invalidateTab(id: number, t: number): void {
    if (!tabBuilt[id]) {
        return;
    }
    const panel: any = W(pn(id, "tp" + t));
    if (panel) {
        mod.DeleteUIWidget(panel);
        forget(pn(id, "tp" + t));
    }
    forgetMenuTab(id, t);
    tabBuilt[id][t] = false;
    rebuildIfCurrent(id, t);
}

function setTab(id: number, t: number, p: mod.Player): void {
    pTab[id] = t;
    for (let i: number = 0; i < TABS_DATA.length; i++) {
        const pv: any = W(pn(id, "tp" + i));
        if (pv) {
            mod.SetUIWidgetVisible(pv, i === t);
        }
    }
    if (!tabBuilt[id][t]) {
        const menu: any = W(pn(id, "menu"));
        if (menu) {
            buildTabRows(id, t, p, menu);
            const pv: any = W(pn(id, "tp" + t));
            if (pv) {
                mod.SetUIWidgetVisible(pv, true);
            }
        }
    } else if (t === TACTICAL_TAB) {
        // Already built: recompute distances and states for the current
        // position instead of showing whatever was cached earlier.
        refreshDebugRows(id);
    }
    paintTabs(id);
}

function setPrestige(id: number, v: number): void {
    pPrestige[id] = v < 0 ? 0 : v;
    const cur: number = pPrestige[id];
    for (const k of ["prv", "mpv"]) {
        const w: any = W(pn(id, k));
        if (w) {
            mod.SetUITextLabel(w, mod.Message(cur));
        }
    }
    const t: number = pTab[id];
    if (tabBuilt[id] && tabBuilt[id][t]) {
        const secs: PshSection[] = tabSectionsFor(id, t);
        for (let s: number = 0; s < secs.length; s++) {
            const items: PshItem[] = secs[s].items;
            for (let i: number = 0; i < items.length; i++) {
                const ckey: string = cellKey(id, t, s, i);
                const afford: boolean = items[i].cost <= cur;
                paintCellBg(id, ckey, afford, false);
                repaintCellLabels(id, ckey, afford);
            }
        }
    }
    log("prestige", "pid=" + id + " -> " + cur);
}



function setMenuOpen(id: number, p: mod.Player, open: boolean): void {
    menuOpen[id] = open;
    if (!open) {
        // Destroy-on-close. The buy menu used to be built once and only hidden,
        // so at 64 players visiting all tabs roughly 19,400 widgets stayed alive
        // for the whole match. Deleting the menu widgets here bounds each player
        // to about 278 and rebuilds them on the next open. The persistent HUD is
        // tracked separately and is not touched here.
        dropMenu(id);
        menuBuilt[id] = false;
        tabBuilt[id] = [];
        pHover[id] = -1;
        pCellHover[id] = -1;
        pDoneHover[id] = false;
        delete tabPaintState[id];
        for (const k of Object.keys(cellBgState)) {
            if (k.lastIndexOf("psh" + id + "_", 0) === 0) {
                delete cellBgState[k];
            }
        }
        try {
            mod.EnableUIInputMode(false, p);
        } catch (e) {
            log("menu", "EnableUIInputMode failed: " + String(e));
        }
        // Highlight markers persist when the buy menu closes. Reopen the menu
        // and click the same location row to clear it.
        return;
    }
    if (!menuBuilt[id]) {
        buildBuyMenu(id, p);
        menuBuilt[id] = true;
    }
    // Look the widget up AFTER the build. Capturing it first yields null on a
    // first open, which turns input on and then never shows the menu.
    const m: any = W(pn(id, "menu"));
    if (!m) {
        log("menu", "pid=" + id + " menu widget missing after build");
        try {
            mod.EnableUIInputMode(false, p);
        } catch (e) {
        }
        menuOpen[id] = false;
        return;
    }
    mod.SetUIWidgetVisible(m, true);
    try {
        mod.EnableUIInputMode(true, p);
    } catch (e) {
        log("menu", "EnableUIInputMode failed: " + String(e));
    }
    log("menu", "pid=" + id + " open");
}

function buildBuyMenu(id: number, p: mod.Player): void {
    if (menuBuilt[id]) {
        return;
    }
    menuBuilt[id] = true;
    const root: mod.UIWidget = mod.GetUIRoot();

    // The menu shell, tab strip and Done button are all menu-scoped widgets, so
    // the whole build is bracketed, not just the tab rows.
    beginMenuBuild(id);
    const menu: mod.UIWidget = mkContainer(id, false, "menu", MENU_INSET, MENU_Y, MENU_W, MENU_H, mod.UIAnchor.TopRight, root, MENU_BG, 0.9, mod.UIBgFill.Solid, p, false);
    mkContainer(id, false, "mframe", 0, 0, MENU_W, MENU_H, mod.UIAnchor.TopLeft, menu, MENU_EDGE, 1, mod.UIBgFill.OutlineThin, p);

    pRingIcon(id, false, "mp", MENU_W - 68, P_RING_R, MENU_BG, 0.9, menu, p);
    mkText(id, false, "mpv", MENU_W - 68 + P_RING_D / 2 + P_RING_GAP_MENU, P_RING_R - 15, 40, 30, mod.Message(pPrestige[id]), 20, MENU_COST, mod.UIAnchor.Center, menu, p);

    const tw: number = tabW();
    for (let i: number = 0; i < TABS_DATA.length; i++) {
        const bw: PshButton = mkLabelledButton(id, "tb" + i, i * tw, TAB_Y, tw, TAB_H, MENU_BG, 0.9, MENU_TAB_HOVER, MENU_TAB_PRESS, menu, p);
        mkButtonLabel(id, "tbt" + i, 0, 0, tw, TAB_H, mod.Message(TABS_DATA[i].label), 12, MENU_TXT, mod.UIAnchor.Center, bw.wrap, p);

        mkContainer(id, false, "tbu" + i, i * tw + 6, TAB_Y + TAB_H, tw - 12, 2, mod.UIAnchor.TopLeft, menu, MENU_ORANGE_SEL, 1, mod.UIBgFill.Solid, p);
    }

    const doneX: number = MENU_W - 214;
    const doneY: number = DONE_Y;
    const doneBtn: PshButton = mkLabelledButton(id, "mdone", doneX, doneY, 210, DONE_H, MENU_EDGE, 0.55, MENU_HOVER, MENU_PRESS, menu, p);
    mkButtonLabel(id, "mdonet", 0, 0, 210, DONE_H, mod.Message("done"), 16, MENU_TITLE, mod.UIAnchor.Center, doneBtn.wrap, p);

    // try/finally, not a bare tail call: if any AddUI* throws mid-build the owner
    // marker would stay set and every later HUD widget for this player would be
    // filed as a menu widget, then destroyed the next time the menu closed.
    try {
        setTab(id, 0, p);
    } finally {
        endMenuBuild();
    }
}

function buildPlayerHud(p: mod.Player): void {
    safe("buildPlayerHud", () => {
        const id: number = mod.GetObjId(p);
        if (pBuilt[id]) {
            return;
        }
        const root: mod.UIWidget = mod.GetUIRoot();
        pNames[id] = [];
        tabBuilt[id] = [];
        pHover[id] = -1;
        pCellHover[id] = -1;
        pPage[id] = 0;
        if (pPrestige[id] === undefined) {
            pPrestige[id] = MOCK_DATA ? MOCK_PRESTIGE : 0;
        }

        dbgMe[id] = teamId(p);

        buildPlayerFeed(id, p, root);

        // Y 44 put the prestige ring under the engine kill feed, which is also
        // anchored top-right. Lifted to 8 so the ring sits above it while staying
        // inside the top bar area rather than riding over the feed chips.
        const pr: mod.UIWidget = mkContainer(id, false, "pr", 28, 8, 210, P_RING_BOX, mod.UIAnchor.TopRight, root, C_BLACK, 0, mod.UIBgFill.None, p);

        pRingIcon(id, false, "pr", P_RING_R, P_RING_R, C_BLACK, 0.5, pr, p);

        mkText(id, false, "prv", P_RING_R + P_RING_D / 2 + P_RING_GAP_HUD, P_RING_R - 15, 170, 30, mod.Message(pPrestige[id]), 25, C_PLAT, mod.UIAnchor.CenterLeft, pr, p);

        menuBuilt[id] = false;
        menuOpen[id] = false;

        pBuilt[id] = true;
        log("hud", "pid=" + id + " player widgets=" + pNames[id].length);
    });
}

function destroyPlayerHud(id: number): void {
    safe("destroyPlayerHud", () => {
        try {
            const owner: any = playerById(id);
            if (owner) {
                mod.EnableUIInputMode(false, owner);
            }
        } catch (e) {
        }
        const mw: any = W(pn(id, "menu"));
        if (mw) {
            mod.SetUIWidgetVisible(mw, false);
        }
        const refs = pNames[id] || [];
        for (let i: number = refs.length - 1; i >= 0; i--) {
            try {
                if (refs[i].w) {
                    mod.DeleteUIWidget(refs[i].w);
                }
            } catch (e) {
                continue;
            }
        }
        forgetPrefix("psh" + id + "_");
        // The loop above already deleted every widget for this player, menu
        // widgets included, so the menu list must be emptied too or dropMenu
        // would later try to delete handles that no longer exist.
        pMenuNames[id] = [];
        for (const k of Object.keys(cellBgState)) {
            if (k.lastIndexOf("psh" + id + "_", 0) === 0) {
                delete cellBgState[k];
            }
        }
        delete tabPaintState[id];
        pNames[id] = [];
        tabBuilt[id] = [];
        pBuilt[id] = false;
        menuOpen[id] = false;

        menuBuilt[id] = false;
        pHover[id] = -1;
        pCellHover[id] = -1;
        pDoneHover[id] = false;
    });
}

function grantPortalGadget(p: mod.Player): void {
    try {
        mod.AddEquipment(p, mod.Gadgets.Misc_PortalGadget);
        log("gadget", "portal gadget granted to " + mod.GetObjId(p));
    } catch (e) {
        log("gadget", "grant failed: " + String(e));
    }
}

function renderFeedChip(prefix: string, slot: number, key: string, a0: string | number, a1: string | number): void {
    const chipW: any = W(prefix + "f" + slot);
    const w: any = W(prefix + "ft" + slot);
    const iw: any = W(prefix + "fi" + slot);
    const aw: any = W(prefix + "fa" + slot);
    let col: mod.Vector = FEED_WHITE;
    let icon: string = "info";
    if (key === "siteLostA" || key === "siteLostB" || key === "siteLostC"
        || key === "bunkerLost" || key === "bunkerFoe"
        // The enemy-capture messages were missing from this branch, so the team
        // that lost the point got a neutral white chip with an "i" icon. It was
        // being delivered, just styled as if nothing had happened, which is why
        // enemy captures read as "no notification".
        || key === "siteFoeA" || key === "siteFoeB" || key === "siteFoeC") {
        col = FEED_RED;
        icon = "warn";
    } else if (key === "protoFoe") {
        col = FEED_RED;
        icon = "warn";
    } else if (key === "nukeReady" || key === "power50" || key === "power75" || key === "power100") {
        col = FEED_YEL;
        icon = "nuke";
    } else if (key === "nukeFoeReady" || key === "powerFoe50" || key === "powerFoe75" || key === "powerFoe100") {
        col = FEED_RED;
        icon = "warn";
      } else if (key === "itemGiven" || key === "prestigeUp" || key === "capDone" || key === "shopNoSpawner"
          || key === "turretDestroyed" || key === "pAwarded") {
          col = FEED_GRN;
      } else if (key === "protoYours" || key === "siteYours" || key === "capStarted" || key === "bunkerYours") {
          col = FEED_BLU;
      } else if (key === "killZone" || key === "capContested" || key === "hqHit" || key === "hqFoeCritical") {
          col = FEED_YEL;
          icon = "warn";
      } else if (key === "hqUnderAttack" || key === "hqCritical") {
          col = FEED_RED;
          icon = "warn";
      } else if (key === "winT1" || key === "winT2" || key === "losOpen") {
          col = FEED_GRN;
          icon = "nuke";
      }

      let msg: mod.Message = mod.Message(key);
      if (key === "baseHit" || key === "hqHit" || key === "hqUnderAttack"
          || key === "hqCritical" || key === "hqFoeCritical") {
          msg = mod.Message(key, a0, a1);
      } else if (key === "prestigeUp" || key === "buyAvailable" || key === "capStarted" || key === "capDone"
          || key === "bunkerYours" || key === "bunkerFoe" || key === "bunkerLost"
          || key === "pAwarded") {
          msg = mod.Message(key, a0);
      }
    if (w) {
        mod.SetUITextLabel(w, msg);
        mod.SetUITextColor(w, col);
    }
    if (iw) {
        mod.SetUITextLabel(iw, mod.Message(icon));
        mod.SetUITextColor(iw, col);
    }
    if (aw) {
        mod.SetUIWidgetBgColor(aw, col);
    }

    if (chipW) {
        const chars: number = FEED_CHARS_BY_KEY[key] === undefined ? 30 : FEED_CHARS_BY_KEY[key];
        const est: number = chars * 7.6 + 52;
        mod.SetUIWidgetSize(chipW, v(est, CHIP_H, 0));
    }
}

const FEED_LANE_HIGH: string[] = [
    "nukeReady", "nukeFoeReady", "protoYours", "protoFoe", "baseHit",
    "hqHit", "hqUnderAttack", "hqCritical", "hqFoeCritical",
    "bunkerYours", "bunkerFoe", "bunkerLost", "losOpen", "turretDestroyed"
];
const COOLDOWN_FRAMES: number = 90;

const feedSeen: { [t: number]: { [k: string]: number } } = {};
const activeFactory: { [id: number]: string } = {};
const highlightedLocation: { [id: number]: string } = {};
let frameNo: number = 0;

// Returns true only when a vehicle was actually spawned. A VehicleSpawner
// silently refuses while it still holds a vehicle, so the caller must not
// deduct prestige unless this succeeds.
function spawnPurchasedVehicle(p: mod.Player, facId: string | undefined, index: number, veh: mod.VehicleList, itemKey: string): boolean {
    if (facId === undefined) {
        log("shop", "vehicle " + itemKey + " denied - no factory in range");
        return false;
    }
    const st: BuildingState | undefined = buildingForPlayer(mod.GetObjId(p));
    if (st === undefined) {
        log("shop", "vehicle " + itemKey + " denied - left " + facId);
        return false;
    }
    if (st.def.vehicleSpawnerIds.length === 0) {
        log("shop", "vehicle " + itemKey + " denied - " + st.def.id + " has no VehicleSpawner");
        pushPlayerFeed(p, "shopNoSpawner", 0, 0);
        return false;
    }
    const choice: SpawnChoice = pickSpawner(st.def.id, index);
    if (choice.slot < 0) {
        log("shop", "vehicle " + itemKey + " refused - " + st.def.id
            + " all slots busy (free " + String(choice.free)
            + ", live vehicles " + String(choice.vehicles) + ")");
        pushPlayerFeed(p, "shopNoSlot", 0, 0);
        return false;
    }
    const slot: number = choice.slot;
    const spawnerId: number = st.def.vehicleSpawnerIds[slot];
    // mod.ForceVehicleSpawnerSpawn returns void, so success cannot be observed.
    // A slot was free and the spawn was issued, so the purchase counts as made.
    // The engine still refuses if something else grabbed the slot in between;
    // that race is not observable and is accepted rather than guessed at.
    let ok: boolean = false;
    safe("shop.vehicle", () => {
        const sp: mod.VehicleSpawner = mod.GetVehicleSpawner(spawnerId);
        if (!mod.IsValid(sp)) {
            log("shop", "vehicle " + itemKey + " denied - spawner " + spawnerId + " invalid");
            return;
        }
        mod.SetVehicleSpawnerVehicleType(sp, veh);
        mod.ForceVehicleSpawnerSpawn(sp);
        ok = true;
        log("shop", "issued " + itemKey + " at slot " + slot
            + " (spawner " + spawnerId + ") for " + st.def.id
            + " free-before=" + String(choice.free));
    });
    return ok;
}

function feedLane(key: string): number {
    return FEED_LANE_HIGH.indexOf(key) >= 0 ? 2 : 1;
}

function pushTeamFeed(team: number, key: string, a0: string | number, a1: string | number): void {
    if (!tBuilt[team]) {
        return;
    }
    if (feedSeen[team] === undefined) {
        feedSeen[team] = {};
    }
    if (feedLane(key) === 1) {
        const last: number = feedSeen[team][key] === undefined ? -9999 : feedSeen[team][key];
        if (frameNo - last < COOLDOWN_FRAMES) {
            log("feed", "t" + team + " rate-limited <- " + key);
            return;
        }
    }
    feedSeen[team][key] = frameNo;
    let slot: number = -1;
    let oldest: number = 0;
    for (let i: number = 0; i < FEED_SLOTS; i++) {
        const r: FeedRow = feedRowOf(team, i);
        if (!r.used) {
            slot = i;
            break;
        }
        if (r.bornFrame < feedRowOf(team, oldest).bornFrame) {
            oldest = i;
        }
    }
    if (slot < 0) {
        slot = oldest;
    }
    const row: FeedRow = feedRowOf(team, slot);
    row.used = true;
    row.bornFrame = frameNo;
    renderFeedChip(tn(team, ""), slot, key, a0, a1);
    layoutTeamFeed(team);
    log("feed", "t" + team + " slot " + slot + " <- " + key);
}

function pushPlayerFeed(p: mod.Player, key: string, a0: string | number, a1: string | number): void {
    safe("pushPlayerFeed", () => {
        const id: number = mod.GetObjId(p);
        if (!pBuilt[id]) {
            return;
        }
        if (pFeedRow[id] === undefined) {
            pFeedRow[id] = { used: false, bornFrame: 0 };
            pFeedIds.push(id);
        }
        pFeedRow[id].used = true;
        pFeedRow[id].bornFrame = frameNo;
        renderFeedChip(pn(id, "p"), 0, key, a0, a1);
        layoutPlayerFeed(id);
        log("feed", "pid " + id + " personal <- " + key);
    });
}

const FEED_EXPIRE_FRAMES: number = 360;

type FeedRow = { used: boolean; bornFrame: number };

const feedRows: { [t: number]: FeedRow[] } = {};
const pFeedRow: { [id: number]: FeedRow } = {};
const pFeedIds: number[] = [];

function feedRowOf(t: number, i: number): FeedRow {
    if (feedRows[t] === undefined) {
        feedRows[t] = [];
    }
    if (feedRows[t][i] === undefined) {
        feedRows[t][i] = { used: false, bornFrame: 0 };
    }
    return feedRows[t][i];
}

function setRowVisible(name: string, on: boolean): void {
    const w: any = W(name);
    if (w) {
        mod.SetUIWidgetVisible(w, on);
    }
}

// Collapse: occupied rows pack to the top, expired rows hide, and the band
// hides entirely when nothing is left, so an empty feed shows nothing at all.
function layoutTeamFeed(team: number): void {
    const row: number[] = [];
    for (let i: number = 0; i < FEED_SLOTS; i++) {
        if (feedRowOf(team, i).used) {
            row.push(i);
        }
    }
    for (let i: number = 0; i < FEED_SLOTS; i++) {
        const on: boolean = row.indexOf(i) >= 0;
        setRowVisible(tn(team, "f" + i), on);
        setRowVisible(tn(team, "fa" + i), on);
        setRowVisible(tn(team, "fi" + i), on);
        setRowVisible(tn(team, "ft" + i), on);
        if (on) {
            const chip: any = W(tn(team, "f" + i));
            if (chip) {
                mod.SetUIWidgetPosition(chip, v(CHIP_INSET, row.indexOf(i) * CHIP_PITCH, 0));
            }
        }
    }
    setRowVisible(tn(team, "fd"), row.length > 0);
}

function layoutPlayerFeed(id: number): void {
    const r: FeedRow | undefined = pFeedRow[id];
    const on: boolean = r !== undefined && r.used;
    setRowVisible(pn(id, "pf0"), on);
    setRowVisible(pn(id, "pfa0"), on);
    setRowVisible(pn(id, "pfi0"), on);
    setRowVisible(pn(id, "pft0"), on);
    setRowVisible(pn(id, "pfd"), on);
}

function expireFeedRows(): void {
    for (let t: number = 1; t <= 2; t++) {
        let changed: boolean = false;
        for (let i: number = 0; i < FEED_SLOTS; i++) {
            const r: FeedRow = feedRowOf(t, i);
            if (r.used && frameNo - r.bornFrame > FEED_EXPIRE_FRAMES) {
                r.used = false;
                changed = true;
            }
        }
        if (changed) {
            layoutTeamFeed(t);
        }
    }
    for (let k: number = pFeedIds.length - 1; k >= 0; k--) {
        const id: number = pFeedIds[k];
        const r: FeedRow | undefined = pFeedRow[id];
        if (r === undefined) {
            pFeedIds.splice(k, 1);
            continue;
        }
        if (r.used && frameNo - r.bornFrame > FEED_EXPIRE_FRAMES) {
            r.used = false;
            layoutPlayerFeed(id);
        }
    }
}

function onGameModeStarted(): void {
    setFeedSink((_tone, teamId, key, a0, a1) => {
        if (teamId === 0) {
            return;
        }
        if (teamId === 1 || teamId === 2) {
            safe("notify.emit", () => { pushTeamFeed(teamId, key, a0, a1); });
        }
    });
    setPlayerFeedSink((p, key, a0, a1) => {
        safe("notify.emitP", () => { pushPlayerFeed(p, key, a0, a1); });
    });
    log("init", "PowerStruggle HUD v0.49. Mock=" + (MOCK_DATA ? "ON" : "off"));

    safe("init.perf", initPerf);
    safe("init.teams", initTeams);
    safe("init.capture", initCapture);
    safe("init.buildings", initBuildings);
    safe("init.spawns", initSpawns);
    safe("init.energy", initEnergy);
    safe("init.factory", initFactory);
    safe("init.turrets", initTurrets);
    safe("init.bots", initBots);
    safe("init.nuke", initNuke);
    safe("init.worldicons", initWorldIcons);
    safe("init.charge", () => {
        onCharge((team: number, before: number, after: number) => {
            announcePowerChange(team, before, after);
        });
    });
    safe("init.scoreboard", () => {
        initTeams();
        initScoreboard();
        resetStats();
        resetTeamScores();
        pushAllRows();
    });
    safe("init.slots", () => {
        for (const a of factoryBuildings()) {
            if (isConfigured(a.areaTriggerId) && a.vehicleSpawnerIds.length > 0) {
                initSlots(a.id, a.vehicleSpawnerIds);
            }
        }
    });

    buildTeamBar(1);
    buildTeamBar(2);
}

function onPlayerJoinGame(eventPlayer: mod.Player): void {
    log("join", "pid=" + mod.GetObjId(eventPlayer) + " team=" + teamId(eventPlayer));
}

  function onPlayerDeployed(eventPlayer: mod.Player): void {
      const t: number = teamId(eventPlayer);
      if (t === 1 || t === 2) {
          buildTeamBar(t);
      }
      // Bots run no HUD, hold no Portal Gadget and open no menus. Skipping
      // both calls here is what keeps roughly 278 widgets per bot unbuilt.
      if (isBotPlayer(eventPlayer)) {
          return;
      }
      buildPlayerHud(eventPlayer);
      grantPortalGadget(eventPlayer);
  }

  function onPlayerUndeploy(eventPlayer: mod.Player): void {
      destroyPlayerHud(mod.GetObjId(eventPlayer));
  }

function onPlayerMandown(eventPlayer: mod.Player): void {
    const id: number = mod.GetObjId(eventPlayer);
    if (menuOpen[id]) {
        setMenuOpen(id, eventPlayer, false);
        log("hud", "pid=" + id + " menu closed on downed");
    }
}

function onPlayerLeaveGame(eventNumber: number): void {
    forgetPlayer(eventNumber);
    destroyPlayerHud(eventNumber);
}

// Charge advances every frame, but repainting 20 pips per side per team at
// 60Hz is wasteful. Track the rounded value each side of the HUD displays
// and only repaint when it actually changes.
const shownPower: { [t: number]: number } = { 1: -1, 2: -1 };

function syncPowerHud(): void {
    let dirty: boolean = false;
    for (const t of [1, 2]) {
        const r: number = Math.round(powerVal[t]);
        if (shownPower[t] !== r) {
            shownPower[t] = r;
            dirty = true;
        }
    }
    if (dirty) {
        repaintTeamBars();
    }
}

// Pixel-art work per tick, scaled back when the engine is behind. The emblems
// are cosmetic, so they are the right thing to throttle first.
let artBudgetThisTick: number = ART_BUDGET;

// Clamp the measured frame delta before it drives any simulation. A
// pathological frame (first tick after load, a long GC pause, a stalled tab)
// would otherwise dump a huge slice of charge into one tick. The bounds are the
// equivalents of 240 Hz and 10 Hz, so ordinary jitter is untouched.
const DT_MIN: number = 1 / 240;
const DT_MAX: number = 1 / 10;

// Frame delta for the current tick, in seconds. Module scope so the charge tick
// can be a plain function reference instead of a closure allocated per frame.
let frameDt: number = DT_MIN;

function tickChargeThisFrame(): void {
    tickCharge(frameDt);
}

function onOngoingGlobal(): void {
    // Measured, not assumed. The engine ticks nearer 30 Hz, so a hardcoded
    // 1/60 made every rate-based system advance at half wall-clock speed: the
    // log recorded a computed 1%/s charge that delivered 0.5%/s. CHARGE_BASE_SECONDS
    // is now genuinely seconds.
    const raw: number = spotDeltaMs() / 1000;
    frameDt = raw < DT_MIN ? DT_MIN : raw > DT_MAX ? DT_MAX : raw;
    frameNo = frameNo + 1;
    tickAdminBudget();
    safe("factory.tick", tickChargeThisFrame);
    safe("hud.power", syncPowerHud);
    if (frameNo % 30 === 0) {
        syncBunkerOwners();
    }
    // The Rorsch probe is the most expensive per-frame item. Skipping it costs
    // one sample: the shot is the IsFiring falling edge (rorschshot.ts), so a
    // skipped tick delays the ray by one tick, and a discharge and re-press
    // that both fall inside skipped ticks merge into one hold.
    if (healthFactor() >= 0.7) {
        tickNukeProbe();
    }
    expireFeedRows();
    if (artActive === undefined && artQueue.length === 0) {
        return;
    }
    artBudgetThisTick = healthFactor() >= 0.9 ? ART_BUDGET : ART_BUDGET >> 1;
    pumpPixelArt();
}

function onGameModeEnding(): void {
    destroyTeamBars();
    try {
        const players: any[] = toArr(mod.AllPlayers());
        for (let i: number = 0; i < players.length; i++) {
            destroyPlayerHud(mod.GetObjId(players[i]));
        }
    } catch (e) {
    }
    log("end", "team + player widgets cleared");
}

  function onPortalGadgetFireStart(eventPlayer: mod.Player): void {
      // Belt and braces behind the missing gadget grant: a bot can never
      // reach a buy menu through this handler.
      if (isBotPlayer(eventPlayer)) {
          return;
      }
      const id: number = mod.GetObjId(eventPlayer);
      if (!pBuilt[id]) {
          buildPlayerHud(eventPlayer);
      }
      const here: BuildingState | undefined = buildingForPlayer(id);
      // The buy menu is derived from the factory the player is standing in right
      // now, never from whatever they last stood in. Leaving the factory must
      // clear it, otherwise the previous factory's items stay purchasable.
      const prevKind: string | undefined = activeFactoryKind[id];
      const mine: number = teamId(eventPlayer);
      // A neutral, enemy-held or contested factory grants no shop at all.
      const owned: boolean = here !== undefined
          && isFactoryKind(here.def.kind)
          && here.owner === mine
          && !here.contested;
      if (owned && here !== undefined) {
          activeFactory[id] = here.def.id;
          activeFactoryKind[id] = here.def.kind;
          if (prevKind !== here.def.kind) {
              invalidateTab(id, FACTORY_TAB);
              log("factory", "pid=" + id + " factory kind " + String(prevKind) + " -> " + here.def.kind
                  + " (tab invalidated)");
          }
          log("factory", "pid=" + id + " gadget fired inside " + here.def.id
              + " (owner=" + here.owner + " contested=" + here.contested + ")");
          pushPlayerFeed(eventPlayer, "buyAvailable", here.def.factoryName, 0);
          setTab(id, FACTORY_TAB, eventPlayer);
      } else {
          delete activeFactory[id];
          delete activeFactoryKind[id];
          if (prevKind !== undefined) {
              invalidateTab(id, FACTORY_TAB);
          }
          // No feed here: firing the gadget away from a factory is the normal
          // way to open the other tabs, so it must stay quiet.
          if (here !== undefined) {
              log("factory", "pid=" + id + " gadget fired inside " + here.def.id
                  + " (" + here.def.kind + " owner=" + here.owner
                  + " contested=" + here.contested + " - no shop)");
          } else {
              log("factory", "pid=" + id + " gadget fired outside any building");
          }
      }
      if (menuOpen[id]) {
          setMenuOpen(id, eventPlayer, false);
          playSfxPlayer("close", eventPlayer, 1);
      } else {
          setMenuOpen(id, eventPlayer, true);
          playSfxPlayer("primary", eventPlayer, 1);
      }
  }

function onUIButtonEvent(eventPlayer: mod.Player, eventUIWidget: mod.UIWidget, eventUIButtonEvent: mod.UIButtonEvent): void {
    // Bots own no widgets, so any button event naming them is ignored.
    if (isBotPlayer(eventPlayer)) {
        return;
    }
    const id: number = mod.GetObjId(eventPlayer);

    let kind: string = "other";
    if (mod.Equals(eventUIButtonEvent, mod.UIButtonEvent.ButtonDown)) {
        kind = "ButtonDown";
    } else if (mod.Equals(eventUIButtonEvent, mod.UIButtonEvent.ButtonUp)) {
        kind = "ButtonUp";
    } else if (mod.Equals(eventUIButtonEvent, mod.UIButtonEvent.FocusIn)) {
        kind = "FocusIn";
    } else if (mod.Equals(eventUIButtonEvent, mod.UIButtonEvent.FocusOut)) {
        kind = "FocusOut";
    } else if (mod.Equals(eventUIButtonEvent, mod.UIButtonEvent.HoverIn)) {
        kind = "HoverIn";
    } else if (mod.Equals(eventUIButtonEvent, mod.UIButtonEvent.HoverOut)) {
        kind = "HoverOut";
        }

        let wname: string = "?";
        try {
            wname = mod.GetUIWidgetName(eventUIWidget);
        } catch (e) {
            wname = "<name failed>";
        }
        log("uiButton", "ev=" + kind + " w=" + wname + " built=" + String(pBuilt[id]) + " open=" + String(menuOpen[id]));
        if (!pBuilt[id] || !menuOpen[id]) {
            return;
        }

        if (kind === "HoverIn") {
            hoverTab(id, eventUIWidget, true);
            hoverCell(id, eventUIWidget, true);
            return;
        }
        if (kind === "HoverOut") {
            hoverTab(id, eventUIWidget, false);
            hoverCell(id, eventUIWidget, false);
            return;
        }

        if (kind !== "ButtonDown") {
            return;
        }

        // DONE and the tab bar must be handled before the "current tab is
        // built" guard below. Otherwise selecting the Factory tab outside a
        // factory swallows every click, the menu can never be closed, and UI
        // input mode stays on until the player redeploys.
        if (widgetIs(id, eventUIWidget, "mdone")) {
            log("uiButton", "act=mdone");
            setMenuOpen(id, eventPlayer, false);
            playSfxPlayer("close", eventPlayer, 1);
            return;
        }
        for (let i: number = 0; i < TABS_DATA.length; i++) {
            if (widgetIs(id, eventUIWidget, "tb" + i)) {
                log("uiButton", "act=tab" + i);
                setTab(id, i, eventPlayer);
                playSfxPlayer("primary", eventPlayer, 1);
                return;
            }
        }

        const t: number = pTab[id];
        if (!tabBuilt[id] || !tabBuilt[id][t]) {
            log("uiButton", "act=none tab " + t + " not built w=" + wname);
            return;
        }

        if (widgetIs(id, eventUIWidget, "pgprev" + t)) {
            setPage(id, t, (pPage[id] === undefined ? 0 : pPage[id]) - 1, eventPlayer);
            playSfxPlayer("primary", eventPlayer, 1);
            return;
        }
        if (widgetIs(id, eventUIWidget, "pgnext" + t)) {
            setPage(id, t, (pPage[id] === undefined ? 0 : pPage[id]) + 1, eventPlayer);
            playSfxPlayer("primary", eventPlayer, 1);
            return;
        }
        const secs: PshSection[] = tabSectionsFor(id, t);
        for (let s: number = 0; s < secs.length; s++) {
            const items: PshItem[] = secs[s].items;
            for (let i: number = 0; i < items.length; i++) {
                if (!widgetIs(id, eventUIWidget, cellKey(id, t, s, i))) {
                    continue;
                }
                log("uiButton", "act=cell " + cellKey(id, t, s, i));
                const rowAct: string | undefined = items[i].act;
                if (rowAct !== undefined) {
                    playSfxPlayer("primary", eventPlayer, 1);
                    runDebugAct(id, rowAct);
                    refreshDebugRows(id);
                    return;
                }
                if (items[i].cost > pPrestige[id]) {
                    playSfxPlayer("deny", eventPlayer, 1);
                    log("shop", "denied " + items[i].key + " need " + items[i].cost + " have " + pPrestige[id]);
                    return;
                }
                const give: mod.Weapons | undefined = items[i].give;
                const veh: mod.VehicleList | undefined = items[i].vehicle;
                if (give === undefined && veh === undefined) {
                    playSfxPlayer("buy", eventPlayer, 1);
                    return;
                }

                // Vehicles and prototype gear may only be bought while actually
                // standing in a matching factory you control. This blocks both
                // the stale-tab case and menu access from outside a factory.
                const inFactory: BuildingState | undefined = buildingForPlayer(id);
                const canBuy: boolean = t !== FACTORY_TAB
                    || (inFactory !== undefined
                        && isFactoryKind(inFactory.def.kind)
                        && activeFactoryKind[id] === inFactory.def.kind
                        && inFactory.owner === teamId(eventPlayer));
                if (!canBuy) {
                    playSfxPlayer("deny", eventPlayer, 1);
                    log("shop", "denied " + items[i].key + " - not inside a matching factory you control");
                    pushPlayerFeed(eventPlayer, "dbgNoFactory", 0, 0);
                    return;
                }

                const facId: string | undefined = activeFactory[id];
                // Vehicles spawn before the cost is taken. If the spawner refuses we
                // never charge, instead of taking prestige for nothing.
                if (veh !== undefined) {
                    const rawIdx: number | undefined = items[i].spawnerIndex;
                    const spawned: boolean = spawnPurchasedVehicle(
                        eventPlayer, facId, rawIdx !== undefined ? rawIdx : 0, veh, items[i].key);
                    if (!spawned) {
                        playSfxPlayer("deny", eventPlayer, 1);
                        return;
                    }
                }
                setPrestige(id, pPrestige[id] - items[i].cost);
                if (give !== undefined) {
                    try {
                        mod.AddEquipment(eventPlayer, give);
                        mod.SetInventoryAmmo(eventPlayer, mod.InventorySlots.PrimaryWeapon, 900);
                    } catch (e) {
                        log("shop", "AddEquipment failed for " + items[i].key + ": " + String(e));
                    }
                }
                playSfxPlayer("buy", eventPlayer, 1);
                pushPlayerFeed(eventPlayer, "itemGiven", 0, 0);
                log("shop", "gave " + items[i].key + " for " + items[i].cost + " factory=" + String(facId));
                return;
            }
        }
}

Events.setLogging((text: string) => {
    logAdmin("events", text);
}, Events.LogLevel.Warning, true);

configureCaptureEvents();
configureBuildingEvents();
configureSpawnEvents();
configureEconomyEvents();
configureBotEvents();

// Kills. Self kills, teamkills, redeploys and deserting earn nothing and
// move no counter - see countsAsCombat in stats.ts.
Events.OnPlayerEarnedKill.subscribe((
    killer: mod.Player,
    victim: mod.Player,
    deathType: mod.DeathType
) => {
    safe("score.kill", () => {
        if (!countsAsCombat(killer, victim, deathType)) {
            log("score", "kill ignored (self/team/redeploy/deserting)");
            return;
        }
        award(killer, "kill");
    });
});

// Deaths. Only real combat deaths are counted: no redeploy, no suicide and
// no friendly fire. Environmental deaths still count.
Events.OnPlayerDied.subscribe((
    victim: mod.Player,
    killer: mod.Player,
    deathType: mod.DeathType
) => {
    safe("score.death", () => {
        if (!countsAsDeath(victim, killer, deathType)) {
            log("score", "death not counted (redeploy/deserting/friendly fire)");
            return;
        }
        countDeath(victim);
    });
});

Events.OnPlayerEarnedKillAssist.subscribe((player: mod.Player, victim: mod.Player) => {
    safe("score.assist", () => {
        if (!countsAsCombat(player, victim)) {
            log("score", "assist ignored (self/team)");
            return;
        }
        award(player, "assist");
    });
});

// Vehicle destruction is deliberately not scored: Tier 0 exposes no damager
// and no OnVehicleDamaged event, so the destroyer cannot be identified. See
// PRESTIGE_VEHICLE in config.ts.
// Route economy gains through setPrestige so the prestige ring and every buy
// cell recolour the moment a kill or capture pays out.
onPrestige((id: number, total: number) => {
    safe("eco.repaint", () => {
        setPrestige(id, total);
    });
});
configureTurretEvents();
configureNukeEvents();

// Bunkers, energy points and factories each pay their own amount, and only to
// the players who were standing on the objective when it flipped. A neutral or
// post-match owner pays nobody, which is what silences the "team 0 paid 0
// player(s)" lines that fired after the round ended.
function awardCaptureToZone(team: number, kind: AwardKind, players: mod.Player[]): void {
    if (team !== 1 && team !== 2) {
        return;
    }
    const capturers: mod.Player[] = [];
    for (const p of players) {
        if (mod.IsValid(p) && teamIdOf(p) === team) {
            capturers.push(p);
        }
    }
    const paid: number = awardPlayers(capturers, kind);
    // paid counts players who received prestige. Bots on the point earn score
    // but never prestige, so they are deliberately excluded from this number and
    // from the warning below.
    log("stats", "capture " + kind + " -> team " + String(team)
        + " present " + String(capturers.length)
        + " paid " + String(paid) + " human(s) x" + String(prestigeFor(kind)));
    if (capturers.length > 0 && paid === 0) {
        logAdmin("stats", "WARNING capture " + kind + " found " + String(capturers.length)
            + " player(s) on the objective but paid no human prestige");
    }
    pushHeader();
    pushAllRows();
}

// One subscription covers kills, assists and every capture, because the
// notification is fired by award() itself rather than by each call site.
onAward((p: mod.Player, _kind: AwardKind, prestige: number) => {
    pushPlayerFeed(p, "pAwarded", prestige, 0);
});

// CustomConquest V15 waits 0.2s after OnCapturePointCaptured before reading the
// point, because players are not reliably registered on it during the event. The
// 0.25s settle here does the same and makes the engine-event path and the
// 30-frame syncBunkerOwners path behave identically.
const BUNKER_SETTLE_MS: number = 250;

// Real HQ damage drives the HUD's HQ health (100 -> 67 -> 33 -> 0 at 3 hits).
onHqHit((base: number, hits: number, required: number) => {
    stateSetBase(base, hqHpPercent(hits, required), true);
});

onCaptured((def, owner, occupants) => {
      if (def.kind === "energy") {
          const slot: number = def.id === "site1" ? 0 : def.id === "site2" ? 1 : def.id === "site3" ? 2 : -1;
          if (slot >= 0) {
              // The trigger's own occupant list is the exact population inside
              // the volume. Captured before stateSetSite, which calls announceSite.
              const onPoint: mod.Player[] = playersFromIds(occupants);
              captureOnPoint = onPoint.filter((p: mod.Player) => teamIdOf(p) === owner);
              const a: number[] = siteState[1] || [];
              const b: number[] = siteState[2] || [];
              const current: number = a[slot] === 1 || a[slot] === 2 ? a[slot] : b[slot] === 1 || b[slot] === 2 ? b[slot] : 0;
              const team: number = current === 1 || current === 2 ? current : owner === 1 || owner === 2 ? owner : 1;
              stateSetSite(team, slot, owner, team === 1 ? 2 : 1);
          }
      }
    if (def.kind === "proto") {
        stateSetProto(owner);
    }
    awardCaptureToZone(owner, def.kind === "energy" ? "energy" : "factory", playersFromIds(occupants));
    refreshTacticalRowsForAll();
    log("state", "area building " + def.id + " -> team " + owner
        + " (energyMult=" + energyMultiplier(owner) + ", factory=" + factoryOwner() + ")");
});

  onBunkerCaptured((def, owner, prevOwner, cp) => {
      onBunkerOwnerChanged(def, owner);
      refreshTacticalRowsForAll();
      captureOnPoint = playersOnCapturePoint(cp).filter((p: mod.Player) => teamIdOf(p) === owner);
      announceBunker(def.id, owner, prevOwner);
    const h: Timers.TimerID | null = Timers.setTimeout(() => {
        safe("award.bunker", () => {
            awardCaptureToZone(owner, "bunker", playersOnCapturePoint(cp));
        });
    }, BUNKER_SETTLE_MS);
    if (h === null) {
        logAdmin("stats", "WARNING bunker settle timer refused for " + def.id);
    }
});

Events.OnPlayerJoinGame.subscribe((p: mod.Player) => {
    safe("score.join", () => {
        pushRow(p);
    });
});

Events.OnGameModeStarted.subscribe(() => {
    safe("score.gamestart", () => {
        resetStats();
        resetTeamScores();
        pushHeader();
        pushAllRows();
    });
    safe("OnGameModeStarted", onGameModeStarted);
});
Events.OnPlayerJoinGame.subscribe((p: mod.Player) => {
    safe("OnPlayerJoinGame", () => {
        onPlayerJoinGame(p);
    });
});
Events.OnPlayerDeployed.subscribe((p: mod.Player) => {
    safe("OnPlayerDeployed", () => {
        onPlayerDeployed(p);
    });
});
Events.OnPlayerUndeploy.subscribe((p: mod.Player) => {
    safe("OnPlayerUndeploy", () => {
        onPlayerUndeploy(p);
    });
});
Events.OnMandown.subscribe((p: mod.Player) => {
    safe("OnMandown", () => {
        onPlayerMandown(p);
    });
});
Events.OnPlayerLeaveGame.subscribe((id: number) => {
    safe("OnPlayerLeaveGame", () => {
        onPlayerLeaveGame(id);
    });
});
Events.OnGameModeEnding.subscribe(() => {
    safe("OnGameModeEnding", onGameModeEnding);
});
Events.OngoingGlobal.subscribe(() => {
    safe("OngoingGlobal", onOngoingGlobal);
});
Events.OnPortalGadgetFireStart.subscribe((p: mod.Player) => {
    safe("OnPortalGadgetFireStart", () => {
        onPortalGadgetFireStart(p);
    });
});
Events.OnPlayerUIButtonEvent.subscribe((p: mod.Player, w: mod.UIWidget, e: mod.UIButtonEvent) => {
    safe("OnPlayerUIButtonEvent", () => {
        onUIButtonEvent(p, w, e);
    });
});

function widestSections(t: number): PshSection[] {
    const n: number = pageCount(t);
    let best: PshSection[] = pageSections(t, 0);
    let bestRows: number = -1;
    for (let p: number = 0; p < n; p++) {
        const cand: PshSection[] = pageSections(t, p);
        const r: number = cand.length;
        if (r > bestRows) {
            bestRows = r;
            best = cand;
        }
    }
    return best;
}

function cellKey(id: number, t: number, s: number, i: number): string {
    const pg: number = pPage[id] === undefined ? 0 : pPage[id];
    return "c" + "p" + pg + "_" + t + s + i;
}

function widgetIs(id: number, w: mod.UIWidget, key: string): boolean {
    try {
        return mod.GetUIWidgetName(w) === pn(id, key);
    } catch (e) {
        return false;
    }
}
