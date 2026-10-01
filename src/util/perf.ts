import { PerformanceStats } from "bf6-portal-utils/performance-stats";
import { log, logAdmin } from "./log";

// Tick instrumentation. performance-stats attaches itself to the OnTickStart
// channel (an alias of OngoingGlobal, same EventChannel instance) at
// EventPriority.First, so trackTick runs before this project's onOngoingGlobal
// and the delta it reports is fresh for the frame being simulated. It performs
// one Date.now() per tick and zero mod.* FFI.
//
// These are thin wrappers rather than a re-export, on purpose: scripts/guard-
// sources.js fails the build on a pure re-export statement, which the Portal
// bundler cannot resolve.

// Known defect in the adopted module, recorded here so it is not rediscovered:
// performance-stats startTrackingTicks() calls unsubscribe() and then re-subscribes
// OnTickStart, but it never clears the Timers.setInterval(measureTimeoutLag, 1000)
// it created the first time. Every OnGameModeStarted therefore leaks one 1 Hz
// interval that keeps firing measureTimeoutLag forever. Harmless for a single
// round. If multi-round is ever configured, store the timer id and clear it
// before re-creating. The module README also says OngoingGlobal where the code
// uses OnTickStart; that is cosmetic, they are the same channel.
//
// A second, deliberate choice: dt in onOngoingGlobal is still a fixed 1/60 even
// though the engine measures nearer 30 Hz, so every frame-denominated TTL and the
// charge rate run at roughly half wall-clock speed. Correcting that is a
// balance change (CHARGE_BASE_SECONDS would go from an effective ~600 s to a
// real 300 s) and is held for an owner decision, not made here.

// Warnings are routed through logAdmin, which is capped at two
// SendPortalLogToAdmin calls per tick. performance-stats is never rate-limited
// by itself and would otherwise be able to flood the admin quota.
let loggingWired: boolean = false;

export function initPerf(): void {
    if (loggingWired) {
        return;
    }
    loggingWired = true;
    try {
        PerformanceStats.setLogging(
            (text: string) => {
                logAdmin("perf", text);
            },
            PerformanceStats.LogLevel.Warning,
            false
        );
    } catch (e) {
        log("perf", "setLogging refused");
    }
}

// Raw delta between the last two ticks, in ms. This is the value that should
// drive simulation timing if the owner chooses to correct it (see the dt
// decision); it is exposed for measurement only until then.
export function spotDeltaMs(): number {
    return PerformanceStats.getSpotDeltaMs();
}

// Instantaneous tick rate in Hz. ~30 is the engine target.
export function spotTickRate(): number {
    return PerformanceStats.getSpotTickRate();
}

// 1.0 means a clean 30 Hz. Below 1.0 the engine is behind and the tick budget
// for optional work should shrink.
export function healthFactor(): number {
    return PerformanceStats.getSpotHealthFactor();
}

// Smoothed values, for display: stable enough to read on a menu row.
export function smoothedTickRate(): number {
    return PerformanceStats.getSmoothedTickRate();
}

export function smoothedTimeoutLagMs(): number {
    return PerformanceStats.getSmoothedTimeoutLagMs();
}
