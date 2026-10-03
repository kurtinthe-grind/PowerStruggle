// Bot display names.
//
// Naming has exactly one path in Tier 0: mod.SpawnAIFromAISpawner takes the name
// as its name: Message argument. There is no mod.SetPlayerName and no
// mod.GetPlayerName, so a name cannot be read back and cannot be changed after
// the soldier exists. Two consequences drive the design here:
//
//   1. The name must be a KEY in the string table. mod.Message only renders a
//      table entry, so all 99 display names live in strings.json as botName0
//      through botName98. They are the 24 names supplied by the mode owner, the
//      74 bot names used by the CustomConquest V15 template, plus
//      kurtinthegrind.
//
//   2. Because a name cannot be recovered from the player, the pool tracks which
//      key it handed out. Each team keeps its own shuffled pool, so no two live
//      bots on a team can ever share a name, and a name returns to the pool when
//      its soldier leaves the game.
//
// Names are released on leave, not on death: a corpse still shows its name in
// the kill feed, so releasing early would let a respawn collide with a body
// that is still on screen.

const NAME_COUNT: number = 99;

export const BOT_NAME_KEYS: string[] = ((): string[] => {
    const keys: string[] = [];
    for (let i: number = 0; i < NAME_COUNT; i++) {
        keys.push("botName" + String(i));
    }
    return keys;
})();

const pool: { [team: number]: string[] } = { 1: [], 2: [] };

// Names issued at spawn but not yet claimed by a player id, with the time they
// were issued. OnSpawnerSpawned (or the deploy event, if the spawn event could
// not) claims the oldest one for that team. Spawns for a team are sequential,
// so a FIFO pairs correctly - as long as every spawn call produces a soldier.
// One that silently does not would leave its name at the head of the queue and
// shift every later bot onto the previous bot's name (and scoreboard row) for
// the rest of the match, so a name not claimed within NAME_CLAIM_MS goes back
// to the pool.
type Unclaimed = { key: string; at: number };
const unclaimed: { [team: number]: Unclaimed[] } = { 1: [], 2: [] };

// Spawn events arrive within a second of the spawn call.
export const NAME_CLAIM_MS: number = 10000;

// Names that expired unclaimed so far, for diagnostics.
let expiredCount: number = 0;
let lastExpired: string = "";

// xorshift32. Deterministic seed: the shuffle only needs to avoid handing the
// same name out twice in a row, not to be unpredictable, and a seeded generator
// cannot be defeated by Math.random returning a constant.
let seed: number = 0x2f6e2b1;

function rnd(): number {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
}

function shuffled(): string[] {
    const out: string[] = BOT_NAME_KEYS.slice();
    for (let i: number = out.length - 1; i > 0; i--) {
        const j: number = Math.floor(rnd() * (i + 1));
        const swap: string = out[i];
        out[i] = out[j];
        out[j] = swap;
    }
    return out;
}

export function initBotNames(): void {
    pool[1] = shuffled();
    pool[2] = shuffled();
    unclaimed[1] = [];
    unclaimed[2] = [];
}

// Take a name for a soldier that is about to be spawned. The key is queued as
// unclaimed until the spawn event claims it. prefer is the name of the bot
// being respawned: it is reused when free, so the respawn keeps its name and
// its scoreboard row (stats are kept per team and name, see stats.ts).
export function takeBotName(team: number, prefer: string, nowMs: number): string {
    if (team !== 1 && team !== 2) {
        return BOT_NAME_KEYS[0];
    }
    const at: number = prefer === "" ? -1 : pool[team].indexOf(prefer);
    if (at >= 0) {
        pool[team].splice(at, 1);
        unclaimed[team].push({ key: prefer, at: nowMs });
        return prefer;
    }
    if (pool[team].length === 0) {
        pool[team] = shuffled();
    }
    const key: string = pool[team].shift() as string;
    unclaimed[team].push({ key: key, at: nowMs });
    return key;
}

// Called from the spawn event (or the deploy event), once the player id is
// known. Returns "" when nothing is queued. Names older than NAME_CLAIM_MS go
// back to the pool first (counted in expiredBotNames).
export function claimBotName(team: number, nowMs: number): string {
    if (team !== 1 && team !== 2) {
        return "";
    }
    const q: Unclaimed[] = unclaimed[team];
    while (q.length > 0 && nowMs - q[0].at > NAME_CLAIM_MS) {
        const stale: Unclaimed = q.shift() as Unclaimed;
        lastExpired = stale.key;
        expiredCount++;
        if (pool[team].indexOf(stale.key) < 0) {
            pool[team].push(stale.key);
        }
    }
    if (q.length === 0) {
        return "";
    }
    return (q.shift() as Unclaimed).key;
}

export function expiredBotNames(): number {
    return expiredCount;
}

export function lastExpiredBotName(): string {
    return lastExpired;
}

// Return a name to the pool once its soldier has left the game.
export function releaseBotName(team: number, key: string): void {
    if (team !== 1 && team !== 2 || key === "" || key === undefined) {
        return;
    }
    const q: Unclaimed[] = unclaimed[team];
    if (q !== undefined) {
        for (let i: number = 0; i < q.length; i++) {
            if (q[i].key === key) {
                // Never claimed, or the bot died before the spawn event landed.
                q.splice(i, 1);
                break;
            }
        }
    }
    if (pool[team].indexOf(key) < 0) {
        pool[team].push(key);
    }
}

// Diagnostics for the DEBUG tab and logs. Zero FFI.
export function botNamePoolFree(team: number): number {
    if (team !== 1 && team !== 2) {
        return 0;
    }
    return pool[team].length;
}
