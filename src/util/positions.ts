import { teamIdOf } from "./roster";

// One position snapshot of every deployed soldier, taken on demand. It replaces
// bf6-portal-utils PlayerLocations, which read every player's position on every
// tick (four engine calls each) for data Power Struggle only needs once a
// second: the bot sweep's threat counts, and the nuke when it goes off.
//
// The arrays are reused between snapshots, so taking one allocates nothing.
// A soldier reading the origin is dead or between lives and is left out, as
// PlayerLocations did.

const pids: number[] = [];
const players: mod.Player[] = [];
const teams: number[] = [];
const xs: number[] = [];
const ys: number[] = [];
const zs: number[] = [];
let count: number = 0;
let takenAt: number = -1;
// Player id -> index in the snapshot, valid while stampOf[pid] === serial.
const slotOf: number[] = [];
const stampOf: number[] = [];
let serial: number = 0;

const ORIGIN_EPS: number = 0.001;

// Takes a new snapshot unless the current one is younger than maxAgeMs.
export function takeSnapshot(maxAgeMs: number): void {
    const now: number = Date.now();
    if (takenAt >= 0 && now - takenAt < maxAgeMs) {
        return;
    }
    takenAt = now;
    count = 0;
    serial++;
    let arr: mod.Array;
    try {
        arr = mod.GetAllPlayers();
    } catch (e) {
        return;
    }
    const n: number = mod.CountOf(arr);
    for (let i: number = 0; i < n; i++) {
        try {
            const p: mod.Player = mod.ValueInArray(arr, i) as mod.Player;
            if (!mod.IsValid(p)) {
                continue;
            }
            const v: mod.Vector = mod.GetObjectPosition(p);
            const x: number = mod.XComponentOf(v);
            const y: number = mod.YComponentOf(v);
            const z: number = mod.ZComponentOf(v);
            if (Math.abs(x) < ORIGIN_EPS && Math.abs(y) < ORIGIN_EPS && Math.abs(z) < ORIGIN_EPS) {
                continue;
            }
            const pid: number = mod.GetObjId(p);
            pids[count] = pid;
            if (pid >= 0) {
                slotOf[pid] = count;
                stampOf[pid] = serial;
            }
            players[count] = p;
            teams[count] = teamIdOf(p);
            xs[count] = x;
            ys[count] = y;
            zs[count] = z;
            count++;
        } catch (e) {
        }
    }
}

// Index of a player in the current snapshot, or -1 when the player was not
// in it (dead, not deployed, or joined since).
export function snapshotIndexOf(pid: number): number {
    return pid >= 0 && stampOf[pid] === serial ? slotOf[pid] : -1;
}

export function snapshotCount(): number {
    return count;
}

export function snapshotPid(i: number): number {
    return pids[i];
}

export function snapshotPlayer(i: number): mod.Player {
    return players[i];
}

export function snapshotTeam(i: number): number {
    return teams[i];
}

export function snapshotX(i: number): number {
    return xs[i];
}

export function snapshotY(i: number): number {
    return ys[i];
}

export function snapshotZ(i: number): number {
    return zs[i];
}

// Soldiers of a team other than team (teams 1 and 2 only) within radius of
// (x, y, z), from the current snapshot.
export function enemiesInSphere(x: number, y: number, z: number, radius: number, team: number): number {
    const r2: number = radius * radius;
    let n: number = 0;
    for (let i: number = 0; i < count; i++) {
        const t: number = teams[i];
        if (t === team || (t !== 1 && t !== 2)) {
            continue;
        }
        const dx: number = xs[i] - x;
        const dy: number = ys[i] - y;
        const dz: number = zs[i] - z;
        if (dx * dx + dy * dy + dz * dz <= r2) {
            n++;
        }
    }
    return n;
}
