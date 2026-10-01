import { Logging } from "bf6-portal-utils/logging";
import { CallbackHandler } from "bf6-portal-utils/callback-handler";
import { LOG_DEBUG } from "../config";

const ADMIN_BUDGET_PER_TICK: number = 2;

let adminBudget: number = ADMIN_BUDGET_PER_TICK;

export function tickAdminBudget(): void {
    adminBudget = ADMIN_BUDGET_PER_TICK;
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
    LOG.log("[" + tag + "] " + line, Logging.LogLevel.Info);
}

// Convenience wrapper for the hot paths. Call sites that build a large string
// should guard with willLogDebug() instead, because the argument is evaluated
// before this is entered.
export function logDebug(tag: string, line: string): void {
    LOG.log("[" + tag + "] " + line, Logging.LogLevel.Debug);
}

// Errors and admin-facing events. This is the only path to SendPortalLogToAdmin
// and it is deliberately NOT routed through LOG, which has no rate limit of its
// own and would happily spend the whole per-tick budget on its own.
export function logAdmin(tag: string, line: string): void {
    log(tag, line);
    if (adminBudget <= 0) {
        return;
    }
    adminBudget--;
    try {
        mod.SendPortalLogToAdmin();
    } catch (e) {
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
