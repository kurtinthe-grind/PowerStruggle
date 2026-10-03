// Launcher shot bookkeeping, free of mod.* so scripts/test-shot.js can test it.

// A launcher fires on the press (no charge, unlike the Rorsch), so the shot
// is IsFiring's rising edge: once per press, however long it is held.
export function pressed(wasFiring: boolean | undefined, firing: boolean): boolean {
    return firing && wasFiring !== true;
}

// The radar's hit points (owner: 4 launcher hits, stays destroyed).
export class RadarHealth {
    private hitsLeft: number;

    constructor(hits: number) {
        this.hitsLeft = hits;
    }

    get left(): number {
        return this.hitsLeft;
    }

    get destroyed(): boolean {
        return this.hitsLeft <= 0;
    }

    hit(): "damaged" | "destroyed" | "ignored" {
        if (this.hitsLeft <= 0) {
            return "ignored";
        }
        this.hitsLeft--;
        return this.hitsLeft === 0 ? "destroyed" : "damaged";
    }

    // PowerStruggle's raygun takes the radar down in one shot. False when it
    // was already down.
    kill(): boolean {
        if (this.hitsLeft <= 0) {
            return false;
        }
        this.hitsLeft = 0;
        return true;
    }
}

// A launcher's own rocket is in front of the eye when the ray is cast, and
// the ray stops on it (in-game 2026-10-03: launcher rays stopped 4.7-6.5 m
// out). Recasting past it failed (a RayCast sent from inside OnRayCastHit
// never answered), so the ray starts past the rocket (PowerStruggle's
// start-offset fix, pushed further) and a stop still within ownRocketM of the
// eye is taken as the rocket: the shot is judged as if nothing blocked it.
export function ownRocketStop(stopFromEyeM: number | undefined, ownRocketM: number): boolean {
    return stopFromEyeM !== undefined && stopFromEyeM < ownRocketM;
}

// A ray with no answer after timeoutMs is given up and judged along its
// path, so a lost answer cannot jam the shooter for the round.
export function rayExpired(sentAt: number, now: number, timeoutMs: number): boolean {
    return now - sentAt >= timeoutMs;
}
