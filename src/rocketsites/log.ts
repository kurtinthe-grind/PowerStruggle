import { LOG_LEVEL } from "./config";

// PortalLog only (the owner reads the log; no on-screen debug). PortalLog is
// shared by every mode, so every line carries the [RST] prefix.
// log() always prints (startup, problems, a radar destroyed, errors);
// logAt() prints only at LOG_LEVEL or above, and builds its message only then.

export const LOG_EVENTS: number = 1;    // shots, locks, launches, hits, radar wake/sleep, the stats line
export const LOG_TRACE: number = 2;     // zone enter/exit, alarm, launcher presses, radar read-backs

export function log(tag: string, msg: string): void {
    console.log("[RST][" + tag + "] " + msg);
}

export function logOn(level: number): boolean {
    return LOG_LEVEL >= level;
}

export function logAt(level: number, tag: string, msg: () => string): void {
    if (LOG_LEVEL >= level) {
        log(tag, msg());
    }
}

const once: { [key: string]: boolean } = {};

export function logOnce(key: string, tag: string, msg: string): void {
    if (once[key]) {
        return;
    }
    once[key] = true;
    log(tag, msg);
}

// Runs fn; a throw is logged once per tag, never in a loop.
export function safe(tag: string, fn: () => void): boolean {
    try {
        fn();
        return true;
    } catch (e) {
        logOnce("err:" + tag, "error", tag + " threw: " + String(e));
        return false;
    }
}

export function tryGet<T>(tag: string, fn: () => T): T | undefined {
    try {
        return fn();
    } catch (e) {
        logOnce("err:" + tag, "error", tag + " threw: " + String(e));
        return undefined;
    }
}

export function fmt(v: readonly number[] | undefined): string {
    return v === undefined ? "n/a" : v.map(n => n.toFixed(2)).join(", ");
}
