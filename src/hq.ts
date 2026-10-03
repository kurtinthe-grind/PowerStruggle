import { flushAdminLog, log, safe, logAdmin, invokeSubscriber } from "./util/log";
import { HQ_EXPLOSION, isConfigured } from "./objids";
import { HQ_HITS_REQUIRED } from "./config";
import { playSfxAll } from "./audio";
import { notifyTeam } from "./notify";
import { winnerForDestroyedBase, winMessageKey, hqHitKeys, HqHitKeys } from "./winner";

// HQ damage and the match end. Rorsch hits near an HQ count once that team's
// rocket sites are down far enough (sitewire.ts hqOpenFor); HQ_HITS_REQUIRED
// hits destroy it and the other team wins. Moved here from turrets.ts when the
// rocket sites replaced the turrets; this is the only place that ends the
// match (scripts/guard-sources.js).

let hqHp: number[] = [0, 0, 0];
let matchOver: boolean = false;

// HQ damage listeners: (base, hits, required). index.ts uses this to drive the
// HUD's HQ health.
export type HqHitListener = (base: number, hits: number, required: number) => void;
const hqHitListeners: HqHitListener[] = [];

export function onHqHit(fn: HqHitListener): void {
    hqHitListeners.push(fn);
}

export function resetHq(): void {
    hqHp = [0, 0, 0];
    matchOver = false;
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
        invokeSubscriber(fn, base, hits, HQ_HITS_REQUIRED, undefined, "hq.hit");
    }
    // base owns the HQ, so the attackers are the other team. The final hit is
    // announced by endMatchFor instead (keys === null).
    const keys: HqHitKeys | null = hqHitKeys(hits, HQ_HITS_REQUIRED);
    if (keys !== null) {
        const left: number = HQ_HITS_REQUIRED - hits;
        notifyTeam(base, keys.defender, left, HQ_HITS_REQUIRED);
        notifyTeam(winnerForDestroyedBase(base), keys.attacker, left, HQ_HITS_REQUIRED);
    }
    log("hq", "HQ base " + base + " hit " + String(hqHp[base]) + "/" + String(HQ_HITS_REQUIRED));
    if (hqHp[base] >= HQ_HITS_REQUIRED) {
        matchOver = true;
        endMatchFor(base);
    }
    return true;
}

function endMatchFor(base: number): void {
    safe("hq.end", () => {
        const idx: number = base === 1 ? 0 : 1;
        const vfx: number = HQ_EXPLOSION[idx];
        if (isConfigured(vfx)) {
            safe("hq.explosion", () => {
                mod.EnableVFX(mod.GetVFX(vfx), true);
            });
        }
        playSfxAll("nukeFire", 1.0);
        // 'base' is the team that owned the destroyed HQ, so the winner is the
        // other team. GetTeam(base - 1) once passed team 0 when HQ 1 fell, and
        // EndGameMode(team 0) is a draw (Tier 0). Both teams get the same
        // factual message: "NATO destroyed the PAX HQ" or the reverse.
        const winner: number = winnerForDestroyedBase(base);
        const msg: string = winMessageKey(winner);
        notifyTeam(1, msg, 0, 0);
        notifyTeam(2, msg, 0, 0);
        logAdmin("hq", "HQ " + base + " destroyed - team " + winner + " WINS - EndGameMode");
        flushAdminLog("match end");
        mod.EndGameMode(mod.GetTeam(winner));
    });
}
