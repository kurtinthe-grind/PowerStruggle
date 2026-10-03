import { Logging } from "bf6-portal-utils/logging";
import { CallbackHandler } from "bf6-portal-utils/callback-handler";
import {
    ADMIN_LOG_CAP_DEFAULT, ADMIN_LOG_CAPS, ADMIN_LOG_MIN_GAP_MS, ADMIN_LOG_SEND_MS, LOG_DEBUG
} from "../config";

// Admin logs (see ADMIN_LOG_CAPS in config.ts). Off: everything is logged and
// nothing is sent, which is what local hosting wants. On: noisy tags are
// filtered and capped, and the log is sent to the admin on a timer instead of
// once per error (the old per-error send would spend a hosted server's whole
// quota in the first minutes).
let adminMode: boolean = false;
let sendSoon: boolean = false;
let lastSendAt: number = 0;
let sends: number = 0;
let minuteAt: number = 0;
const tagCount: { [tag: string]: number } = {};
const tagDropped: { [tag: string]: number } = {};

export function adminLogMode(): boolean {
    return adminMode;
}

export function adminLogSends(): number {
    return sends;
}

export function setAdminLogMode(on: boolean): void {
    if (on === adminMode) {
        return;
    }
    adminMode = on;
    rawLog("[log] admin logs " + (on ? "ON" : "OFF"));
    if (on) {
        sendAdminLog("admin logs switched on");
    }
}

// Sends now when admin logs are on (match end), whatever the timer says.
export function flushAdminLog(reason: string): void {
    if (adminMode) {
        sendAdminLog(reason);
    }
}

function sendAdminLog(reason: string): void {
    sends++;
    lastSendAt = Date.now();
    sendSoon = false;
    // Logged before the send, so the line is part of what is sent.
    rawLog("[log] send #" + sends + " to admin (" + reason + ")");
    try {
        mod.SendPortalLogToAdmin();
    } catch (e) {
        rawLog("[log] send #" + sends + " failed: " + String(e));
    }
}

function rawLog(line: string): void {
    LOG.log(line, Logging.LogLevel.Info);
}

// True when this line may be written: always with admin logs off, else
// within its tag's per-minute cap.
function allowed(tag: string): boolean {
    if (!adminMode) {
        return true;
    }
    const capped: number | undefined = ADMIN_LOG_CAPS[tag];
    const cap: number = capped === undefined ? ADMIN_LOG_CAP_DEFAULT : capped;
    const n: number = (tagCount[tag] === undefined ? 0 : tagCount[tag]) + 1;
    tagCount[tag] = n;
    if (n <= cap) {
        return true;
    }
    tagDropped[tag] = (tagDropped[tag] === undefined ? 0 : tagDropped[tag]) + 1;
    return false;
}

// Called once per tick (index.ts). Rolls the per-minute caps over, writes what
// was dropped, and sends on the timer or after an error.
export function tickAdminBudget(): void {
    if (!adminMode) {
        return;
    }
    const now: number = Date.now();
    if (now - minuteAt >= 60000) {
        minuteAt = now;
        let dropped: string = "";
        for (const tag in tagDropped) {
            dropped += (dropped === "" ? "" : ", ") + tag + " " + tagDropped[tag];
            delete tagDropped[tag];
        }
        for (const tag in tagCount) {
            delete tagCount[tag];
        }
        if (dropped !== "") {
            rawLog("[log] admin filter dropped last minute: " + dropped);
        }
    }
    const since: number = now - lastSendAt;
    if (since >= ADMIN_LOG_SEND_MS || (sendSoon && since >= ADMIN_LOG_MIN_GAP_MS)) {
        sendAdminLog(sendSoon ? "error" : "timer");
    }
}

// Shared Logging instance. Modules that need to gate a call site call
// willLogDebug() from here before building an expensive string: Logging gates its
// own output, but the concatenation would already have happened by then.
//
// Do NOT re-export Logging from this module. The bundler flattens every module
// into one scope, so re-exporting an imported binding collides with the exported
// class the logging module itself emits, and the Portal compiler fails with
// "Export declaration conflicts with exported declaration of 'Logging'". Call
// sites that need the type or the enum must import it straight from
// bf6-portal-utils/logging. scripts/guard-sources.js now blocks this.
export const LOG: Logging = new Logging("PSH");

// Configured once at module load so log() behaves identically whether or not the
// game's init has run. The sink is the plain console the engine captures.
LOG.setLogging(
    (text: string) => {
        try {
            console.log(text);
        } catch (e) {
        }
    },
    LOG_DEBUG ? Logging.LogLevel.Debug : Logging.LogLevel.Info,
    false
);

// For call sites that build an expensive string. Check this BEFORE concatenating.
export function willLogDebug(): boolean {
    return LOG.willLog(Logging.LogLevel.Debug);
}

export function log(tag: string, line: string): void {
    if (!allowed(tag)) {
        return;
    }
    LOG.log("[" + tag + "] " + line, Logging.LogLevel.Info);
}

// Convenience wrapper for the hot paths. Call sites that build a large string
// should guard with willLogDebug() instead, because the argument is evaluated
// before this is entered.
export function logDebug(tag: string, line: string): void {
    if (adminMode) {
        return;
    }
    LOG.log("[" + tag + "] " + line, Logging.LogLevel.Debug);
}

// Errors and admin-facing events. Written like any line; with admin logs on it
// also asks for a send, at most every ADMIN_LOG_MIN_GAP_MS. It used to call
// SendPortalLogToAdmin itself, up to twice a tick, which on a hosted server
// would use up the session quota early in the match.
export function logAdmin(tag: string, line: string): void {
    log(tag, line);
    if (adminMode) {
        sendSoon = true;
    }
}

// Deliberately NOT routed through CallbackHandler.invokeNoArgs. That helper
// takes a void return, so reporting failure through it needs a wrapper closure -
// and that wrapper would be allocated on every call, including the per-frame
// safe("factory.tick", ...), which is the opposite of what the helper is meant
// to buy. The project's safe() must also return a boolean (worldicons.ts
// consumes it), which invokeNoArgs cannot provide.
//
// Every current safe() callback is synchronous and returns void, so the promise
// rejection handling inside invokeNoArgs has nothing to catch here. It is used
// where it does pay: the listener buses, where it removes duplicated try/catch
// and isolates each subscriber from its neighbours.
export function safe(tag: string, fn: () => void): boolean {
    try {
        fn();
        return true;
    } catch (e) {
        logAdmin("ERROR", tag + " threw: " + String(e));
        return false;
    }
}

// Dispatches one subscriber with per-listener error isolation. At most four
// positional arguments, which is what the util accepts. The callback is typed
// with any[] rather than unknown[] because function parameters are checked
// contravariantly, and the util's own invoke signature uses any[] for the same
// reason.
export function invokeSubscriber(
    fn: ((...args: any[]) => void) | undefined,
    a: unknown,
    b: unknown,
    c: unknown,
    d: unknown,
    tag: string
): void {
    CallbackHandler.invoke(fn, a, b, c, d, LOG, tag);
}
