// Lock state machine for one site, free of mod.* so Node can test it.
// One target at a time: track the nearest free intruder, fire after lockMs
// once a silo can fire, then wait cooldownMs before tracking the next one.
// A target that leaves (or is busy with a rocket) cancels the lock; coming
// back starts the full lock again.

export interface Intruder {
    key: string;
    pid: number;
    x: number;
    y: number;
    z: number;
}

export type LockEvent =
    | { kind: "track"; key: string; pid: number }
    | { kind: "cancel"; key: string }
    | { kind: "fire"; key: string; pid: number };

export class LockCore {
    private current: Intruder | null = null;
    private lockStart: number = 0;
    private cooldownUntil: number = 0;
    private readonly lockMs: number;
    private readonly cooldownMs: number;

    constructor(lockMs: number, cooldownMs: number) {
        this.lockMs = lockMs;
        this.cooldownMs = cooldownMs;
    }

    get target(): string | null {
        return this.current === null ? null : this.current.key;
    }

    get targetPid(): number | null {
        return this.current === null ? null : this.current.pid;
    }

    update(now: number, intruders: Intruder[], busy: Set<string>, origin: number[], canFire: boolean): LockEvent[] {
        const out: LockEvent[] = [];
        const free: Intruder[] = intruders.filter(i => !busy.has(i.key));
        if (this.current !== null) {
            const key: string = this.current.key;
            const still: Intruder | undefined = free.find(i => i.key === key);
            if (still === undefined) {
                out.push({ kind: "cancel", key });
                this.current = null;
            } else {
                this.current = still;
            }
        }
        if (this.current === null && now >= this.cooldownUntil && free.length > 0) {
            let best: Intruder = free[0];
            let bestD: number = distSq(best, origin);
            for (const i of free) {
                const d: number = distSq(i, origin);
                if (d < bestD) {
                    best = i;
                    bestD = d;
                }
            }
            this.current = best;
            this.lockStart = now;
            out.push({ kind: "track", key: best.key, pid: best.pid });
        }
        if (this.current !== null && canFire && now - this.lockStart >= this.lockMs) {
            out.push({ kind: "fire", key: this.current.key, pid: this.current.pid });
            this.current = null;
            this.cooldownUntil = now + this.cooldownMs;
        }
        return out;
    }
}

function distSq(i: Intruder, o: number[]): number {
    const dx: number = i.x - o[0];
    const dy: number = i.y - o[1];
    const dz: number = i.z - o[2];
    return dx * dx + dy * dy + dz * dz;
}

// The players each site has claimed: its lock target, its pending launches
// and the targets of its rockets in the air.
export interface SiteClaims {
    site: number;
    pids: number[];
}

// Keys of the intruders another site has claimed, for LockCore's busy set:
// one site per player at a time (owner, 2026-10-03).
export function busyFromOthers(all: SiteClaims[], me: number, intruders: Intruder[]): Set<string> {
    const taken: Set<number> = new Set<number>();
    for (const c of all) {
        if (c.site !== me) {
            for (const pid of c.pids) {
                taken.add(pid);
            }
        }
    }
    return new Set<string>(intruders.filter(i => taken.has(i.pid)).map(i => i.key));
}

// Round-robin from start: the first silo whose reload is over, or -1.
export function nextReadySilo(readyAt: number[], now: number, start: number): number {
    for (let k = 0; k < readyAt.length; k++) {
        const i: number = (start + k) % readyAt.length;
        if (now >= readyAt[i]) {
            return i;
        }
    }
    return -1;
}

// What to do with a zone member this tick. Only a player who is no longer
// valid (left the game) is dropped. A failed read or a valid-but-not-alive
// player is skipped this tick and kept: membership only comes back through a
// new zone entry, so dropping on one bad read would make the player immune.
// Deaths are dropped separately by OnPlayerDied.
export function memberAction(valid: boolean | undefined, alive: boolean | undefined): "drop" | "skip" | "keep" {
    if (valid === false) {
        return "drop";
    }
    if (valid !== true || alive !== true) {
        return "skip";
    }
    return "keep";
}

// Owner, 2026-10-03: the alarm must not cut off the moment the zone empties.
// It plays while the site is busy (enemies in the zone, a launch or a rocket
// in flight) and for lingerMs after the last busy tick.
export class AlarmLinger {
    private lastBusyAt: number | undefined;

    constructor(private readonly lingerMs: number) {}

    wanted(now: number, busy: boolean): boolean {
        if (busy) {
            this.lastBusyAt = now;
            return true;
        }
        return this.lastBusyAt !== undefined && now - this.lastBusyAt < this.lingerMs;
    }
}
