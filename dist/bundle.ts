// --- BUNDLED TYPESCRIPT OUTPUT ---
// @ts-nocheck

// --- SOURCE: node_modules\bf6-portal-utils\logging\index.ts ---
// version: 1.2.0
export class Logging {
    /**
     * Safely converts an error of unknown type to a string.
     * This method cannot throw - it will always return a string.
     * @param error - The error to convert to a string.
     * @returns The error as a string.
     */
    private static _safeErrorToString(error: unknown): string {
        try {
            if (error instanceof Error) {
                // Try to get the message, but handle cases where .message might throw.
                try {
                    return error.message || 'Error';
                } catch {
                    return 'Error (message unavailable)';
                }
            }
            // Try `String()` conversion, but handle cases where `toString()` might throw.
            try {
                return String(error);
            } catch {
                return '[Error object]';
            }
        } catch {
            // Ultimate fallback - this should never happen, but ensures we always return a string.
            return '[Unable to stringify error]';
        }
    }

    public constructor(tag: string) {
        this._tag = tag;
    }

    private _tag: string;

    private _logLevel: Logging.LogLevel = Logging.LogLevel.Info;

    private _includeRawError: boolean = false;

    private _logger?: (text: string, error?: unknown) => Promise<void> | void;

    private readonly _asyncErrorHandler = (loggingError: unknown): void => {
        // Catch and log async logger errors to prevent unhandled promise rejections.
        console.log(`<${this._tag}> Error in async logger:`, loggingError);
    };

    /**
     * Checks if a message with the given log level would actually be logged.
     * Use this to avoid building expensive log messages when logging is disabled or below the threshold.
     * @param logLevel - The log level to check.
     * @returns True if logging will occur, false otherwise.
     */
    public willLog(logLevel: Logging.LogLevel): boolean {
        return this._logger != null && logLevel >= this._logLevel;
    }

    /**
     * Logs a message with the given log level.
     * @param text - The text to log.
     * @param logLevel - The log level to use.
     * @param error - The error to include in the log.
     */
    public log(text: string, logLevel: Logging.LogLevel = Logging.LogLevel.Warning, error?: unknown): void {
        if (!this._logger || logLevel < this._logLevel) return;

        try {
            const errorText = this._includeRawError && error ? ` - Error: ${Logging._safeErrorToString(error)}` : '';

            const result = this._logger(`<${this._tag}> ${text}${errorText}`, error);

            if (result instanceof Promise) {
                result.catch(this._asyncErrorHandler);
            }
        } catch (logError: unknown) {
            // Catch and log sync logger errors so the logging functionality can still run.
            console.log(`<${this._tag}> Error in sync logger:`, logError);
        }
    }

    /**
     * Attaches a logger and defines a minimum log level and whether to attempt to append a string form of the error to
     * the text of the log message.
     * @param log - The logger function: `(formattedText, error?) => void | Promise<void>`. `error` is the same value
     *              passed to `log()` (if any), for inspection (e.g. `instanceof Error`, `stack`). `formattedText` may
     *              also include ` - Error: …` when `includeRawError` is true.
     * @param logLevel - The minimum log level to use.
     * @param includeRawError - When true and `log()` receives an error, attempts to append a string form of the error
     *                          to the text of the log message.
     */
    public setLogging(
        log?: (text: string, error?: unknown) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeRawError?: boolean
    ): void {
        this._logger = log;
        this._logLevel = logLevel ?? Logging.LogLevel.Warning;
        this._includeRawError = includeRawError ?? false;
    }
}

export namespace Logging {
    /**
     * The log levels.
     */
    export enum LogLevel {
        /**
         * Debug-level messages. Most verbose, typically used during development.
         */
        Debug = 0,
        /**
         * Informational messages. General operational information.
         */
        Info = 1,
        /**
         * Warning messages. Indicates potential issues or unexpected conditions.
         */
        Warning = 2,
        /**
         * Error messages. Indicates errors that need attention. Least verbose.
         */
        Error = 3,
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\callback-handler\index.ts ---


// version: 2.0.0
export namespace CallbackHandler {
    function getCallbackNamePart(callback: ((...args: any[]) => unknown) | null | undefined): string {
        const callbackName = callback?.name;

        return !callbackName ? 'anonymous callback' : `${callbackName} callback`;
    }

    function getContextPart(context?: string): string {
        return !context ? '' : `${context} `;
    }

    /**
     * Safely invokes a callback with no arguments that may be sync or async, catching and logging errors.
     * @param callback - The callback to invoke (may be undefined or null).
     * @param logging - Logging instance to use for error reporting.
     * @param context - Optional context for error messages.
     */
    export function invokeNoArgs(
        callback: (() => Promise<void> | void) | null | undefined,
        logging: Logging,
        context?: string
    ): void {
        invoke(callback, undefined, undefined, undefined, undefined, logging, context);
    }

    /**
     * Safely invokes a callback directly without rest parameters or array allocations, catching and logging errors.
     * @param callback - The callback to invoke (may be undefined or null).
     * @param a - First argument.
     * @param b - Second argument.
     * @param c - Third argument.
     * @param d - Fourth argument.
     * @param logging - Logging instance to use for error reporting.
     * @param context - Optional context for error messages.
     */
    export function invoke<T extends (...args: any[]) => Promise<void> | void>(
        callback: T | null | undefined,
        a: unknown,
        b: unknown,
        c: unknown,
        d: unknown,
        logging: Logging,
        context?: string
    ): void {
        if (!callback) return;

        try {
            const result = (callback as (a: unknown, b: unknown, c: unknown, d: unknown) => Promise<void> | void)(
                a,
                b,
                c,
                d
            );

            if (result instanceof Promise) {
                result.catch((error: unknown) => {
                    logging.log(
                        `Error in ${getContextPart(context)}async ${getCallbackNamePart(callback)}:`,
                        Logging.LogLevel.Error,
                        error
                    );
                });
            }
        } catch (error: unknown) {
            logging.log(
                `Error in ${getContextPart(context)}sync ${getCallbackNamePart(callback)}:`,
                Logging.LogLevel.Error,
                error
            );
        }
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\timers\index.ts ---




// version: 2.0.0
export namespace Timers {
    const logging = new Logging('Timers');

    /**
     * A re-export of the `Logging.LogLevel` enum.
     */
    export const LogLevel = Logging.LogLevel;

    /**
     * Attaches a logger and defines a minimum log level and whether to attempt to append a string form of the error to
     * the text of the log message.
     * @param log - The logger function: `(formattedText, error?) => void | Promise<void>`. `error` is the same value
     *              passed to `log()` (if any), for inspection (e.g. `instanceof Error`, `stack`). `formattedText` may
     *              also include ` - Error: …` when `includeRawError` is true.
     * @param logLevel - The minimum log level to use.
     * @param includeRawError - When true and `log()` receives an error, attempts to append a string form of the error
     *                          to the text of the log message.
     */
    export function setLogging(
        log?: (text: string, error?: unknown) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeRawError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeRawError);
    }

    /**
     * Unique generation-encoded identifier for a Timer.
     */
    export type TimerID = number & { readonly __brand: 'TimerID' };

    /**
     * Maximum timer delay or interval in milliseconds (signed 32-bit integer limit: 2,147,483,647 ms).
     */
    export const MAX_TIMER_DELAY_MS = 2_147_483_647;

    // --- Configuration ---
    const MAX_TIMERS = 512;
    const MAX_GENERATIONS = 65_535;
    const SERVER_START_TIME = Date.now();
    const GENERATION_MULTIPLIER = 10_000; // Must be strictly larger than MAX_TIMERS.
    const INVALID_INDEX = -1;

    // --- Data-Oriented Storage (Zero Allocation Pool) ---
    const _expirationTimes = new Uint32Array(MAX_TIMERS);
    const _generations = new Uint16Array(MAX_TIMERS);

    /**
     * Intrusive link / interval milliseconds array:
     * - Free slot (_callbacks[i] === null): Points to the next free slot on the intrusive free list (`_firstFree`).
     * - In-use slot (_callbacks[i] !== null): Stores the repeat interval in milliseconds (0 for timeouts).
     */
    const _intervalMs = new Int32Array(MAX_TIMERS);

    for (let i = 0; i < MAX_TIMERS - 1; ++i) {
        _intervalMs[i] = i + 1;
    }

    _intervalMs[MAX_TIMERS - 1] = INVALID_INDEX;

    let _firstFree = 0;

    // Pre-allocated array initialized with nulls to prevent dynamic resizing.
    const _callbacks = new Array<(() => Promise<void> | void) | null>(MAX_TIMERS).fill(null);

    let _activeTimerCount = 0;
    let _isSubscribed = false;

    /**
     * @returns The current server uptime in milliseconds.
     */
    function getUptime(): number {
        return Date.now() - SERVER_START_TIME;
    }

    /**
     * Pops the next available slot from the intrusive free-list in O(1) time.
     * @returns The index of the allocated slot, or INVALID_INDEX if the pool is full.
     */
    function _allocateSlot(): number {
        if (_firstFree === INVALID_INDEX) {
            logging.log('Pool is full', LogLevel.Error);
            return INVALID_INDEX;
        }

        const index = _firstFree;
        _firstFree = _intervalMs[index];
        _intervalMs[index] = 0;

        return index;
    }

    /**
     * Resolves a public TimerID to its internal slot index.
     * @param id - The public TimerID.
     * @returns The internal slot index, or INVALID_INDEX if invalid or inactive.
     */
    function _resolveIndex(id: TimerID): number {
        if (id < 0) return INVALID_INDEX;

        const index = id % GENERATION_MULTIPLIER;

        if (index >= MAX_TIMERS) return INVALID_INDEX;

        const expectedGen = Math.floor(id / GENERATION_MULTIPLIER);

        if (_generations[index] !== expectedGen || _callbacks[index] === null) return INVALID_INDEX;

        return index;
    }

    /**
     * Deletes a timer by its index and returns the slot to the free list.
     * @param index - The index of the timer to delete.
     */
    function _deleteTimer(index: number): void {
        _callbacks[index] = null;
        --_activeTimerCount;

        if (_generations[index] < MAX_GENERATIONS) {
            ++_generations[index];
            _intervalMs[index] = _firstFree;
            _firstFree = index;
        } else if (logging.willLog(LogLevel.Warning)) {
            logging.log(`Slot ${index} exhausted max generations and was retired`, LogLevel.Warning);
        }
    }

    /**
     * Evaluates all active timers on every game tick with zero promise allocations.
     */
    function _handleTick(): void {
        // Fast exit if no timers are active.
        if (_activeTimerCount === 0) return;

        const currentUptime = getUptime();

        for (let index = 0; index < MAX_TIMERS; ++index) {
            const cb = _callbacks[index];

            if (cb === null) continue;

            if (currentUptime < _expirationTimes[index]) continue;

            // Mutate state before executing the callback in case the callback clears the timer.
            if (_intervalMs[index] > 0) {
                _expirationTimes[index] = currentUptime + _intervalMs[index];
            } else {
                _deleteTimer(index);
            }

            CallbackHandler.invokeNoArgs(cb, logging, 'trigger');
        }
    }

    /**
     * Ensures that the global tick subscription is active.
     */
    function _ensureSubscribed(): void {
        if (_isSubscribed) return;

        _isSubscribed = true;

        // Subscribed to OnTickStart at priority Normal (0) so scheduled timers execute at the start
        // of each frame, allowing their state mutations to flow into the current tick's simulation and UI commit pipeline.
        Events.OnTickStart.subscribe(_handleTick);
    }

    /**
     * Creates a timer.
     * @param callback - The callback to execute.
     * @param expirationDelay - The delay before the first execution.
     * @param interval - The interval between executions.
     * @returns The timer ID, or null if the pool is full.
     */
    function _createTimer(
        callback: () => Promise<void> | void,
        expirationDelay: number,
        interval: number
    ): TimerID | null {
        _ensureSubscribed();

        const index = _allocateSlot();

        if (index === INVALID_INDEX) return null;

        ++_activeTimerCount;
        _callbacks[index] = callback;
        _expirationTimes[index] = getUptime() + expirationDelay;
        _intervalMs[index] = interval;

        return (index + GENERATION_MULTIPLIER * _generations[index]) as TimerID;
    }

    /**
     * Schedules a one-time execution after the specified delay.
     * @param callback - The callback to execute.
     * @param ms - The delay in milliseconds (clamped between 0 and 2,147,483,647 ms).
     * @returns The timer ID, or null if the pool is full.
     */
    export function setTimeout(callback: () => Promise<void> | void, ms: number): TimerID | null {
        const safeMs = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, ms));
        return _createTimer(callback, safeMs, 0);
    }

    /**
     * Schedules a repeated execution after the specified interval.
     * @param callback - The callback to execute.
     * @param ms - The interval in milliseconds (clamped between 0 and 2,147,483,647 ms).
     * @param immediate - If true, runs the callback immediately.
     * @returns The timer ID, or null if the pool is full.
     */
    export function setInterval(
        callback: () => Promise<void> | void,
        ms: number,
        immediate: boolean = false
    ): TimerID | null {
        const safeMs = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, ms));
        const expirationDelay = immediate ? 0 : safeMs;

        return _createTimer(callback, expirationDelay, safeMs);
    }

    /**
     * Cancels a timeout (or interval). Silently ignores invalid IDs.
     * @param id - The timer ID to cancel.
     */
    export function clearTimeout(id: TimerID): void {
        clear(id);
    }

    /**
     * Cancels an interval (or timeout). Silently ignores invalid IDs.
     * @param id - The timer ID to cancel.
     */
    export function clearInterval(id: TimerID): void {
        clear(id);
    }

    /**
     * Cancels a timeout or interval. Silently ignores invalid IDs.
     * @param id - The timer ID to cancel.
     */
    export function clear(id: TimerID): void {
        const index = _resolveIndex(id);

        if (index === INVALID_INDEX) return;

        _deleteTimer(index);
    }

    /**
     * @param id The timer ID to check.
     * @returns True if the timer is active, false otherwise.
     */
    export function isActive(id: TimerID): boolean {
        return _resolveIndex(id) !== INVALID_INDEX;
    }

    /**
     * @returns The number of active timers.
     */
    export function getActiveTimerCount(): number {
        return _activeTimerCount;
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\events\index.ts ---




// version: 1.8.0

/**
 * Priority levels for event handlers.
 * Lower numbers run earlier, higher numbers run later.
 * Custom numbers can also be used.
 */
export enum EventPriority {
    First = -100,
    Normal = 0,
    Last = 100,
}

namespace EventsTypes {
    /**
     * Map of each event name to its trigger function. Use for typed references to event payloads
     * (e.g. `Parameters<typeof Events.Type.OnPlayerDied>`) or dynamic dispatch. Prefer the channel API
     * (`Events.OnPlayerDied.subscribe(handler)`) for subscribe/trigger with full IntelliSense.
     */
    export const Type = {
        OngoingGlobal,
        OnTickStart,
        OnTickEnd,
        OngoingAreaTrigger,
        OngoingBlockingSphere,
        OngoingBomb,
        OngoingCapturePoint,
        OngoingEmplacementSpawner,
        OngoingHQ,
        OngoingInteractPoint,
        OngoingLootSpawner,
        OngoingMCOM,
        OngoingPlayer,
        OngoingRingOfFire,
        OngoingSector,
        OngoingSpawner,
        OngoingSpawnPoint,
        OngoingTeam,
        OngoingVehicle,
        OngoingVehicleSpawner,
        OngoingWaypointPath,
        OngoingWorldIcon,
        OnAIMoveToFailed,
        OnAIMoveToRunning,
        OnAIMoveToSucceeded,
        OnAIParachuteRunning,
        OnAIParachuteSucceeded,
        OnAIWaypointIdleFailed,
        OnAIWaypointIdleRunning,
        OnAIWaypointIdleSucceeded,
        OnBombDropped,
        OnBombPickedUp,
        OnBombStateChanged,
        OnCapturePointCaptured,
        OnCapturePointCapturing,
        OnCapturePointLost,
        OnGameModeEnding,
        OnGameModeStarted,
        OnGolmudTrainStopped,
        OnMandown,
        OnMCOMArmed,
        OnMCOMDefused,
        OnMCOMDestroyed,
        OnPlayerDamaged,
        OnPlayerDeployed,
        OnPlayerDied,
        OnPlayerEarnedKill,
        OnPlayerEarnedKillAssist,
        OnPlayerEmerged,
        OnPlayerEnterAreaTrigger,
        OnPlayerEnterCapturePoint,
        OnPlayerEnteredWater,
        OnPlayerEnterVehicle,
        OnPlayerEnterVehicleSeat,
        OnPlayerEnterVL7Cloud,
        OnPlayerExitAreaTrigger,
        OnPlayerExitCapturePoint,
        OnPlayerExitedWater,
        OnPlayerExitVehicle,
        OnPlayerExitVehicleSeat,
        OnPlayerExitVL7Cloud,
        OnPlayerInteract,
        OnPlayerJoinGame,
        OnPlayerLeaveGame,
        OnPlayerSubmerged,
        OnPlayerSwitchTeam,
        OnPlayerUIButtonEvent,
        OnPlayerUndeploy,
        OnPortalGadgetAimStart,
        OnPortalGadgetAimStop,
        OnPortalGadgetFireStart,
        OnPortalGadgetFireStop,
        OnPortalGadgetLaserToggle,
        OnRayCastHit,
        OnRayCastMissed,
        OnRevived,
        OnRingOfFireZoneSizeChange,
        OnSpawnerSpawned,
        OnTimeLimitReached,
        OnVehicleDestroyed,
        OnVehicleSpawned,
    } as const;

    /**
     * Extract parameters from a function type.
     */
    export type Parameters<T> = T extends (...args: infer P) => void ? P : never;

    /**
     * Trigger function types (single source of truth); same shape as Events.Type.
     */
    export type Signature = typeof Type;

    /**
     * One of the trigger function names (a key from Events.Type).
     */
    export type SignatureKey = keyof Signature;

    /**
     * One of the trigger functions (a value from Events.Type).
     */
    export type TypeValue = Signature[SignatureKey];

    /**
     * Typed channel for a single event. Each event (e.g. `Events.OngoingInteractPoint`, `Events.OnPlayerDied`)
     * exposes this interface with `subscribe`, `unsubscribe`, and `trigger` typed to that event's payload.
     * @template K - Event name; handler and trigger args are inferred from the corresponding trigger function.
     */
    export type Channel<K extends SignatureKey> = EventChannel<K>;

    /**
     * Map of each event name to its typed channel (`subscribe`, `unsubscribe`, `trigger`, `handlerCount`).
     * Merged onto the Events namespace so you get e.g. `Events.OngoingInteractPoint.subscribe(handler)`.
     */
    export type ChannelsMap = {
        [K in SignatureKey]: K extends SignatureKey ? Channel<K> : never;
    };

    /**
     * Get the handler function type for a specific event type.
     * Handlers can be synchronous or asynchronous (returning void or Promise<void>).
     */
    export type HandlerForType<T extends TypeValue> = T extends (...args: infer P) => void
        ? (...args: P) => void | Promise<void>
        : never;

    /**
     * Get the parameter tuple for a specific event type.
     */
    export type EventParameters<T extends TypeValue> = T extends (...args: infer P) => void ? P : never;

    /**
     * Create a union of all possible handler types.
     * Handlers can be synchronous or asynchronous (returning void or Promise<void>).
     */
    export type AllHandlers = {
        [K in SignatureKey]: Signature[K] extends (...args: infer P) => void
            ? (...args: P) => void | Promise<void>
            : never;
    }[SignatureKey];

    export type TriggerWithChannel = TypeValue & {
        _channel?: EventChannel<SignatureKey>;
    };
}

namespace EventsPrivate {
    export const LOG_TIMEOUT_MS = 10_000;

    export const logging = new Logging('Events');

    let isTickEndPending = false;

    /**
     * Schedules the virtual OnTickEnd event to resolve at the end of the current frame via mod.Wait(0).
     */
    export function scheduleTickEnd(): void {
        if (isTickEndPending) return;

        isTickEndPending = true;
        mod.Wait(0).then(onTickEndPromiseResolved);
    }

    function onTickEndPromiseResolved(): void {
        isTickEndPending = false;
        OnTickEnd();
    }
}

class EventChannel<K extends EventsTypes.SignatureKey> {
    public handlers: EventsTypes.HandlerForType<EventsTypes.Signature[K]>[] | null = null;
    public priorities: number[] | null = null;
    public incompleteTriggers = 0;
    public logTimeout: number | null = null;

    constructor(public readonly typeValue: EventsTypes.Signature[K]) {}

    public subscribe(
        handler: EventsTypes.HandlerForType<EventsTypes.Signature[K]>,
        priority: number = EventPriority.Normal
    ): () => void {
        if (!this.handlers || !this.priorities) {
            this.handlers = [handler];
            this.priorities = [priority];
        } else {
            const handlers = this.handlers.slice();
            const priorities = this.priorities.slice();
            const len = priorities.length;
            let insertIdx = len;

            for (let i = 0; i < len; ++i) {
                if (priorities[i] > priority) {
                    insertIdx = i;
                    break;
                }
            }

            handlers.splice(insertIdx, 0, handler);
            priorities.splice(insertIdx, 0, priority);
            this.handlers = handlers;
            this.priorities = priorities;
        }

        return () => this.unsubscribe(handler);
    }

    public unsubscribe(handler: EventsTypes.HandlerForType<EventsTypes.Signature[K]>): void {
        if (!this.handlers || !this.priorities) return;

        const idx = this.handlers.indexOf(handler);

        if (idx === -1) return;

        if (this.handlers.length === 1) {
            this.handlers = null;
            this.priorities = null;
        } else {
            const handlers = this.handlers.slice();
            const priorities = this.priorities.slice();
            handlers.splice(idx, 1);
            priorities.splice(idx, 1);
            this.handlers = handlers;
            this.priorities = priorities;
        }
    }

    public trigger(...args: EventsTypes.EventParameters<EventsTypes.Signature[K]>): void;
    public trigger(a?: unknown, b?: unknown, c?: unknown, d?: unknown): void {
        const handlers = this.handlers;

        if (!handlers) return;

        const len = handlers.length;

        if (len === 0) return;

        // Incomplete-trigger accounting: Portal servers previously aborted the JS thread for a block of synchronous
        // work after ~50ms, so a trigger can be started (increment below) but never reach the decrement. We schedule a
        // one-shot timeout to log how many such incomplete triggers occurred in the last _LOG_TIMEOUT_MS window in
        // order to avoid spamming the log, especially for high-frequency triggers like any of the Ongoing events.
        if (this.incompleteTriggers > 0 && !this.logTimeout) {
            const processIncompleteTriggers = () => {
                this.logTimeout = null;

                EventsPrivate.logging.log(
                    `${this.incompleteTriggers} incomplete triggers for ${this.typeValue?.name ?? 'unknown'} in last ${EventsPrivate.LOG_TIMEOUT_MS}ms`,
                    Logging.LogLevel.Warning
                );

                this.incompleteTriggers = 0;
            };

            this.logTimeout = Timers.setTimeout(processIncompleteTriggers, EventsPrivate.LOG_TIMEOUT_MS);
        }

        ++this.incompleteTriggers;

        // Execute each handler asynchronously and non-blocking.
        // Errors in one handler won't prevent other handlers from executing.
        for (let i = 0; i < len; ++i) {
            CallbackHandler.invoke(
                handlers[i] as (...args: unknown[]) => Promise<void> | void,
                a,
                b,
                c,
                d,
                EventsPrivate.logging,
                'trigger'
            );
        }

        // Decrement runs synchronously after the loop; the only way it is skipped is tick abort.
        --this.incompleteTriggers;
    }

    public handlerCount(): number {
        return this.handlers?.length ?? 0;
    }
}

class EventsImplementation {
    /**
     * The event types.
     */
    public static readonly Type = EventsTypes.Type;

    /**
     * The event priority levels.
     */
    public static readonly EventPriority = EventPriority;

    /**
     * The logging levels.
     */
    public static readonly LogLevel = Logging.LogLevel;

    static {
        /** Build per-event channel objects so users can call Events.OngoingInteractPoint.subscribe(handler), etc. */
        const typeKeys = Object.keys(EventsTypes.Type) as EventsTypes.SignatureKey[];

        for (const key of typeKeys) {
            const typeValue = EventsTypes.Type[key];
            const channel = new EventChannel(typeValue);

            // Link channel to the trigger function object for fast retrieval.
            (typeValue as EventsTypes.TriggerWithChannel)._channel = channel;

            (
                EventsImplementation as unknown as Record<
                    EventsTypes.SignatureKey,
                    EventChannel<EventsTypes.SignatureKey>
                >
            )[key] = channel;
        }

        // OnTickStart is an alias for OngoingGlobal: share the same EventChannel instance
        const ongoingGlobalChannel = (
            EventsImplementation as unknown as Record<EventsTypes.SignatureKey, EventChannel<EventsTypes.SignatureKey>>
        )['OngoingGlobal'];

        (EventsImplementation as unknown as Record<EventsTypes.SignatureKey, EventChannel<EventsTypes.SignatureKey>>)[
            'OnTickStart'
        ] = ongoingGlobalChannel;

        (EventsTypes.Type.OnTickStart as EventsTypes.TriggerWithChannel)._channel = ongoingGlobalChannel;
    }

    private constructor() {}

    private static getChannel(type: EventsTypes.TypeValue): EventChannel<EventsTypes.SignatureKey> {
        const typeWithChannel = type as EventsTypes.TriggerWithChannel;

        let channel = typeWithChannel._channel;

        if (!channel) {
            channel = new EventChannel(type);
            typeWithChannel._channel = channel;
        }

        return channel;
    }

    /**
     * Attaches a logger and defines a minimum log level and whether to attempt to append a string form of the error to
     * the text of the log message.
     * @param log - The logger function: `(formattedText, error?) => void | Promise<void>`. `error` is the same value
     *              passed to `log()` (if any), for inspection (e.g. `instanceof Error`, `stack`). `formattedText` may
     *              also include ` - Error: …` when `includeRawError` is true.
     * @param logLevel - The minimum log level to use.
     * @param includeRawError - When true and `log()` receives an error, attempts to append a string form of the error
     *                          to the text of the log message.
     */
    public static setLogging(
        log?: (text: string, error?: unknown) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeRawError?: boolean
    ): void {
        EventsPrivate.logging.setLogging(log, logLevel, includeRawError);
    }

    /**
     * Subscribe to an event.
     * @param type - The event type to subscribe to.
     * @param handler - The handler function to call when the event is triggered.
     * @param priority - The priority of the handler (e.g. `EventPriority.First`, `EventPriority.Normal`, `EventPriority.Last`, or custom number). Lower numbers run earlier. Defaults to `EventPriority.Normal` (0).
     * @returns A function to unsubscribe from the event.
     */
    public static subscribe<T extends EventsTypes.TypeValue>(
        type: T,
        handler: EventsTypes.HandlerForType<T>,
        priority: number = EventPriority.Normal
    ): () => void {
        return EventsImplementation.getChannel(type).subscribe(
            handler as unknown as EventsTypes.HandlerForType<EventsTypes.Signature[EventsTypes.SignatureKey]>,
            priority
        );
    }

    /**
     * Unsubscribe from an event.
     * @param type - The event type to unsubscribe from.
     * @param handler - The handler function that was subscribed.
     */
    public static unsubscribe<T extends EventsTypes.TypeValue>(type: T, handler: EventsTypes.HandlerForType<T>): void {
        EventsImplementation.getChannel(type).unsubscribe(
            handler as unknown as EventsTypes.HandlerForType<EventsTypes.Signature[EventsTypes.SignatureKey]>
        );
    }

    /**
     * Triggers an event.
     * @param type - The event type to trigger.
     * @param args - The arguments to pass to the handler function.
     */
    public static trigger<T extends EventsTypes.TypeValue>(type: T, ...args: EventsTypes.EventParameters<T>): void {
        (
            EventsImplementation.getChannel(type) as unknown as {
                trigger(a?: unknown, b?: unknown, c?: unknown, d?: unknown): void;
            }
        ).trigger(args[0], args[1], args[2], args[3]);
    }

    /**
     * Return the number of handlers currently subscribed to an event.
     * @param type - The event type to query.
     * @returns Count of subscribed handlers (0 if none).
     */
    public static handlerCount<T extends EventsTypes.TypeValue>(type: T): number {
        return EventsImplementation.getChannel(type).handlerCount();
    }
}

export const Events = EventsImplementation as typeof EventsImplementation & EventsTypes.ChannelsMap;

/* eslint-disable jsdoc/require-jsdoc */
export function OngoingGlobal(): void {
    EventsPrivate.scheduleTickEnd();
    Events.OngoingGlobal.trigger();
}

export function OnTickStart(): void {
    OngoingGlobal();
}

export function OnTickEnd(): void {
    Events.OnTickEnd.trigger();
}

export function OngoingAreaTrigger(areaTrigger: mod.AreaTrigger): void {
    Events.OngoingAreaTrigger.trigger(areaTrigger);
}

export function OngoingBlockingSphere(blockingSphere: mod.BlockingSphere): void {
    Events.OngoingBlockingSphere.trigger(blockingSphere);
}

export function OngoingBomb(bomb: mod.Bomb): void {
    Events.OngoingBomb.trigger(bomb);
}

export function OngoingCapturePoint(capturePoint: mod.CapturePoint): void {
    Events.OngoingCapturePoint.trigger(capturePoint);
}

export function OngoingEmplacementSpawner(emplacementSpawner: mod.EmplacementSpawner): void {
    Events.OngoingEmplacementSpawner.trigger(emplacementSpawner);
}

export function OngoingHQ(hq: mod.HQ): void {
    Events.OngoingHQ.trigger(hq);
}

export function OngoingInteractPoint(interactPoint: mod.InteractPoint): void {
    Events.OngoingInteractPoint.trigger(interactPoint);
}

export function OngoingLootSpawner(lootSpawner: mod.LootSpawner): void {
    Events.OngoingLootSpawner.trigger(lootSpawner);
}

export function OngoingMCOM(mcom: mod.MCOM): void {
    Events.OngoingMCOM.trigger(mcom);
}

export function OngoingPlayer(player: mod.Player): void {
    Events.OngoingPlayer.trigger(player);
}

export function OngoingRingOfFire(ringOfFire: mod.RingOfFire): void {
    Events.OngoingRingOfFire.trigger(ringOfFire);
}

export function OngoingSector(sector: mod.Sector): void {
    Events.OngoingSector.trigger(sector);
}

export function OngoingSpawner(spawner: mod.Spawner): void {
    Events.OngoingSpawner.trigger(spawner);
}

export function OngoingSpawnPoint(spawnPoint: mod.SpawnPoint): void {
    Events.OngoingSpawnPoint.trigger(spawnPoint);
}

export function OngoingTeam(team: mod.Team): void {
    Events.OngoingTeam.trigger(team);
}

export function OngoingVehicle(vehicle: mod.Vehicle): void {
    Events.OngoingVehicle.trigger(vehicle);
}

export function OngoingVehicleSpawner(vehicleSpawner: mod.VehicleSpawner): void {
    Events.OngoingVehicleSpawner.trigger(vehicleSpawner);
}

export function OngoingWaypointPath(waypointPath: mod.WaypointPath): void {
    Events.OngoingWaypointPath.trigger(waypointPath);
}

export function OngoingWorldIcon(worldIcon: mod.WorldIcon): void {
    Events.OngoingWorldIcon.trigger(worldIcon);
}

export function OnAIMoveToFailed(player: mod.Player): void {
    Events.OnAIMoveToFailed.trigger(player);
}

export function OnAIMoveToRunning(player: mod.Player): void {
    Events.OnAIMoveToRunning.trigger(player);
}

export function OnAIMoveToSucceeded(player: mod.Player): void {
    Events.OnAIMoveToSucceeded.trigger(player);
}

export function OnAIParachuteRunning(player: mod.Player): void {
    Events.OnAIParachuteRunning.trigger(player);
}

export function OnAIParachuteSucceeded(player: mod.Player): void {
    Events.OnAIParachuteSucceeded.trigger(player);
}

export function OnAIWaypointIdleFailed(player: mod.Player): void {
    Events.OnAIWaypointIdleFailed.trigger(player);
}

export function OnAIWaypointIdleRunning(player: mod.Player): void {
    Events.OnAIWaypointIdleRunning.trigger(player);
}

export function OnAIWaypointIdleSucceeded(player: mod.Player): void {
    Events.OnAIWaypointIdleSucceeded.trigger(player);
}

export function OnBombDropped(bomb: mod.Bomb, player: mod.Player): void {
    Events.OnBombDropped.trigger(bomb, player);
}

export function OnBombPickedUp(bomb: mod.Bomb, player: mod.Player): void {
    Events.OnBombPickedUp.trigger(bomb, player);
}

export function OnBombStateChanged(bomb: mod.Bomb, state: mod.BombState): void {
    Events.OnBombStateChanged.trigger(bomb, state);
}

export function OnCapturePointCaptured(capturePoint: mod.CapturePoint): void {
    Events.OnCapturePointCaptured.trigger(capturePoint);
}

export function OnCapturePointCapturing(capturePoint: mod.CapturePoint): void {
    Events.OnCapturePointCapturing.trigger(capturePoint);
}

export function OnCapturePointLost(capturePoint: mod.CapturePoint): void {
    Events.OnCapturePointLost.trigger(capturePoint);
}

export function OnGameModeEnding(): void {
    Events.OnGameModeEnding.trigger();
}

export function OnGameModeStarted(): void {
    Events.OnGameModeStarted.trigger();
}

export function OnGolmudTrainStopped(reason: mod.GolmudTrainStopReason): void {
    Events.OnGolmudTrainStopped.trigger(reason);
}

export function OnMandown(player: mod.Player, otherPlayer: mod.Player): void {
    Events.OnMandown.trigger(player, otherPlayer);
}

export function OnMCOMArmed(mcom: mod.MCOM): void {
    Events.OnMCOMArmed.trigger(mcom);
}

export function OnMCOMDefused(mcom: mod.MCOM): void {
    Events.OnMCOMDefused.trigger(mcom);
}

export function OnMCOMDestroyed(mcom: mod.MCOM): void {
    Events.OnMCOMDestroyed.trigger(mcom);
}

export function OnPlayerDamaged(
    damagedPlayer: mod.Player,
    damagingPlayer: mod.Player,
    damageType: mod.DamageType,
    weapon: mod.WeaponUnlock
): void {
    Events.OnPlayerDamaged.trigger(damagedPlayer, damagingPlayer, damageType, weapon);
}

export function OnPlayerDeployed(player: mod.Player): void {
    Events.OnPlayerDeployed.trigger(player);
}

export function OnPlayerDied(
    victim: mod.Player,
    killer: mod.Player,
    deathType: mod.DeathType,
    weapon: mod.WeaponUnlock
): void {
    Events.OnPlayerDied.trigger(victim, killer, deathType, weapon);
}

export function OnPlayerEarnedKill(
    killer: mod.Player,
    victim: mod.Player,
    deathType: mod.DeathType,
    weapon: mod.WeaponUnlock
): void {
    Events.OnPlayerEarnedKill.trigger(killer, victim, deathType, weapon);
}

export function OnPlayerEarnedKillAssist(assistingPlayer: mod.Player, victim: mod.Player): void {
    Events.OnPlayerEarnedKillAssist.trigger(assistingPlayer, victim);
}

export function OnPlayerEmerged(player: mod.Player): void {
    Events.OnPlayerEmerged.trigger(player);
}

export function OnPlayerEnterAreaTrigger(player: mod.Player, areaTrigger: mod.AreaTrigger): void {
    Events.OnPlayerEnterAreaTrigger.trigger(player, areaTrigger);
}

export function OnPlayerEnterCapturePoint(player: mod.Player, capturePoint: mod.CapturePoint): void {
    Events.OnPlayerEnterCapturePoint.trigger(player, capturePoint);
}

export function OnPlayerEnteredWater(player: mod.Player): void {
    Events.OnPlayerEnteredWater.trigger(player);
}

export function OnPlayerEnterVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    Events.OnPlayerEnterVehicle.trigger(player, vehicle);
}

export function OnPlayerEnterVehicleSeat(player: mod.Player, vehicle: mod.Vehicle, seat: mod.Object): void {
    Events.OnPlayerEnterVehicleSeat.trigger(player, vehicle, seat);
}

export function OnPlayerEnterVL7Cloud(player: mod.Player, cloud: mod.VL7Cloud): void {
    Events.OnPlayerEnterVL7Cloud.trigger(player, cloud);
}

export function OnPlayerExitAreaTrigger(player: mod.Player, areaTrigger: mod.AreaTrigger): void {
    Events.OnPlayerExitAreaTrigger.trigger(player, areaTrigger);
}

export function OnPlayerExitCapturePoint(player: mod.Player, capturePoint: mod.CapturePoint): void {
    Events.OnPlayerExitCapturePoint.trigger(player, capturePoint);
}

export function OnPlayerExitedWater(player: mod.Player): void {
    Events.OnPlayerExitedWater.trigger(player);
}

export function OnPlayerExitVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    Events.OnPlayerExitVehicle.trigger(player, vehicle);
}

export function OnPlayerExitVehicleSeat(player: mod.Player, vehicle: mod.Vehicle, seat: mod.Object): void {
    Events.OnPlayerExitVehicleSeat.trigger(player, vehicle, seat);
}

export function OnPlayerExitVL7Cloud(player: mod.Player, cloud: mod.VL7Cloud): void {
    Events.OnPlayerExitVL7Cloud.trigger(player, cloud);
}

export function OnPlayerInteract(player: mod.Player, interactPoint: mod.InteractPoint): void {
    Events.OnPlayerInteract.trigger(player, interactPoint);
}

export function OnPlayerJoinGame(player: mod.Player): void {
    Events.OnPlayerJoinGame.trigger(player);
}

export function OnPlayerLeaveGame(playerId: number): void {
    Events.OnPlayerLeaveGame.trigger(playerId);
}

export function OnPlayerSubmerged(player: mod.Player): void {
    Events.OnPlayerSubmerged.trigger(player);
}

export function OnPlayerSwitchTeam(player: mod.Player, team: mod.Team): void {
    Events.OnPlayerSwitchTeam.trigger(player, team);
}

export function OnPlayerUIButtonEvent(
    player: mod.Player,
    uiWidget: mod.UIWidget,
    uiButtonEvent: mod.UIButtonEvent
): void {
    Events.OnPlayerUIButtonEvent.trigger(player, uiWidget, uiButtonEvent);
}

export function OnPlayerUndeploy(player: mod.Player): void {
    Events.OnPlayerUndeploy.trigger(player);
}

export function OnPortalGadgetAimStart(player: mod.Player): void {
    Events.OnPortalGadgetAimStart.trigger(player);
}

export function OnPortalGadgetAimStop(player: mod.Player): void {
    Events.OnPortalGadgetAimStop.trigger(player);
}

export function OnPortalGadgetFireStart(player: mod.Player): void {
    Events.OnPortalGadgetFireStart.trigger(player);
}

export function OnPortalGadgetFireStop(player: mod.Player): void {
    Events.OnPortalGadgetFireStop.trigger(player);
}

export function OnPortalGadgetLaserToggle(player: mod.Player, toggle: boolean): void {
    Events.OnPortalGadgetLaserToggle.trigger(player, toggle);
}

export function OnRayCastHit(player: mod.Player, point: mod.Vector, normal: mod.Vector): void {
    Events.OnRayCastHit.trigger(player, point, normal);
}

export function OnRayCastMissed(player: mod.Player): void {
    Events.OnRayCastMissed.trigger(player);
}

export function OnRevived(revivedPlayer: mod.Player, revivingPlayer: mod.Player): void {
    Events.OnRevived.trigger(revivedPlayer, revivingPlayer);
}

export function OnRingOfFireZoneSizeChange(ringOfFire: mod.RingOfFire, number: number): void {
    Events.OnRingOfFireZoneSizeChange.trigger(ringOfFire, number);
}

export function OnSpawnerSpawned(player: mod.Player, spawner: mod.Spawner): void {
    Events.OnSpawnerSpawned.trigger(player, spawner);
}

export function OnTimeLimitReached(): void {
    if (!mod.GetMatchTimeElapsed()) return; // Avoids a bug where this event is triggered by the server prematurely.

    Events.OnTimeLimitReached.trigger();
}

export function OnVehicleDestroyed(vehicle: mod.Vehicle): void {
    Events.OnVehicleDestroyed.trigger(vehicle);
}

export function OnVehicleSpawned(vehicle: mod.Vehicle): void {
    Events.OnVehicleSpawned.trigger(vehicle);
}
/* eslint-enable jsdoc/require-jsdoc */


// --- SOURCE: src\config.ts ---
export const PRESTIGE_STEP: number = 250;

// Debug-level logging is off by default. The hot paths (capture and turret
// ENTER/EXIT, nuke CAST/HIT, tint, paint, feed layout) concatenate their
// message at the call site, so leaving them on costs a string build per event
// even when nobody reads it. Flip to true to diagnose, then flip back.
export const LOG_DEBUG: boolean = false;
// Debug: every item on the buy menu WEAPONS tab costs 0 prestige, so the Rorsch
// and the other test weapons are always available. Set false for real matches.
export const WEAPONS_TAB_FREE: boolean = true;
export const POWER_MILESTONES: number[] = [50, 75, 100];
export const ART_BUDGET: number = 32;
export const SITE_LETTER: string[] = ["A", "B", "C"];

export const PRESTIGE_ON_DEPLOY: number = 0;

// Prestige paid per scoring action. Captures are split by what was taken so
// bunkers, energy points and factories are worth different amounts.
export const PRESTIGE_BUNKER: number = 150;
export const PRESTIGE_ENERGY: number = 200;
export const PRESTIGE_FACTORY: number = 250;
export const PRESTIGE_KILL: number = 50;
export const PRESTIGE_ASSIST: number = 25;

// DEFERRED - vehicle destruction is not scored. Tier 0 has no damager/killer
// accessor and no OnVehicleDamaged event, so the destroyer cannot be identified.
// The values below are held here so the decision and its numbers are recorded;
// they are intentionally not referenced by stats.ts.
export const PRESTIGE_VEHICLE: number = 100;

// Scoreboard score is tracked separately from prestige and is the primary
// sort column. It is not spendable.
export const SCORE_BUNKER: number = 150;
export const SCORE_ENERGY: number = 200;
export const SCORE_FACTORY: number = 250;
export const SCORE_KILL: number = 100;
export const SCORE_ASSIST: number = 50;
// DEFERRED - see PRESTIGE_VEHICLE.
export const SCORE_VEHICLE: number = 200;

export const CAPTURE_SECONDS: number = 20;
export const CAPTURE_TICK_HZ: number = 4;
export const CAPTURE_DECAY: number = 0.5;

export const BUNKER_CAPTURE_SECONDS: number = 20;
export const BUNKER_NEUTRALIZE_SECONDS: number = 10;
export const BUNKER_CAPTURE_MULTIPLIER: number = 3;

export const CHARGE_BASE_SECONDS: number = 300;
export const CHARGE_PER_SITE: number = 1.5;
export const CHARGE_REQUIRES_FACTORY: boolean = true;
export const CHARGE_UNLOCK_50: number = 50;
export const CHARGE_UNLOCK_100: number = 100;

export const TURRET_WARNING_SECS: number = 3;
export const TURRET_CLUSTER_REQ: number = 3;
export const TURRET_HIT_RADIUS_M: number = 12;
// Upright cylinder around each turret base for the Rorsch path test (RayCast
// passes through the AA turrets). Sized from the 17:38 playtest: shots aimed
// at a turret passed 2.3-6 m from its axis at 6-14 m above its base.
export const TURRET_RAY_RADIUS_M: number = 7;
export const TURRET_RAY_BELOW_M: number = 3;
export const TURRET_RAY_ABOVE_M: number = 16;

export const HQ_HIT_RADIUS_M: number = 100;
export const HQ_HITS_REQUIRED: number = 3;

export const RAY_MAX_DIST_M: number = 900;
// Push the ray origin past the soldier's own body so it cannot self-hit.
export const RAY_START_OFFSET_M: number = 2.5;
// Ignore impacts closer than this; they are the player's own geometry.
export const RAY_MIN_HIT_DIST_M: number = 3.0;
// The Rorsch shot is the moment IsFiring turns off after a full charge (see
// rorschshot.ts). Measured 2026-10-01: the discharge lands 2200-2212 ms after
// the press. A release shorter than this is a cancelled charge, no shot. Kept
// below the measured charge so tick jitter cannot drop a real shot.
export const RORSCH_MIN_CHARGE_MS: number = 2100;
// Diagnostic: log the active slot at each press, both IsReloading edges and
// every ray outcome while a player is in an HQ fire zone. One soldier-state read
// per tick per player in a fire zone. Set false once settled.
export const RORSCH_TRACE: boolean = true;
export const POWER_LEVEL_REQUIRED: number = 100;

// ---- Bots: custom AI_Spawner objective players (no UI, no buy, no nuke) ----
// Bots are spawned and maintained entirely by src/bots.ts. The AI_Spawner
// prefab carries no count or respawn property, so every number below is
// script-owned. All bot pathing is plain distance math over a static position
// cache in src/botobjectives.ts; the only per-sweep FFI is one GetPosition
// per processed bot plus a behavior call when its intent changes.
export const BOT_COUNT_PER_TEAM: number = 24;
// Dedicated 1 Hz sweep timer, separate from OngoingGlobal so bot thinking
// never competes with the per-frame HUD and charge work.
export const BOT_SWEEP_MS: number = 1000;
// Roster slice re-thought per sweep. 48 bots at 12 per sweep refresh fully
// every 4 sweeps; ownership changes force a full re-think (see bots.ts).
export const BOT_SLICE: number = 12;
// Spawn burst cap per sweep. Matches the 0.5 s stagger the official
// PortalPerformanceExample uses between SpawnAIFromAISpawner calls.
export const BOT_SPAWN_PER_SWEEP: number = 2;
export const BOT_RESPAWN_DELAY_MS: number = 5000;
// Corpse lifetime on the spawner before the engine unspawns the dead bot.
export const BOT_CORPSE_SECONDS: number = 3;
// Global damage bot -> human, applied once at mode start (AcePursuit pattern).
export const BOT_DAMAGE_MULT: number = 0.5;
// Per-bot damage taken, applied at spawn (ObliterationExample pattern).
export const BOT_INCOMING_DAMAGE: number = 0.5;
// Pathfinding radius cap. Source is TIER 2 CustomCQ README (500 m) -
// UNVERIFIED against PS_Isolated, tune after the first playtest.
export const BOT_MAX_PATH_M: number = 500;
// Arrival radius: inside this the bot is treated as on the objective and the
// capture system takes over, no further MoveTo needed.
export const BOT_ARRIVE_M: number = 8;
// Failed MoveTo handling: defend-in-place retries before re-picking.
export const BOT_RETRY_LIMIT: number = 2;
export const BOT_FAIL_COOLDOWN_MS: number = 15000;
// Zero means issue a behavior only when the intent changes (dirty-check).
// Raised from 0 to 8: with a pure dirty-check a bot whose behavior silently
// expired never re-issued anything and wedged in place permanently.
export const BOT_REISSUE_SWEEPS: number = 8;
// Defend leash around the objective anchor, and hold radius when owned-safe.
export const BOT_DEFEND_MIN_M: number = 5;
export const BOT_DEFEND_MAX_M: number = 25;
export const BOT_HOLD_RADIUS_M: number = 30;
// Beyond this distance the bot Sprints to its attack target, else runs.
export const BOT_SPRINT_DIST_M: number = 30;

// Stuck recovery. A bot that has moved less than BOT_STUCK_MIN_M over
// BOT_STUCK_WINDOW_SWEEPS consecutive thinks is wedged: either it is against a
// wall it cannot path around, or the behavior it was given expired without the
// engine reporting a move failure. It is first re-issued toward a different
// objective; after BOT_STUCK_STRIKES it is killed outright, which recycles it
// through the normal death and respawn path and puts it back at a spawner
// instead of leaving it parked in a corner.
export const BOT_STUCK_MIN_M: number = 4;
export const BOT_STUCK_WINDOW_SWEEPS: number = 6;
export const BOT_STUCK_STRIKES: number = 3;

// Spread, so 24 bots do not all converge on one identical point and shove each
// other off it. Each bot nudges its own target by up to this radius, seeded from
// its player id so the offset is stable across sweeps.
export const BOT_SPREAD_M: number = 18;
// How strongly a bot avoids an already-crowded objective. Expressed in metres
// and squared-distance weighted in pickObjective: each bot already standing on
// a point counts as this much extra distance, so the 13th bot walks to the next
// point instead of piling onto the 12 that are there.
export const BOT_CROWD_PENALTY_M: number = 22;

// Role split. A bot whose player id mod BOT_ROLE_MOD equals its team id is a
// dedicated factory guard, which for a 24 bot team is 4 of every 6 ids - so
// roughly the 3-4 guards per team asked for, with no extra spawn pass. Ids are
// stable for a soldier's whole life, so a guard stays a guard instead of
// flipping roles between sweeps.
export const BOT_ROLE_MOD: number = 6;

// Roaming. A bot that reached a safely-held objective used to sit on it for the
// rest of the match. Every BOT_ROAM_MS it is told to relocate to a different
// objective, which is what CustomConquest V15 AI_Scouting does: move to another
// CapturePoint in range and defend it, so the team circulates instead of
// stacking on one flag.
export const BOT_ROAM_MS: number = 22000;

// Reactive defence. botobjectives.pickDefendObjective considers owned objectives
// with enemies inside this radius, and sends a bot across when a point is
// under-defended. The pressure count itself comes from PlayerLocations, which
// answers it from cached positions at no FFI cost, so this radius is the only
// tuning knob.
export const BOT_THREAT_REACH_M: number = 220;

// Vehicles. mod.AllVehicles() is a list FFI, so the candidate scan runs once
// per BOT_VEHICLE_SCAN_MS for the whole team instead of once per bot per sweep.
// Only bots whose id mod BOT_VEHICLE_MOD equals their team try to board, and
// only a vehicle with fewer than BOT_VEHICLE_FREE_SEATS occupants is taken, so
// a parked tank is not stripped by every bot in the area at once.
export const BOT_VEHICLE_SCAN_MS: number = 3000;
export const BOT_VEHICLE_RADIUS_M: number = 60;
export const BOT_VEHICLE_MOD: number = 4;
export const BOT_VEHICLE_FREE_SEATS: number = 2;

// Radius used to spot vehicles already parked on a factory's spawner slots.
export const VEHICLE_SLOT_RADIUS_M: number = 25;
// A VehicleSpawner refuses to spawn while it still holds a vehicle, so a
// second purchase of the same type needs a free slot or it is refused.
export const VEHICLE_NO_SLOT_FEED: string = "shopNoSlot";


// --- SOURCE: src\util\log.ts ---




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


// --- SOURCE: node_modules\bf6-portal-utils\performance-stats\index.ts ---




// version: 2.1.0
export namespace PerformanceStats {
    const logging = new Logging('PS');

    /**
     * A re-export of the `Logging.LogLevel` enum.
     */
    export const LogLevel = Logging.LogLevel;

    /**
     * Attaches a logger and defines a minimum log level and whether to attempt to append a string form of the error to
     * the text of the log message.
     * @param log - The logger function: `(formattedText, error?) => void | Promise<void>`. `error` is the same value
     *              passed to `log()` (if any), for inspection (e.g. `instanceof Error`, `stack`). `formattedText` may
     *              also include ` - Error: …` when `includeRawError` is true.
     * @param logLevel - The minimum log level to use.
     * @param includeRawError - When true and `log()` receives an error, attempts to append a string form of the error
     *                          to the text of the log message.
     */
    export function setLogging(
        log?: (text: string, error?: unknown) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeRawError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeRawError);
    }

    const TARGET_HZ = 30;
    const TARGET_DELTA_MS = 1_000 / TARGET_HZ; // ~33.33ms if TARGET_HZ is 30.
    const SAMPLE_RATE_MS = 1_000;
    const SMOOTHING_FACTOR = 0.3; // 0.0 to 1.0 (Lower = smoother, Higher = more responsive)

    // Spot State (Updated every tick)
    let lastTickTime = 0;
    let lastTickDeltaMs = TARGET_DELTA_MS;

    // Window State (Updated every second)
    let tickCount = 0;
    let lastWindowTime = 0;

    // Smoothed Output State (For UI)
    let smoothedTickRate = TARGET_HZ;
    let smoothedTimeoutLagMs = 0;

    function getSmoothedValue(spotValue: number, currentSmoothedValue: number): number {
        return spotValue * SMOOTHING_FACTOR + currentSmoothedValue * (1 - SMOOTHING_FACTOR);
    }

    /**
     * The core timeout lag measurement loop for UI and logging.
     */
    function measureTimeoutLag(): void {
        const now = Date.now();
        const deltaMs = now - lastWindowTime;

        if (deltaMs <= 0) return;

        // Calculate average spot metrics for this specific window.
        const rawTickRate = (tickCount / deltaMs) * 1_000;
        const timeoutLagMs = Math.max(0, now - (lastWindowTime + SAMPLE_RATE_MS)); // How late timer woke up.

        // Apply exponential moving average (EMA) for UI stability.
        smoothedTickRate = getSmoothedValue(rawTickRate, smoothedTickRate);
        smoothedTimeoutLagMs = getSmoothedValue(timeoutLagMs, smoothedTimeoutLagMs);

        // Instant spike logging with log-level guard to eliminate string allocations.
        if (logging.willLog(LogLevel.Warning)) {
            if (timeoutLagMs > 100) {
                logging.log(`Timeout lag spike: +${~~timeoutLagMs}ms over`, LogLevel.Warning);
            }

            if (rawTickRate < 25) {
                logging.log(`Tick rate dropped: ${~~rawTickRate}Hz`, LogLevel.Warning);
            }
        }

        // Reset for next window.
        tickCount = 0;
        lastWindowTime = now;
    }

    /**
     * The per-tick tracker for scaling and counting.
     */
    function trackTick(): void {
        const now = Date.now();

        // Update Spot Math for compute scaling.
        lastTickDeltaMs = now - lastTickTime;
        lastTickTime = now;

        // Accumulate ticks for the window loop.
        ++tickCount;
    }

    function startTrackingTicks(): void {
        unsubscribe();

        // Subscribed to OnTickStart at priority Normal (0) to record timestamps at the very beginning of the frame
        // for accurate inter-tick delta and server load calculations.
        Events.OnTickStart.subscribe(trackTick, Events.EventPriority.First);

        // Kick off the macro measurement loop using a persistent interval.
        lastWindowTime = lastTickTime = Date.now();
        Timers.setInterval(measureTimeoutLag, SAMPLE_RATE_MS);

        if (logging.willLog(LogLevel.Info)) {
            logging.log('Monitoring started', LogLevel.Info);
        }
    }

    const unsubscribe = Events.OnGameModeStarted.subscribe(startTrackingTicks, Events.EventPriority.First);

    /**
     * @returns The smoothed tick rate. Good/stable for UI display.
     */
    export function getSmoothedTickRate(): number {
        return smoothedTickRate;
    }

    /**
     * @returns The smoothed lag time. Good/stable for UI display.
     */
    export function getSmoothedTimeoutLagMs(): number {
        return smoothedTimeoutLagMs;
    }

    /**
     * Returns the value that is somewhat analogous to SFT when above 33ms.
     * @returns The raw delta time between the last two ticks. Good for compute scaling.
     */
    export function getSpotDeltaMs(): number {
        return lastTickDeltaMs;
    }

    /**
     * Returns the value that is analogous to STR.
     * @returns The tick rate in Hz. Good for compute scaling.
     */
    export function getSpotTickRate(): number {
        return TARGET_DELTA_MS / Math.max(1, lastTickDeltaMs);
    }

    /**
     * @returns A normalized health factor from 0.0 to 1.0. Good for compute scaling.
     * 1.0 = Perfect 30Hz performance.
     * < 1.0 = Engine is bogged down, scale your compute back.
     */
    export function getSpotHealthFactor(): number {
        // Cap at 1.0 so a randomly fast tick doesn't cause logic to scale > 100%
        return Math.min(1.0, getSpotTickRate());
    }
}


// --- SOURCE: src\util\perf.ts ---



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
// dt: onOngoingGlobal now drives the charge tick from spotDeltaMs() (clamped
// to 1/240..1/10 s), so CHARGE_BASE_SECONDS is real seconds. Constants still
// counted in frames (COOLDOWN_FRAMES, frameNo % 30, feed TTLs) follow the
// engine's ~30 Hz tick, not 60.

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


// --- SOURCE: src\util\names.ts ---
// Widget naming + handle cache.
//
// Every widget this mod creates is registered here at creation time, together
// with the handle that the creation helper just resolved. Two consumers:
//
//   tNames/pNames  ordered per-owner lists, used to tear widgets down in reverse
//                  creation order (children before parents).
//   byName         flat name -> handle map, so repaint/hover/layout paths read a
//                  JS property instead of paying mod.FindUIWidgetWithName.
//
// The map is authoritative and must be updated on EVERY delete, not just on
// teardown: a cached handle for a destroyed widget stays truthy, whereas
// FindUIWidgetWithName would have returned falsy and the caller would skip the
// write. Forget the name at the same time the widget is deleted.

export interface PshRef {
    n: string;
    w: mod.UIWidget;
    // Tab index this widget belongs to, or -1 for the menu shell. Set so a tab
    // panel teardown can drop exactly its own descendants from the menu list.
    tab?: number;
}

export const tNames: { [t: number]: PshRef[] } = {};
export const pNames: { [id: number]: PshRef[] } = {};

// Widgets created while a buy menu is being built, split out from the persistent
// HUD so closing the menu can delete the menu without touching the HUD.
export const pMenuNames: { [id: number]: PshRef[] } = {};
// A separate flag, NOT a sentinel id. Player ObjIds start at 0, so a "no build"
// sentinel of 0 matched the real player 0 and silently filed that player's
// entire HUD as menu widgets - dropMenu then deleted the prestige ring the
// first time the menu closed. A boolean cannot collide with any id.
let inMenuBuild: boolean = false;
let menuBuildOwner: number = 0;
let menuBuildTab: number = -1;

// Called around the buy-menu and tab-row build functions. Synchronous, so plain
// markers are enough; trackP files widgets under the menu list while they are
// set, tagged with the tab they belong to.
export function beginMenuBuild(id: number, tab: number = -1): void {
    inMenuBuild = true;
    menuBuildOwner = id;
    menuBuildTab = tab;
}

export function endMenuBuild(): void {
    inMenuBuild = false;
    menuBuildOwner = 0;
    menuBuildTab = -1;
}

const byName: { [n: string]: mod.UIWidget } = {};

export function tn(team: number, s: string): string {
    return "pst" + team + "_" + s;
}

export function pn(id: number, s: string): string {
    return "psh" + id + "_" + s;
}

export function trackT(team: number, name: string, w: mod.UIWidget): void {
    if (!tNames[team]) {
        tNames[team] = [];
    }
    tNames[team].push({ n: name, w: w });
    byName[name] = w;
}

export function trackP(id: number, name: string, w: mod.UIWidget): void {
    if (!pNames[id]) {
        pNames[id] = [];
    }
    pNames[id].push({ n: name, w: w });
    if (inMenuBuild && menuBuildOwner === id) {
        if (!pMenuNames[id]) {
            pMenuNames[id] = [];
        }
        pMenuNames[id].push({ n: name, w: w, tab: menuBuildTab });
    }
    byName[name] = w;
}

// Cached widget lookup. Falls back to a real search when a name is not
// registered, which keeps behaviour identical to the old Find-only code if a
// future creation path forgets to register (that costs one FFI, not a bug).
export function W(name: string): any {
    const hit: mod.UIWidget = byName[name];
    if (hit !== undefined) {
        return hit;
    }
    return mod.FindUIWidgetWithName(name);
}

// Drop a name from the cache. Call whenever the widget is deleted.
export function forget(name: string): void {
    delete byName[name];
}

// Drop every name starting with prefix. Used after deleting a parent container,
// where the engine may or may not have destroyed the children with it.
export function forgetPrefix(prefix: string): void {
    for (const k of Object.keys(byName)) {
        if (k.lastIndexOf(prefix, 0) === 0) {
            delete byName[k];
        }
    }
}

// Delete a player's menu widgets in reverse creation order, unregistering each
// one so no cached handle survives. Returns how many were deleted.
export function dropMenu(id: number): number {
    const refs: PshRef[] = pMenuNames[id] || [];
    let gone: number = 0;
    for (let i: number = refs.length - 1; i >= 0; i--) {
        try {
            if (refs[i].w) {
                mod.DeleteUIWidget(refs[i].w);
                gone++;
            }
        } catch (e) {
            // Already gone; the unregister below still has to happen.
        }
        delete byName[refs[i].n];
    }
    pMenuNames[id] = [];
    return gone;
}

// Forget the tracked refs for one tab without deleting anything. Called after a
// tab panel container is deleted, which takes its children with it, so the refs
// must not be left behind to accumulate on every page or tab switch.
export function forgetMenuTab(id: number, tab: number): void {
    const refs: PshRef[] = pMenuNames[id];
    if (refs === undefined) {
        return;
    }
    const keep: PshRef[] = [];
    for (let i: number = 0; i < refs.length; i++) {
        if (refs[i].tab === tab) {
            delete byName[refs[i].n];
        } else {
            keep.push(refs[i]);
        }
    }
    pMenuNames[id] = keep;
}


// --- SOURCE: src\util\vec.ts ---
export function v(x: number, y: number, z: number): mod.Vector {
    return mod.CreateVector(x, y, z);
}


// --- SOURCE: src\ui\palette.ts ---
export const C_BLUE: mod.Vector = mod.CreateVector(0.3, 0.8, 1.0);
export const C_RED: mod.Vector = mod.CreateVector(1.0, 0.28, 0.28);
export const C_GOLD: mod.Vector = mod.CreateVector(1.0, 0.78, 0.28);
export const C_PLAT: mod.Vector = mod.CreateVector(0.79, 0.81, 0.84);
export const C_DARK: mod.Vector = mod.CreateVector(0.22, 0.26, 0.29);
export const C_BLACK: mod.Vector = mod.CreateVector(0.0, 0.0, 0.0);

export const FEED_WHITE: mod.Vector = mod.CreateVector(0.9, 0.93, 0.95);
export const FEED_RED: mod.Vector = mod.CreateVector(0.95, 0.26, 0.2);
export const FEED_YEL: mod.Vector = mod.CreateVector(0.95, 0.85, 0.3);
export const FEED_GRN: mod.Vector = mod.CreateVector(0.45, 0.9, 0.5);
export const FEED_BLU: mod.Vector = mod.CreateVector(0.45, 0.72, 1.0);

export const MENU_BG: mod.Vector = mod.CreateVector(0.028, 0.055, 0.032);
export const MENU_EDGE: mod.Vector = mod.CreateVector(0.35, 0.45, 0.28);
export const MENU_TITLE: mod.Vector = mod.CreateVector(0.86, 0.9, 0.82);
export const MENU_COST: mod.Vector = mod.CreateVector(0.85, 0.8, 0.25);
export const MENU_LOCKTXT: mod.Vector = mod.CreateVector(0.45, 0.5, 0.45);
export const MENU_HEAD: mod.Vector = mod.CreateVector(0.1, 0.16, 0.09);

export const MENU_TXT: mod.Vector = mod.CreateVector(0.85, 0.96, 0.78);

export const MENU_ORANGE_SEL: mod.Vector = mod.CreateVector(0.96, 0.71, 0.26);

export const MENU_ORANGE_HOVER: mod.Vector = mod.CreateVector(1.0, 0.56, 0.14);

export const MENU_HOVER: mod.Vector = mod.CreateVector(0.35, 0.48, 0.24);
export const MENU_PRESS: mod.Vector = mod.CreateVector(0.22, 0.32, 0.15);

export const MENU_TAB_PRESS: mod.Vector = MENU_ORANGE_SEL;
export const MENU_TAB_HOVER: mod.Vector = MENU_ORANGE_HOVER;

export const P_RING: mod.Vector = mod.CreateVector(0.45, 0.63, 0.34);

export function colorFor(me: number, team: number): mod.Vector {
    if (team === me) {
        return C_BLUE;
    }
    if (team === 0) {
        return C_DARK;
    }
    return C_RED;
}

// lighten used to cost 3 X/Y/ZComponentOf FFI plus a CreateVector on every call,
// and it runs inside the tint commit path. The palette is a fixed set of known
// constants, so each lightened variant is built once here and the FFI is paid at
// module load instead of per repaint. Compared by identity, so no Map or keyed
// lookup is needed.
const LIFT: number = 0.32;

function liftOf(x: number, y: number, z: number): mod.Vector {
    return mod.CreateVector(
        Math.min(1, x + LIFT),
        Math.min(1, y + LIFT),
        Math.min(1, z + LIFT)
    );
}

const C_BLUE_L: mod.Vector = liftOf(0.3, 0.8, 1.0);
const C_RED_L: mod.Vector = liftOf(1.0, 0.28, 0.28);
const C_DARK_L: mod.Vector = liftOf(0.22, 0.26, 0.29);
const C_GOLD_L: mod.Vector = liftOf(1.0, 0.78, 0.28);
const C_PLAT_L: mod.Vector = liftOf(0.79, 0.81, 0.84);
const C_BLACK_L: mod.Vector = liftOf(0.0, 0.0, 0.0);

export function lighten(c: mod.Vector): mod.Vector {
    if (c === C_BLUE) {
        return C_BLUE_L;
    }
    if (c === C_RED) {
        return C_RED_L;
    }
    if (c === C_DARK) {
        return C_DARK_L;
    }
    if (c === C_GOLD) {
        return C_GOLD_L;
    }
    if (c === C_PLAT) {
        return C_PLAT_L;
    }
    if (c === C_BLACK) {
        return C_BLACK_L;
    }
    // Not a palette constant: rare and off the repaint path, so pay the FFI read
    // rather than risk returning the wrong colour.
    return mod.CreateVector(
        Math.min(1, mod.XComponentOf(c) + LIFT),
        Math.min(1, mod.YComponentOf(c) + LIFT),
        Math.min(1, mod.ZComponentOf(c) + LIFT)
    );
}


// --- SOURCE: src\state.ts ---
export const baseVal: { [t: number]: number } = { 1: 100, 2: 100 };
export let protoOwner: number = 0;
export const dbgMe: { [id: number]: number } = {};
export const siteState: { [t: number]: number[] } = {};
export const pPrestige: { [id: number]: number } = {};
// Monotonic banked charge, 0-100. Advanced by the global tick in factory.ts
// and only ever increases; losing sites stops the rate but never refunds it.
// This single value drives the HUD power bar and the nuke unlock check.
export const powerVal: { [t: number]: number } = { 1: 0, 2: 0 };

export function nukeReady(team: number): boolean {
    return powerVal[team] >= 100;
}

export function setProtoOwner(owner: number): void {
    protoOwner = owner;
}

export function getProtoOwner(): number {
    return protoOwner;
}

export function resetRoundState(): void {
    baseVal[1] = 100;
    baseVal[2] = 100;
    powerVal[1] = 0;
    powerVal[2] = 0;
    setProtoOwner(0);
    delete siteState[1];
    delete siteState[2];
    for (const id of Object.keys(pPrestige)) {
        delete pPrestige[Number(id)];
    }
}

export function playerIdOf(id: number): number {
    return id;
}


// --- SOURCE: src\teams.ts ---


// Portal teams are addressed 1 and 2 (NATO and PAX). mod.GetTeam takes the team
// id, not a zero-based index - the previous GetTeam(0)/GetTeam(1) pair was wrong,
// though dormant because these handles were never resolved.
let teamOne: mod.Team | undefined;
let teamTwo: mod.Team | undefined;

export function initTeams(): void {
    resolve(1);
    resolve(2);
    if (teamOne === undefined || teamTwo === undefined) {
        log("teams", "WARNING - could not resolve both team handles");
        return;
    }
    log("teams", "resolved t1=" + String(mod.GetObjId(teamOne))
        + " t2=" + String(mod.GetObjId(teamTwo)));
}

function resolve(n: number): void {
    try {
        const t: mod.Team = mod.GetTeam(n);
        if (!mod.IsValid(t)) {
            return;
        }
        if (n === 1) {
            teamOne = t;
        } else if (n === 2) {
            teamTwo = t;
        }
    } catch (e) {
        log("teams", "team " + n + " handle unavailable");
    }
}

export function teamNumOf(t: mod.Team): number {
    return mod.GetObjId(t);
}

export function foeOf(team: number): number {
    return team === 1 ? 2 : team === 2 ? 1 : 0;
}

export function teamHandle(n: number): mod.Team | undefined {
    if (n === 1) {
        return teamOne;
    }
    if (n === 2) {
        return teamTwo;
    }
    return undefined;
}

// teamIdOf and isConfiguredTeam deliberately do NOT live here. They are owned
// by util/roster, the single source of truth for team predicates, so import
// them from there instead.
//
// Two bundler traps are now recorded here after they cost this module:
//   1. Do not re-export from this file. The Portal bundler cannot resolve a
//      pure re-export and drops the whole module.
//   2. Do not put a backtick inside a comment. The bundler's strip-comments
//      pass mangles the line and swallows everything after it, which deleted
//      every function below and shipped a bundle full of 'Cannot find name'
//      errors that tsc cannot catch, because tsc resolves both fine.
// npm run build now type-checks the emitted bundle to catch that class of bug.


// --- SOURCE: src\audio.ts ---




const cache: { [key: string]: mod.SFX } = {};

export type SfxKey =
    | "primary" | "buy" | "close" | "deny"
    | "capStart" | "capStartEnemy" | "capTick" | "capTickEnemy"
    | "capDone" | "capDoneEnemy" | "capNeutralize" | "capContested"
    | "siteYours" | "siteLost" | "siteFoe"
    | "nukeReady" | "nukeFire" | "turretDown" | "losOpen" | "killZone" | "hqHit";

const ASSETS: { [k: string]: mod.RuntimeSpawn_Common } = {
    primary: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_PrimarySelect_OneShot2D,
    buy: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ClickSelectLoadout_OneShot2D,
    close: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_GoBack_OneShot2D,
    deny: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_ZoomBlocked_OneShot2D,

    capStart: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureStartedByFriendly_OneShot2D,
    capStartEnemy: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureStartedByEnemy_OneShot2D,
    capTick: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickFriendly_OneShot2D,
    capTickEnemy: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickEnemy_OneShot2D,
    capDone: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinFriendly_OneShot2D,
    capDoneEnemy: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinEnemy_OneShot2D,
    capNeutralize: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureNeutralize_OneShot2D,
    capContested: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinThump_OneShot2D,

    siteYours: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_AreaUnlock_OneShot2D,
    siteLost: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureNeutralize_OneShot2D,
    siteFoe: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinEnemy_OneShot2D,

    nukeReady: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_AreaUnlock_OneShot2D,
    nukeFire: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DeathWarning_SimpleLoop2D,
    turretDown: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_Wreckage_BombBeeping_OneShot3D,
    losOpen: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinNeutral_OneShot2D,
    killZone: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_RetrievalBeaconBeep_OneShot3D,
    hqHit: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DeathWarning_SimpleLoop3D
};

function sfxFor(key: SfxKey): mod.SFX | undefined {
    let s: mod.SFX | undefined = cache[key];
    if (s !== undefined) {
        return s;
    }
    const asset: mod.RuntimeSpawn_Common | undefined = ASSETS[key];
    if (asset === undefined) {
        return undefined;
    }
    try {
        s = mod.SpawnObject(asset, v(0, 0, 0), v(0, 0, 0)) as mod.SFX;
        cache[key] = s;
    } catch (e) {
        log("sfx", "spawn failed for " + key);
        return undefined;
    }
    return s;
}

export function playSfxPlayer(key: SfxKey, p: mod.Player, amp: number): void {
    const s: mod.SFX | undefined = sfxFor(key);
    if (s === undefined) {
        return;
    }
    try {
        mod.PlaySound(s, amp, p);
    } catch (e) {
    }
}

export function playSfxTeam(key: SfxKey, teamId: number, amp: number): void {
    const s: mod.SFX | undefined = sfxFor(key);
    if (s === undefined) {
        return;
    }
    // teamHandle, not mod.GetTeam: GetTeam takes the team id itself, so the old
    // GetTeam(teamId - 1) asked for team 0 when routing to team 1 and for team 1
    // when routing to team 2. Every call threw inside the catch and was silently
    // dropped, so all team-routed sounds were inaudible.
    const t: mod.Team | undefined = teamHandle(teamId);
    if (t === undefined) {
        return;
    }
    try {
        mod.PlaySound(s, amp, t);
    } catch (e) {
    }
}

export function playSfxAll(key: SfxKey, amp: number): void {
    const s: mod.SFX | undefined = sfxFor(key);
    if (s === undefined) {
        return;
    }
    try {
        mod.PlaySound(s, amp);
    } catch (e) {
    }
}


// --- SOURCE: src\objids.ts ---
export interface TurretDef {
    emplId: number;
    zoneId: number;
    vfxId: number;
    base: 1 | 2;
    cluster: number;
    yOffset: number;
}

export interface AreaBuildingDef {
    id: string;
    kind: "energy" | "proto" | "war" | "air" | "naval";
    areaTriggerId: number;
    worldIconId: number;
    vehicleSpawnerId: number;
    vehicleSpawnerIds: number[];
    factoryName: string;
}

export interface BunkerDef {
    id: string;
    capturePointId: number;
    worldIconId: number;
}

export const BUNKERS: BunkerDef[] = [
    { id: "bunker1", capturePointId: 1000, worldIconId: 1100 },
    { id: "bunker2", capturePointId: 1001, worldIconId: 1101 },
    { id: "bunker3", capturePointId: 1002, worldIconId: 1102 }
];

export const ENERGY_SITES: AreaBuildingDef[] = [
    { id: "site1", kind: "energy", areaTriggerId: 2000, worldIconId: 2100, vehicleSpawnerId: 0, vehicleSpawnerIds: [], factoryName: "Energy Site 1" },
    { id: "site2", kind: "energy", areaTriggerId: 2001, worldIconId: 2101, vehicleSpawnerId: 0, vehicleSpawnerIds: [], factoryName: "Energy Site 2" },
    { id: "site3", kind: "energy", areaTriggerId: 2002, worldIconId: 2102, vehicleSpawnerId: 0, vehicleSpawnerIds: [], factoryName: "Energy Site 3" }
];

export const PROTO_FACTORY: AreaBuildingDef[] = [
    { id: "proto1", kind: "proto", areaTriggerId: 3000, worldIconId: 3100, vehicleSpawnerId: 0, vehicleSpawnerIds: [], factoryName: "Prototype Factory" }
];

export const WAR_FACTORY: AreaBuildingDef[] = [
    { id: "war1", kind: "war", areaTriggerId: 4000, worldIconId: 4100, vehicleSpawnerId: 4200, vehicleSpawnerIds: [4200, 4201, 4202], factoryName: "War Factory 1" },
    { id: "war2", kind: "war", areaTriggerId: 4001, worldIconId: 4101, vehicleSpawnerId: 4203, vehicleSpawnerIds: [4203, 4204, 4205], factoryName: "War Factory 2" }
];

export const AIR_FACTORY: AreaBuildingDef[] = [
    { id: "air1", kind: "air", areaTriggerId: 5000, worldIconId: 5100, vehicleSpawnerId: 5200, vehicleSpawnerIds: [5200, 5201, 5202], factoryName: "Aviation Factory" }
];

export const NAVAL_FACTORY: AreaBuildingDef[] = [
    { id: "naval1", kind: "naval", areaTriggerId: 6000, worldIconId: 6100, vehicleSpawnerId: 6200, vehicleSpawnerIds: [6200, 6201], factoryName: "Naval Factory 1" },
    { id: "naval2", kind: "naval", areaTriggerId: 6001, worldIconId: 6101, vehicleSpawnerId: 6202, vehicleSpawnerIds: [6202, 6203], factoryName: "Naval Factory 2" }
];

export const TURRETS: TurretDef[] = [
    { emplId: 7000, zoneId: 7100, vfxId: 7200, base: 1, cluster: 0, yOffset: 15.267723 },
    { emplId: 7001, zoneId: 7101, vfxId: 7201, base: 1, cluster: 0, yOffset: 15.267723 },
    { emplId: 7002, zoneId: 7102, vfxId: 7202, base: 1, cluster: 0, yOffset: 15.267723 },
    { emplId: 7003, zoneId: 7103, vfxId: 7203, base: 1, cluster: 0, yOffset: 15.267723 },
    { emplId: 7004, zoneId: 7104, vfxId: 7204, base: 2, cluster: 1, yOffset: 15.267723 },
    { emplId: 7005, zoneId: 7105, vfxId: 7205, base: 2, cluster: 1, yOffset: 15.267723 },
    { emplId: 7006, zoneId: 7106, vfxId: 7206, base: 2, cluster: 1, yOffset: 15.267723 },
    { emplId: 7007, zoneId: 7107, vfxId: 7207, base: 2, cluster: 1, yOffset: 15.267723 }
];

export const HQ_TARGETS: number[] = [7300, 7301];
export const HQ_EXPLOSION: number[] = [7400, 7401];
export const HQ_GATES: number[] = [7500, 7501];
export const HQ_OBJIDS: number[] = [1, 2];

export const DEFERRED_SLOTS: { what: string; note: string }[] = [
];

export function isConfigured(objId: number): boolean {
    return objId > 0;
}

export interface AiSpawnerDef {
    spawnerId: number;
    team: 1 | 2;
}

// 8000-8099: AI_SPAWNERS for the custom bot population. The AI_Spawner prefab
// exposes only ObjId and AlternateSpawns in Godot - team, class mix, count
// and respawn are all script-owned in src/bots.ts. Two spawners per team so a
// single spawner position never funnels all 24 bots through one doorway.
// Reserve the whole 8000 block for future spawner slots.
//
// No extra spawners are needed at the bunkers. Following CustomConquest V15's
// AI_ObjectiveSpawn, bots that spawn onto a friendly objective are moved there
// with mod.Teleport against the objective's cached position, rather than
// requiring an AI_Spawner object per bunker.
export const AI_SPAWNERS: AiSpawnerDef[] = [
    { spawnerId: 8000, team: 1 },
    { spawnerId: 8001, team: 1 },
    { spawnerId: 8010, team: 2 },
    { spawnerId: 8011, team: 2 }
];

export function allAreaBuildings(): AreaBuildingDef[] {
    return ENERGY_SITES.concat(PROTO_FACTORY, WAR_FACTORY, AIR_FACTORY, NAVAL_FACTORY);
}

export function factoryBuildings(): AreaBuildingDef[] {
    return PROTO_FACTORY.concat(WAR_FACTORY, AIR_FACTORY, NAVAL_FACTORY);
}

export function buildingDefById(id: string): AreaBuildingDef | undefined {
    for (const a of allAreaBuildings()) {
        if (a.id === id) {
            return a;
        }
    }
    return undefined;
}


// --- SOURCE: src\util\roster.ts ---
// Portal's mod.Array is opaque: it has no length, no map and no spread, so every
// traversal must go through mod.CountOf / mod.ValueInArray. These helpers mirror
// the sanctioned official SDK runtime helpers in
// main_resources/modlib_original/index.ts (ConvertArray, FilteredArray,
// getTeamId, getPlayersInTeam) and are the only place in this project that is
// allowed to hand-roll the opaque-array walk.



// Tier 0: OnPlayerSwitchTeam(eventPlayer, eventTeam) is "This will trigger when a
// Player changes team", which is the only way teamIdOf can go stale.
Events.OnPlayerSwitchTeam.subscribe((p: mod.Player) => {
    try {
        forgetTeamCache(mod.GetObjId(p));
    } catch (e) {
    }
});

export function convertArray(array: mod.Array): any[] {
    const out: any[] = [];
    const n: number = mod.CountOf(array);
    for (let i: number = 0; i < n; i++) {
        out.push(mod.ValueInArray(array, i));
    }
    return out;
}

export function filteredArray(array: mod.Array, cond: (element: any) => boolean): mod.Array {
    let out: mod.Array = mod.EmptyArray();
    const n: number = mod.CountOf(array);
    for (let i: number = 0; i < n; i++) {
        const e: any = mod.ValueInArray(array, i);
        if (cond(e)) {
            mod.AppendToArray(out, e);
        }
    }
    return out;
}

// teamIdOf was two FFI calls (GetTeam then GetObjId) inside a try/catch, and it
// is called from every combat filter, every award, and every zone enter/exit.
// A player's team only changes on OnPlayerSwitchTeam, so it is cached and the
// cache is invalidated by that event.
const teamCache: { [pid: number]: number } = {};

export function teamIdOf(p: mod.Player): number {
    if (!mod.IsValid(p)) {
        return 0;
    }
    const pid: number = mod.GetObjId(p);
    const cached: number | undefined = teamCache[pid];
    if (cached !== undefined) {
        return cached;
    }
    let team: number = 0;
    try {
        team = mod.GetObjId(mod.GetTeam(p));
    } catch (e) {
        team = 0;
    }
    teamCache[pid] = team;
    return team;
}

export function forgetTeamCache(pid: number): void {
    delete teamCache[pid];
}

// True only for a genuine 1 <-> 2 matchup. Returns false for an unknown team so
// an unresolved team can never be treated as an enemy.
export function isEnemyTeam(a: number, b: number): boolean {
    if (!isConfiguredTeam(a) || !isConfiguredTeam(b)) {
        return false;
    }
    return a !== b;
}

export function isConfiguredTeam(n: number): boolean {
    return n === 1 || n === 2;
}

export function allPlayers(): mod.Player[] {
    let array: mod.Array = mod.EmptyArray();
    try {
        array = mod.AllPlayers();
    } catch (e) {
        return [];
    }
    const out: mod.Player[] = [];
    const n: number = mod.CountOf(array);
    for (let i: number = 0; i < n; i++) {
        const p: mod.Player = mod.ValueInArray(array, i) as mod.Player;
        if (mod.IsValid(p)) {
            out.push(p);
        }
    }
    return out;
}

// AreaTriggers track occupants as ObjIds, so the capture payout resolves them
// through mod.GetPlayer. Ids that no longer resolve are dropped rather than
// passed on as an invalid handle.
export function playersFromIds(ids: number[]): mod.Player[] {
    const out: mod.Player[] = [];
    for (const id of ids) {
        try {
            const p: mod.Player = mod.GetPlayer(id);
            if (mod.IsValid(p)) {
                out.push(p);
            }
        } catch (e) {
        }
    }
    return out;
}

// CapturePoints report their own occupants. The result contains BOTH teams, so
// callers filter to the capturing team, exactly as CustomConquest V15 does with
// mod.GetPlayersOnPoint plus a modlib.FilteredArray team comparison.
export function playersOnCapturePoint(cp: mod.CapturePoint): mod.Player[] {
    const out: mod.Player[] = [];
    let array: mod.Array;
    try {
        array = mod.GetPlayersOnPoint(cp);
    } catch (e) {
        return out;
    }
    const n: number = mod.CountOf(array);
    for (let i: number = 0; i < n; i++) {
        const p: mod.Player = mod.ValueInArray(array, i) as mod.Player;
        if (mod.IsValid(p)) {
            out.push(p);
        }
    }
    return out;
}

// Scalar sibling of playersFromIds, for callers that check one id at a time and
// stop early. Returns undefined for an id that no longer resolves.
export function playerById(id: number): mod.Player | undefined {
    if (id < 0) {
        return undefined;
    }
    try {
        const p: mod.Player = mod.GetPlayer(id);
        return mod.IsValid(p) ? p : undefined;
    } catch (e) {
        return undefined;
    }
}

export function playersInTeam(teamId: number): mod.Player[] {
    if (!isConfiguredTeam(teamId)) {
        return [];
    }
    const out: mod.Player[] = [];
    for (const p of allPlayers()) {
        if (teamIdOf(p) === teamId) {
            out.push(p);
        }
    }
    return out;
}


// --- SOURCE: src\notify.ts ---


export type FeedTone = "info" | "good" | "bad" | "warn";

type FeedSink = (t: FeedTone, teamId: number, key: string, a0: string | number, a1: string | number) => void;

let sink: FeedSink | undefined;

export function setFeedSink(fn: FeedSink): void {
    sink = fn;
}

export function notifyTeam(
    teamId: number,
    key: string,
    a0: string | number,
    a1: string | number
): void {
    const fn = sink;
    if (fn === undefined) {
        log("notify", "no sink for " + key);
        return;
    }
    safe("notify.team", () => {
        fn("info", teamId, key, a0, a1);
    });
    log("notify", "t" + String(teamId) + " <- " + key);
}

export function notifyPlayer(
    p: mod.Player,
    key: string,
    a0: string | number,
    a1: string | number
): void {
    const fn = sink;
    if (fn === undefined) {
        log("notify", "no sink for " + key);
        return;
    }
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    safe("notify.player", () => {
        fn("info", 0, key, a0, a1);
        pushPlayerFeedFromNotify(p, key, a0, a1);
    });
}

let playerSink: ((p: mod.Player, key: string, a0: string | number, a1: string | number) => void) | undefined;

export function setPlayerFeedSink(
    fn: (p: mod.Player, key: string, a0: string | number, a1: string | number) => void
): void {
    playerSink = fn;
}

function pushPlayerFeedFromNotify(
    p: mod.Player,
    key: string,
    a0: string | number,
    a1: string | number
): void {
    const fn = playerSink;
    if (fn === undefined) {
        return;
    }
    fn(p, key, a0, a1);
}


// --- SOURCE: src\capture.ts ---









export interface BuildingState {
    def: AreaBuildingDef;
    trigger: mod.AreaTrigger;
    occupants: number[];
    occupantTeam: { [id: number]: number };
    progress: { 1: number; 2: number };
    owner: number;
    contested: boolean;
    ticking: boolean;
    tickAccum: number;
}

// occupants is the AreaTrigger's live occupant list, captured at the instant
// the point flipped. Only those players are paid, not the whole team.
export type CaptureListener = (def: AreaBuildingDef, newOwner: number, occupants: number[]) => void;

const byTrigger: { [triggerId: number]: BuildingState } = {};
const states: BuildingState[] = [];
const listeners: CaptureListener[] = [];

let timer: Timers.TimerID | null = null;

const perSecond: number = 1 / CAPTURE_SECONDS;

function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function onCaptured(fn: CaptureListener): void {
    listeners.push(fn);
}

function fireCaptured(def: AreaBuildingDef, owner: number, occupants: number[]): void {
    for (const fn of listeners) {
        invokeSubscriber(fn, def, owner, occupants, undefined, "capture." + def.id);
    }
}

export function initCapture(): void {
    for (const def of allAreaBuildings()) {
        if (!isConfigured(def.areaTriggerId)) {
            log("capture", "skip " + def.id + " (AreaTrigger id 0 - unconfigured)");
            continue;
        }
        const trigger: mod.AreaTrigger = mod.GetAreaTrigger(def.areaTriggerId);
        if (!mod.IsValid(trigger)) {
            log("capture", "FAIL " + def.id + " trigger " + def.areaTriggerId + " did not resolve");
            continue;
        }
        const st: BuildingState = {
            def: def,
            trigger: trigger,
            occupants: [],
            occupantTeam: {},
            progress: { 1: 0, 2: 0 },
            owner: 0,
            contested: false,
            ticking: false,
            tickAccum: 0
        };
        states.push(st);
        byTrigger[def.areaTriggerId] = st;
        log("capture", "bound " + def.id + " trigger=" + def.areaTriggerId + " kind=" + def.kind);
    }
    if (states.length === 0) {
        log("capture", "no AreaTrigger buildings configured - capture system idle");
        return;
    }
    timer = Timers.setInterval(() => { safe("capture.tick", tick); }, Math.floor(1000 / CAPTURE_TICK_HZ));
    if (timer === null) {
        log("capture", "FATAL: Timers pool full, capture tick not scheduled");
    }
}

function tick(): void {
    const dt: number = 1 / CAPTURE_TICK_HZ;
    tickClock = tickClock + dt;
    for (const st of states) {
        if (st.occupants.length === 0) {
            continue;
        }
        let n1: number = 0;
        let n2: number = 0;
        for (const id of st.occupants) {
            const t: number = st.occupantTeam[id];
            if (t === 1) {
                n1++;
            } else if (t === 2) {
                n2++;
            }
        }

        st.contested = n1 > 0 && n2 > 0;
        if (st.contested) {
            if (!st.ticking) {
                st.ticking = true;
                    // Contested is a both-teams event, so it used to be playSfxAll:
                    // every player in the match heard it, including people nowhere
                    // near the point, and with bots contesting points constantly it
                    // was a repeating stinger. Now routed per team, behind a shared
                    // cooldown, and only for a team with a human on the point.
                          contestedAt = contestedAt + dt;
                      if (contestedAt >= CONTESTED_INTERVAL) {
                          contestedAt = 0;
                          for (const p of occupantPlayers(st, 1)) {
                              playSfxPlayer("capContested", p, 0.4);
                          }
                          for (const p of occupantPlayers(st, 2)) {
                              playSfxPlayer("capContested", p, 0.4);
                          }
                      }
            }
            continue;
        }

        if (n1 > 0) {
            if (st.owner === 1 && st.progress[1] >= 1) {
                st.ticking = false;
                continue;
            }
            st.progress[1] = clamp01(st.progress[1] + perSecond * Math.min(n1, 3) * dt);
            st.progress[2] = clamp01(st.progress[2] - perSecond * CAPTURE_DECAY * dt);
            beginTick(st, 1);
        } else if (n2 > 0) {
            if (st.owner === 2 && st.progress[2] >= 1) {
                st.ticking = false;
                continue;
            }
            st.progress[2] = clamp01(st.progress[2] + perSecond * Math.min(n2, 3) * dt);
            st.progress[1] = clamp01(st.progress[1] - perSecond * CAPTURE_DECAY * dt);
            beginTick(st, 2);
        } else {
            st.ticking = false;
        }
        resolveOwner(st);
    }
}

const TICK_INTERVAL: number = 0.5;

// The players actually standing in this objective's AreaTrigger right now,
// filtered to one team.
//
// This is the exact population, not a proximity estimate: the trigger's own
// occupant list already tells us who is inside the polygon volume, and
// bunkers get the same information from mod.GetPlayersOnPoint. Broadcast capture
// feedback to the whole team instead meant 24 bots per team made a player hear
// tick sounds and see capture notices for points on the far side of the map, so
// every capture cue below is delivered only to the players inside the volume.
//
// Returns the occupants that resolve to a live Player, so callers can hand the
// same list to both the sound and the feed.
function occupantPlayers(st: BuildingState, team: number): mod.Player[] {
    const out: mod.Player[] = [];
    for (const id of st.occupants) {
        if (st.occupantTeam[id] !== team) {
            continue;
        }
        const p: mod.Player | undefined = playerById(id);
        if (p !== undefined) {
            out.push(p);
        }
    }
    return out;
}

// Shared across every building, so a screen full of contested points produces
// one sting every CONTESTED_INTERVAL rather than one per building per capture
// episode.
const CONTESTED_INTERVAL: number = 3;
let contestedAt: number = 0;

// One shared cooldown per sound key across every building. beginTick runs once
// per actively-capturing building, so without this N simultaneous captures
// stacked N copies of the same tick on the same 0.5s boundary.
const tickSfxAt: { [k: string]: number } = {};
let tickClock: number = 0;

function beginTick(st: BuildingState, team: number): void {
    if (!st.ticking) {
        st.ticking = true;
        st.tickAccum = 0;
        log("capture", st.def.id + " capture started by team " + team);
        for (const p of occupantPlayers(st, team)) {
            notifyPlayer(p, "capStarted", st.def.factoryName, 0);
        }
    }
    st.tickAccum = st.tickAccum + dt();
    if (st.tickAccum >= TICK_INTERVAL) {
        st.tickAccum = 0;
        const key: SfxKey = team === 1 ? "capTick" : "capTickEnemy";
        if (tickSfxAt[key] === undefined || tickClock - tickSfxAt[key] >= TICK_INTERVAL) {
            tickSfxAt[key] = tickClock;
            // Only to the players inside the volume, not the whole team.
            for (const p of occupantPlayers(st, team)) {
                playSfxPlayer(key, p, 0.55);
            }
        }
    }
}

function dt(): number {
    return 1 / CAPTURE_TICK_HZ;
}

function resolveOwner(st: BuildingState): void {
    if (st.progress[1] >= 1 && st.owner !== 1) {
        st.owner = 1;
        // Latch both bars: leaving the owner's progress at 1 while the loser
        // decayed let the next tick re-enter beginTick, which re-announced the
        // capture and replayed the start/tick sounds indefinitely.
        st.progress[1] = 1;
        st.progress[2] = 0;
        st.ticking = false;
        // Delivered only to the players standing in the volume. The capture
        // itself and its payout are unaffected, so a bot-only capture still
        // completes and is still scored - it just stops interrupting players
        // who are not there.
        for (const p of occupantPlayers(st, 1)) {
            playSfxPlayer("capDone", p, 0.8);
            playSfxPlayer("siteYours", p, 0.6);
            notifyPlayer(p, "capDone", st.def.factoryName, 0);
        }
        log("capture", st.def.id + " captured by team 1");
        fireCaptured(st.def, 1, st.occupants);
    } else if (st.progress[2] >= 1 && st.owner !== 2) {
        st.owner = 2;
        st.progress[2] = 1;
        st.progress[1] = 0;
        st.ticking = false;
        for (const p of occupantPlayers(st, 2)) {
            playSfxPlayer("capDoneEnemy", p, 0.8);
            playSfxPlayer("siteFoe", p, 0.6);
            notifyPlayer(p, "capDone", st.def.factoryName, 0);
        }
        log("capture", st.def.id + " captured by team 2");
        fireCaptured(st.def, 2, st.occupants);
    }
}

// Match ONLY by exact ObjId. A mod.Equals fallback was tried and removed: it is
// not discriminating for AreaTrigger handles, so HQ gates (7500/7501) and turret
// zones (7100-7107) were matched to site1, letting the player "capture" an
// energy site while standing in a kill zone. Unknown triggers are reported.
function stateForTrigger(at: mod.AreaTrigger): BuildingState | undefined {
    return byTrigger[mod.GetObjId(at)];
}

function onEnter(p: mod.Player, at: mod.AreaTrigger): void {
    const zoneId: number = mod.GetObjId(at);
    const id: number = mod.GetObjId(p);
    const st: BuildingState | undefined = stateForTrigger(at);
    if (!st) {
        if (willLogDebug()) {
        log("capture", "UNMATCHED ENTER trigger=" + zoneId + " pid=" + id);
    }
        return;
    }
    if (id < 0) {
        log("capture", "ENTER ignored invalid player trigger=" + zoneId);
        return;
    }
    const team: number = teamIdOf(p);
    if (team !== 1 && team !== 2) {
        log("capture", "ENTER ignored invalid team trigger=" + zoneId + " pid=" + id + " team=" + team);
        return;
    }
    if (st.occupants.indexOf(id) < 0) {
        st.occupants.push(id);
    }
    st.occupantTeam[id] = team;
    if (willLogDebug()) {
        log("capture", "ENTER " + st.def.id + " zone=" + zoneId + " pid=" + id
            + " team=" + team + " occ=" + st.occupants.length);
    }
}

function onExit(p: mod.Player, at: mod.AreaTrigger): void {
    const zoneId: number = mod.GetObjId(at);
    const st: BuildingState | undefined = stateForTrigger(at);
    if (!st) {
        if (willLogDebug()) {
            log("capture", "UNMATCHED EXIT trigger=" + zoneId + " pid=" + mod.GetObjId(p));
        }
        return;
    }
    const id: number = mod.GetObjId(p);
    const i: number = st.occupants.indexOf(id);
    if (i >= 0) {
        st.occupants.splice(i, 1);
    }
    delete st.occupantTeam[id];
    if (willLogDebug()) {
        log("capture", "EXIT " + st.def.id + " zone=" + zoneId + " pid=" + id
            + " occ=" + st.occupants.length);
    }
}

function onLeave(id: number): void {
    for (const st of states) {
        const i: number = st.occupants.indexOf(id);
        if (i >= 0) {
            st.occupants.splice(i, 1);
        }
        delete st.occupantTeam[id];
    }
}

export function buildingById(id: string): BuildingState | undefined {
    for (const st of states) {
        if (st.def.id === id) {
            return st;
        }
    }
    return undefined;
}

export function buildingsOfKind(kind: string): BuildingState[] {
    const out: BuildingState[] = [];
    for (const st of states) {
        if (st.def.kind === kind) {
            out.push(st);
        }
    }
    return out;
}

export function allStates(): BuildingState[] {
    return states;
}

export function buildingForPlayer(pid: number): BuildingState | undefined {
    for (const st of states) {
        if (st.occupants.indexOf(pid) >= 0) {
            return st;
        }
    }
    return undefined;
}

export function buildingAtTrigger(triggerId: number): BuildingState | undefined {
    return byTrigger[triggerId];
}

export function configureCaptureEvents(): void {
    Events.OnPlayerEnterAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("area.enter", () => { onEnter(p, at); });
    });
    Events.OnPlayerExitAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("area.exit", () => { onExit(p, at); });
    });
    Events.OnPlayerLeaveGame.subscribe((id: number) => {
        safe("area.leave", () => { onLeave(id); });
    });
}

export function shutdownCapture(): void {
    if (timer !== null) {
        Timers.clear(timer);
        timer = null;
    }
    states.length = 0;
}


// --- SOURCE: src\buildings.ts ---






export interface BunkerState {
    def: BunkerDef;
    capturePoint: mod.CapturePoint;
    owner: number;
}

const byCapturePoint: { [cpId: number]: BunkerState } = {};
const bunkers: BunkerState[] = [];

export type BunkerListener = (
    def: BunkerDef,
    newOwner: number,
    prevOwner: number,
    capturePoint: mod.CapturePoint
) => void;

const listeners_2: BunkerListener[] = [];

export function onBunkerCaptured(fn: BunkerListener): void {
    listeners_2.push(fn);
}

function fire(def: BunkerDef, owner: number, prevOwner: number, cp: mod.CapturePoint): void {
    for (const fn of listeners_2) {
        invokeSubscriber(fn, def, owner, prevOwner, cp, "bunker." + def.id);
    }
}

export function initBuildings(): void {
    for (const def of BUNKERS) {
        if (!isConfigured(def.capturePointId)) {
            log("buildings", "skip " + def.id + " (CapturePoint id 0 - unconfigured)");
            continue;
        }
        const capturePoint: mod.CapturePoint = mod.GetCapturePoint(def.capturePointId);
        if (!mod.IsValid(capturePoint)) {
            log("buildings", "FAIL " + def.id + " cp=" + def.capturePointId + " did not resolve");
            continue;
        }
        const st: BunkerState = { def: def, capturePoint: capturePoint, owner: 0 };
        bunkers.push(st);
        byCapturePoint[def.capturePointId] = st;
        configureObjective(capturePoint, def.id);
        log("buildings", "bound " + def.id + " cp=" + def.capturePointId);
    }
    if (bunkers.length === 0) {
        log("buildings", "no bunkers configured - native capture path idle");
    }
}

// A CapturePoint stays inert until the game mode objective is enabled: without
// this the engine never reports OnCapturePointCaptured and GetCurrentOwnerTeam
// stays 0. Tier 0 index.d.ts:33310 and the official template
// mods_original/_StartHere_BasicTemplate/BasicTemplate.ts:72 both call it.
function configureObjective(cp: mod.CapturePoint, defId: string): void {
    safe("buildings.objective", () => {
        mod.EnableGameModeObjective(cp, true);
        mod.SetCapturePointCapturingTime(cp, BUNKER_CAPTURE_SECONDS);
        mod.SetCapturePointNeutralizationTime(cp, BUNKER_NEUTRALIZE_SECONDS);
        mod.SetMaxCaptureMultiplier(cp, BUNKER_CAPTURE_MULTIPLIER);
        mod.EnableCapturePointDeploying(cp, true);
        log("buildings", defId + " objective enabled"
            + " cap=" + String(BUNKER_CAPTURE_SECONDS)
            + " mult=" + String(BUNKER_CAPTURE_MULTIPLIER));
    });
}

export function applyOwner(cp: mod.CapturePoint, owner: number): void {
    let st: BunkerState | undefined = byCapturePoint[mod.GetObjId(cp)];
    if (st === undefined) {
        for (const candidate of bunkers) {
            if (mod.Equals(cp, candidate.capturePoint)) {
                st = candidate;
                break;
            }
        }
    }
    if (!st) {
        log("buildings", "UNMATCHED capture-point event cp=" + mod.GetObjId(cp));
        return;
    }
    const normalizedOwner: number = owner === 1 || owner === 2 ? owner : 0;
    if (st.owner === normalizedOwner) {
        return;
    }
    const prevOwner: number = st.owner;
    st.owner = normalizedOwner;
    log("buildings", st.def.id + " owner -> " + normalizedOwner);
    fire(st.def, normalizedOwner, prevOwner, st.capturePoint);
}

export function syncBunkerOwners(): void {
    for (const st of bunkers) {
        safe("buildings.owner", () => {
            const owner: number = teamNumOf(mod.GetCurrentOwnerTeam(st.capturePoint));
            if (owner !== st.owner) {
                applyOwner(st.capturePoint, owner);
            }
        });
    }
}

export function bunkerByCp(cpId: number): BunkerState | undefined {
    return byCapturePoint[cpId];
}

export function bunkerById(defId: string): BunkerState | undefined {
    for (const st of bunkers) {
        if (st.def.id === defId) {
            return st;
        }
    }
    return undefined;
}

export function allBunkers(): BunkerState[] {
    return bunkers;
}

export function configureBuildingEvents(): void {
    Events.OnCapturePointCaptured.subscribe((cp: mod.CapturePoint) => {
        safe("cp.captured", () => {
            applyOwner(cp, teamNumOf(mod.GetCurrentOwnerTeam(cp)));
        });
    });
    Events.OnCapturePointLost.subscribe((cp: mod.CapturePoint) => {
        safe("cp.lost", () => { applyOwner(cp, 0); });
    });
}


// --- SOURCE: src\spawns.ts ---





const deployed: { [defId: string]: boolean } = {};

function enableDeploying(def: BunkerDef, on: boolean): void {
    if (!isConfigured(def.capturePointId)) {
        return;
    }
    const cp: mod.CapturePoint = mod.GetCapturePoint(def.capturePointId);
    if (cp === undefined) {
        log("spawns", def.id + " capture point " + def.capturePointId + " did not resolve");
        return;
    }
    try {
        mod.EnableCapturePointDeploying(cp, on);
        log("spawns", def.id + " deploying=" + String(on));
    } catch (e) {
        log("spawns", def.id + " enable failed: " + String(e));
    }
}

export function initSpawns(): void {
    let any: number = 0;
    for (const def of BUNKERS) {
        if (!isConfigured(def.capturePointId)) {
            log("spawns", "skip " + def.id + " (CapturePoint id 0 - unconfigured)");
            continue;
        }
        any++;
        enableDeploying(def, true);
    }
    if (any === 0) {
        log("spawns", "no bunkers configured - native deploy mode idle");
        return;
    }
    try {
        mod.SetSpawnMode(mod.SpawnModes.Deploy);
        log("spawns", "spawn mode = Deploy across " + any + " bunker(s)");
    } catch (e) {
        log("spawns", "SetSpawnMode failed: " + String(e));
    }
}

export function onBunkerOwnerChanged(def: BunkerDef, owner: number): void {
    if (deployed[def.id] === undefined) {
        deployed[def.id] = true;
    }
    if (owner === 1 || owner === 2) {
        log("spawns", def.id + " now available to team " + owner);
    } else {
        log("spawns", def.id + " neutral - spawns unavailable");
    }
}

export function refreshSpawnAvailability(): void {
    for (const def of BUNKERS) {
        if (isConfigured(def.capturePointId)) {
            enableDeploying(def, true);
        }
    }
}

export function configureSpawnEvents(): void {
    Events.OnPlayerJoinGame.subscribe(() => {
        safe("spawn.join", () => { refreshSpawnAvailability(); });
    });
}

export function currentOwnerOfCapturePoint(cpId: number): number {
    if (!isConfigured(cpId)) {
        return 0;
    }
    try {
        return teamNumOf(mod.GetCurrentOwnerTeam(mod.GetCapturePoint(cpId)));
    } catch (e) {
        return 0;
    }
}


// --- SOURCE: src\economy.ts ---





export type PrestigeListener = (id: number, total: number, gained: number) => void;

const listeners_3: PrestigeListener[] = [];

export function onPrestige(fn: PrestigeListener): void {
    listeners_3.push(fn);
}

function fire_2(id: number, total: number, gained: number): void {
    for (const fn of listeners_3) {
        invokeSubscriber(fn, id, total, gained, undefined, "economy.prestige");
    }
}

export function prestigeOf(id: number): number {
    const v: number | undefined = pPrestige[id];
    return v === undefined ? 0 : v;
}

export function addPrestige(id: number, delta: number): void {
    const before: number = prestigeOf(id);
    const after: number = before + delta < 0 ? 0 : before + delta;
    if (after === before) {
        return;
    }
    pPrestige[id] = after;
    log("economy", "prestige " + id + " " + before + " -> " + after);
    fire_2(id, after, after - before);
}

export function spendPrestige(id: number, cost: number): boolean {
    if (cost <= 0) {
        return true;
    }
    if (prestigeOf(id) < cost) {
        return false;
    }
    addPrestige(id, -cost);
    return true;
}

export function canAfford(id: number, cost: number): boolean {
    return prestigeOf(id) >= cost;
}

// Kill, assist, death and capture payouts live in stats.ts so that the
// self-kill and redeploy filters can run before anything is awarded. Only the
// deploy bonus is handled here.
export function configureEconomyEvents(): void {
    Events.OnPlayerDeployed.subscribe((p: mod.Player) => {
        safe("eco.deploy", () => {
            if (PRESTIGE_ON_DEPLOY > 0) {
                addPrestige(mod.GetObjId(p), PRESTIGE_ON_DEPLOY);
            }
        });
    });
}


// --- SOURCE: node_modules\bf6-portal-utils\vectors\index.ts ---
// version: 2.0.0
export namespace Vectors {
    /**
     * A simple transparent and mutable 3D vector.
     */
    export type Vector3 = {
        x: number;
        y: number;
        z: number;
    };

    /**
     * The zero Vector3 (immutable).
     */
    export const ZERO: Readonly<Vector3> = Object.freeze({ x: 0, y: 0, z: 0 });

    /**
     * The one Vector3 (immutable).
     */
    export const ONE: Readonly<Vector3> = Object.freeze({ x: 1, y: 1, z: 1 });

    /**
     * Sets the x, y, and z components of the target vector.
     * @param target - The vector to modify.
     * @param x - The new x component.
     * @param y - The new y component.
     * @param z - The new z component.
     * @returns The modified target vector.
     */
    export function set(target: Vector3, x: number, y: number, z: number): Vector3 {
        target.x = x;
        target.y = y;
        target.z = z;

        return target;
    }

    /**
     * Copies the components from the source vector into the target vector.
     * @param target - The destination vector.
     * @param source - The source vector to copy from.
     * @returns The modified target vector.
     */
    export function copy(target: Vector3, source: Vector3): Vector3 {
        target.x = source.x;
        target.y = source.y;
        target.z = source.z;

        return target;
    }

    /**
     * Clones the provided vector into a new Vector3 instance.
     * @param source - The vector to clone.
     * @returns A new Vector3 with the same components.
     */
    export function clone(source: Vector3): Vector3 {
        return { x: source.x, y: source.y, z: source.z };
    }

    /**
     * Checks if two vectors are equal within an optional tolerance.
     * @param a - The first vector.
     * @param b - The second vector.
     * @param tolerance - The maximum allowed difference per component (default: 0).
     * @returns True if the vectors are equal within tolerance, false otherwise.
     */
    export function equals(a: Vector3, b: Vector3, tolerance: number = 0): boolean {
        return tolerance === 0
            ? a.x === b.x && a.y === b.y && a.z === b.z
            : Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.z - b.z) <= tolerance;
    }

    /**
     * Checks if a vector is approximately zero within an optional tolerance.
     * @param vector - The vector to check.
     * @param tolerance - The maximum allowed deviation from zero per component (default: 0).
     * @returns True if all components are within tolerance of zero, false otherwise.
     */
    export function isZero(vector: Vector3, tolerance: number = 0): boolean {
        return tolerance === 0
            ? vector.x === 0 && vector.y === 0 && vector.z === 0
            : Math.abs(vector.x) <= tolerance && Math.abs(vector.y) <= tolerance && Math.abs(vector.z) <= tolerance;
    }

    /**
     * Converts the provided Vector3 to an engine mod.Vector.
     * @param vector - The Vector3 to convert.
     * @returns The engine mod.Vector.
     */
    export function toVector(vector: Vector3): mod.Vector {
        return mod.CreateVector(vector.x, vector.y, vector.z);
    }

    /**
     * Converts the provided engine mod.Vector to a Vector3.
     * @param vector - The mod.Vector to convert.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The converted Vector3.
     */
    export function toVector3(vector: mod.Vector, out?: Vector3): Vector3 {
        const x = mod.XComponentOf(vector);
        const y = mod.YComponentOf(vector);
        const z = mod.ZComponentOf(vector);

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Adds the provided vectors.
     * @param a - The first vector.
     * @param b - The second vector.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The sum of the vectors.
     */
    export function add(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const x = a.x + b.x;
        const y = a.y + b.y;
        const z = a.z + b.z;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Adds vector b scaled by a scalar to vector a (a + b * scale).
     * @param a - The base vector.
     * @param b - The vector to scale and add.
     * @param scale - The scalar multiplier applied to vector b.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The resulting vector.
     */
    export function addScaled(a: Vector3, b: Vector3, scale: number, out?: Vector3): Vector3 {
        const x = a.x + b.x * scale;
        const y = a.y + b.y * scale;
        const z = a.z + b.z * scale;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Subtracts vector b from vector a.
     * @param a - The first vector.
     * @param b - The second vector to subtract.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The difference of the vectors (a - b).
     */
    export function subtract(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const x = a.x - b.x;
        const y = a.y - b.y;
        const z = a.z - b.z;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Multiplies the provided vector by a scalar.
     * @param vector - The vector to multiply.
     * @param scalar - The scalar to multiply by.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The multiplied vector.
     */
    export function multiply(vector: Vector3, scalar: number, out?: Vector3): Vector3 {
        const x = vector.x * scalar;
        const y = vector.y * scalar;
        const z = vector.z * scalar;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Divides the provided vector by a scalar.
     * @param vector - The vector to divide.
     * @param scalar - The scalar divisor.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The divided vector.
     */
    export function divide(vector: Vector3, scalar: number, out?: Vector3): Vector3 {
        const x = vector.x / scalar;
        const y = vector.y / scalar;
        const z = vector.z / scalar;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Computes the Hadamard product (element-wise multiplication) of two vectors.
     * @param a - The first vector.
     * @param b - The second vector.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The element-wise product vector.
     */
    export function hadamardMultiply(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const x = a.x * b.x;
        const y = a.y * b.y;
        const z = a.z * b.z;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Computes the Hadamard division (element-wise division: a / b) of two vectors.
     * @param a - The numerator vector.
     * @param b - The denominator vector.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The element-wise divided vector.
     */
    export function hadamardDivide(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const x = a.x / b.x;
        const y = a.y / b.y;
        const z = a.z / b.z;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Computes the dot product of two vectors.
     * @param a - The first vector.
     * @param b - The second vector.
     * @returns The scalar dot product.
     */
    export function dot(a: Vector3, b: Vector3): number {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    /**
     * Computes the cross product of two vectors (a x b).
     * @param a - The first vector.
     * @param b - The second vector.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The cross product vector.
     */
    export function cross(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const ax = a.x;
        const ay = a.y;
        const az = a.z;
        const bx = b.x;
        const by = b.y;
        const bz = b.z;

        const x = ay * bz - az * by;
        const y = az * bx - ax * bz;
        const z = ax * by - ay * bx;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Returns the squared magnitude/length of the vector (avoids square root).
     * @param vector - The vector.
     * @returns The squared length.
     */
    export function lengthSquared(vector: Vector3): number {
        return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z;
    }

    /**
     * Returns the magnitude/length of the vector.
     * @param vector - The vector.
     * @returns The length.
     */
    export function length(vector: Vector3): number {
        return Math.sqrt(lengthSquared(vector));
    }

    /**
     * Returns the normalized (unit length) version of the provided vector.
     * If the vector is zero length, returns a zero vector.
     * @param vector - The vector to normalize.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The normalized vector.
     */
    export function normalize(vector: Vector3, out?: Vector3): Vector3 {
        const len = length(vector);

        if (len === 0) {
            if (!out) return { x: 0, y: 0, z: 0 };

            out.x = 0;
            out.y = 0;
            out.z = 0;

            return out;
        }

        const x = vector.x / len;
        const y = vector.y / len;
        const z = vector.z / len;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Calculates the normalized unit direction vector pointing from `from` to `to`.
     * If the points are identical, returns a zero vector.
     * @param from - The starting vector.
     * @param to - The target vector.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The normalized direction vector.
     */
    export function direction(from: Vector3, to: Vector3, out?: Vector3): Vector3 {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const lenSq = dx * dx + dy * dy + dz * dz;

        if (lenSq === 0) {
            if (!out) return { x: 0, y: 0, z: 0 };

            out.x = 0;
            out.y = 0;
            out.z = 0;

            return out;
        }

        const invLen = 1 / Math.sqrt(lenSq);
        const x = dx * invLen;
        const y = dy * invLen;
        const z = dz * invLen;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Linearly interpolates between vector a and vector b.
     * @param a - The starting vector (t = 0).
     * @param b - The destination vector (t = 1).
     * @param t - The interpolation factor (typically 0 to 1).
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The interpolated vector.
     */
    export function lerp(a: Vector3, b: Vector3, t: number, out?: Vector3): Vector3 {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const z = a.z + (b.z - a.z) * t;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Calculates the midpoint between two vectors.
     * @param a - The first vector.
     * @param b - The second vector.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The midpoint vector.
     */
    export function midpoint(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        return lerp(a, b, 0.5, out);
    }

    /**
     * Truncates each component of the vector to the provided number of decimal places.
     * @param vector - The vector to truncate.
     * @param decimalPlaces - The number of decimal places to preserve (default: 2).
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The truncated vector.
     */
    export function truncate(vector: Vector3, decimalPlaces: number = 2, out?: Vector3): Vector3 {
        const scale = 10 ** Math.max(decimalPlaces, 0);
        const x = ~~(vector.x * scale) / scale;
        const y = ~~(vector.y * scale) / scale;
        const z = ~~(vector.z * scale) / scale;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Clamps the magnitude/length of the vector so it does not exceed `maxLength`.
     * @param vector - The vector to clamp.
     * @param maxLength - The maximum allowed length.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The length-clamped vector.
     */
    export function clampLength(vector: Vector3, maxLength: number, out?: Vector3): Vector3 {
        const lenSq = lengthSquared(vector);

        if (lenSq <= maxLength * maxLength) {
            if (!out) return { x: vector.x, y: vector.y, z: vector.z };

            out.x = vector.x;
            out.y = vector.y;
            out.z = vector.z;

            return out;
        }

        const scale = maxLength / Math.sqrt(lenSq);
        const x = vector.x * scale;
        const y = vector.y * scale;
        const z = vector.z * scale;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Rotates a vector around a given unit axis by an angle in radians, using Rodrigues' rotation formula.
     * @param vector - The vector to rotate.
     * @param axis - The unit axis to rotate around.
     * @param angleRad - The angle in radians to rotate by.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The rotated vector.
     */
    export function rotateAroundAxis(vector: Vector3, axis: Vector3, angleRad: number, out?: Vector3): Vector3 {
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);

        // Dot product of axis and vector.
        const dotProduct = vector.x * axis.x + vector.y * axis.y + vector.z * axis.z;

        // Cross product of axis and vector.
        const crossX = axis.y * vector.z - axis.z * vector.y;
        const crossY = axis.z * vector.x - axis.x * vector.z;
        const crossZ = axis.x * vector.y - axis.y * vector.x;

        const oneMinusCos = 1 - cos;

        const x = vector.x * cos + crossX * sin + axis.x * dotProduct * oneMinusCos;
        const y = vector.y * cos + crossY * sin + axis.y * dotProduct * oneMinusCos;
        const z = vector.z * cos + crossZ * sin + axis.z * dotProduct * oneMinusCos;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Transforms a local coordinate offset (X=Right, Y=Up, Z=Forward) into world space relative to an origin and forward vector.
     * @param origin - The world-space origin position.
     * @param forward - The forward facing direction vector.
     * @param localOffset - The local offset (X=Right, Y=Up, Z=Forward).
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The transformed world-space position.
     */
    export function transformLocalOffset(
        origin: Vector3,
        forward: Vector3,
        localOffset: Vector3,
        out?: Vector3
    ): Vector3 {
        const fLen = length(forward);
        const fX = fLen > 0 ? forward.x / fLen : 0;
        const fY = fLen > 0 ? forward.y / fLen : 0;
        const fZ = fLen > 0 ? forward.z / fLen : 1;

        // Gimbal singularity protection (use world X if looking straight up/down)
        const wx = Math.abs(fY) > 0.999 ? 1 : 0;
        const wy = Math.abs(fY) > 0.999 ? 0 : 1;
        const wz = 0;

        // Right = Forward x WorldUp
        let rX = fY * wz - fZ * wy;
        let rY = fZ * wx - fX * wz;
        let rZ = fX * wy - fY * wx;
        const rLen = Math.sqrt(rX * rX + rY * rY + rZ * rZ);

        if (rLen > 0) {
            rX /= rLen;
            rY /= rLen;
            rZ /= rLen;
        }

        // Up = Right x Forward
        const uX = rY * fZ - rZ * fY;
        const uY = rZ * fX - rX * fZ;
        const uZ = rX * fY - rY * fX;

        const x = origin.x + rX * localOffset.x + uX * localOffset.y + fX * localOffset.z;
        const y = origin.y + rY * localOffset.x + uY * localOffset.y + fY * localOffset.z;
        const z = origin.z + rZ * localOffset.x + uZ * localOffset.y + fZ * localOffset.z;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Rotates a direction vector by relative yaw (horizontal) and pitch (vertical) angle deltas in degrees.
     * @param forward - The base forward direction vector.
     * @param yawDeg - Horizontal angle offset in degrees (left positive).
     * @param pitchDeg - Vertical angle offset in degrees (up positive).
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The rotated, unit-length direction vector.
     */
    export function rotateYawPitch(forward: Vector3, yawDeg: number, pitchDeg: number, out?: Vector3): Vector3 {
        if (yawDeg === 0 && pitchDeg === 0) return normalize(forward, out);

        const fLen = length(forward);
        const fX = fLen > 0 ? forward.x / fLen : 0;
        const fY = fLen > 0 ? forward.y / fLen : 0;
        const fZ = fLen > 0 ? forward.z / fLen : 1;

        const wx = Math.abs(fY) > 0.999 ? 1 : 0;
        const wy = Math.abs(fY) > 0.999 ? 0 : 1;
        const wz = 0;

        let rX = fY * wz - fZ * wy;
        let rY = fZ * wx - fX * wz;
        let rZ = fX * wy - fY * wx;
        const rLen = Math.sqrt(rX * rX + rY * rY + rZ * rZ);

        if (rLen > 0) {
            rX /= rLen;
            rY /= rLen;
            rZ /= rLen;
        }

        const uX = rY * fZ - rZ * fY;
        const uY = rZ * fX - rX * fZ;
        const uZ = rX * fY - rY * fX;

        const hRad = (yawDeg * Math.PI) / 180;
        const vRad = (pitchDeg * Math.PI) / 180;

        const cFwd = Math.cos(hRad) * Math.cos(vRad);
        const cUp = Math.cos(hRad) * Math.sin(vRad);
        const cRight = Math.sin(hRad);

        const x = fX * cFwd + uX * cUp + rX * cRight;
        const y = fY * cFwd + uY * cUp + rY * cRight;
        const z = fZ * cFwd + uZ * cUp + rZ * cRight;

        if (!out) return { x, y, z };

        out.x = x;
        out.y = y;
        out.z = z;

        return out;
    }

    /**
     * Converts the provided degrees to radians.
     * @param degrees - The degrees to convert.
     * @returns The radians.
     */
    export function degreesToRadians(degrees: number): number {
        return (degrees * Math.PI) / 180;
    }

    /**
     * Returns a rotation Vector3 for the provided orientation in compass degrees.
     * @param orientation - The orientation in compass degrees (0-360).
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The rotation Vector3 (with y in radians).
     */
    export function getRotationVector(orientation: number, out?: Vector3): Vector3 {
        const y = degreesToRadians(180 - orientation);

        if (!out) return { x: 0, y, z: 0 };

        out.x = 0;
        out.y = y;
        out.z = 0;

        return out;
    }

    /**
     * Converts a player's raw engine rotation vector (from `mod.GetObjectRotation(player)`) into a unit horizontal facing direction vector.
     * Unwraps Frostbite's northern-hemisphere Euler representation:
     * - South -> (0, 0, 1)
     * - East  -> (1, 0, 0)
     * - North -> (0, 0, -1)
     * - West  -> (-1, 0, 0)
     * @param rotation - The raw engine rotation vector from `mod.GetObjectRotation(player)`.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The unit horizontal facing direction Vector3.
     */
    export function getDirectionFromPlayerRotation(rotation: Vector3, out?: Vector3): Vector3 {
        const dest = out ?? { x: 0, y: 0, z: 0 };
        const rotX = rotation.x;
        const rotY = rotation.y;

        const yaw = rotX > 1.5 || rotX < -1.5 ? (rotY >= 0 ? Math.PI - rotY : -Math.PI - rotY) : rotY;

        dest.x = Math.sin(yaw);
        dest.y = 0;
        dest.z = Math.cos(yaw);

        return dest;
    }

    /**
     * Converts a player's raw engine rotation vector (from `mod.GetObjectRotation(player)`) into a compass heading in degrees [0, 360).
     * Maps to in-game HUD compass:
     * - North -> 0°
     * - East  -> 90°
     * - South -> 180°
     * - West  -> 270°
     * @param rotation - The raw engine rotation vector from `mod.GetObjectRotation(player)`.
     * @returns The compass heading in degrees in the range [0, 360).
     */
    export function getHeadingFromPlayerRotation(rotation: Vector3): number {
        const rotX = rotation.x;
        const rotY = rotation.y;

        const yaw = rotX > 1.5 || rotX < -1.5 ? (rotY >= 0 ? Math.PI - rotY : -Math.PI - rotY) : rotY;
        const heading = 180 - (yaw * 180) / Math.PI;
        const normalized = ((heading % 360) + 360) % 360;

        return normalized === 360 ? 0 : normalized;
    }

    /**
     * Converts a 3D facing direction vector into Euler rotation angles in radians (ZYX convention: x=pitch, y=yaw, z=roll=0).
     * Where facing due North [0, 0, -1] corresponds to zero rotation (x=0, y=0, z=0).
     * Automatically normalizes the input vector to safely handle non-unit vectors (e.g. from soldier or vehicle states).
     * @param facing - The 3D facing direction vector.
     * @param out - Optional target Vector3 to write into for zero-allocation reuse.
     * @returns The Euler rotation angles Vector3 in radians ({ x: pitch, y: yaw, z: 0 }).
     */
    export function facingToEuler(facing: Vector3, out?: Vector3): Vector3 {
        const dest = out ?? { x: 0, y: 0, z: 0 };
        const fx = facing.x;
        const fy = facing.y;
        const fz = facing.z;
        const lenSq = fx * fx + fy * fy + fz * fz;

        if (lenSq === 0) {
            dest.x = 0;
            dest.y = 0;
            dest.z = 0;

            return dest;
        }

        const invLen = 1 / Math.sqrt(lenSq);
        const normY = fy * invLen;
        const clampedY = normY > 1 ? 1 : normY < -1 ? -1 : normY;
        const horizLenSq = fx * fx + fz * fz;

        dest.x = Math.asin(clampedY);
        dest.y = horizLenSq === 0 ? 0 : Math.atan2(-fx || 0, -fz || 0);
        dest.z = 0;

        return dest;
    }

    /**
     * Returns the squared Euclidean distance between two vectors (avoids square root).
     * @param a - The first vector.
     * @param b - The second vector.
     * @returns The squared distance.
     */
    export function distanceSquared(a: Vector3, b: Vector3): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;

        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * Returns the Euclidean distance between two vectors.
     * @param a - The first vector.
     * @param b - The second vector.
     * @returns The distance.
     */
    export function distance(a: Vector3, b: Vector3): number {
        return Math.sqrt(distanceSquared(a, b));
    }

    /**
     * Checks if the provided value is a valid Vector3 object.
     * @param v - The value to check.
     * @returns True if the value is a Vector3, false otherwise.
     */
    export function isVector3(v: unknown): v is Vector3 {
        if (v === null || typeof v !== 'object') return false;

        const vector = v as Record<string, unknown>;

        return typeof vector.x === 'number' && typeof vector.y === 'number' && typeof vector.z === 'number';
    }

    /**
     * Returns a string representation of the provided Vector3.
     * @param vector - The Vector3 to format.
     * @param precision - The decimal precision (default: 2).
     * @returns The formatted string representation (e.g. "<1.00, 2.00, 3.00>").
     */
    export function getVectorString(vector: Vector3, precision: number = 2): string {
        return `<${vector.x.toFixed(precision)}, ${vector.y.toFixed(precision)}, ${vector.z.toFixed(precision)}>`;
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\player-locations\index.ts ---





// version: 1.0.0
export namespace PlayerLocations {
    const logging = new Logging('PL');

    /**
     * Re-export of the `Logging.LogLevel` enum.
     */
    export const LogLevel = Logging.LogLevel;

    /**
     * Attaches a logger and defines a minimum log level and whether to attempt to append a string form of the error to
     * the text of the log message.
     * @param log - The logger function: `(formattedText, error?) => void | Promise<void>`. `error` is the same value
     *              passed to `log()` (if any), for inspection (e.g. `instanceof Error`, `stack`). `formattedText` may
     *              also include ` - Error: …` when `includeRawError` is true.
     * @param logLevel - The minimum log level to use.
     * @param includeRawError - When true and `log()` receives an error, attempts to append a string form of the error
     *                          to the text of the log message.
     */
    export function setLogging(
        log?: (text: string, error?: unknown) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeRawError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeRawError);
    }

    /**
     * Explicitly initializes the PlayerLocations spatial tracking engine.
     *
     * Synchronizes currently connected players via `mod.AllPlayers()` and subscribes to
     * `Events.OnTickStart`, `Events.OnPlayerJoinGame`, and `Events.OnPlayerLeaveGame`.
     * Safe to call multiple times (idempotent).
     *
     * It is strongly recommended to call this inside `Events.OnGameModeStarted.subscribe(...)`
     * (or after initial match setup) to avoid running per-tick spatial tracking during initial server
     * world loading and entity spawning.
     */
    export function initialize(): void {
        if (_isInitialized) return;

        _isInitialized = true;

        _initConnectedPlayers();

        // Subscribed to OnTickStart at priority Normal (0) to query player positions and rebuild spatial
        // grids at the start of the frame, providing fresh spatial query data for all gameplay logic throughout the tick.
        Events.OnTickStart.subscribe(_handleTick, Events.EventPriority.First);
        Events.OnPlayerJoinGame.subscribe(_handlePlayerJoin, Events.EventPriority.First);
        Events.OnPlayerLeaveGame.subscribe(_handlePlayerLeave, Events.EventPriority.First);
    }

    /**
     * Checks whether the PlayerLocations spatial tracking engine has been initialized.
     * @returns True if initialize() has already been called, false otherwise.
     */
    export function isInitialized(): boolean {
        return _isInitialized;
    }

    // =========================================================================
    // Types & Callback Signatures
    // =========================================================================

    /** Callback invoked when a player enters or exits a spatial zone or crosses a boundary. */
    export type PlayerZoneCallback = (player: mod.Player, playerId: number) => Promise<void> | void;

    /** Callback invoked when the identity of an extremum player changes. */
    export type PlayerExtremaCallback = (
        newPlayer: mod.Player | undefined,
        prevPlayer: mod.Player | undefined,
        newPlayerId: number | undefined,
        prevPlayerId: number | undefined
    ) => Promise<void> | void;

    /** Handle returned by sphere zone subscriptions to allow updating parameters or unsubscribing. */
    export interface SphereHandle {
        /** Cancels the subscription and removes the zone listener. Safe to call multiple times. */
        unsubscribe(): void;
        /**
         * Updates the center coordinates and optionally radius of the sphere on the fly.
         * Has no effect if the subscription has already been unsubscribed.
         * @param x - New center X coordinate in world meters.
         * @param y - New center Y coordinate in world meters.
         * @param z - New center Z coordinate in world meters.
         * @param radiusMeters - Optional new radius in meters.
         */
        update(x: number, y: number, z: number, radiusMeters?: number): void;
    }

    /** Handle returned by cylinder zone subscriptions to allow updating parameters or unsubscribing. */
    export interface CylinderHandle {
        /** Cancels the subscription and removes the zone listener. Safe to call multiple times. */
        unsubscribe(): void;
        /**
         * Updates the cylinder center coordinates, radius, and elevation bounds on the fly.
         * Has no effect if the subscription has already been unsubscribed.
         * @param centerX - New center X coordinate in world meters.
         * @param centerZ - New center Z coordinate in world meters.
         * @param radiusMeters - Optional new radius in meters.
         * @param minY - Optional new minimum Y elevation in meters (default: -Infinity).
         * @param maxY - Optional new maximum Y elevation in meters (default: Infinity).
         */
        update(centerX: number, centerZ: number, radiusMeters?: number, minY?: number, maxY?: number): void;
    }

    /** Handle returned by AABB bounding box subscriptions to allow updating parameters or unsubscribing. */
    export interface AABBHandle {
        /** Cancels the subscription and removes the zone listener. Safe to call multiple times. */
        unsubscribe(): void;
        /**
         * Updates the bounding box coordinate limits on the fly.
         * Has no effect if the subscription has already been unsubscribed.
         * @param minX - New minimum X coordinate in world meters.
         * @param minY - New minimum Y coordinate in world meters.
         * @param minZ - New minimum Z coordinate in world meters.
         * @param maxX - New maximum X coordinate in world meters.
         * @param maxY - New maximum Y coordinate in world meters.
         * @param maxZ - New maximum Z coordinate in world meters.
         */
        update(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void;
    }

    /** 2D Vertex representing a point on the XZ ground plane for polygonal prism volumes. */
    export type PrismVertex = {
        x: number;
        z: number;
    };

    /** Handle returned by polygonal prism subscriptions to allow updating parameters or unsubscribing. */
    export interface PrismHandle {
        /** Cancels the subscription and removes the zone listener. Safe to call multiple times. */
        unsubscribe(): void;
        /**
         * Updates the polygon vertices and elevation bounds on the fly.
         * Has no effect if the subscription has already been unsubscribed.
         * @param vertices - New polygon vertices on the XZ ground plane.
         * @param minY - Optional new minimum Y elevation in meters (default: -Infinity).
         * @param maxY - Optional new maximum Y elevation in meters (default: Infinity).
         */
        update(vertices: PrismVertex[], minY?: number, maxY?: number): void;
    }

    /** Handle returned by directional plane/boundary subscriptions to allow updating parameters or unsubscribing. */
    export interface PlaneHandle {
        /** Cancels the subscription and removes the boundary listener. Safe to call multiple times. */
        unsubscribe(): void;
        /**
         * Updates the boundary coordinate threshold on the fly.
         * Has no effect if the subscription has already been unsubscribed.
         * @param threshold - New coordinate threshold in world meters.
         */
        update(threshold: number): void;
    }

    /** Handle returned by global extrema subscriptions (highest/lowest) to allow unsubscribing. */
    export interface ExtremaHandle {
        /** Cancels the subscription and removes the extremum listener. Safe to call multiple times. */
        unsubscribe(): void;
    }

    /** Handle returned by target point extrema subscriptions (closest/farthest) to allow updating target point or unsubscribing. */
    export interface TargetExtremaHandle extends ExtremaHandle {
        /**
         * Updates the target reference point coordinates on the fly.
         * Has no effect if the subscription has already been unsubscribed.
         * @param x - New target X coordinate in world meters.
         * @param y - New target Y coordinate in world meters.
         * @param z - New target Z coordinate in world meters.
         */
        update(x: number, y: number, z: number): void;
    }

    const enum AxisType {
        X = 0,
        Y = 1,
        Z = 2,
    }

    const enum ExtremaType {
        Closest = 0,
        Farthest = 1,
        Highest = 2,
        Lowest = 3,
    }

    interface BasePresenceMask {
        mask0: number;
        mask1: number;
        mask2: number;
        mask3: number;
        onEnter?: PlayerZoneCallback;
        onExit?: PlayerZoneCallback;
    }

    interface SphereListener extends BasePresenceMask {
        centerX: number;
        centerY: number;
        centerZ: number;
        radiusSq: number;
    }

    interface CylinderListener extends BasePresenceMask {
        centerX: number;
        centerZ: number;
        radiusSq: number;
        minY: number;
        maxY: number;
    }

    interface AABBListener extends BasePresenceMask {
        minX: number;
        minY: number;
        minZ: number;
        maxX: number;
        maxY: number;
        maxZ: number;
    }

    interface PrismListener extends BasePresenceMask {
        coords: Float32Array;
        vertexCount: number;
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
        minY: number;
        maxY: number;
    }

    interface PlaneListener extends BasePresenceMask {
        axis: AxisType;
        threshold: number;
    }

    interface ExtremaListener {
        type: ExtremaType;
        callback: PlayerExtremaCallback;
        x: number;
        y: number;
        z: number;
        lastPlayerId: number | undefined;
    }

    interface PrismBounds {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
    }

    // =========================================================================
    // Configuration & Pre-Allocated Storage (Zero-GC)
    // =========================================================================

    /** Maximum supported player slots in Battlefield 6 Portal (0-99). */
    export const MAX_PLAYERS = 100;

    /** Maximum supported vertices per polygonal prism (32 vertices). */
    export const MAX_PRISM_VERTICES = 32;

    /** Spatial Grid Voxel Size in world meters (25 meters). */
    const VOXEL_SIZE = 25;

    /** Hash table bucket count for the spatial grid (must be a power of 2). */
    const GRID_TABLE_SIZE = 512;

    /** Bitmask for spatial grid hash mapping (GRID_TABLE_SIZE - 1). */
    const GRID_MASK = GRID_TABLE_SIZE - 1;

    /** Sentinel coordinate value indicating an unspawned, dead, or inactive player. */
    const INVALID_POS = -99999.0;

    /** Tolerance in meters (1 millimeter) for filtering out unspawned/inactive players near origin. */
    const ORIGIN_TOLERANCE_METERS = 0.001;

    // --- State Bit Flags ---
    const FLAG_CONNECTED = 1 << 0; // 1 = Connected / In-Game slot
    const FLAG_ACTIVE = 1 << 1; // 2 = Spawned / Alive with valid 3D coordinates

    // --- 1. Struct of Arrays (SoA) Buffers (32-bit Float Coordinates in Meters) ---
    const posX = new Float32Array(MAX_PLAYERS);
    const posY = new Float32Array(MAX_PLAYERS);
    const posZ = new Float32Array(MAX_PLAYERS);
    const stateFlags = new Uint8Array(MAX_PLAYERS);

    // --- 2. Zero-GC Linked-List Spatial Grid ---
    const gridHead = new Int8Array(GRID_TABLE_SIZE);
    const nextPlayer = new Int8Array(MAX_PLAYERS);

    // --- 3. Three Sorted Axis Arrays (Sweep-and-Prune) ---
    const sortedX = new Uint8Array(MAX_PLAYERS);
    const sortedY = new Uint8Array(MAX_PLAYERS);
    const sortedZ = new Uint8Array(MAX_PLAYERS);

    // --- 4. Query Visit Tracking (Prevents duplicate processing on voxel hash collisions) ---
    const queryVisited = new Uint32Array(MAX_PLAYERS);
    let queryToken = 1;

    // --- Pre-Allocated mod.Player Cache (Fixed-Size Array: MAX_PLAYERS) ---
    const _players: (mod.Player | undefined)[] = new Array(MAX_PLAYERS);

    // --- Private Internal Scratch Buffers (Zero Heap Allocations, Never Exposed) ---
    const _internalScratchIds: number[] = [];
    const _scratchPos: Vectors.Vector3 = { x: 0, y: 0, z: 0 };
    const _scratchCoords = new Float32Array(MAX_PRISM_VERTICES * 2);

    const _scratchPrismBounds: PrismBounds = {
        minX: 0,
        maxX: 0,
        minZ: 0,
        maxZ: 0,
    };

    // Pre-allocated Heap Buffers for K-Closest / K-Farthest queries
    const heapDist = new Float64Array(MAX_PLAYERS);
    const heapId = new Uint8Array(MAX_PLAYERS);

    // Event Subscriptions Storage (Separated by Geometry Type for Monomorphic Efficiency)
    const sphereListeners: SphereListener[] = [];
    const cylinderListeners: CylinderListener[] = [];
    const aabbListeners: AABBListener[] = [];
    const prismListeners: PrismListener[] = [];
    const planeListeners: PlaneListener[] = [];
    const extremaListeners: ExtremaListener[] = [];

    // Track initialization and activity state
    let _isInitialized = false;
    let _lastActiveCount = 0;

    // Initialize ID index and coordinate arrays
    for (let i = 0; i < MAX_PLAYERS; ++i) {
        sortedX[i] = i;
        sortedY[i] = i;
        sortedZ[i] = i;
        posX[i] = INVALID_POS;
        posY[i] = INVALID_POS;
        posZ[i] = INVALID_POS;
    }

    // =========================================================================
    // Internal State & Flag Helpers
    // =========================================================================

    function _getPlayerId(player: number | mod.Player): number | undefined {
        if (typeof player === 'number') return player >= 0 && player < MAX_PLAYERS ? player : undefined;

        const id = mod.GetObjId(player);

        if (id === undefined) return undefined;

        return id >= 0 && id < MAX_PLAYERS ? id : undefined;
    }

    function _isConnected(id: number | undefined): id is number {
        return id !== undefined && id >= 0 && id < MAX_PLAYERS && (stateFlags[id] & FLAG_CONNECTED) !== 0;
    }

    function _isActive(id: number | undefined): id is number {
        return id !== undefined && id >= 0 && id < MAX_PLAYERS && (stateFlags[id] & FLAG_ACTIVE) !== 0;
    }

    function _setFlag(id: number, flag: number): void {
        stateFlags[id] |= flag;
    }

    function _clearFlag(id: number, flag: number): void {
        stateFlags[id] &= ~flag;
    }

    function _clearPresence(mask: BasePresenceMask, id: number): boolean {
        const wordIdx = id >> 5;
        const bitMask = 1 << (id & 31);
        let wasInside = false;

        if (wordIdx === 0) {
            wasInside = (mask.mask0 & bitMask) !== 0;
            mask.mask0 &= ~bitMask;
        } else if (wordIdx === 1) {
            wasInside = (mask.mask1 & bitMask) !== 0;
            mask.mask1 &= ~bitMask;
        } else if (wordIdx === 2) {
            wasInside = (mask.mask2 & bitMask) !== 0;
            mask.mask2 &= ~bitMask;
        } else {
            wasInside = (mask.mask3 & bitMask) !== 0;
            mask.mask3 &= ~bitMask;
        }

        return wasInside;
    }

    function _updatePresence(mask: BasePresenceMask, id: number, isInsideNow: boolean): boolean {
        const wordIdx = id >> 5;
        const bitMask = 1 << (id & 31);
        let wasInside = false;

        if (wordIdx === 0) {
            wasInside = (mask.mask0 & bitMask) !== 0;

            if (isInsideNow) {
                mask.mask0 |= bitMask;
            } else {
                mask.mask0 &= ~bitMask;
            }
        } else if (wordIdx === 1) {
            wasInside = (mask.mask1 & bitMask) !== 0;

            if (isInsideNow) {
                mask.mask1 |= bitMask;
            } else {
                mask.mask1 &= ~bitMask;
            }
        } else if (wordIdx === 2) {
            wasInside = (mask.mask2 & bitMask) !== 0;

            if (isInsideNow) {
                mask.mask2 |= bitMask;
            } else {
                mask.mask2 &= ~bitMask;
            }
        } else {
            wasInside = (mask.mask3 & bitMask) !== 0;

            if (isInsideNow) {
                mask.mask3 |= bitMask;
            } else {
                mask.mask3 &= ~bitMask;
            }
        }

        return wasInside;
    }

    function _clearPlayerPresence(listener: BasePresenceMask, id: number): void {
        const wasInside = _clearPresence(listener, id);

        if (!wasInside || !listener.onExit) return;

        const player = _players[id];

        if (player) {
            CallbackHandler.invoke(listener.onExit, player, id, undefined, undefined, logging, 'clearPlayerPresence');
        }
    }

    function _resetPlayer(id: number): void {
        _clearFlag(id, FLAG_CONNECTED | FLAG_ACTIVE);

        posX[id] = INVALID_POS;
        posY[id] = INVALID_POS;
        posZ[id] = INVALID_POS;
        nextPlayer[id] = -1;

        for (let i = 0; i < sphereListeners.length; ++i) {
            _clearPlayerPresence(sphereListeners[i], id);
        }

        for (let i = 0; i < cylinderListeners.length; ++i) {
            _clearPlayerPresence(cylinderListeners[i], id);
        }

        for (let i = 0; i < aabbListeners.length; ++i) {
            _clearPlayerPresence(aabbListeners[i], id);
        }

        for (let i = 0; i < prismListeners.length; ++i) {
            _clearPlayerPresence(prismListeners[i], id);
        }

        for (let i = 0; i < planeListeners.length; ++i) {
            _clearPlayerPresence(planeListeners[i], id);
        }

        _players[id] = undefined;
    }

    function _initConnectedPlayers(): void {
        const all = mod.AllPlayers();
        const count = mod.CountOf(all);

        for (let i = 0; i < count; ++i) {
            const player = mod.ValueInArray(all, i) as mod.Player;
            const id = mod.GetObjId(player);

            if (id < 0 || id >= MAX_PLAYERS) continue;

            _setFlag(id, FLAG_CONNECTED);
            _players[id] = player;
        }
    }

    function _countPlayersByFlag(flag: number): number {
        let count = 0;

        for (let i = 0; i < MAX_PLAYERS; ++i) {
            if ((stateFlags[i] & flag) === 0) continue;

            ++count;
        }

        return count;
    }

    function _findPlayersByFlag(
        flag: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        // Fast count-only path.
        if (!filterFn && !idsOut && !playersOut) return _countPlayersByFlag(flag);

        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        let count = 0;

        for (let i = 0; i < MAX_PLAYERS; ++i) {
            if ((stateFlags[i] & flag) === 0) continue;

            const p = _players[i]!;

            if (filterFn && !filterFn(p, i)) continue;

            if (idsOut) {
                idsOut[count] = i;
            }

            if (playersOut) {
                playersOut[count] = p;
            }

            ++count;
        }

        return count;
    }

    // =========================================================================
    // Event Handlers
    // =========================================================================

    function _handlePlayerJoin(player: mod.Player): void {
        const id = mod.GetObjId(player);

        if (id < 0 || id >= MAX_PLAYERS) return;

        _setFlag(id, FLAG_CONNECTED);
        _players[id] = player;
    }

    function _handlePlayerLeave(id: number): void {
        if (id < 0 || id >= MAX_PLAYERS) return;

        _resetPlayer(id);
    }

    function _updateListenerPresence(listener: BasePresenceMask, id: number, isInsideNow: boolean): void {
        const wasInside = _updatePresence(listener, id, isInsideNow);

        if (!wasInside && isInsideNow) {
            if (!listener.onEnter) return;

            const player = _players[id];

            if (player) {
                CallbackHandler.invoke(listener.onEnter, player, id, undefined, undefined, logging, 'onEnter');
            }
        } else if (wasInside && !isInsideNow) {
            if (!listener.onExit) return;

            const player = _players[id];

            if (player) {
                CallbackHandler.invoke(listener.onExit, player, id, undefined, undefined, logging, 'onExit');
            }
        }
    }

    function _evaluateSphereSubscriptions(): void {
        const sphereCount = sphereListeners.length;

        if (sphereCount === 0) return;

        for (let z = 0; z < sphereCount; ++z) {
            const l = sphereListeners[z];
            const cx = l.centerX;
            const cy = l.centerY;
            const cz = l.centerZ;
            const rSq = l.radiusSq;

            for (let id = 0; id < MAX_PLAYERS; ++id) {
                let isInside = false;

                if (_isActive(id)) {
                    const dx = posX[id] - cx;
                    const dy = posY[id] - cy;
                    const dz = posZ[id] - cz;
                    isInside = dx * dx + dy * dy + dz * dz <= rSq;
                }

                _updateListenerPresence(l, id, isInside);
            }
        }
    }

    function _evaluateCylinderSubscriptions(): void {
        const cylinderCount = cylinderListeners.length;

        if (cylinderCount === 0) return;

        for (let z = 0; z < cylinderCount; ++z) {
            const l = cylinderListeners[z];
            const cx = l.centerX;
            const cz = l.centerZ;
            const rSq = l.radiusSq;
            const minY = l.minY;
            const maxY = l.maxY;

            for (let id = 0; id < MAX_PLAYERS; ++id) {
                let isInside = false;

                if (_isActive(id)) {
                    const y = posY[id];

                    if (y >= minY && y <= maxY) {
                        const dx = posX[id] - cx;
                        const dz = posZ[id] - cz;
                        isInside = dx * dx + dz * dz <= rSq;
                    }
                }

                _updateListenerPresence(l, id, isInside);
            }
        }
    }

    function _evaluateAabbSubscriptions(): void {
        const aabbCount = aabbListeners.length;

        if (aabbCount === 0) return;

        for (let z = 0; z < aabbCount; ++z) {
            const l = aabbListeners[z];
            const minX = l.minX;
            const minY = l.minY;
            const minZ = l.minZ;
            const maxX = l.maxX;
            const maxY = l.maxY;
            const maxZ = l.maxZ;

            for (let id = 0; id < MAX_PLAYERS; ++id) {
                let isInside = false;

                if (_isActive(id)) {
                    const x = posX[id];
                    const y = posY[id];
                    const z = posZ[id];
                    isInside = x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ;
                }

                _updateListenerPresence(l, id, isInside);
            }
        }
    }

    function _evaluatePrismSubscriptions(): void {
        const prismCount = prismListeners.length;

        if (prismCount === 0) return;

        for (let z = 0; z < prismCount; ++z) {
            const l = prismListeners[z];
            const count = l.vertexCount;

            if (count < 3) continue;

            const minX = l.minX;
            const maxX = l.maxX;
            const minZ = l.minZ;
            const maxZ = l.maxZ;
            const minY = l.minY;
            const maxY = l.maxY;
            const coords = l.coords;

            for (let id = 0; id < MAX_PLAYERS; ++id) {
                let isInside = false;

                if (_isActive(id)) {
                    const y = posY[id];

                    if (y >= minY && y <= maxY) {
                        const x = posX[id];
                        const pz = posZ[id];

                        if (x >= minX && x <= maxX && pz >= minZ && pz <= maxZ) {
                            isInside = _isPointInPolygon(x, pz, coords, count);
                        }
                    }
                }

                _updateListenerPresence(l, id, isInside);
            }
        }
    }

    function _evaluatePlaneSubscriptions(): void {
        const planeCount = planeListeners.length;

        if (planeCount === 0) return;

        for (let z = 0; z < planeCount; ++z) {
            const l = planeListeners[z];
            const thresh = l.threshold;
            const posArr = l.axis === AxisType.X ? posX : l.axis === AxisType.Y ? posY : posZ;

            for (let id = 0; id < MAX_PLAYERS; ++id) {
                const isInside = _isActive(id) && posArr[id] >= thresh;

                _updateListenerPresence(l, id, isInside);
            }
        }
    }

    function _evaluateExtremaSubscriptions(): void {
        const extremaCount = extremaListeners.length;

        if (extremaCount === 0) return;

        for (let i = 0; i < extremaCount; ++i) {
            const l = extremaListeners[i];
            let currId: number | undefined = undefined;

            if (l.type === ExtremaType.Highest) {
                currId = getHighestPlayerId();
            } else if (l.type === ExtremaType.Lowest) {
                currId = getLowestPlayerId();
            } else if (l.type === ExtremaType.Closest) {
                currId = getClosestPlayerId(l.x, l.y, l.z);
            } else if (l.type === ExtremaType.Farthest) {
                currId = getFarthestPlayerId(l.x, l.y, l.z);
            }

            if (currId === l.lastPlayerId) continue;

            const prevId = l.lastPlayerId;
            l.lastPlayerId = currId;

            const newPlayer = currId !== undefined ? _players[currId] : undefined;
            const prevPlayer = prevId !== undefined ? _players[prevId] : undefined;

            CallbackHandler.invoke(l.callback, newPlayer, prevPlayer, currId, prevId, logging, 'onExtremaChange');
        }
    }

    function _handleTick(): void {
        // Fast path: if no players are connected to the server, skip all tick processing
        if (_countPlayersByFlag(FLAG_CONNECTED) === 0) {
            _lastActiveCount = 0;
            return;
        }

        // Clear Grid Head Table
        gridHead.fill(-1);

        let activeCount = 0;

        // Phase 1: Fetch positions for connected players, convert to scaled ints, update SoA & Grid
        for (let id = 0; id < MAX_PLAYERS; ++id) {
            if (!_isConnected(id)) continue;

            const player = _players[id];

            if (player === undefined) {
                _resetPlayer(id);
                continue;
            }

            Vectors.toVector3(mod.GetObjectPosition(player), _scratchPos);

            // Filter out inactive/dead/unspawned players near origin (within 1mm tolerance)
            if (Vectors.isZero(_scratchPos, ORIGIN_TOLERANCE_METERS)) {
                _clearFlag(id, FLAG_ACTIVE);
                posX[id] = INVALID_POS;
                posY[id] = INVALID_POS;
                posZ[id] = INVALID_POS;
                nextPlayer[id] = -1;

                continue;
            }

            _setFlag(id, FLAG_ACTIVE);
            ++activeCount;

            const x = _scratchPos.x;
            const y = _scratchPos.y;
            const z = _scratchPos.z;

            posX[id] = x;
            posY[id] = y;
            posZ[id] = z;

            // Insert into 3D Linked Voxel Grid
            const gx = Math.floor(x / VOXEL_SIZE) | 0;
            const gy = Math.floor(y / VOXEL_SIZE) | 0;
            const gz = Math.floor(z / VOXEL_SIZE) | 0;
            const cellHash = _hashVoxel(gx, gy, gz);

            nextPlayer[id] = gridHead[cellHash];
            gridHead[cellHash] = id;
        }

        // If no players are active this tick and were not active last tick, skip sorting and subscriptions
        if (activeCount === 0 && _lastActiveCount === 0) return;

        _lastActiveCount = activeCount;

        // Phase 2: Update 3 Sorted Axis Arrays via Insertion Sort (O(N) near-linear time)
        _insertionSort(sortedX, posX);
        _insertionSort(sortedY, posY);
        _insertionSort(sortedZ, posZ);

        // Phase 3: Evaluate Active Reactive Subscriptions (Zero-GC Bitmask Diffing)
        _evaluateSphereSubscriptions();
        _evaluateCylinderSubscriptions();
        _evaluateAabbSubscriptions();
        _evaluatePrismSubscriptions();
        _evaluatePlaneSubscriptions();
        _evaluateExtremaSubscriptions();
    }

    // =========================================================================
    // Internal Helper Math & Sorting
    // =========================================================================

    /**
     * Unpacks an array of PrismVertex points into a flat interleaved Float32Array buffer
     * [x0, z0, x1, z1, ...] and computes the 2D bounding box (minX, maxX, minZ, maxZ).
     *
     * Bounding box values are written into the targetBounds target object to eliminate heap allocations.
     * @param vertices - Array of {x, z} vertex objects defining the polygon.
     * @param targetCoords - Target Float32Array to write interleaved coordinates [x0, z0, x1, z1, ...] into.
     * @param targetBounds - Target object to populate with bounding box.
     */
    function _unpackVertices(vertices: PrismVertex[], targetCoords: Float32Array, targetBounds: PrismBounds): void {
        const count = vertices.length;

        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;

        for (let i = 0; i < count; ++i) {
            const v = vertices[i];
            const vx = v.x;
            const vz = v.z;
            const i2 = i << 1;

            targetCoords[i2] = vx;
            targetCoords[i2 + 1] = vz;

            if (vx < minX) {
                minX = vx;
            }

            if (vx > maxX) {
                maxX = vx;
            }

            if (vz < minZ) {
                minZ = vz;
            }

            if (vz > maxZ) {
                maxZ = vz;
            }
        }

        targetBounds.minX = minX;
        targetBounds.maxX = maxX;
        targetBounds.minZ = minZ;
        targetBounds.maxZ = maxZ;
    }

    /**
     * Determines whether a 2D point (px, pz) lies inside a polygon defined by interleaved coordinates.
     * Uses the Jordan Curve Theorem (Ray-Casting even-odd rule).
     * @param px - Point X coordinate in meters.
     * @param pz - Point Z coordinate in meters.
     * @param coords - Flat Float32Array of interleaved polygon coordinates [x0, z0, x1, z1, ...].
     * @param count - Total number of vertices.
     * @returns True if point is inside the polygon, false otherwise.
     */
    function _isPointInPolygon(px: number, pz: number, coords: Float32Array, count: number): boolean {
        if (count < 3) return false;

        let inside = false;

        for (let i = 0, j = count - 1; i < count; j = i++) {
            const i2 = i << 1;
            const j2 = j << 1;
            const xi = coords[i2];
            const zi = coords[i2 + 1];
            const xj = coords[j2];
            const zj = coords[j2 + 1];

            const intersect = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi;

            if (!intersect) continue;

            inside = !inside;
        }

        return inside;
    }

    function _hashVoxel(gx: number, gy: number, gz: number): number {
        // Fast spatial integer hash mapped to 0..511
        return ((gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791)) & GRID_MASK;
    }

    function _insertionSort(sortedArray: Uint8Array, posArray: Float32Array): void {
        for (let i = 1; i < MAX_PLAYERS; ++i) {
            const keyId = sortedArray[i];
            const keyVal = posArray[keyId];
            let j = i - 1;

            while (j >= 0 && posArray[sortedArray[j]] > keyVal) {
                sortedArray[j + 1] = sortedArray[j];
                --j;
            }

            sortedArray[j + 1] = keyId;
        }
    }

    function _findLowerBound(sortedArray: Uint8Array, posArray: Float32Array, targetVal: number): number {
        let low = 0;
        let high = MAX_PLAYERS - 1;
        let ans = MAX_PLAYERS;

        while (low <= high) {
            const mid = (low + high) >> 1;

            if (posArray[sortedArray[mid]] >= targetVal) {
                ans = mid;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }

        return ans;
    }

    function _findUpperBound(sortedArray: Uint8Array, posArray: Float32Array, targetVal: number): number {
        let low = 0;
        let high = MAX_PLAYERS - 1;
        let ans = -1;

        while (low <= high) {
            const mid = (low + high) >> 1;

            if (posArray[sortedArray[mid]] <= targetVal) {
                ans = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return ans;
    }

    function _findPlayersGte(
        sortedArray: Uint8Array,
        posArray: Float32Array,
        valMeters: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        const lx = _findLowerBound(sortedArray, posArray, valMeters);
        let count = 0;

        // Fast count-only path.
        if (!filterFn && !idsOut && !playersOut) {
            for (let i = lx; i < MAX_PLAYERS; ++i) {
                if (!_isActive(sortedArray[i])) continue;

                ++count;
            }

            return count;
        }

        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        for (let i = lx; i < MAX_PLAYERS; ++i) {
            const id = sortedArray[i];

            if (!_isActive(id)) continue;

            const p = _players[id]!;

            if (filterFn && !filterFn(p, id)) continue;

            if (idsOut) {
                idsOut[count] = id;
            }

            if (playersOut) {
                playersOut[count] = p;
            }

            ++count;
        }

        return count;
    }

    function _findPlayersLte(
        sortedArray: Uint8Array,
        posArray: Float32Array,
        valMeters: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        const ux = _findUpperBound(sortedArray, posArray, valMeters);
        let count = 0;

        // Fast count-only path.
        if (!filterFn && !idsOut && !playersOut) {
            for (let i = 0; i <= ux; ++i) {
                if (!_isActive(sortedArray[i])) continue;

                ++count;
            }

            return count;
        }

        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        for (let i = 0; i <= ux; ++i) {
            const id = sortedArray[i];

            if (!_isActive(id)) continue;

            const p = _players[id]!;

            if (filterFn && !filterFn(p, id)) continue;

            if (idsOut) {
                idsOut[count] = id;
            }

            if (playersOut) {
                playersOut[count] = p;
            }

            ++count;
        }

        return count;
    }

    // =========================================================================
    // Internal Heap Helpers (Zero-GC)
    // =========================================================================

    function _heapPush(distSq: number, id: number, heapSize: number, isMax: boolean): void {
        let idx = heapSize;
        heapDist[idx] = distSq;
        heapId[idx] = id;

        while (idx > 0) {
            const parent = (idx - 1) >> 1;

            if (isMax ? heapDist[idx] <= heapDist[parent] : heapDist[idx] >= heapDist[parent]) break;

            const td = heapDist[idx];
            heapDist[idx] = heapDist[parent];
            heapDist[parent] = td;

            const ti = heapId[idx];
            heapId[idx] = heapId[parent];
            heapId[parent] = ti;

            idx = parent;
        }
    }

    function _heapReplaceRoot(distSq: number, id: number, heapSize: number, isMax: boolean): void {
        heapDist[0] = distSq;
        heapId[0] = id;
        let idx = 0;

        while (true) {
            let best = idx;
            const left = (idx << 1) + 1;
            const right = left + 1;

            if (left < heapSize && (isMax ? heapDist[left] > heapDist[best] : heapDist[left] < heapDist[best])) {
                best = left;
            }

            if (right < heapSize && (isMax ? heapDist[right] > heapDist[best] : heapDist[right] < heapDist[best])) {
                best = right;
            }

            if (best === idx) break;

            const td = heapDist[idx];
            heapDist[idx] = heapDist[best];
            heapDist[best] = td;

            const ti = heapId[idx];
            heapId[idx] = heapId[best];
            heapId[best] = ti;

            idx = best;
        }
    }

    function _getExtremumPlayer(
        x: number,
        y: number,
        z: number,
        findClosest: boolean,
        filterFn?: (player: mod.Player, id: number) => boolean
    ): number | undefined {
        let bestId: number | undefined = undefined;
        let bestDistSq = findClosest ? Infinity : -1;

        for (let id = 0; id < MAX_PLAYERS; ++id) {
            if (!_isActive(id)) continue;

            if (filterFn && !filterFn(_players[id]!, id)) continue;

            const dx = posX[id] - x;
            const dy = posY[id] - y;
            const dz = posZ[id] - z;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (findClosest ? distSq < bestDistSq : distSq > bestDistSq) {
                bestDistSq = distSq;
                bestId = id;
            }
        }

        return bestId;
    }

    function _getKExtremumDistancePlayers(
        x: number,
        y: number,
        z: number,
        k: number,
        isClosest: boolean,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        if (k <= 0) return 0;

        const targetK = k > MAX_PLAYERS ? MAX_PLAYERS : k;
        let heapSize = 0;

        for (let id = 0; id < MAX_PLAYERS; ++id) {
            if (!_isActive(id)) continue;

            if (filterFn && !filterFn(_players[id]!, id)) continue;

            const dx = posX[id] - x;
            const dy = posY[id] - y;
            const dz = posZ[id] - z;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (heapSize < targetK) {
                _heapPush(distSq, id, heapSize, isClosest);
                ++heapSize;
            } else if (isClosest ? distSq < heapDist[0] : distSq > heapDist[0]) {
                _heapReplaceRoot(distSq, id, heapSize, isClosest);
            }
        }

        if (idsOut) {
            idsOut.length = heapSize;
        }

        if (playersOut) {
            playersOut.length = heapSize;
        }

        let currentSize = heapSize;

        for (let i = heapSize - 1; i >= 0; --i) {
            const id = heapId[0];

            if (idsOut) {
                idsOut[i] = id;
            }

            if (playersOut) {
                playersOut[i] = _players[id]!;
            }

            if (i <= 0) break;

            _heapReplaceRoot(heapDist[currentSize - 1], heapId[currentSize - 1], currentSize - 1, isClosest);
            --currentSize;
        }

        return heapSize;
    }

    function _getKExtremes(
        sortedArray: Uint8Array,
        k: number,
        reverse: boolean,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        if (k <= 0) return 0;

        const targetK = k > MAX_PLAYERS ? MAX_PLAYERS : k;
        let count = 0;

        const start = reverse ? MAX_PLAYERS - 1 : 0;
        const end = reverse ? -1 : MAX_PLAYERS;
        const step = reverse ? -1 : 1;

        for (let i = start; i !== end; i += step) {
            const id = sortedArray[i];

            if (!_isActive(id)) continue;

            const p = _players[id]!;

            if (filterFn && !filterFn(p, id)) continue;

            if (idsOut) {
                idsOut[count] = id;
            }

            if (playersOut) {
                playersOut[count] = p;
            }

            if (++count === targetK) break;
        }

        return count;
    }

    // =========================================================================
    // Exposed Player State Functions
    // =========================================================================

    /**
     * Gets world coordinates in meters for an active player.
     * Pass an `out` vector for zero-allocation reuse.
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @param out - Optional target Vector3 to write coordinates into.
     * @returns The Vector3 position in meters, null if the player is connected but unspawned/inactive, or undefined if not connected.
     */
    export function getPosition(
        player: number | mod.Player,
        out?: Vectors.Vector3
    ): Vectors.Vector3 | null | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        if (!_isActive(id)) return null;

        const res = out || { x: 0, y: 0, z: 0 };
        res.x = posX[id];
        res.y = posY[id];
        res.z = posZ[id];

        return res;
    }

    /**
     * Checks if a player slot is currently connected to the server.
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @returns True if the player is connected, false otherwise.
     */
    export function isPlayerConnected(player: number | mod.Player): boolean {
        return _isConnected(_getPlayerId(player));
    }

    /**
     * Checks if a player is active (connected, spawned, and tracked with a valid 3D position).
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @returns True if active/spawned, false if connected but inactive, or undefined if the player is not connected.
     */
    export function isPlayerActive(player: number | mod.Player): boolean | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        return _isActive(id);
    }

    /**
     * Returns the total count of currently connected players.
     * @returns The number of connected players.
     */
    export function getConnectedPlayerCount(): number {
        return _countPlayersByFlag(FLAG_CONNECTED);
    }

    /**
     * Returns the total count of currently active (spawned) players.
     * @returns The number of active players.
     */
    export function getActivePlayerCount(): number {
        return _countPlayersByFlag(FLAG_ACTIVE);
    }

    /**
     * Retrieves the cached engine `mod.Player` object for a given player ID or object.
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @returns The engine mod.Player object, or undefined if the player is not connected or invalid.
     */
    export function getPlayer(player: number | mod.Player): mod.Player | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        return _players[id!];
    }

    /**
     * Resolves the integer slot ID (0-99) for a given player ID or engine mod.Player object.
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @returns The integer player slot ID (0-99), or undefined if the player is not connected or invalid.
     */
    export function getPlayerId(player: number | mod.Player): number | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        return id;
    }

    /**
     * Zero-GC batch utility to map an array of player IDs to their corresponding cached `mod.Player` objects.
     * Populates and returns the provided `playersOut` array.
     * Non-connected or invalid player IDs are set to `undefined`.
     * @param ids - Array of player IDs to convert.
     * @param playersOut - Optional target array to write mod.Player objects into.
     * @returns The players array.
     */
    export function toPlayers(
        ids: (number | undefined)[],
        playersOut?: (mod.Player | undefined)[]
    ): (mod.Player | undefined)[] {
        const out = playersOut ?? [];
        out.length = 0;
        const length = ids.length;

        for (let i = 0; i < length; ++i) {
            const id = ids[i];

            out[i] = _isConnected(id) ? _players[id] : undefined;
        }

        return out;
    }

    /**
     * Zero-GC batch utility to resolve an array of engine `mod.Player` objects to their integer slot IDs.
     * Populates and returns the provided `idsOut` array.
     * Non-connected or invalid players are set to `undefined`.
     * @param players - Array of mod.Player objects to convert.
     * @param idsOut - Optional target array to write player IDs into.
     * @returns The ids array.
     */
    export function toPlayerIds(
        players: (mod.Player | undefined)[],
        idsOut?: (number | undefined)[]
    ): (number | undefined)[] {
        const out = idsOut ?? [];
        out.length = 0;
        const length = players.length;

        for (let i = 0; i < length; ++i) {
            const p = players[i];

            if (!p) {
                out[i] = undefined;
                continue;
            }

            const id = _getPlayerId(p);

            out[i] = _isConnected(id) ? id : undefined;
        }

        return out;
    }

    /**
     * Finds all currently connected players.
     * If no buffers are provided, simply returns the connected player count with zero memory writes.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write connected player IDs into.
     * @param playersOut - Optional target array to write connected mod.Player objects into.
     * @returns The total number of connected players found.
     */
    export function findConnectedPlayers(
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _findPlayersByFlag(FLAG_CONNECTED, filterFn, idsOut, playersOut);
    }

    /**
     * Finds all currently active (spawned) players with valid 3D coordinates.
     * If no buffers are provided, simply returns the active player count with zero memory writes.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players found.
     */
    export function findActivePlayers(
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _findPlayersByFlag(FLAG_ACTIVE, filterFn, idsOut, playersOut);
    }

    // =========================================================================
    // Exposed Distance Functions
    // =========================================================================

    /**
     * Returns the squared 3D Euclidean distance in meters squared (m^2) between two active players.
     * Avoids square root overhead.
     * @param playerA - The first player slot ID (0-99) or engine mod.Player object.
     * @param playerB - The second player slot ID (0-99) or engine mod.Player object.
     * @returns The squared distance in meters squared, Infinity if either player is inactive, or undefined if either player is not connected.
     */
    export function getDistanceSq(playerA: number | mod.Player, playerB: number | mod.Player): number | undefined {
        const idA = _getPlayerId(playerA);
        const idB = _getPlayerId(playerB);

        if (!_isConnected(idA) || !_isConnected(idB)) return undefined;

        if (!_isActive(idA) || !_isActive(idB)) return Infinity;

        const dx = posX[idA] - posX[idB];
        const dy = posY[idA] - posY[idB];
        const dz = posZ[idA] - posZ[idB];

        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * Returns the 3D Euclidean distance in meters between two active players.
     * @param playerA - The first player slot ID (0-99) or engine mod.Player object.
     * @param playerB - The second player slot ID (0-99) or engine mod.Player object.
     * @returns The distance in meters, Infinity if either player is inactive, or undefined if either player is not connected.
     */
    export function getDistance(playerA: number | mod.Player, playerB: number | mod.Player): number | undefined {
        const distSq = getDistanceSq(playerA, playerB);

        if (distSq === undefined) return undefined;

        return distSq === Infinity ? Infinity : Math.sqrt(distSq);
    }

    /**
     * Returns the squared 2D horizontal distance in meters squared (m^2) on the XZ plane between two active players.
     * Avoids square root overhead and ignores vertical elevation differences.
     * @param playerA - The first player slot ID (0-99) or engine mod.Player object.
     * @param playerB - The second player slot ID (0-99) or engine mod.Player object.
     * @returns The horizontal squared distance in meters squared, Infinity if either player is inactive, or undefined if either player is not connected.
     */
    export function getDistanceSqXZ(playerA: number | mod.Player, playerB: number | mod.Player): number | undefined {
        const idA = _getPlayerId(playerA);
        const idB = _getPlayerId(playerB);

        if (!_isConnected(idA) || !_isConnected(idB)) return undefined;

        if (!_isActive(idA) || !_isActive(idB)) return Infinity;

        const dx = posX[idA] - posX[idB];
        const dz = posZ[idA] - posZ[idB];

        return dx * dx + dz * dz;
    }

    /**
     * Returns the 2D horizontal distance in meters on the XZ plane between two active players.
     * Ignores vertical elevation differences.
     * @param playerA - The first player slot ID (0-99) or engine mod.Player object.
     * @param playerB - The second player slot ID (0-99) or engine mod.Player object.
     * @returns The horizontal distance in meters, Infinity if either player is inactive, or undefined if either player is not connected.
     */
    export function getDistanceXZ(playerA: number | mod.Player, playerB: number | mod.Player): number | undefined {
        const distSq = getDistanceSqXZ(playerA, playerB);

        if (distSq === undefined) return undefined;

        return distSq === Infinity ? Infinity : Math.sqrt(distSq);
    }

    // =========================================================================
    // Exposed Proximity Query Functions
    // =========================================================================

    /**
     * Fast 3D Volumetric Sphere Query using 3D Linked Voxel Grid.
     * Executes in O(cells) with ZERO Garbage Collection pressure.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param x - Target X coordinate in world meters.
     * @param y - Target Y coordinate in world meters.
     * @param z - Target Z coordinate in world meters.
     * @param radiusMeters - Search sphere radius in meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players found within the sphere.
     */
    export function findPlayersInSphere(
        x: number,
        y: number,
        z: number,
        radiusMeters: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        if (radiusMeters <= 0) return 0;

        const radiusSq = radiusMeters * radiusMeters;
        const minGx = Math.floor((x - radiusMeters) / VOXEL_SIZE);
        const maxGx = Math.floor((x + radiusMeters) / VOXEL_SIZE);
        const minGy = Math.floor((y - radiusMeters) / VOXEL_SIZE);
        const maxGy = Math.floor((y + radiusMeters) / VOXEL_SIZE);
        const minGz = Math.floor((z - radiusMeters) / VOXEL_SIZE);
        const maxGz = Math.floor((z + radiusMeters) / VOXEL_SIZE);

        // Advance query token for visit stamping
        ++queryToken;

        if (queryToken === 0xffffffff) {
            queryVisited.fill(0);
            queryToken = 1;
        }

        const currentToken = queryToken;
        let count = 0;

        for (let gx = minGx; gx <= maxGx; ++gx) {
            for (let gy = minGy; gy <= maxGy; ++gy) {
                for (let gz = minGz; gz <= maxGz; ++gz) {
                    const hash = _hashVoxel(gx, gy, gz);

                    for (let pId = gridHead[hash]; pId !== -1; pId = nextPlayer[pId]) {
                        if (queryVisited[pId] === currentToken) continue;

                        queryVisited[pId] = currentToken;

                        if (!_isActive(pId)) continue;

                        const dx = posX[pId] - x;
                        const dy = posY[pId] - y;
                        const dz = posZ[pId] - z;

                        if (dx * dx + dy * dy + dz * dz > radiusSq) continue;

                        const p = _players[pId]!;

                        if (filterFn && !filterFn(p, pId)) continue;

                        if (idsOut) {
                            idsOut[count] = pId;
                        }

                        if (playersOut) {
                            playersOut[count] = p;
                        }

                        ++count;
                    }
                }
            }
        }

        return count;
    }

    /**
     * Finds all active players outside a 3D sphere.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param x - Center X coordinate in world meters.
     * @param y - Center Y coordinate in world meters.
     * @param z - Center Z coordinate in world meters.
     * @param radiusMeters - Sphere radius in meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players found strictly outside the sphere.
     */
    export function findPlayersOutsideSphere(
        x: number,
        y: number,
        z: number,
        radiusMeters: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        const radiusSq = radiusMeters * radiusMeters;
        let count = 0;

        for (let id = 0; id < MAX_PLAYERS; ++id) {
            if (!_isActive(id)) continue;

            const p = _players[id]!;

            if (filterFn && !filterFn(p, id)) continue;

            const dx = posX[id] - x;
            const dy = posY[id] - y;
            const dz = posZ[id] - z;

            if (dx * dx + dy * dy + dz * dz <= radiusSq) continue;

            if (idsOut) {
                idsOut[count] = id;
            }

            if (playersOut) {
                playersOut[count] = p;
            }

            ++count;
        }

        return count;
    }

    /**
     * Fast 2.5D Volumetric Cylinder Query (horizontal radius on XZ plane with vertical Y bounds).
     * Uses sweep-and-prune axis selection for high performance.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param centerX - Center X coordinate in world meters.
     * @param centerZ - Center Z coordinate in world meters.
     * @param radiusMeters - Cylinder horizontal radius in meters.
     * @param minY - Optional minimum Y elevation in meters (default: -Infinity).
     * @param maxY - Optional maximum Y elevation in meters (default: Infinity).
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players found within the cylinder.
     */
    export function findPlayersInCylinder(
        centerX: number,
        centerZ: number,
        radiusMeters: number,
        minY: number = -Infinity,
        maxY: number = Infinity,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        if (radiusMeters <= 0) return 0;

        const radiusSq = radiusMeters * radiusMeters;
        const minX = centerX - radiusMeters;
        const maxX = centerX + radiusMeters;
        const minZ = centerZ - radiusMeters;
        const maxZ = centerZ + radiusMeters;

        const lx = _findLowerBound(sortedX, posX, minX);
        const ux = _findUpperBound(sortedX, posX, maxX);
        const lz = _findLowerBound(sortedZ, posZ, minZ);
        const uz = _findUpperBound(sortedZ, posZ, maxZ);

        const countX = ux >= lx ? ux - lx + 1 : 0;
        const countZ = uz >= lz ? uz - lz + 1 : 0;

        const bestSorted = countX <= countZ ? sortedX : sortedZ;
        const start = countX <= countZ ? lx : lz;
        const end = countX <= countZ ? ux : uz;
        let count = 0;

        for (let i = start; i <= end; ++i) {
            const id = bestSorted[i];

            if (!_isActive(id) || posY[id] < minY || posY[id] > maxY) continue;

            const dx = posX[id] - centerX;
            const dz = posZ[id] - centerZ;

            if (dx * dx + dz * dz > radiusSq) continue;

            const p = _players[id]!;

            if (filterFn && !filterFn(p, id)) continue;

            if (idsOut) {
                idsOut[count] = id;
            }

            if (playersOut) {
                playersOut[count] = p;
            }

            ++count;
        }

        return count;
    }

    /**
     * Finds all active players outside a 2.5D vertical cylinder.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param centerX - Center X coordinate in world meters.
     * @param centerZ - Center Z coordinate in world meters.
     * @param radiusMeters - Cylinder horizontal radius in meters.
     * @param minY - Optional minimum Y elevation in meters (default: -Infinity).
     * @param maxY - Optional maximum Y elevation in meters (default: Infinity).
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players found strictly outside the cylinder.
     */
    export function findPlayersOutsideCylinder(
        centerX: number,
        centerZ: number,
        radiusMeters: number,
        minY: number = -Infinity,
        maxY: number = Infinity,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        const radiusSq = radiusMeters * radiusMeters;
        let count = 0;

        for (let id = 0; id < MAX_PLAYERS; ++id) {
            if (!_isActive(id)) continue;

            const p = _players[id]!;

            if (filterFn && !filterFn(p, id)) continue;

            const y = posY[id];

            if (y < minY || y > maxY) {
                if (idsOut) {
                    idsOut[count] = id;
                }

                if (playersOut) {
                    playersOut[count] = p;
                }

                ++count;

                continue;
            }

            const dx = posX[id] - centerX;
            const dz = posZ[id] - centerZ;

            if (dx * dx + dz * dz > radiusSq) {
                if (idsOut) {
                    idsOut[count] = id;
                }

                if (playersOut) {
                    playersOut[count] = p;
                }

                ++count;
            }
        }

        return count;
    }

    /**
     * Fast 3D AABB Box Query using 3-Axis Sweep-and-Prune.
     * Evaluates binary search ranges across all 3 axes and iterates along the axis with the fewest candidate elements.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param minX - Minimum X coordinate in world meters.
     * @param minY - Minimum Y coordinate in world meters.
     * @param minZ - Minimum Z coordinate in world meters.
     * @param maxX - Maximum X coordinate in world meters.
     * @param maxY - Maximum Y coordinate in world meters.
     * @param maxZ - Maximum Z coordinate in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players found within the bounding box.
     */
    export function findPlayersInAABB(
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        // Binary search bounds across all 3 sorted axes
        const lx = _findLowerBound(sortedX, posX, minX);
        const ux = _findUpperBound(sortedX, posX, maxX);

        const ly = _findLowerBound(sortedY, posY, minY);
        const uy = _findUpperBound(sortedY, posY, maxY);

        const lz = _findLowerBound(sortedZ, posZ, minZ);
        const uz = _findUpperBound(sortedZ, posZ, maxZ);

        const countX = ux >= lx ? ux - lx + 1 : 0;
        const countY = uy >= ly ? uy - ly + 1 : 0;
        const countZ = uz >= lz ? uz - lz + 1 : 0;

        // Disjoint axis: zero players can possibly match
        if (countX === 0 || countY === 0 || countZ === 0) return 0;

        // Pick whichever sorted axis has the fewest candidate elements
        let sorted = sortedZ;
        let start = lz;
        let end = uz;

        if (countX <= countY && countX <= countZ) {
            sorted = sortedX;
            start = lx;
            end = ux;
        } else if (countY <= countX && countY <= countZ) {
            sorted = sortedY;
            start = ly;
            end = uy;
        }

        let count = 0;

        for (let i = start; i <= end; ++i) {
            const id = sorted[i];

            if (!_isActive(id)) continue;

            if (posX[id] < minX || posX[id] > maxX) continue;

            if (posY[id] < minY || posY[id] > maxY) continue;

            if (posZ[id] < minZ || posZ[id] > maxZ) continue;

            const p = _players[id]!;

            if (filterFn && !filterFn(p, id)) continue;

            if (idsOut) {
                idsOut[count] = id;
            }

            if (playersOut) {
                playersOut[count] = p;
            }

            ++count;
        }

        return count;
    }

    /**
     * Finds all active players outside a 3D Axis-Aligned Bounding Box (AABB).
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param minX - Minimum X coordinate in world meters.
     * @param minY - Minimum Y coordinate in world meters.
     * @param minZ - Minimum Z coordinate in world meters.
     * @param maxX - Maximum X coordinate in world meters.
     * @param maxY - Maximum Y coordinate in world meters.
     * @param maxZ - Maximum Z coordinate in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players found strictly outside the bounding box.
     */
    export function findPlayersOutsideAABB(
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        let count = 0;

        for (let id = 0; id < MAX_PLAYERS; ++id) {
            if (!_isActive(id)) continue;

            const p = _players[id]!;

            if (filterFn && !filterFn(p, id)) continue;

            const x = posX[id];
            const y = posY[id];
            const z = posZ[id];

            if (x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ) continue;

            if (idsOut) {
                idsOut[count] = id;
            }

            if (playersOut) {
                playersOut[count] = p;
            }

            ++count;
        }

        return count;
    }

    /**
     * Fast 2.5D Polygonal Prism Query (extruded polygon on XZ plane with vertical Y bounds).
     * Uses 3-axis sweep-and-prune AABB filtering and ray-casting.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param vertices - Array of polygon vertices ({x, z}). Capped at 32 vertices.
     * @param minY - Optional minimum Y elevation in meters (default: -Infinity).
     * @param maxY - Optional maximum Y elevation in meters (default: Infinity).
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players within the prism volume, or undefined if the vertices array is invalid (< 3 or > 32 vertices).
     */
    export function findPlayersInPrism(
        vertices: PrismVertex[],
        minY: number = -Infinity,
        maxY: number = Infinity,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number | undefined {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        const vertCount = vertices.length;

        if (vertCount < 3 || vertCount > MAX_PRISM_VERTICES) {
            logging.log(`Polygonal prism requires between 3 and ${MAX_PRISM_VERTICES} vertices.`, LogLevel.Warning);
            return undefined;
        }

        _unpackVertices(vertices, _scratchCoords, _scratchPrismBounds);

        // 1. Let findPlayersInAABB perform Sweep-and-Prune candidate selection using internal scratch
        const candidateCount = findPlayersInAABB(
            _scratchPrismBounds.minX,
            minY,
            _scratchPrismBounds.minZ,
            _scratchPrismBounds.maxX,
            maxY,
            _scratchPrismBounds.maxZ,
            filterFn,
            _internalScratchIds
        );

        // 2. In-place filter candidate players against the 2D polygon with Zero-GC
        let count = 0;

        for (let i = 0; i < candidateCount; ++i) {
            const id = _internalScratchIds[i];

            if (!_isPointInPolygon(posX[id], posZ[id], _scratchCoords, vertCount)) continue;

            if (idsOut) {
                idsOut[count] = id;
            }

            if (playersOut) {
                playersOut[count] = _players[id]!;
            }

            ++count;
        }

        return count;
    }

    /**
     * Finds all active players outside a 2.5D polygonal prism.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param vertices - Array of polygon vertices ({x, z}). Capped at 32 vertices.
     * @param minY - Optional minimum Y elevation in meters (default: -Infinity).
     * @param maxY - Optional maximum Y elevation in meters (default: Infinity).
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players strictly outside the prism volume, or undefined if the vertices array is invalid (< 3 or > 32 vertices).
     */
    export function findPlayersOutsidePrism(
        vertices: PrismVertex[],
        minY: number = -Infinity,
        maxY: number = Infinity,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number | undefined {
        if (idsOut) {
            idsOut.length = 0;
        }

        if (playersOut) {
            playersOut.length = 0;
        }

        const vertCount = vertices.length;

        if (vertCount < 3 || vertCount > MAX_PRISM_VERTICES) {
            logging.log(`Polygonal prism requires between 3 and ${MAX_PRISM_VERTICES} vertices.`, LogLevel.Warning);
            return undefined;
        }

        _unpackVertices(vertices, _scratchCoords, _scratchPrismBounds);

        const minX = _scratchPrismBounds.minX;
        const maxX = _scratchPrismBounds.maxX;
        const minZ = _scratchPrismBounds.minZ;
        const maxZ = _scratchPrismBounds.maxZ;
        let count = 0;

        for (let id = 0; id < MAX_PLAYERS; ++id) {
            if (!_isActive(id)) continue;

            const p = _players[id]!;

            if (filterFn && !filterFn(p, id)) continue;

            const y = posY[id];

            if (y < minY || y > maxY) {
                if (idsOut) {
                    idsOut[count] = id;
                }

                if (playersOut) {
                    playersOut[count] = p;
                }

                ++count;

                continue;
            }

            const x = posX[id];
            const z = posZ[id];

            if (x < minX || x > maxX || z < minZ || z > maxZ) {
                if (idsOut) {
                    idsOut[count] = id;
                }

                if (playersOut) {
                    playersOut[count] = p;
                }

                ++count;

                continue;
            }

            if (!_isPointInPolygon(x, z, _scratchCoords, vertCount)) {
                if (idsOut) {
                    idsOut[count] = id;
                }

                if (playersOut) {
                    playersOut[count] = p;
                }

                ++count;
            }
        }

        return count;
    }

    // =========================================================================
    // Exposed Directional & Extremum Query Functions
    // =========================================================================

    /**
     * Finds all active players located at or above a given Y elevation (altitude).
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param y - The elevation threshold in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players at or above the elevation.
     */
    export function findPlayersAbove(
        y: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _findPlayersGte(sortedY, posY, y, filterFn, idsOut, playersOut);
    }

    /**
     * Finds all active players located at or below a given Y elevation (altitude).
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param y - The elevation threshold in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players at or below the elevation.
     */
    export function findPlayersBelow(
        y: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _findPlayersLte(sortedY, posY, y, filterFn, idsOut, playersOut);
    }

    /**
     * Finds all active players located east of (positive X) a given X coordinate.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param x - The X coordinate threshold in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players east of the coordinate.
     */
    export function findPlayersEastOf(
        x: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _findPlayersGte(sortedX, posX, x, filterFn, idsOut, playersOut);
    }

    /**
     * Finds all active players located west of (negative X) a given X coordinate.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param x - The X coordinate threshold in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players west of the coordinate.
     */
    export function findPlayersWestOf(
        x: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _findPlayersLte(sortedX, posX, x, filterFn, idsOut, playersOut);
    }

    /**
     * Finds all active players located north of (negative Z) a given Z coordinate.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param z - The Z coordinate threshold in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players north of the coordinate.
     */
    export function findPlayersNorthOf(
        z: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _findPlayersLte(sortedZ, posZ, z, filterFn, idsOut, playersOut);
    }

    /**
     * Finds all active players located south of (positive Z) a given Z coordinate.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param z - The Z coordinate threshold in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of active players south of the coordinate.
     */
    export function findPlayersSouthOf(
        z: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _findPlayersGte(sortedZ, posZ, z, filterFn, idsOut, playersOut);
    }

    /**
     * Finds the single closest active player to a 3D target point.
     * @param x - Target X coordinate in world meters.
     * @param y - Target Y coordinate in world meters.
     * @param z - Target Z coordinate in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @returns The ID of the closest player, or undefined if no active player satisfies the condition.
     */
    export function getClosestPlayerId(
        x: number,
        y: number,
        z: number,
        filterFn?: (player: mod.Player, id: number) => boolean
    ): number | undefined {
        return _getExtremumPlayer(x, y, z, true, filterFn);
    }

    /**
     * Finds the single farthest active player from a 3D target point.
     * @param x - Target X coordinate in world meters.
     * @param y - Target Y coordinate in world meters.
     * @param z - Target Z coordinate in world meters.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @returns The ID of the farthest player, or undefined if no active player satisfies the condition.
     */
    export function getFarthestPlayerId(
        x: number,
        y: number,
        z: number,
        filterFn?: (player: mod.Player, id: number) => boolean
    ): number | undefined {
        return _getExtremumPlayer(x, y, z, false, filterFn);
    }

    /**
     * Finds the 'k' closest active players to a target 3D point, sorted closest-first.
     * Executes in O(N log k) time using a bounded Max-Heap with ZERO Garbage Collection pressure.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param x - Target X coordinate in world meters.
     * @param y - Target Y coordinate in world meters.
     * @param z - Target Z coordinate in world meters.
     * @param k - Number of nearest players to find.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of players found (up to k).
     */
    export function findKClosestPlayers(
        x: number,
        y: number,
        z: number,
        k: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _getKExtremumDistancePlayers(x, y, z, k, true, filterFn, idsOut, playersOut);
    }

    /**
     * Finds the 'k' farthest active players from a target 3D point, sorted farthest-first.
     * Executes in O(N log k) time using a bounded Min-Heap with ZERO Garbage Collection pressure.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param x - Target X coordinate in world meters.
     * @param y - Target Y coordinate in world meters.
     * @param z - Target Z coordinate in world meters.
     * @param k - Number of farthest players to find.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of players found (up to k).
     */
    export function findKFarthestPlayers(
        x: number,
        y: number,
        z: number,
        k: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _getKExtremumDistancePlayers(x, y, z, k, false, filterFn, idsOut, playersOut);
    }

    /**
     * Gets the highest altitude (Y axis) active player in near O(1) time using the Y-axis sorted array.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @returns The ID of the highest active player, or undefined if no active player satisfies the condition.
     */
    export function getHighestPlayerId(filterFn?: (player: mod.Player, id: number) => boolean): number | undefined {
        for (let i = MAX_PLAYERS - 1; i >= 0; --i) {
            const id = sortedY[i];

            if (!_isActive(id)) continue;

            const p = _players[id]!;

            if (!filterFn || filterFn(p, id)) return id;
        }

        return undefined;
    }

    /**
     * Gets the lowest altitude (Y axis) active player in near O(1) time using the Y-axis sorted array.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @returns The ID of the lowest active player, or undefined if no active player satisfies the condition.
     */
    export function getLowestPlayerId(filterFn?: (player: mod.Player, id: number) => boolean): number | undefined {
        for (let i = 0; i < MAX_PLAYERS; ++i) {
            const id = sortedY[i];

            if (!_isActive(id)) continue;

            const p = _players[id]!;

            if (!filterFn || filterFn(p, id)) return id;
        }

        return undefined;
    }

    /**
     * Finds the 'k' highest altitude active players, sorted from highest to lowest.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param k - Number of highest players to find.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of players found (up to k).
     */
    export function findKHighestPlayers(
        k: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _getKExtremes(sortedY, k, true, filterFn, idsOut, playersOut);
    }

    /**
     * Finds the 'k' lowest altitude active players, sorted from lowest to highest.
     * If no buffers are provided, simply returns the matching count with zero memory writes.
     * @param k - Number of lowest players to find.
     * @param filterFn - Optional filter predicate returning true for candidates to consider. Receives (player, id).
     * @param idsOut - Optional target array to write active player IDs into.
     * @param playersOut - Optional target array to write active mod.Player objects into.
     * @returns The total number of players found (up to k).
     */
    export function findKLowestPlayers(
        k: number,
        filterFn?: (player: mod.Player, id: number) => boolean,
        idsOut?: number[],
        playersOut?: mod.Player[]
    ): number {
        return _getKExtremes(sortedY, k, false, filterFn, idsOut, playersOut);
    }

    // =========================================================================
    // Exposed Proximity Check Functions
    // =========================================================================

    /**
     * Fast 2.5D Cylinder / Capture Zone test for a player (horizontal radius on XZ plane with vertical Y bounds).
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @param centerX - Center X coordinate in world meters.
     * @param centerZ - Center Z coordinate in world meters.
     * @param radiusMeters - Cylinder radius in meters.
     * @param minY - Optional minimum Y elevation bound in meters (default: -Infinity).
     * @param maxY - Optional maximum Y elevation bound in meters (default: Infinity).
     * @returns True if active and inside, false if active and outside or inactive, or undefined if not connected.
     */
    export function isPlayerInCylinder(
        player: number | mod.Player,
        centerX: number,
        centerZ: number,
        radiusMeters: number,
        minY: number = -Infinity,
        maxY: number = Infinity
    ): boolean | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        if (!_isActive(id)) return false;

        const y = posY[id];

        if (y < minY || y > maxY) return false;

        const dx = posX[id] - centerX;
        const dz = posZ[id] - centerZ;

        return dx * dx + dz * dz <= radiusMeters * radiusMeters;
    }

    /**
     * Checks if an active player lies strictly outside a 2.5D vertical cylinder.
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @param centerX - Center X coordinate in world meters.
     * @param centerZ - Center Z coordinate in world meters.
     * @param radiusMeters - Cylinder radius in meters.
     * @param minY - Optional minimum Y elevation bound in meters (default: -Infinity).
     * @param maxY - Optional maximum Y elevation bound in meters (default: Infinity).
     * @returns True if active and outside, false if active and inside or inactive, or undefined if not connected.
     */
    export function isPlayerOutsideCylinder(
        player: number | mod.Player,
        centerX: number,
        centerZ: number,
        radiusMeters: number,
        minY: number = -Infinity,
        maxY: number = Infinity
    ): boolean | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        if (!_isActive(id)) return false;

        return !isPlayerInCylinder(id, centerX, centerZ, radiusMeters, minY, maxY);
    }

    /**
     * Checks if an active player lies within a 3D sphere.
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @param centerX - Sphere center X coordinate in world meters.
     * @param centerY - Sphere center Y coordinate in world meters.
     * @param centerZ - Sphere center Z coordinate in world meters.
     * @param radiusMeters - Sphere radius in meters.
     * @returns True if active and inside, false if active and outside or inactive, or undefined if not connected.
     */
    export function isPlayerInSphere(
        player: number | mod.Player,
        centerX: number,
        centerY: number,
        centerZ: number,
        radiusMeters: number
    ): boolean | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        if (!_isActive(id)) return false;

        const dx = posX[id] - centerX;
        const dy = posY[id] - centerY;
        const dz = posZ[id] - centerZ;

        return dx * dx + dy * dy + dz * dz <= radiusMeters * radiusMeters;
    }

    /**
     * Checks if an active player lies strictly outside a 3D sphere.
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @param centerX - Sphere center X coordinate in world meters.
     * @param centerY - Sphere center Y coordinate in world meters.
     * @param centerZ - Sphere center Z coordinate in world meters.
     * @param radiusMeters - Sphere radius in meters.
     * @returns True if active and outside, false if active and inside or inactive, or undefined if not connected.
     */
    export function isPlayerOutsideSphere(
        player: number | mod.Player,
        centerX: number,
        centerY: number,
        centerZ: number,
        radiusMeters: number
    ): boolean | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        if (!_isActive(id)) return false;

        return !isPlayerInSphere(id, centerX, centerY, centerZ, radiusMeters);
    }

    /**
     * Checks if an active player lies within a 3D Axis-Aligned Bounding Box (AABB).
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @param minX - Minimum X coordinate in world meters.
     * @param minY - Minimum Y coordinate in world meters.
     * @param minZ - Minimum Z coordinate in world meters.
     * @param maxX - Maximum X coordinate in world meters.
     * @param maxY - Maximum Y coordinate in world meters.
     * @param maxZ - Maximum Z coordinate in world meters.
     * @returns True if active and inside, false if active and outside or inactive, or undefined if not connected.
     */
    export function isPlayerInAABB(
        player: number | mod.Player,
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number
    ): boolean | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        if (!_isActive(id)) return false;

        const x = posX[id];
        const y = posY[id];
        const z = posZ[id];

        return x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ;
    }

    /**
     * Checks if an active player lies strictly outside a 3D Axis-Aligned Bounding Box (AABB).
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @param minX - Minimum X coordinate in world meters.
     * @param minY - Minimum Y coordinate in world meters.
     * @param minZ - Minimum Z coordinate in world meters.
     * @param maxX - Maximum X coordinate in world meters.
     * @param maxY - Maximum Y coordinate in world meters.
     * @param maxZ - Maximum Z coordinate in world meters.
     * @returns True if active and outside, false if active and inside or inactive, or undefined if not connected.
     */
    export function isPlayerOutsideAABB(
        player: number | mod.Player,
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number
    ): boolean | undefined {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        if (!_isActive(id)) return false;

        return !isPlayerInAABB(id, minX, minY, minZ, maxX, maxY, maxZ);
    }

    /**
     * Checks if an active player lies within a 2.5D polygonal prism (extruded polygon on XZ plane with vertical Y bounds).
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @param vertices - Array of polygon vertices ({x, z}). Capped at 32 vertices.
     * @param minY - Optional minimum Y elevation bound in meters (default: -Infinity).
     * @param maxY - Optional maximum Y elevation bound in meters (default: Infinity).
     * @returns True if active and inside, false if active and outside or inactive, undefined if not connected, or null if the vertices array is invalid (< 3 or > 32 vertices).
     */
    export function isPlayerInPrism(
        player: number | mod.Player,
        vertices: PrismVertex[],
        minY: number = -Infinity,
        maxY: number = Infinity
    ): boolean | undefined | null {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        if (!_isActive(id)) return false;

        const count = vertices.length;

        if (count < 3 || count > MAX_PRISM_VERTICES) {
            logging.log(`Polygonal prism requires between 3 and ${MAX_PRISM_VERTICES} vertices.`, LogLevel.Warning);
            return null;
        }

        _unpackVertices(vertices, _scratchCoords, _scratchPrismBounds);

        if (
            !isPlayerInAABB(
                id,
                _scratchPrismBounds.minX,
                minY,
                _scratchPrismBounds.minZ,
                _scratchPrismBounds.maxX,
                maxY,
                _scratchPrismBounds.maxZ
            )
        ) {
            return false;
        }

        return _isPointInPolygon(posX[id], posZ[id], _scratchCoords, count);
    }

    /**
     * Checks if an active player lies strictly outside a 2.5D polygonal prism.
     * @param player - The player slot ID (0-99) or engine mod.Player object.
     * @param vertices - Array of polygon vertices ({x, z}). Capped at 32 vertices.
     * @param minY - Optional minimum Y elevation bound in meters (default: -Infinity).
     * @param maxY - Optional maximum Y elevation bound in meters (default: Infinity).
     * @returns True if active and outside, false if active and inside or inactive, undefined if not connected, or null if the vertices array is invalid (< 3 or > 32 vertices).
     */
    export function isPlayerOutsidePrism(
        player: number | mod.Player,
        vertices: PrismVertex[],
        minY: number = -Infinity,
        maxY: number = Infinity
    ): boolean | undefined | null {
        const id = _getPlayerId(player);

        if (!_isConnected(id)) return undefined;

        if (!_isActive(id)) return false;

        const count = vertices.length;

        if (count < 3 || count > MAX_PRISM_VERTICES) {
            logging.log(`Polygonal prism requires between 3 and ${MAX_PRISM_VERTICES} vertices.`, LogLevel.Warning);
            return null;
        }

        const isInside = isPlayerInPrism(id, vertices, minY, maxY);

        return typeof isInside === 'boolean' ? !isInside : isInside;
    }

    // =========================================================================
    // Exposed Reactive Event Subscriptions
    // =========================================================================

    /**
     * Subscribes to events when any player enters or exits a 3D sphere.
     * At least one callback (onEnter or onExit) must be provided.
     * @param x - Sphere center X coordinate in world meters.
     * @param y - Sphere center Y coordinate in world meters.
     * @param z - Sphere center Z coordinate in world meters.
     * @param radiusMeters - Sphere radius in meters.
     * @param onEnter - Callback invoked when a player enters the sphere.
     * @param onExit - Optional callback invoked when a player exits the sphere.
     * @returns A {@link SphereHandle} to update parameters or unsubscribe.
     */
    export function onSphere(
        x: number,
        y: number,
        z: number,
        radiusMeters: number,
        onEnter: PlayerZoneCallback,
        onExit?: PlayerZoneCallback
    ): SphereHandle;
    /**
     * Subscribes to events when any player exits a 3D sphere.
     * @param x - Sphere center X coordinate in world meters.
     * @param y - Sphere center Y coordinate in world meters.
     * @param z - Sphere center Z coordinate in world meters.
     * @param radiusMeters - Sphere radius in meters.
     * @param onEnter - Explicitly undefined to indicate no enter callback.
     * @param onExit - Callback invoked when a player exits the sphere.
     * @returns A {@link SphereHandle} to update parameters or unsubscribe.
     */
    export function onSphere(
        x: number,
        y: number,
        z: number,
        radiusMeters: number,
        onEnter: undefined,
        onExit: PlayerZoneCallback
    ): SphereHandle;
    /**
     * Implementation for {@link onSphere} subscriptions.
     * @param x - Sphere center X coordinate in world meters.
     * @param y - Sphere center Y coordinate in world meters.
     * @param z - Sphere center Z coordinate in world meters.
     * @param radiusMeters - Sphere radius in meters.
     * @param onEnter - Optional callback invoked when a player enters the sphere.
     * @param onExit - Optional callback invoked when a player exits the sphere.
     * @returns A {@link SphereHandle} to update parameters or unsubscribe.
     */
    export function onSphere(
        x: number,
        y: number,
        z: number,
        radiusMeters: number,
        onEnter?: PlayerZoneCallback,
        onExit?: PlayerZoneCallback
    ): SphereHandle {
        const listener: SphereListener = {
            centerX: x,
            centerY: y,
            centerZ: z,
            radiusSq: radiusMeters * radiusMeters,
            onEnter,
            onExit,
            mask0: 0,
            mask1: 0,
            mask2: 0,
            mask3: 0,
        };

        sphereListeners.push(listener);

        return {
            unsubscribe(): void {
                const idx = sphereListeners.indexOf(listener);

                if (idx !== -1) {
                    sphereListeners.splice(idx, 1);
                }
            },
            update(newX: number, newY: number, newZ: number, newRadius?: number): void {
                listener.centerX = newX;
                listener.centerY = newY;
                listener.centerZ = newZ;

                if (newRadius !== undefined) {
                    listener.radiusSq = newRadius * newRadius;
                }
            },
        };
    }

    /**
     * Subscribes to events when any player enters or exits a 2.5D cylinder (horizontal XZ radius with vertical elevation bounds).
     * At least one callback (onEnter or onExit) must be provided.
     * @param centerX - Cylinder center X coordinate in world meters.
     * @param centerZ - Cylinder center Z coordinate in world meters.
     * @param radiusMeters - Cylinder radius in meters.
     * @param minY - Minimum Y elevation in meters (pass undefined or -Infinity for unbounded).
     * @param maxY - Maximum Y elevation in meters (pass undefined or Infinity for unbounded).
     * @param onEnter - Callback invoked when a player enters the cylinder.
     * @param onExit - Optional callback invoked when a player exits the cylinder.
     * @returns A {@link CylinderHandle} to update parameters or unsubscribe.
     */
    export function onCylinder(
        centerX: number,
        centerZ: number,
        radiusMeters: number,
        minY: number | undefined,
        maxY: number | undefined,
        onEnter: PlayerZoneCallback,
        onExit?: PlayerZoneCallback
    ): CylinderHandle;
    /**
     * Subscribes to events when any player exits a 2.5D cylinder.
     * @param centerX - Cylinder center X coordinate in world meters.
     * @param centerZ - Center Z coordinate in world meters.
     * @param radiusMeters - Cylinder radius in meters.
     * @param minY - Minimum Y elevation in meters (pass undefined or -Infinity for unbounded).
     * @param maxY - Maximum Y elevation in meters (pass undefined or Infinity for unbounded).
     * @param onEnter - Explicitly undefined to indicate no enter callback.
     * @param onExit - Callback invoked when a player exits the cylinder.
     * @returns A {@link CylinderHandle} to update parameters or unsubscribe.
     */
    export function onCylinder(
        centerX: number,
        centerZ: number,
        radiusMeters: number,
        minY: number | undefined,
        maxY: number | undefined,
        onEnter: undefined,
        onExit: PlayerZoneCallback
    ): CylinderHandle;
    /**
     * Implementation for {@link onCylinder} subscriptions.
     * @param centerX - Cylinder center X coordinate in world meters.
     * @param centerZ - Center Z coordinate in world meters.
     * @param radiusMeters - Cylinder radius in meters.
     * @param minY - Minimum Y elevation in meters (default: -Infinity).
     * @param maxY - Maximum Y elevation in meters (default: Infinity).
     * @param onEnter - Optional callback invoked when a player enters the cylinder.
     * @param onExit - Optional callback invoked when a player exits the cylinder.
     * @returns A {@link CylinderHandle} to update parameters or unsubscribe.
     */
    export function onCylinder(
        centerX: number,
        centerZ: number,
        radiusMeters: number,
        minY: number = -Infinity,
        maxY: number = Infinity,
        onEnter?: PlayerZoneCallback,
        onExit?: PlayerZoneCallback
    ): CylinderHandle {
        const listener: CylinderListener = {
            centerX,
            centerZ,
            radiusSq: radiusMeters * radiusMeters,
            minY: minY !== undefined ? minY : -Infinity,
            maxY: maxY !== undefined ? maxY : Infinity,
            onEnter,
            onExit,
            mask0: 0,
            mask1: 0,
            mask2: 0,
            mask3: 0,
        };

        cylinderListeners.push(listener);

        return {
            unsubscribe(): void {
                const idx = cylinderListeners.indexOf(listener);

                if (idx !== -1) {
                    cylinderListeners.splice(idx, 1);
                }
            },
            update(
                newCenterX: number,
                newCenterZ: number,
                newRadius?: number,
                newMinY?: number,
                newMaxY?: number
            ): void {
                listener.centerX = newCenterX;
                listener.centerZ = newCenterZ;

                if (newRadius !== undefined) {
                    listener.radiusSq = newRadius * newRadius;
                }

                if (newMinY !== undefined) {
                    listener.minY = newMinY;
                }

                if (newMaxY !== undefined) {
                    listener.maxY = newMaxY;
                }
            },
        };
    }

    /**
     * Subscribes to events when any player enters or exits a 3D Axis-Aligned Bounding Box (AABB).
     * At least one callback (onEnter or onExit) must be provided.
     * @param minX - Minimum X coordinate in world meters.
     * @param minY - Minimum Y coordinate in world meters.
     * @param minZ - Minimum Z coordinate in world meters.
     * @param maxX - Maximum X coordinate in world meters.
     * @param maxY - Maximum Y coordinate in world meters.
     * @param maxZ - Maximum Z coordinate in world meters.
     * @param onEnter - Callback invoked when a player enters the box.
     * @param onExit - Optional callback invoked when a player exits the box.
     * @returns An {@link AABBHandle} to update parameters or unsubscribe.
     */
    export function onAABB(
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number,
        onEnter: PlayerZoneCallback,
        onExit?: PlayerZoneCallback
    ): AABBHandle;
    /**
     * Subscribes to events when any player exits a 3D Axis-Aligned Bounding Box (AABB).
     * @param minX - Minimum X coordinate in world meters.
     * @param minY - Minimum Y coordinate in world meters.
     * @param minZ - Minimum Z coordinate in world meters.
     * @param maxX - Maximum X coordinate in world meters.
     * @param maxY - Maximum Y coordinate in world meters.
     * @param maxZ - Maximum Z coordinate in world meters.
     * @param onEnter - Explicitly undefined to indicate no enter callback.
     * @param onExit - Callback invoked when a player exits the box.
     * @returns An {@link AABBHandle} to update parameters or unsubscribe.
     */
    export function onAABB(
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number,
        onEnter: undefined,
        onExit: PlayerZoneCallback
    ): AABBHandle;
    /**
     * Implementation for {@link onAABB} subscriptions.
     * @param minX - Minimum X coordinate in world meters.
     * @param minY - Minimum Y coordinate in world meters.
     * @param minZ - Minimum Z coordinate in world meters.
     * @param maxX - Maximum X coordinate in world meters.
     * @param maxY - Maximum Y coordinate in world meters.
     * @param maxZ - Maximum Z coordinate in world meters.
     * @param onEnter - Optional callback invoked when a player enters the box.
     * @param onExit - Optional callback invoked when a player exits the box.
     * @returns An {@link AABBHandle} to update parameters or unsubscribe.
     */
    export function onAABB(
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number,
        onEnter?: PlayerZoneCallback,
        onExit?: PlayerZoneCallback
    ): AABBHandle {
        const listener: AABBListener = {
            minX,
            minY,
            minZ,
            maxX,
            maxY,
            maxZ,
            onEnter,
            onExit,
            mask0: 0,
            mask1: 0,
            mask2: 0,
            mask3: 0,
        };

        aabbListeners.push(listener);

        return {
            unsubscribe(): void {
                const idx = aabbListeners.indexOf(listener);

                if (idx !== -1) {
                    aabbListeners.splice(idx, 1);
                }
            },
            update(
                newMinX: number,
                newMinY: number,
                newMinZ: number,
                newMaxX: number,
                newMaxY: number,
                newMaxZ: number
            ): void {
                listener.minX = newMinX;
                listener.minY = newMinY;
                listener.minZ = newMinZ;
                listener.maxX = newMaxX;
                listener.maxY = newMaxY;
                listener.maxZ = newMaxZ;
            },
        };
    }

    /**
     * Subscribes to events when any player enters or exits a 2.5D polygonal prism (extruded polygon on XZ plane with vertical elevation bounds).
     * At least one callback (onEnter or onExit) must be provided.
     * @param vertices - Array of polygon vertices ({x, z}). Capped at 32 vertices.
     * @param minY - Minimum Y elevation in meters (pass undefined or -Infinity for unbounded).
     * @param maxY - Maximum Y elevation in meters (pass undefined or Infinity for unbounded).
     * @param onEnter - Callback invoked when a player enters the prism volume.
     * @param onExit - Optional callback invoked when a player exits the prism volume.
     * @returns A {@link PrismHandle} to update parameters or unsubscribe.
     */
    export function onPrism(
        vertices: PrismVertex[],
        minY: number | undefined,
        maxY: number | undefined,
        onEnter: PlayerZoneCallback,
        onExit?: PlayerZoneCallback
    ): PrismHandle | null;
    /**
     * Subscribes to events when any player exits a 2.5D polygonal prism.
     * @param vertices - Array of polygon vertices ({x, z}). Capped at 32 vertices.
     * @param minY - Minimum Y elevation in meters (pass undefined or -Infinity for unbounded).
     * @param maxY - Maximum Y elevation in meters (pass undefined or Infinity for unbounded).
     * @param onEnter - Explicitly undefined to indicate no enter callback.
     * @param onExit - Callback invoked when a player exits the prism volume.
     * @returns A {@link PrismHandle} to update parameters or unsubscribe, or null if vertices are invalid (< 3 or > 32 vertices).
     */
    export function onPrism(
        vertices: PrismVertex[],
        minY: number | undefined,
        maxY: number | undefined,
        onEnter: undefined,
        onExit: PlayerZoneCallback
    ): PrismHandle | null;
    /**
     * Implementation for {@link onPrism} subscriptions.
     * @param vertices - Array of polygon vertices ({x, z}). Capped at 32 vertices.
     * @param minY - Minimum Y elevation in meters (default: -Infinity).
     * @param maxY - Maximum Y elevation in meters (default: Infinity).
     * @param onEnter - Optional callback invoked when a player enters the prism volume.
     * @param onExit - Optional callback invoked when a player exits the prism volume.
     * @returns A {@link PrismHandle} to update parameters or unsubscribe, or null if vertices are invalid (< 3 or > 32 vertices).
     */
    export function onPrism(
        vertices: PrismVertex[],
        minY: number = -Infinity,
        maxY: number = Infinity,
        onEnter?: PlayerZoneCallback,
        onExit?: PlayerZoneCallback
    ): PrismHandle | null {
        const count = vertices.length;

        if (count < 3 || count > MAX_PRISM_VERTICES) {
            logging.log(`Polygonal prism requires between 3 and ${MAX_PRISM_VERTICES} vertices.`, LogLevel.Warning);
            return null;
        }

        const coords = new Float32Array(MAX_PRISM_VERTICES * 2);
        _unpackVertices(vertices, coords, _scratchPrismBounds);

        const listener: PrismListener = {
            coords,
            vertexCount: count,
            minX: _scratchPrismBounds.minX,
            maxX: _scratchPrismBounds.maxX,
            minZ: _scratchPrismBounds.minZ,
            maxZ: _scratchPrismBounds.maxZ,
            minY: minY !== undefined ? minY : -Infinity,
            maxY: maxY !== undefined ? maxY : Infinity,
            onEnter,
            onExit,
            mask0: 0,
            mask1: 0,
            mask2: 0,
            mask3: 0,
        };

        prismListeners.push(listener);

        return {
            unsubscribe(): void {
                const idx = prismListeners.indexOf(listener);

                if (idx !== -1) {
                    prismListeners.splice(idx, 1);
                }
            },
            update(newVertices: PrismVertex[], newMinY?: number, newMaxY?: number): void {
                const newCount = newVertices.length;

                if (newCount < 3 || newCount > MAX_PRISM_VERTICES) {
                    logging.log(
                        `Polygonal prism requires between 3 and ${MAX_PRISM_VERTICES} vertices.`,
                        LogLevel.Warning
                    );

                    listener.vertexCount = 0;
                } else {
                    _unpackVertices(newVertices, listener.coords, _scratchPrismBounds);

                    listener.vertexCount = newCount;
                    listener.minX = _scratchPrismBounds.minX;
                    listener.maxX = _scratchPrismBounds.maxX;
                    listener.minZ = _scratchPrismBounds.minZ;
                    listener.maxZ = _scratchPrismBounds.maxZ;
                }

                if (newMinY !== undefined) {
                    listener.minY = newMinY;
                }

                if (newMaxY !== undefined) {
                    listener.maxY = newMaxY;
                }
            },
        };
    }

    function _createPlaneHandle(listener: PlaneListener): PlaneHandle {
        planeListeners.push(listener);

        return {
            unsubscribe(): void {
                const idx = planeListeners.indexOf(listener);

                if (idx !== -1) {
                    planeListeners.splice(idx, 1);
                }
            },
            update(newThreshold: number): void {
                listener.threshold = newThreshold;
            },
        };
    }

    /**
     * Subscribes to events when any player crosses an altitude threshold (Y elevation).
     * At least one callback (onAbove or onBelow) must be provided.
     * @param y - Elevation threshold in world meters.
     * @param onAbove - Callback invoked when crossing at or above the elevation.
     * @param onBelow - Optional callback invoked when crossing below the elevation.
     * @returns A {@link PlaneHandle} to update parameters or unsubscribe.
     */
    export function onCrossAltitude(y: number, onAbove: PlayerZoneCallback, onBelow?: PlayerZoneCallback): PlaneHandle;
    /**
     * Subscribes to events when any player crosses below an altitude threshold (Y elevation).
     * @param y - Elevation threshold in world meters.
     * @param onAbove - Explicitly undefined to indicate no above callback.
     * @param onBelow - Callback invoked when crossing below the elevation.
     * @returns A {@link PlaneHandle} to update parameters or unsubscribe.
     */
    export function onCrossAltitude(y: number, onAbove: undefined, onBelow: PlayerZoneCallback): PlaneHandle;
    /**
     * Implementation for {@link onCrossAltitude} subscriptions.
     * @param y - Elevation threshold in world meters.
     * @param onAbove - Optional callback invoked when crossing at or above the elevation.
     * @param onBelow - Optional callback invoked when crossing below the elevation.
     * @returns A {@link PlaneHandle} to update parameters or unsubscribe.
     */
    export function onCrossAltitude(
        y: number,
        onAbove?: PlayerZoneCallback,
        onBelow?: PlayerZoneCallback
    ): PlaneHandle {
        return _createPlaneHandle({
            axis: AxisType.Y,
            threshold: y,
            onEnter: onAbove,
            onExit: onBelow,
            mask0: 0,
            mask1: 0,
            mask2: 0,
            mask3: 0,
        });
    }

    /**
     * Subscribes to events when any player crosses an East-West threshold (X axis).
     * At least one callback (onEast or onWest) must be provided.
     * @param x - X coordinate threshold in world meters.
     * @param onEast - Callback invoked when crossing east (+X) of the coordinate.
     * @param onWest - Optional callback invoked when crossing west (-X) of the coordinate.
     * @returns A {@link PlaneHandle} to update parameters or unsubscribe.
     */
    export function onCrossEastWest(x: number, onEast: PlayerZoneCallback, onWest?: PlayerZoneCallback): PlaneHandle;
    /**
     * Subscribes to events when any player crosses west of an East-West threshold (X axis).
     * @param x - X coordinate threshold in world meters.
     * @param onEast - Explicitly undefined to indicate no east callback.
     * @param onWest - Callback invoked when crossing west (-X) of the coordinate.
     * @returns A {@link PlaneHandle} to update parameters or unsubscribe.
     */
    export function onCrossEastWest(x: number, onEast: undefined, onWest: PlayerZoneCallback): PlaneHandle;
    /**
     * Implementation for {@link onCrossEastWest} subscriptions.
     * @param x - X coordinate threshold in world meters.
     * @param onEast - Optional callback invoked when crossing east (+X) of the coordinate.
     * @param onWest - Optional callback invoked when crossing west (-X) of the coordinate.
     * @returns A {@link PlaneHandle} to update parameters or unsubscribe.
     */
    export function onCrossEastWest(x: number, onEast?: PlayerZoneCallback, onWest?: PlayerZoneCallback): PlaneHandle {
        return _createPlaneHandle({
            axis: AxisType.X,
            threshold: x,
            onEnter: onEast,
            onExit: onWest,
            mask0: 0,
            mask1: 0,
            mask2: 0,
            mask3: 0,
        });
    }

    /**
     * Subscribes to events when any player crosses a North-South threshold (Z axis).
     * At least one callback (onSouth or onNorth) must be provided.
     * @param z - Z coordinate threshold in world meters.
     * @param onSouth - Callback invoked when crossing south (+Z) of the coordinate.
     * @param onNorth - Optional callback invoked when crossing north (-Z) of the coordinate.
     * @returns A {@link PlaneHandle} to update parameters or unsubscribe.
     */
    export function onCrossNorthSouth(
        z: number,
        onSouth: PlayerZoneCallback,
        onNorth?: PlayerZoneCallback
    ): PlaneHandle;
    /**
     * Subscribes to events when any player crosses north of a North-South threshold (Z axis).
     * @param z - Z coordinate threshold in world meters.
     * @param onSouth - Explicitly undefined to indicate no south callback.
     * @param onNorth - Callback invoked when crossing north (-Z) of the coordinate.
     * @returns A {@link PlaneHandle} to update parameters or unsubscribe.
     */
    export function onCrossNorthSouth(z: number, onSouth: undefined, onNorth: PlayerZoneCallback): PlaneHandle;
    /**
     * Implementation for {@link onCrossNorthSouth} subscriptions.
     * @param z - Z coordinate threshold in world meters.
     * @param onSouth - Optional callback invoked when crossing south (+Z) of the coordinate.
     * @param onNorth - Optional callback invoked when crossing north (-Z) of the coordinate.
     * @returns A {@link PlaneHandle} to update parameters or unsubscribe.
     */
    export function onCrossNorthSouth(
        z: number,
        onSouth?: PlayerZoneCallback,
        onNorth?: PlayerZoneCallback
    ): PlaneHandle {
        return _createPlaneHandle({
            axis: AxisType.Z,
            threshold: z,
            onEnter: onSouth,
            onExit: onNorth,
            mask0: 0,
            mask1: 0,
            mask2: 0,
            mask3: 0,
        });
    }

    function _createExtremaHandle(listener: ExtremaListener): ExtremaHandle {
        extremaListeners.push(listener);

        return {
            unsubscribe(): void {
                const idx = extremaListeners.indexOf(listener);

                if (idx !== -1) {
                    extremaListeners.splice(idx, 1);
                }
            },
        };
    }

    function _createTargetExtremaHandle(listener: ExtremaListener): TargetExtremaHandle {
        extremaListeners.push(listener);

        return {
            unsubscribe(): void {
                const idx = extremaListeners.indexOf(listener);

                if (idx !== -1) {
                    extremaListeners.splice(idx, 1);
                }
            },
            update(newX: number, newY: number, newZ: number): void {
                listener.x = newX;
                listener.y = newY;
                listener.z = newZ;
            },
        };
    }

    /**
     * Subscribes to events when the identity of the highest altitude active player changes.
     * @param callback - Function invoked with (newPlayer, prevPlayer, newPlayerId, prevPlayerId).
     * @returns An {@link ExtremaHandle} to unsubscribe.
     */
    export function onHighestPlayerChanged(callback: PlayerExtremaCallback): ExtremaHandle {
        return _createExtremaHandle({
            type: ExtremaType.Highest,
            callback,
            x: 0,
            y: 0,
            z: 0,
            lastPlayerId: getHighestPlayerId(),
        });
    }

    /**
     * Subscribes to events when the identity of the lowest altitude active player changes.
     * @param callback - Function invoked with (newPlayer, prevPlayer, newPlayerId, prevPlayerId).
     * @returns An {@link ExtremaHandle} to unsubscribe.
     */
    export function onLowestPlayerChanged(callback: PlayerExtremaCallback): ExtremaHandle {
        return _createExtremaHandle({
            type: ExtremaType.Lowest,
            callback,
            x: 0,
            y: 0,
            z: 0,
            lastPlayerId: getLowestPlayerId(),
        });
    }

    /**
     * Subscribes to events when the identity of the closest active player to a 3D point changes.
     * @param x - Target X coordinate in world meters.
     * @param y - Target Y coordinate in world meters.
     * @param z - Target Z coordinate in world meters.
     * @param callback - Function invoked with (newPlayer, prevPlayer, newPlayerId, prevPlayerId).
     * @returns A {@link TargetExtremaHandle} to update target coordinates or unsubscribe.
     */
    export function onClosestPlayerChanged(
        x: number,
        y: number,
        z: number,
        callback: PlayerExtremaCallback
    ): TargetExtremaHandle {
        return _createTargetExtremaHandle({
            type: ExtremaType.Closest,
            callback,
            x,
            y,
            z,
            lastPlayerId: getClosestPlayerId(x, y, z),
        });
    }

    /**
     * Subscribes to events when the identity of the farthest active player from a 3D point changes.
     * @param x - Target X coordinate in world meters.
     * @param y - Target Y coordinate in world meters.
     * @param z - Target Z coordinate in world meters.
     * @param callback - Function invoked with (newPlayer, prevPlayer, newPlayerId, prevPlayerId).
     * @returns A {@link TargetExtremaHandle} to update target coordinates or unsubscribe.
     */
    export function onFarthestPlayerChanged(
        x: number,
        y: number,
        z: number,
        callback: PlayerExtremaCallback
    ): TargetExtremaHandle {
        return _createTargetExtremaHandle({
            type: ExtremaType.Farthest,
            callback,
            x,
            y,
            z,
            lastPlayerId: getFarthestPlayerId(x, y, z),
        });
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\player-undeploy-fixer\index.ts ---




// version 1.1.0
export namespace PlayerUndeployFixer {
    const logging = new Logging('PUF');

    /**
     * A re-export of the `Logging.LogLevel` enum.
     */
    export const LogLevel = Logging.LogLevel;

    /**
     * Attaches a logger and defines a minimum log level and whether to attempt to append a string form of the error to
     * the text of the log message.
     * @param log - The logger function: `(formattedText, error?) => void | Promise<void>`. `error` is the same value
     *              passed to `log()` (if any), for inspection (e.g. `instanceof Error`, `stack`). `formattedText` may
     *              also include ` - Error: …` when `includeRawError` is true.
     * @param logLevel - The minimum log level to use.
     * @param includeRawError - When true and `log()` receives an error, attempts to append a string form of the error
     *                          to the text of the log message.
     */
    export function setLogging(
        log?: (text: string, error?: unknown) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeRawError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeRawError);
    }

    const MAX_TIME_TO_UNDEPLOY_MS: number = 30_000;
    const MAX_PLAYERS = 100;
    const SERVER_START_TIME = Date.now();

    /**
     * @returns The current server uptime in milliseconds (guaranteed >= 1).
     */
    function getUptime(): number {
        return Date.now() - SERVER_START_TIME + 1;
    }

    const deathTimes = new Uint32Array(MAX_PLAYERS);

    let pendingDeadCount = 0;

    Events.OnPlayerDied.subscribe(handlePlayerDied);
    Events.OnPlayerUndeploy.subscribe(handlePlayerUndeployed);
    Events.OnPlayerLeaveGame.subscribe(handlePlayerLeaveGame);

    Timers.setInterval(checkPendingUndeploys, 1000);

    function handlePlayerDied(player: mod.Player): void {
        const playerId = mod.GetObjId(player);

        if (typeof playerId !== 'number' || playerId < 0 || playerId >= MAX_PLAYERS) return;

        if (!deathTimes[playerId]) {
            ++pendingDeadCount;
        }

        deathTimes[playerId] = getUptime();
    }

    function handlePlayerUndeployed(player: mod.Player): void {
        const playerId = mod.GetObjId(player);

        if (typeof playerId !== 'number' || playerId < 0 || playerId >= MAX_PLAYERS) return;

        if (deathTimes[playerId]) {
            deathTimes[playerId] = 0;
            --pendingDeadCount;
        }
    }

    function handlePlayerLeaveGame(playerId: number): void {
        if (typeof playerId !== 'number' || playerId < 0 || playerId >= MAX_PLAYERS) return;

        if (deathTimes[playerId]) {
            deathTimes[playerId] = 0;
            --pendingDeadCount;
        }
    }

    function checkPendingUndeploys(): void {
        if (pendingDeadCount <= 0) return;

        const now = getUptime();

        for (let i = 0; i < MAX_PLAYERS; ++i) {
            const deathTime = deathTimes[i];

            if (!deathTime || now - deathTime < MAX_TIME_TO_UNDEPLOY_MS) continue;

            // NOTE: Might need to handle clearing this only after fetching soldier state does not throw.
            deathTimes[i] = 0;
            --pendingDeadCount;

            const player = mod.GetPlayer(i);

            if (player === undefined || mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive)) continue;

            logging.log(`P_${i} stuck in limbo; forcing undeployment`, LogLevel.Warning);

            Events.OnPlayerUndeploy.trigger(player);
        }
    }
}


// --- SOURCE: src\botnames.ts ---
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

// Names issued at spawn but not yet claimed by a player id. OnSpawnerSpawned
// claims the oldest one for that team. Spawns for a team are sequential, so a
// FIFO pairs correctly.
const unclaimed: { [team: number]: string[] } = { 1: [], 2: [] };

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
// unclaimed until the spawn event claims it.
export function takeBotName(team: number): string {
    if (team !== 1 && team !== 2) {
        return BOT_NAME_KEYS[0];
    }
    if (pool[team].length === 0) {
        pool[team] = shuffled();
    }
    const key: string = pool[team].shift() as string;
    unclaimed[team].push(key);
    return key;
}

// Called from the spawn event, once the player id is known.
export function claimBotName(team: number): string {
    if (team !== 1 && team !== 2) {
        return "";
    }
    const q: string[] = unclaimed[team];
    if (q.length === 0) {
        return "";
    }
    return q.shift() as string;
}

// Return a name to the pool once its soldier has left the game.
export function releaseBotName(team: number, key: string): void {
    if (team !== 1 && team !== 2 || key === "" || key === undefined) {
        return;
    }
    const q: string[] = unclaimed[team];
    if (q !== undefined) {
        const at: number = q.indexOf(key);
        if (at >= 0) {
            // Never claimed, or the bot died before the spawn event landed.
            q.splice(at, 1);
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


// --- SOURCE: node_modules\bf6-portal-utils\interleaved-vectors\index.ts ---


// version: 1.0.0
export namespace InterleavedVectors {
    export type Vector3 = Vectors.Vector3;

    /**
     * Copies a 3D vector component triple from a flat TypedArray into a target Vector3 object.
     * @param sourceArray - Source flat TypedArray with stride 3.
     * @param sIdx - Slot / element index (multiplied by 3 internally).
     * @param target - Destination Vector3 object.
     * @returns The modified target Vector3 instance.
     */
    export function toVector(sourceArray: Float32Array, sIdx: number, target: Vector3): Vector3 {
        const s3 = sIdx * 3;
        target.x = sourceArray[s3];
        target.y = sourceArray[s3 + 1];
        target.z = sourceArray[s3 + 2];

        return target;
    }

    /**
     * Copies a Vector3 object's components into a flat TypedArray at the given slot index.
     * @param source - Source Vector3 containing x, y, z components.
     * @param targetArray - Target flat TypedArray with stride 3.
     * @param tIdx - Target slot / element index (multiplied by 3 internally).
     */
    export function toSlice(source: Vector3, targetArray: Float32Array, tIdx: number): void {
        const t3 = tIdx * 3;
        targetArray[t3] = source.x;
        targetArray[t3 + 1] = source.y;
        targetArray[t3 + 2] = source.z;
    }

    /**
     * Copies a 3-component vector slice from one flat TypedArray into another flat TypedArray at the same slot index.
     * @param sourceArray - Source flat TypedArray with stride 3.
     * @param targetArray - Target flat TypedArray with stride 3.
     * @param idx - Slot / element index (multiplied by 3 internally).
     */
    export function copySlice(sourceArray: Float32Array, targetArray: Float32Array, idx: number): void {
        const i3 = idx * 3;
        targetArray[i3] = sourceArray[i3];
        targetArray[i3 + 1] = sourceArray[i3 + 1];
        targetArray[i3 + 2] = sourceArray[i3 + 2];
    }

    /**
     * Sets 3 components of a vector slot in a flat TypedArray.
     * If y and z are omitted, sets all components to the uniform scalar x.
     * @param targetArray - Target flat TypedArray with stride 3.
     * @param tIdx - Target slot / element index.
     * @param x - X component or uniform scalar.
     * @param y - Optional Y component.
     * @param z - Optional Z component.
     */
    export function setSlice(targetArray: Float32Array, tIdx: number, x: number, y?: number, z?: number): void {
        const t3 = tIdx * 3;

        if (y === undefined && z === undefined) {
            targetArray[t3] = x;
            targetArray[t3 + 1] = x;
            targetArray[t3 + 2] = x;
        } else {
            targetArray[t3] = x;
            targetArray[t3 + 1] = y ?? x;
            targetArray[t3 + 2] = z ?? x;
        }
    }

    /**
     * Adds an array vector slot and a Vector3 object, writing the result directly into a target array slot.
     * @param aArray - Source flat TypedArray with stride 3.
     * @param aIdx - Source slot index.
     * @param b - Vector3 addend.
     * @param outArray - Target flat TypedArray with stride 3.
     * @param outIdx - Target slot index.
     */
    export function addSliceAndVectorToSlice(
        aArray: Float32Array,
        aIdx: number,
        b: Vector3,
        outArray: Float32Array,
        outIdx: number
    ): void {
        const a3 = aIdx * 3;
        const out3 = outIdx * 3;
        outArray[out3] = aArray[a3] + b.x;
        outArray[out3 + 1] = aArray[a3 + 1] + b.y;
        outArray[out3 + 2] = aArray[a3 + 2] + b.z;
    }

    /**
     * Adds two Vector3 objects together, writing the result into a flat TypedArray slot.
     * @param a - First Vector3 addend.
     * @param b - Second Vector3 addend.
     * @param outArray - Target flat TypedArray with stride 3.
     * @param outIdx - Target slot index.
     */
    export function addVectorsToSlice(a: Vector3, b: Vector3, outArray: Float32Array, outIdx: number): void {
        const out3 = outIdx * 3;
        outArray[out3] = a.x + b.x;
        outArray[out3 + 1] = a.y + b.y;
        outArray[out3 + 2] = a.z + b.z;
    }

    /**
     * Subtracts vector b from vector a, writing the result into a flat TypedArray slot.
     * @param a - Vector to subtract from (minuend).
     * @param b - Vector to subtract (subtrahend).
     * @param outArray - Target flat TypedArray with stride 3.
     * @param outIdx - Target slot index.
     */
    export function subtractVectorsToSlice(a: Vector3, b: Vector3, outArray: Float32Array, outIdx: number): void {
        const out3 = outIdx * 3;
        outArray[out3] = a.x - b.x;
        outArray[out3 + 1] = a.y - b.y;
        outArray[out3 + 2] = a.z - b.z;
    }

    /**
     * Adds an array vector slot and a Vector3 object, writing into an output Vector3.
     * @param aArray - Source flat TypedArray with stride 3.
     * @param aIdx - Source slot index.
     * @param b - Vector3 addend.
     * @param outVector - Destination Vector3 object.
     * @returns The modified outVector instance.
     */
    export function addSliceAndVectorToVector(
        aArray: Float32Array,
        aIdx: number,
        b: Vector3,
        outVector: Vector3
    ): Vector3 {
        const a3 = aIdx * 3;
        outVector.x = aArray[a3] + b.x;
        outVector.y = aArray[a3 + 1] + b.y;
        outVector.z = aArray[a3 + 2] + b.z;

        return outVector;
    }

    /**
     * Adds a scaled source array slot in-place to a target array slot.
     * @param sourceArray - Source flat TypedArray with stride 3.
     * @param sIdx - Source slot index.
     * @param scale - Scale multiplier applied to source slot.
     * @param targetArray - Target flat TypedArray with stride 3.
     * @param tIdx - Target slot index.
     */
    export function addScaledSliceOntoSlice(
        sourceArray: Float32Array,
        sIdx: number,
        scale: number,
        targetArray: Float32Array,
        tIdx: number
    ): void {
        const t3 = tIdx * 3;
        const s3 = sIdx * 3;
        targetArray[t3] += sourceArray[s3] * scale;
        targetArray[t3 + 1] += sourceArray[s3 + 1] * scale;
        targetArray[t3 + 2] += sourceArray[s3 + 2] * scale;
    }

    /**
     * Adds a scaled Vector3 object in-place to a target array slot.
     * @param vec - Source Vector3 object.
     * @param scale - Scale multiplier applied to the vector.
     * @param targetArray - Target flat TypedArray with stride 3.
     * @param tIdx - Target slot index.
     */
    export function addScaledVectorOntoSlice(
        vec: Vector3,
        scale: number,
        targetArray: Float32Array,
        tIdx: number
    ): void {
        const t3 = tIdx * 3;
        targetArray[t3] += vec.x * scale;
        targetArray[t3 + 1] += vec.y * scale;
        targetArray[t3 + 2] += vec.z * scale;
    }

    /**
     * Adds a scaled array vector slot in-place to a target Vector3 object.
     * @param sourceArray - Source flat TypedArray with stride 3.
     * @param sIdx - Source slot index.
     * @param scale - Scale multiplier applied to the source slot.
     * @param target - Destination Vector3 object.
     * @returns The modified target Vector3 instance.
     */
    export function addScaledSliceOntoVector(
        sourceArray: Float32Array,
        sIdx: number,
        scale: number,
        target: Vector3
    ): Vector3 {
        const s3 = sIdx * 3;
        target.x += sourceArray[s3] * scale;
        target.y += sourceArray[s3 + 1] * scale;
        target.z += sourceArray[s3 + 2] * scale;

        return target;
    }

    /**
     * Subtracts vector slot b from vector slot a and writes the result into an output Vector3 object.
     * @param aArray - First source flat TypedArray with stride 3.
     * @param aIdx - First source slot index.
     * @param bArray - Second source flat TypedArray with stride 3.
     * @param bIdx - Second source slot index.
     * @param out - Destination Vector3 object.
     * @returns The modified out Vector3 instance.
     */
    export function subtractSlicesToVector(
        aArray: Float32Array,
        aIdx: number,
        bArray: Float32Array,
        bIdx: number,
        out: Vector3
    ): Vector3 {
        const a3 = aIdx * 3;
        const b3 = bIdx * 3;
        out.x = aArray[a3] - bArray[b3];
        out.y = aArray[a3 + 1] - bArray[b3 + 1];
        out.z = aArray[a3 + 2] - bArray[b3 + 2];

        return out;
    }

    /**
     * Subtracts a Vector3 object from a vector slot, writing the result into a target Vector3.
     * @param aArray - Source flat TypedArray with stride 3.
     * @param aIdx - Source slot index.
     * @param b - Vector3 subtracted.
     * @param out - Destination Vector3 object.
     * @returns The modified out instance.
     */
    export function subtractVectorFromSliceToVector(
        aArray: Float32Array,
        aIdx: number,
        b: Vector3,
        out: Vector3
    ): Vector3 {
        const a3 = aIdx * 3;
        out.x = aArray[a3] - b.x;
        out.y = aArray[a3 + 1] - b.y;
        out.z = aArray[a3 + 2] - b.z;

        return out;
    }

    /**
     * Multiplies a vector by a scalar, writing the result into a flat TypedArray slot.
     * @param a - The Vector3 to multiply.
     * @param b - The scalar to multiply by.
     * @param outArray - The target flat TypedArray with stride 3.
     * @param outIdx - The target slot index.
     */
    export function multiplyVectorToSlice(a: Vector3, b: number, outArray: Float32Array, outIdx: number): void {
        const out3 = outIdx * 3;
        outArray[out3] = a.x * b;
        outArray[out3 + 1] = a.y * b;
        outArray[out3 + 2] = a.z * b;
    }

    /**
     * Scales all components of a vector slot in a flat TypedArray in-place by a scalar.
     * @param array - Target flat TypedArray with stride 3.
     * @param idx - Slot index.
     * @param scalar - Scale multiplier.
     */
    export function scaleSlice(array: Float32Array, idx: number, scalar: number): void {
        const i3 = idx * 3;
        array[i3] *= scalar;
        array[i3 + 1] *= scalar;
        array[i3 + 2] *= scalar;
    }

    /**
     * Computes the dot product between two vector slots in flat TypedArrays.
     * @param aArray - First source flat TypedArray with stride 3.
     * @param aIdx - First source slot index.
     * @param bArray - Second source flat TypedArray with stride 3.
     * @param bIdx - Second source slot index.
     * @returns The scalar dot product.
     */
    export function dotSlices(aArray: Float32Array, aIdx: number, bArray: Float32Array, bIdx: number): number {
        const a3 = aIdx * 3;
        const b3 = bIdx * 3;
        return aArray[a3] * bArray[b3] + aArray[a3 + 1] * bArray[b3 + 1] + aArray[a3 + 2] * bArray[b3 + 2];
    }

    /**
     * Computes the dot product between a Vector3 object and a vector slot in a flat TypedArray.
     * @param array - Source flat TypedArray with stride 3.
     * @param idx - Slot index.
     * @param vec - Vector3 object.
     * @returns The scalar dot product.
     */
    export function dotSliceAndVector(array: Float32Array, idx: number, vec: Vector3): number {
        const i3 = idx * 3;
        return vec.x * array[i3] + vec.y * array[i3 + 1] + vec.z * array[i3 + 2];
    }

    /**
     * Computes the Euclidean length (magnitude) of a vector slot in a flat TypedArray.
     * @param array - Source flat TypedArray with stride 3.
     * @param idx - Slot index.
     * @returns The Euclidean length.
     */
    export function length(array: Float32Array, idx: number): number {
        return Math.sqrt(lengthSquared(array, idx));
    }

    /**
     * Computes the squared Euclidean length of a vector slot in a flat TypedArray.
     * @param array - Source flat TypedArray with stride 3.
     * @param idx - Slot index.
     * @returns The squared length.
     */
    export function lengthSquared(array: Float32Array, idx: number): number {
        const i3 = idx * 3;
        const x = array[i3];
        const y = array[i3 + 1];
        const z = array[i3 + 2];

        return x * x + y * y + z * z;
    }

    /**
     * Computes the squared Euclidean distance between two vector slots in flat TypedArrays.
     * @param aArray - First source flat TypedArray with stride 3.
     * @param aIdx - First source slot index.
     * @param bArray - Second source flat TypedArray with stride 3.
     * @param bIdx - Second source slot index.
     * @returns The squared distance.
     */
    export function sliceToSliceDistanceSquared(
        aArray: Float32Array,
        aIdx: number,
        bArray: Float32Array,
        bIdx: number
    ): number {
        const a3 = aIdx * 3;
        const b3 = bIdx * 3;
        const dx = aArray[a3] - bArray[b3];
        const dy = aArray[a3 + 1] - bArray[b3 + 1];
        const dz = aArray[a3 + 2] - bArray[b3 + 2];

        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * Computes the squared Euclidean distance between a vector slot in a flat TypedArray and a Vector3 object.
     * @param array - Source flat TypedArray with stride 3.
     * @param idx - Slot index.
     * @param vec - Vector3 object.
     * @returns The squared distance.
     */
    export function sliceToVectorDistanceSquared(array: Float32Array, idx: number, vec: Vector3): number {
        const i3 = idx * 3;
        const dx = vec.x - array[i3];
        const dy = vec.y - array[i3 + 1];
        const dz = vec.z - array[i3 + 2];

        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * Computes the cross product (a x b) between two vector slots in flat TypedArrays and writes the result into an output Vector3.
     * @param aArray - First source flat TypedArray with stride 3.
     * @param aIdx - First source slot index.
     * @param bArray - Second source flat TypedArray with stride 3.
     * @param bIdx - Second source slot index.
     * @param out - Destination Vector3 object.
     * @returns The modified out Vector3 instance.
     */
    export function crossToVector(
        aArray: Float32Array,
        aIdx: number,
        bArray: Float32Array,
        bIdx: number,
        out: Vector3
    ): Vector3 {
        const a3 = aIdx * 3;
        const b3 = bIdx * 3;
        const ax = aArray[a3];
        const ay = aArray[a3 + 1];
        const az = aArray[a3 + 2];

        const bx = bArray[b3];
        const by = bArray[b3 + 1];
        const bz = bArray[b3 + 2];

        out.x = ay * bz - az * by;
        out.y = az * bx - ax * bz;
        out.z = ax * by - ay * bx;

        return out;
    }

    /**
     * Computes the cross product (a x b) between two vector slots in flat TypedArrays and writes the result into an output array slot.
     * @param aArray - First source flat TypedArray with stride 3.
     * @param aIdx - First source slot index.
     * @param bArray - Second source flat TypedArray with stride 3.
     * @param bIdx - Second source slot index.
     * @param outArray - Target flat TypedArray with stride 3.
     * @param outIdx - Target slot index.
     */
    export function crossToSlice(
        aArray: Float32Array,
        aIdx: number,
        bArray: Float32Array,
        bIdx: number,
        outArray: Float32Array,
        outIdx: number
    ): void {
        const a3 = aIdx * 3;
        const b3 = bIdx * 3;
        const ax = aArray[a3];
        const ay = aArray[a3 + 1];
        const az = aArray[a3 + 2];

        const bx = bArray[b3];
        const by = bArray[b3 + 1];
        const bz = bArray[b3 + 2];

        const out3 = outIdx * 3;
        outArray[out3] = ay * bz - az * by;
        outArray[out3 + 1] = az * bx - ax * bz;
        outArray[out3 + 2] = ax * by - ay * bx;
    }

    /**
     * Normalizes a vector slot into an output Vector3 object.
     * @param array - Source flat TypedArray with stride 3.
     * @param idx - Slot index.
     * @param out - Destination Vector3 object.
     * @param epsilon - Threshold below which the vector is treated as zero (default: 1e-6).
     * @returns The original Euclidean length of the vector.
     */
    export function normalizeToVector(array: Float32Array, idx: number, out: Vector3, epsilon: number = 1e-6): number {
        const i3 = idx * 3;
        const x = array[i3];
        const y = array[i3 + 1];
        const z = array[i3 + 2];
        const lenSq = x * x + y * y + z * z;

        if (lenSq <= epsilon * epsilon) {
            out.x = 0;
            out.y = 0;
            out.z = 0;

            return 0;
        }

        const len = Math.sqrt(lenSq);
        const invLen = 1 / len;
        out.x = x * invLen;
        out.y = y * invLen;
        out.z = z * invLen;

        return len;
    }

    /**
     * Computes the element-wise (Hadamard) product of two array vector slots and writes into an output array slot.
     * @param aArray - First source flat TypedArray.
     * @param aIdx - First source slot index.
     * @param bArray - Second source flat TypedArray.
     * @param bIdx - Second source slot index.
     * @param targetArray - Destination flat TypedArray.
     * @param tIdx - Destination slot index.
     */
    export function hadamardMultiplyToSlice(
        aArray: Float32Array,
        aIdx: number,
        bArray: Float32Array,
        bIdx: number,
        targetArray: Float32Array,
        tIdx: number
    ): void {
        const a3 = aIdx * 3;
        const b3 = bIdx * 3;
        const t3 = tIdx * 3;
        targetArray[t3] = aArray[a3] * bArray[b3];
        targetArray[t3 + 1] = aArray[a3 + 1] * bArray[b3 + 1];
        targetArray[t3 + 2] = aArray[a3 + 2] * bArray[b3 + 2];
    }

    /**
     * Computes the element-wise (Hadamard) product of two array vector slots and writes into an output Vector3 object.
     * @param aArray - First source flat TypedArray.
     * @param aIdx - First source slot index.
     * @param bArray - Second source flat TypedArray.
     * @param bIdx - Second source slot index.
     * @param targetVector - Destination Vector3 object.
     * @returns The modified targetVector instance.
     */
    export function hadamardMultiplyToVector(
        aArray: Float32Array,
        aIdx: number,
        bArray: Float32Array,
        bIdx: number,
        targetVector: Vector3
    ): Vector3 {
        const a3 = aIdx * 3;
        const b3 = bIdx * 3;
        targetVector.x = aArray[a3] * bArray[b3];
        targetVector.y = aArray[a3 + 1] * bArray[b3 + 1];
        targetVector.z = aArray[a3 + 2] * bArray[b3 + 2];

        return targetVector;
    }

    /**
     * Compares a vector slot in a flat TypedArray against a Vector3 object for exact equality.
     * @param array - Source flat TypedArray with stride 3.
     * @param idx - Slot index to compare against.
     * @param vector - Vector3 to compare.
     * @returns True if x, y, and z are exactly equal.
     */
    export function equalsVector(array: Float32Array, idx: number, vector: Vector3): boolean {
        const i3 = idx * 3;
        return vector.x === array[i3] && vector.y === array[i3 + 1] && vector.z === array[i3 + 2];
    }

    /**
     * Computes the element-wise (Hadamard) division of a Vector3 object by a vector slot in a flat TypedArray and writes the result into an output Vector3 object.
     * @param numVec - Numerator Vector3 object.
     * @param denomArray - Denominator flat TypedArray with stride 3.
     * @param denomIdx - Denominator slot index.
     * @param out - Destination Vector3 object.
     * @param epsilon - Threshold below which the denominator component is treated as zero (default: 1e-6).
     * @returns The modified out Vector3 instance.
     */
    export function safeHadamardDivideVectorBySliceToVector(
        numVec: Vector3,
        denomArray: Float32Array,
        denomIdx: number,
        out: Vector3,
        epsilon: number = 1e-6
    ): Vector3 {
        const d3 = denomIdx * 3;
        out.x = Math.abs(denomArray[d3]) > epsilon ? numVec.x / denomArray[d3] : 0;
        out.y = Math.abs(denomArray[d3 + 1]) > epsilon ? numVec.y / denomArray[d3 + 1] : 0;
        out.z = Math.abs(denomArray[d3 + 2]) > epsilon ? numVec.z / denomArray[d3 + 2] : 0;

        return out;
    }
}


// --- SOURCE: src\botobjectives.ts ---











// Unified objective read model for the bot population. Bunkers (native
// CapturePoints) and area buildings (custom AreaTrigger capture) become one
// flat list with a cached world position, a cached mod.Vector handle and an
// event-fed occupant set each.
//
// Cost model: every mod.* call in this file runs once at init. Steady state
// is pure math (sliceToVectorDistanceSquared) plus plain map reads - zero FFI,
// zero allocation per pick. Objective positions never move, so the cache is
// never invalidated; ownership is refreshed from the in-memory buildings /
// capture state, never re-queried from the engine.
//
// This deliberately duplicates capture.ts occupancy rather than sharing it:
// capture's sets are its private simulation state, and bots need a superset
// view that also covers bunkers.

export const OBJ_BUNKER: number = 0;
export const OBJ_ENERGY: number = 1;
export const OBJ_PROTO: number = 2;
export const OBJ_WAR: number = 3;
export const OBJ_AIR: number = 4;
export const OBJ_NAVAL: number = 5;

// Intent states returned alongside a pick.
export const OBJ_HOLD: number = 0;    // owned by us, uncontested - stay
export const OBJ_ATTACK: number = 1;  // not owned by us - take it
export const OBJ_DEFEND: number = 2;  // owned by us but contested - fight for it

const MAX_OBJECTIVES: number = 16;

const objPos: Float32Array = new Float32Array(MAX_OBJECTIVES * 3);
const objVec: mod.Vector[] = [];
const objOwner: number[] = [];
const objKind: number[] = [];
const objKey: string[] = [];
const occByIdx: number[][] = [];
const idxByTrigger: { [triggerId: number]: number } = {};
const idxByCp: { [cpId: number]: number } = {};
const occTeam: { [pid: number]: number } = {};
// Native CapturePoint handle per objective, bunkers only. Held so deployment
// can teleport onto a freshly read bunker position (mod.GetObjectPosition on
// the CapturePoint) instead of a cached anchor, matching CustomConquest V15
// AI_ObjectiveSpawn.
const objCp: (mod.CapturePoint | undefined)[] = [];

let objCount: number = 0;
let ownersDirty: boolean = true;
let inited: boolean = false;

// Scratch reused by every pick. Never stored, never returned.
const scratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

function kindOf(kind: string): number {
    if (kind === "energy") {
        return OBJ_ENERGY;
    }
    if (kind === "proto") {
        return OBJ_PROTO;
    }
    if (kind === "war") {
        return OBJ_WAR;
    }
    if (kind === "air") {
        return OBJ_AIR;
    }
    if (kind === "naval") {
        return OBJ_NAVAL;
    }
    return OBJ_PROTO;
}

function addObjective(key: string, kind: number, owner: number, vec: mod.Vector): void {
    if (objCount >= MAX_OBJECTIVES) {
        log("botobj", "pool full, dropping " + key);
        return;
    }
    const idx: number = objCount;
    objCount++;
    objKey[idx] = key;
    objKind[idx] = kind;
    objOwner[idx] = owner;
    objVec[idx] = vec;
    occByIdx[idx] = [];
    // Single boundary conversion per objective, at init only.
    Vectors.toVector3(vec, scratch);
    InterleavedVectors.setSlice(objPos, idx, scratch.x, scratch.y, scratch.z);
}

// Position source preference: WorldIcon first (a real world-positioned
// object), AreaTrigger as fallback. This also resolves the open PS_ObjIds
// 6.2 question for the bot path: whichever source binds is logged here.
function resolveAreaVec(
    key: string, worldIconId: number, triggerId: number
): mod.Vector | undefined {
    if (isConfigured(worldIconId)) {
        try {
            const icon: mod.WorldIcon = mod.GetWorldIcon(worldIconId);
            if (mod.IsValid(icon)) {
                const vec: mod.Vector = mod.GetObjectPosition(icon);
                log("botobj", key + " anchored on WorldIcon " + worldIconId);
                return vec;
            }
        } catch (e) {
        }
    }
    if (isConfigured(triggerId)) {
        try {
            const trigger: mod.AreaTrigger = mod.GetAreaTrigger(triggerId);
            if (mod.IsValid(trigger)) {
                const vec: mod.Vector = mod.GetObjectPosition(trigger);
                log("botobj", key + " anchored on AreaTrigger " + triggerId + " (icon missing)");
                return vec;
            }
        } catch (e) {
        }
    }
    return undefined;
}

export function initBotObjectives(): void {
    if (inited) {
        return;
    }
    inited = true;
    for (const b of allBunkers()) {
        if (!isConfigured(b.def.capturePointId)) {
            continue;
        }
    try {
            const vec: mod.Vector = mod.GetObjectPosition(b.capturePoint);
            addObjective("bunker:" + b.def.id, OBJ_BUNKER, b.owner, vec);
            const idx: number = objCount - 1;
            idxByCp[b.def.capturePointId] = idx;
            objCp[idx] = b.capturePoint;
        } catch (e) {
            log("botobj", "bunker " + b.def.id + " position failed: " + String(e));
        }
    }
    for (const st of allStates()) {
        const vec: mod.Vector | undefined = resolveAreaVec(
            "area:" + st.def.id, st.def.worldIconId, st.def.areaTriggerId
        );
        if (vec === undefined) {
            log("botobj", "area " + st.def.id + " has no anchor, skipped");
            continue;
        }
        addObjective("area:" + st.def.id, kindOf(st.def.kind), st.owner, vec);
        idxByTrigger[st.def.areaTriggerId] = objCount - 1;
    }
    log("botobj", "bound " + objCount + " objectives");
    configureBotObjectiveEvents();
}

export function objectiveCount(): number {
    return objCount;
}

export function objectiveKey(idx: number): string {
    return objKey[idx] === undefined ? "?" : objKey[idx];
}

export function objectiveVector(idx: number): mod.Vector {
    return objVec[idx];
}

// Deployment placement. Bots must land in a bunker, so this only ever considers
// OBJ_BUNKER objectives - the energy, proto, war, air and naval AreaTriggers are
// attack targets, not spawn targets, and a playtest showed bots landing on
// resource points because those were in the same candidate list.
//
// The position is read from the native CapturePoint at deploy time with
// mod.GetObjectPosition, matching CustomConquest V15 AI_ObjectiveSpawn, rather
// than from the cached anchor, so a bunker that moves with its deployment keeps
// spawning bots where it actually is.
//
// Within the bunkers this team owns, the emptiest is preferred and the roll
// breaks ties, so 24 spawning bots distribute across the team's bunkers instead
// of all landing on the same one. Returns -1 when the team owns no bunker, and
// the caller then leaves the bot at its spawner rather than dumping it on a
// contested point.
export function pickSpawnObjective(team: number, roll: number): number {
    let minOcc: number = -1;
    for (let i: number = 0; i < objCount; i++) {
        if (objKind[i] !== OBJ_BUNKER || objOwner[i] !== team) {
            continue;
        }
        const occ: number = occupancy(i);
        if (minOcc < 0 || occ < minOcc) {
            minOcc = occ;
        }
    }
    if (minOcc < 0) {
        return -1;
    }
    let n: number = 0;
    for (let i: number = 0; i < objCount; i++) {
        if (objKind[i] === OBJ_BUNKER && objOwner[i] === team && occupancy(i) === minOcc) {
            n++;
        }
    }
    if (n === 0) {
        return -1;
    }
    let at: number = Math.floor(roll * n);
    if (at < 0) {
        at = 0;
    }
    if (at >= n) {
        at = n - 1;
    }
    for (let i: number = 0; i < objCount; i++) {
        if (objKind[i] === OBJ_BUNKER && objOwner[i] === team && occupancy(i) === minOcc) {
            if (at === 0) {
                return i;
            }
            at--;
        }
    }
    return -1;
}

// The native CapturePoint behind a bunker objective, or undefined for area
// objectives. Callers use this to read a live position at deploy time.
export function bunkerCapturePoint(idx: number): mod.CapturePoint | undefined {
    return objCp[idx];
}

export function objectiveKind(idx: number): number {
    return objKind[idx] === undefined ? -1 : objKind[idx];
}

export function ownerOf(idx: number): number {
    return objOwner[idx] === undefined ? 0 : objOwner[idx];
}

// Refresh ownership from the in-memory buildings / capture state. Zero FFI:
// both modules own their numbers already, we just copy them over.
export function refreshOwners(): void {
    for (const b of allBunkers()) {
        const idx: number | undefined = idxByCp[b.def.capturePointId];
        if (idx !== undefined) {
            objOwner[idx] = b.owner;
        }
    }
    for (const st of allStates()) {
        const idx: number | undefined = idxByTrigger[st.def.areaTriggerId];
        if (idx !== undefined) {
            objOwner[idx] = st.owner;
        }
    }
    ownersDirty = false;
}

export function markOwnersDirty(): void {
    ownersDirty = true;
}

export function ownersNeedRefresh(): boolean {
    return ownersDirty;
}

function addOccupant(idx: number, pid: number, team: number): void {
    const occ: number[] = occByIdx[idx];
    if (occ === undefined || pid < 0) {
        return;
    }
    if (occ.indexOf(pid) < 0) {
        occ.push(pid);
    }
    occTeam[pid] = team;
}

function removeOccupant(idx: number, pid: number): void {
    const occ: number[] = occByIdx[idx];
    if (occ === undefined) {
        return;
    }
    const at: number = occ.indexOf(pid);
    if (at >= 0) {
        occ.splice(at, 1);
    }
}

// Called by bots.ts when a bot dies or undeploys. A corpse must stop counting
// as an occupant, otherwise the capture sim keeps crediting a dead player.
export function dropOccupant(pid: number): void {
    for (let i: number = 0; i < objCount; i++) {
        removeOccupant(i, pid);
    }
    delete occTeam[pid];
}

// True when both teams stand on the objective right now. Pure map reads.
export function isContested(idx: number): boolean {
    const occ: number[] = occByIdx[idx];
    if (occ === undefined || occ.length < 2) {
        return false;
    }
    let t1: boolean = false;
    let t2: boolean = false;
    for (const pid of occ) {
        const t: number | undefined = occTeam[pid];
        if (t === 1) {
            t1 = true;
        } else if (t === 2) {
            t2 = true;
        }
        if (t1 && t2) {
            return true;
        }
    }
    return false;
}

// Which objective, if any, holds this player right now. Zero FFI.
export function onObjective(pid: number): number {
    for (let i: number = 0; i < objCount; i++) {
        if (occByIdx[i].indexOf(pid) >= 0) {
            return i;
        }
    }
    return -1;
}

// Intent state of an objective for a team: defend a contested owned point
// first, attack what is not ours, hold what is safely ours.
export function objectiveState(idx: number, team: number): number {
    if (objOwner[idx] !== team) {
        return OBJ_ATTACK;
    }
    return isContested(idx) ? OBJ_DEFEND : OBJ_HOLD;
}

// Nearest objective by role priority: contested-ours, then nearest not-ours
// within pathing range, then nearest safely-ours. All squared distances, one
// sqrt nowhere. Returns -1 when nothing is in range.
//
// Occupancy is folded into the comparison as a squared-distance penalty so a
// bot prefers a slightly further but empty point over piling onto a point that
// already has a dozen bots standing on it. That penalty is what stops the whole
// team funnelling through one doorway and then shoving each other off the flag.
export function pickObjective(team: number, x: number, y: number, z: number): number {
    scratch.x = x;
    scratch.y = y;
    scratch.z = z;
    const maxD: number = BOT_MAX_PATH_M * BOT_MAX_PATH_M;
    let defend: number = -1;
    let defendD: number = 0;
    let attack: number = -1;
    let attackD: number = 0;
    let hold: number = -1;
    let holdD: number = 0;
    for (let i: number = 0; i < objCount; i++) {
        const d: number = InterleavedVectors.sliceToVectorDistanceSquared(objPos, i, scratch);
        if (d > maxD) {
            continue;
        }
        // Crowding penalty, in squared-metre units: each bot already standing
        // there is worth BOT_CROWD_PENALTY_M of extra "distance".
        const occ: number = occupancy(i);
        const cost: number = d + occ * occ * BOT_CROWD_PENALTY_M * BOT_CROWD_PENALTY_M;
        const st: number = objectiveState(i, team);
        if (st === OBJ_DEFEND) {
            if (defend < 0 || cost < defendD) {
                defend = i;
                defendD = cost;
            }
        } else if (st === OBJ_ATTACK) {
            if (attack < 0 || cost < attackD) {
                attack = i;
                attackD = cost;
            }
        } else {
            if (hold < 0 || cost < holdD) {
                hold = i;
                holdD = cost;
            }
        }
    }
    if (defend >= 0) {
        return defend;
    }
    if (attack >= 0) {
        return attack;
    }
    return hold;
}

export function distSqTo(idx: number, x: number, y: number, z: number): number {    scratch.x = x;
    scratch.y = y;
    scratch.z = z;
    return InterleavedVectors.sliceToVectorDistanceSquared(objPos, idx, scratch);
}

// Guard assignment target. A bot picked as a factory guard has no other job, so
// it needs the nearest prototype factory its team actually owns. A playtest
// showed generic picks parking guards in the prototype factory by accident and
// then never moving them again, which is exactly the reported behaviour, so the
// role is now explicit and the brain sticks to it. Returns -1 when the team owns
// no prototype factory, which lets the guard fall back to normal picking.
export function pickGuardObjective(team: number, x: number, y: number, z: number): number {
    scratch.x = x;
    scratch.y = y;
    scratch.z = z;
    let best: number = -1;
    let bestD: number = 0;
    for (let i: number = 0; i < objCount; i++) {
        if (objKind[i] !== OBJ_PROTO || objOwner[i] !== team) {
            continue;
        }
        const d: number = InterleavedVectors.sliceToVectorDistanceSquared(objPos, i, scratch);
        if (best < 0 || d < bestD) {
            best = i;
            bestD = d;
        }
    }
    return best;
}

// Roaming target. This is CustomConquest V15 AI_Scouting reduced to what the bot
// already has: pick another objective within range and walk there, instead of
// holding the first one it reached for the rest of the match. exclude is the
// objective the bot is already on, so a roam always produces a new destination
// and the brain's dirty-check sees a changed intent. Owned points are preferred
// over enemy ones, since a roam is about circulating, not about rotating the
// whole team into a single attack.
export function pickRoamObjective(
    team: number, x: number, y: number, z: number, exclude: number
): number {
    scratch.x = x;
    scratch.y = y;
    scratch.z = z;
    const maxD: number = BOT_MAX_PATH_M * BOT_MAX_PATH_M;
    let own: number = -1;
    let ownD: number = 0;
    let any: number = -1;
    let anyD: number = 0;
    for (let i: number = 0; i < objCount; i++) {
        if (i === exclude) {
            continue;
        }
        const d: number = InterleavedVectors.sliceToVectorDistanceSquared(objPos, i, scratch);
        if (d > maxD) {
            continue;
        }
        if (any < 0 || d < anyD) {
            any = i;
            anyD = d;
        }
        if (objOwner[i] === team && (own < 0 || d < ownD)) {
            own = i;
            ownD = d;
        }
    }
    return own >= 0 ? own : any;
}

// Which owned objective most needs help right now: enemies inside the threat
// radius of a point we still own. Returns -1 when nothing is threatened, or when
// the most pressured point is already busier with defenders than it is with
// attackers, which is the case where sending one more bot across makes it worse.
//
// Pure map reads plus one PlayerLocations sphere query, so this is safe to call
// from a bot think.
export function pickDefendObjective(
    team: number, x: number, y: number, z: number
): number {
    scratch.x = x;
    scratch.y = y;
    scratch.z = z;
    const reachSq: number = BOT_THREAT_REACH_M * BOT_THREAT_REACH_M;
    let best: number = -1;
    let bestScore: number = 0;
    for (let i: number = 0; i < objCount; i++) {
        if (objOwner[i] !== team) {
            continue;
        }
        const d: number = InterleavedVectors.sliceToVectorDistanceSquared(objPos, i, scratch);
        if (d > reachSq) {
            continue;
        }
        const defenders: number = occupancy(i);
        const pressure: number = enemyPressure(i, team, BOT_THREAT_REACH_M);
        // Two enemies minimum, and strictly more attackers than defenders.
        // Without both gates a single enemy loitering near a flag would pull
        // half the team off what it is doing, because the reach radius is
        // deliberately wide.
        if (pressure < 2 || defenders >= pressure) {
            continue;
        }
        // Under-defended by margin, and nearer is better on a tie.
        const score: number = pressure - defenders;
        if (best < 0 || score > bestScore) {
            best = i;
            bestScore = score;
        }
    }
    return best;
}

// How many bots currently stand on an objective. Used to spread a crowd across
// objectives instead of stacking all 24 on the single nearest one.
export function occupancy(idx: number): number {
    const occ: number[] = occByIdx[idx];
    return occ === undefined ? 0 : occ.length;
}

// Enemy pressure on an objective for a team: how many enemy players are inside
// the threat radius of the anchor. This is the "they are about to cap that one"
// signal the brain reacts to, and it comes from PlayerLocations' cached
// positions, so it costs no FFI at all - the sphere query walks a prebuilt
// voxel grid in QuickJS memory rather than calling mod.GetSoldierState.
//
// Distinct from isContested, which only reports players standing exactly on the
// trigger. An objective with no one on it but two enemies walking toward it is
// exactly the case that needs a defender sent across, and isContested cannot
// see it.
export function enemyPressure(idx: number, team: number, radius: number): number {
    if (idx < 0 || idx >= objCount || !PlayerLocations.isInitialized()) {
        return 0;
    }
    const ax: number = objPos[idx * 3];
    const ay: number = objPos[idx * 3 + 1];
    const az: number = objPos[idx * 3 + 2];
    return PlayerLocations.findPlayersInSphere(
        ax, ay, az, radius,
        (p: mod.Player) => isEnemyTeam(teamIdOf(p), team)
    );
}

// A per-bot offset around an objective anchor. Without this every bot on a team
// aimed at the same metre, walked to the same metre, and shoved each other off
// it. The offset is a pure function of the player id, so a bot keeps the same
// spot between sweeps instead of jittering. Cached mod.Vector per bot: the
// behavior APIs take a Vector and the spread never changes for a given bot.
const spreadX: { [pid: number]: number } = {};
const spreadZ: { [pid: number]: number } = {};
const spreadVec: { [pid: number]: mod.Vector } = {};

export function spreadOffset(pid: number, idx: number): mod.Vector {
    let vec: mod.Vector = spreadVec[pid];
    if (vec === undefined) {
        // Stable per-pid pseudo-random direction and radius.
        const h: number = (pid * 2654435761 + idx * 40503) % 10007;
        const ang: number = (h / 10007) * Math.PI * 2;
        const rad: number = BOT_SPREAD_M * (0.35 + ((h % 977) / 977) * 0.65);
        spreadX[pid] = Math.cos(ang) * rad;
        spreadZ[pid] = Math.sin(ang) * rad;
        vec = mod.CreateVector(spreadX[pid], 0, spreadZ[pid]);
        spreadVec[pid] = vec;
    }
    return vec;
}

function onEnterTrigger(p: mod.Player, at: mod.AreaTrigger): void {
    const idx: number | undefined = idxByTrigger[mod.GetObjId(at)];
    if (idx === undefined) {
        return;
    }
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    addOccupant(idx, pid, teamIdOf(p));
}

function onExitTrigger(p: mod.Player, at: mod.AreaTrigger): void {
    const idx: number | undefined = idxByTrigger[mod.GetObjId(at)];
    if (idx === undefined) {
        return;
    }
    removeOccupant(idx, mod.GetObjId(p));
}

function onEnterCp(p: mod.Player, cp: mod.CapturePoint): void {
    const st = bunkerByCp(mod.GetObjId(cp));
    if (st === undefined) {
        return;
    }
    const idx: number | undefined = idxByCp[st.def.capturePointId];
    if (idx === undefined) {
        return;
    }
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    addOccupant(idx, pid, teamIdOf(p));
}

function onExitCp(p: mod.Player, cp: mod.CapturePoint): void {
    const st = bunkerByCp(mod.GetObjId(cp));
    if (st === undefined) {
        return;
    }
    const idx: number | undefined = idxByCp[st.def.capturePointId];
    if (idx === undefined) {
        return;
    }
    removeOccupant(idx, mod.GetObjId(p));
}

function configureBotObjectiveEvents(): void {
    Events.OnPlayerEnterAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("botobj.enter", () => { onEnterTrigger(p, at); });
    });
    Events.OnPlayerExitAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("botobj.exit", () => { onExitTrigger(p, at); });
    });
    Events.OnPlayerLeaveGame.subscribe((id: number) => {
        safe("botobj.leave", () => { dropOccupant(id); });
    });
    Events.OnPlayerEnterCapturePoint.subscribe((p: mod.Player, cp: mod.CapturePoint) => {
        safe("botobj.cp.enter", () => { onEnterCp(p, cp); });
    });
    Events.OnPlayerExitCapturePoint.subscribe((p: mod.Player, cp: mod.CapturePoint) => {
        safe("botobj.cp.exit", () => { onExitCp(p, cp); });
    });
    // Ownership invalidation is event-driven, never polled: either listener
    // firing means at least one brain must re-pick next sweep.
    onCaptured(() => {
        markOwnersDirty();
    });
    onBunkerCaptured(() => {
        markOwnersDirty();
    });
    if (willLogDebug()) {
        log("botobj", "occupancy + invalidation subscriptions live");
    }
}


// --- SOURCE: src\botbrain.ts ---




// Per-bot intent state. The brain issues a behavior only when the intent
// changes (or when BOT_REISSUE_SWEEPS elapses, if persistence tests demand
// it) - never on a fixed re-issue loop. This is the opposite of the official
// PortalPerformanceExample, which re-issues AIMoveToBehavior every 50 ms.

export const BOT_ROLE_FIGHT: number = 0;
export const BOT_ROLE_GUARD: number = 1;

export interface BotMind {
    state: number;
    obj: number;
    speed: number;
    age: number;
    retries: number;
    role: number;
    // When the current objective was picked, so a holding bot can be told to
    // relocate once it has been sitting there long enough.
    since: number;
    failUntil: { [obj: number]: number };
}

// Role is derived from the player id, not stored and shuffled, so it is stable
// across the whole life of a soldier: a guard does not become a fighter after a
// respawn cycle, and the same handful of ids per team always takes the guard
// slots. The prototype factory is the objective guards are pinned to, which is
// what stops 3-4 bots from wandering off and leaves the rest of the team free to
// roam and attack.
export function roleOf(pid: number, team: number): number {
    return pid % BOT_ROLE_MOD === team ? BOT_ROLE_GUARD : BOT_ROLE_FIGHT;
}

export function newMind(pid: number, team: number): BotMind {
    return {
        state: -1, obj: -1, speed: -1, age: 0, retries: 0,
        role: roleOf(pid, team), since: 0, failUntil: {}
    };
}

// A failed MoveTo stamps the objective as untouchable for a while, then the
// bot re-picks around it. After BOT_RETRY_LIMIT consecutive failures the bot
// holds the nearest safely-owned point instead of wedging itself.
export function noteMoveFailed(mind: BotMind, nowMs: number): void {
    mind.retries++;
    if (mind.obj >= 0) {
        mind.failUntil[mind.obj] = nowMs + BOT_FAIL_COOLDOWN_MS;
    }
    if (mind.retries > BOT_RETRY_LIMIT) {
        mind.retries = 0;
        // Force a re-pick next think by clearing the recorded intent.
        mind.state = -1;
        mind.obj = -1;
        mind.speed = -1;
    }
    if (willLogDebug()) {
        log("botbrain", "move failed obj=" + mind.obj + " retries=" + mind.retries);
    }
}

export function noteMoveSucceeded(mind: BotMind): void {
    mind.retries = 0;
}

function failedRecently(mind: BotMind, obj: number, nowMs: number): boolean {
    const until: number | undefined = mind.failUntil[obj];
    return until !== undefined && nowMs < until;
}

function issueAttack(p: mod.Player, vec: mod.Vector, sprint: boolean): void {
    mod.AIMoveToBehavior(p, vec);
    mod.AISetMoveSpeed(p, sprint ? mod.MoveSpeed.Sprint : mod.MoveSpeed.InvestigateRun);
}

function issueDefend(p: mod.Player, vec: mod.Vector): void {
    mod.AIDefendPositionBehavior(p, vec, BOT_DEFEND_MIN_M, BOT_DEFEND_MAX_M);
    mod.AISetMoveSpeed(p, mod.MoveSpeed.InvestigateRun);
}

function issueHold(p: mod.Player, vec: mod.Vector): void {
    mod.AIDefendPositionBehavior(p, vec, 0, BOT_HOLD_RADIUS_M);
    mod.AISetMoveSpeed(p, mod.MoveSpeed.Patrol);
}

// One think step. Returns true when a behavior was issued, false when the
// standing intent already covers the situation. nowMs is Date.now() from the
// sweep driver, used only for fail-stamp expiry. pid is passed in because the
// sweep driver already holds it, and re-reading it here cost one FFI per bot per
// sweep for a value the caller has in hand.
export function thinkBot(
    p: mod.Player, pid: number, team: number,
    x: number, y: number, z: number,
    mind: BotMind, nowMs: number
): boolean {
    // Already standing on an objective we own: hold it. The capture sim does
    // the rest, no MoveTo required. This is the cheapest possible outcome -
    // a refreshOwners + set lookup, zero FFI.
    const cur: number = onObjective(pid);
    let wantState: number = -1;
    let wantObj: number = -1;
    let roaming: boolean = false;
    if (mind.role === BOT_ROLE_GUARD) {
        // Guards do not roam and do not chase. They own the factory, so the only
        // thing that can pull them off it is losing it.
        const guard: number = pickGuardObjective(team, x, y, z);
        if (guard >= 0) {
            if (cur === guard) {
                wantState = objectiveState(guard, team) === OBJ_ATTACK ? OBJ_ATTACK : OBJ_HOLD;
                wantObj = guard;
            } else if (guard === mind.obj) {
                // Already walking to the factory; leave the intent alone.
                wantState = mind.state;
                wantObj = mind.obj;
            } else {
                wantState = OBJ_ATTACK;
                wantObj = guard;
            }
        }
    }
    if (wantObj < 0 && cur >= 0 && objectiveState(cur, team) !== OBJ_ATTACK
        && !failedRecently(mind, cur, nowMs)) {
        const holding: number = objectiveState(cur, team);
        if (holding === OBJ_HOLD && nowMs - mind.since > BOT_ROAM_MS
            && !failedRecently(mind, mind.obj, nowMs)) {
            // Held it long enough. Go somewhere else, the way CQ's AI_Scouting
            // rotates a bot between points instead of parking it.
            const roam: number = pickRoamObjective(team, x, y, z, cur);
            if (roam >= 0) {
                wantState = OBJ_HOLD;
                wantObj = roam;
                roaming = true;
            }
        }
        if (wantObj < 0) {
            wantState = holding === OBJ_DEFEND ? OBJ_DEFEND : OBJ_HOLD;
            wantObj = cur;
        }
    }
    if (wantObj < 0 || (wantState === OBJ_HOLD && !roaming && mind.role !== BOT_ROLE_GUARD)) {
        // Nothing to hold. Before the normal pick, check whether one of our own
        // objectives is about to be capped: an owned point with enemies around
        // it and fewer defenders than attackers outranks whatever else is
        // available. This is the "defend the one they are taking" behaviour.
        const help: number = pickDefendObjective(team, x, y, z);
        if (help >= 0 && !failedRecently(mind, help, nowMs)) {
            wantState = OBJ_DEFEND;
            wantObj = help;
        }
    }
    if (wantObj < 0) {
        const idx: number = pickObjective(team, x, y, z);
        if (idx < 0) {
            return false;
        }
        if (failedRecently(mind, idx, nowMs)) {
            return false;
        }
        wantState = objectiveState(idx, team);
        wantObj = idx;
    }
    // Arrival without occupancy: standing close enough that the trigger will
    // claim the bot. Hold instead of re-issuing MoveTo every sweep.
    const arriveSq: number = BOT_ARRIVE_M * BOT_ARRIVE_M;
    const dSq: number = distSqTo(wantObj, x, y, z);
    let wantSpeed: number = 0;
    if (wantState === OBJ_ATTACK) {
        if (dSq < arriveSq) {
            wantState = OBJ_HOLD;
        } else {
            wantSpeed = dSq > BOT_SPRINT_DIST_M * BOT_SPRINT_DIST_M ? 1 : 0;
        }
    }
    // Dirty-check: identical intent is never re-issued. age counts sweeps
    // since the last issue; BOT_REISSUE_SWEEPS > 0 re-issues the same intent
    // on schedule if playtests show behaviors expiring mid-path.
    if (mind.state === wantState && mind.obj === wantObj && mind.speed === wantSpeed) {
        mind.age++;
        if (BOT_REISSUE_SWEEPS <= 0 || mind.age < BOT_REISSUE_SWEEPS) {
            return false;
        }
    }
    // Aim at the objective anchor nudged by this bot's own stable offset, so 24
    // bots heading for the same point spread around it instead of stacking on
    // one metre and shoving each other off.
    const anchor: mod.Vector = objectiveVector(wantObj);
    const off: mod.Vector = spreadOffset(pid, wantObj);
    const vec: mod.Vector = mod.CreateVector(
        mod.XComponentOf(anchor) + mod.XComponentOf(off),
        mod.YComponentOf(anchor) + mod.YComponentOf(off),
        mod.ZComponentOf(anchor) + mod.ZComponentOf(off));
    if (wantState === OBJ_ATTACK) {
        issueAttack(p, vec, wantSpeed === 1);
    } else if (wantState === OBJ_DEFEND) {
        issueDefend(p, vec);
    } else {
        issueHold(p, vec);
    }
    const prevObj: number = mind.obj;
    mind.state = wantState;
    mind.obj = wantObj;
    mind.speed = wantSpeed;
    mind.age = 0;
    if (mind.since === 0 || prevObj !== wantObj) {
        // Roam timer restarts only on a genuine destination change, otherwise a
        // re-issued hold would reset the clock and the bot would never rotate.
        mind.since = nowMs;
    }
    return true;
}


// --- SOURCE: src\bots.ts ---















// Custom AI_Spawner bot population. The spawner prefab carries no count or
// respawn property, so this module owns the whole lifecycle: an initial burst
// queue, a per-sweep spawn drain, death -> timed re-queue, and a registry the
// rest of the mod consults (UI suppression, nuke guard, prestige guard).
//
// Cost model: one Timers sweep per second. Each sweep drains at most
// BOT_SPAWN_PER_SWEEP spawns and re-thinks BOT_SLICE bots; a think costs one
// GetPosition (3 FFI) plus a behavior call only when the intent changed.
// Occupancy, ownership and deaths are event-driven - nothing is polled.

interface BotRec {
    pid: number;
    team: number;
    player: mod.Player;
    mind: BotMind;
    dead: boolean;
    // String-table key of the name this soldier was spawned with. Held so the
    // name can go back to the pool when the soldier leaves, since a name cannot
    // be read back off the player.
    nameKey: string;
    // Stuck tracking. lastX/Y/Z is the previous think position, stillFor counts
    // consecutive thinks that moved less than BOT_STUCK_MIN_M, strikes counts
    // windows that have passed without the bot escaping.
    lastX: number;
    lastY: number;
    lastZ: number;
    stillFor: number;
    strikes: number;
    // True while this bot is occupying a vehicle seat. Gates both the boarding
    // attempt and the position-based stuck detector, which cannot tell a parked
    // bot from a bot at the wheel.
    inVehicle: boolean;
}

const respawnPending: { [pid: number]: boolean } = {};

const bots: { [pid: number]: BotRec } = {};
const botOrder: number[] = [];
const botPidSet: { [pid: number]: boolean } = {};
const spawnerByTeam: { [team: number]: mod.Spawner[] } = { 1: [], 2: [] };
const spawnQueue: number[] = [];

let sweepTimer: Timers.TimerID | null = null;
let cursor: number = 0;
let spawnRound: number = 0;
let fixerWired: boolean = false;
let fullRethink: boolean = false;
// Named distinctly rather than a third generic "inited": the bundler flattens
// every module into one scope and suffixes colliding top-level names
// (inited / inited_2 / inited_3), so a uniquely named flag keeps this module
// independent of the other two that share the word.
let botsInited: boolean = false;

// Scratch reused for every position read. Never stored, never returned.
const posScratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

// Zero-FFI bot test for the hot paths (nuke probe, award). Populated at
// OnSpawnerSpawned and at deploy; cleared on leave.
export function isBotPid(pid: number): boolean {
    return botPidSet[pid] === true;
}

// Slower test for event paths that already hold a Player: registry first,
// one IsAISoldier read on miss (deploy is infrequent), then memoized.
export function isBotPlayer(p: mod.Player): boolean {
    let pid: number = -1;
    try {
        pid = mod.GetObjId(p);
    } catch (e) {
        return false;
    }
    if (pid < 0) {
        return false;
    }
    if (botPidSet[pid] === true) {
        return true;
    }
    let ai: boolean = false;
    try {
        ai = mod.GetSoldierState(p, mod.SoldierStateBool.IsAISoldier);
    } catch (e) {
        return false;
    }
    if (ai) {
        botPidSet[pid] = true;
    }
    return ai;
}

function liveCount(team: number): number {
    let n: number = 0;
    for (const pid of botOrder) {
        const rec: BotRec | undefined = bots[pid];
        if (rec !== undefined && !rec.dead && rec.team === team) {
            n++;
        }
    }
    return n;
}

function queueSpawn(team: number): void {
    if (team !== 1 && team !== 2) {
        return;
    }
    spawnQueue.push(team);
}

function drainSpawns(): void {
    let n: number = 0;
    while (n < BOT_SPAWN_PER_SWEEP && spawnQueue.length > 0) {
        const team: number = spawnQueue[0];
        if (liveCount(team) >= BOT_COUNT_PER_TEAM) {
            spawnQueue.shift();
            continue;
        }
        const pool: mod.Spawner[] = spawnerByTeam[team];
        if (pool.length === 0) {
            spawnQueue.shift();
            log("bots", "no spawner for team " + team + ", dropping queued spawn");
            continue;
        }
        const sp: mod.Spawner = pool[spawnRound % pool.length];
        spawnRound++;
        const cls: mod.SoldierClass = spawnRound % 4 === 0
            ? mod.SoldierClass.Assault
            : spawnRound % 4 === 1
                ? mod.SoldierClass.Engineer
                : spawnRound % 4 === 2
                    ? mod.SoldierClass.Recon
                    : mod.SoldierClass.Support;
        const handle: mod.Team | undefined = teamHandle(team);
        if (handle === undefined) {
            spawnQueue.shift();
            log("bots", "no team handle for team " + team + ", dropping queued spawn");
            continue;
        }
        spawnQueue.shift();
        n++;
        // Name is the 4th argument of the four-arg SpawnAIFromAISpawner
        // overload. It must be a string-table key, not a literal: mod.Message
        // renders table entries only, and this is the sole naming path in
        // Tier 0 (no mod.SetPlayerName).
        const nameKey: string = takeBotName(team);
        try {
            mod.SpawnAIFromAISpawner(sp, cls, mod.Message(nameKey), handle);
        } catch (e) {
            releaseBotName(team, nameKey);
            log("bots", "spawn failed team " + team + ": " + String(e));
        }
    }
}

function registerBot(p: mod.Player, pid: number, team: number): BotRec {
    let rec: BotRec | undefined = bots[pid];
    if (rec === undefined) {
        rec = {
            pid: pid, team: team, player: p, mind: newMind(pid, team), dead: false, nameKey: "",
            lastX: 0, lastY: 0, lastZ: 0, stillFor: 0, strikes: 0, inVehicle: false
        };
        bots[pid] = rec;
        botOrder.push(pid);
        log("bots", "registered pid=" + pid + " team=" + team);
    } else {
        rec.player = p;
        rec.team = team;
        rec.dead = false;
        rec.stillFor = 0;
        rec.strikes = 0;
        rec.inVehicle = false;
    }
    botPidSet[pid] = true;
    // The name was queued by drainSpawns before the engine spawned this
    // soldier, so claiming it here pairs the key with the real player id.
    const claimed: string = claimBotName(team);
    if (claimed !== "") {
        rec.nameKey = claimed;
    }
    return rec;
}

function forgetBot(pid: number): void {
    const rec: BotRec | undefined = bots[pid];
    if (rec !== undefined) {
        // Release here, on leaving the game, not on death: the corpse still
        // carries the name in the kill feed until it unspawns.
        releaseBotName(rec.team, rec.nameKey);
    }
    delete bots[pid];
    delete botPidSet[pid];
    delete respawnPending[pid];
    dropOccupant(pid);
    const at: number = botOrder.indexOf(pid);
    if (at >= 0) {
        botOrder.splice(at, 1);
    }
}

function onSpawnerSpawned(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    const team: number = teamIdOf(p);
    if (team !== 1 && team !== 2) {
        return;
    }
    registerBot(p, pid, team);
    if (willLogDebug()) {
        log("bots", "spawned pid=" + pid + " team=" + team + " live=" + liveCount(team));
    }
}

function onBotDead(pid: number): void {
    const rec: BotRec | undefined = bots[pid];
    if (rec !== undefined) {
        if (!rec.dead) {
            rec.dead = true;
            scheduleRespawn(pid, rec.team);
        }
    }
    dropOccupant(pid);
}

// Respawn is scheduled from OnPlayerDied, not from OnPlayerUndeploy. The old
// code only armed the timer in the undeploy handler, and a playtest showed no
// respawns at all: the engine unspawns a dead AI soldier without raising
// OnPlayerUndeploy, so nothing was ever queued. OnPlayerDied is reliable (the
// death handler demonstrably runs), so it is the safe anchor.
function scheduleRespawn(pid: number, team: number): void {
    if (team !== 1 && team !== 2) {
        return;
    }
    if (respawnPending[pid] === true) {
        return;
    }
    respawnPending[pid] = true;
    const h: Timers.TimerID | null = Timers.setTimeout(() => {
        safe("bots.respawn", () => {
            delete respawnPending[pid];
            if (liveCount(team) < BOT_COUNT_PER_TEAM) {
                queueSpawn(team);
            }
        });
    }, BOT_RESPAWN_DELAY_MS);
    if (h === null) {
        delete respawnPending[pid];
        logAdmin("bots", "WARNING respawn timer refused for team " + team);
    }
}

function onBotUndeployed(p: mod.Player, pid: number): void {
    onBotDead(pid);
    const rec: BotRec | undefined = bots[pid];
    const team: number = rec !== undefined ? rec.team : teamIdOf(p);
    // Safety net only. onBotDead already armed the timer; scheduleRespawn is
    // idempotent per pid, so reaching here for a bot that has not left yet is
    // harmless, and it covers the case where the bot undeploys without dying.
    scheduleRespawn(pid, team);
}

function onMoveFailed(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    const rec: BotRec | undefined = bots[pid];
    if (rec === undefined) {
        return;
    }
    noteMoveFailed(rec.mind, Date.now());
}

function onMoveSucceeded(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    const rec: BotRec | undefined = bots[pid];
    if (rec === undefined) {
        return;
    }
    noteMoveSucceeded(rec.mind);
}

// Retaliation only: bots never hunt, they answer. One target set plus a short
// force-fire burst when damaged by a live enemy.
function onDamaged(victim: mod.Player, damager: mod.Player): void {
    const pid: number = mod.GetObjId(victim);
    const rec: BotRec | undefined = bots[pid];
    if (rec === undefined || rec.dead) {
        return;
    }
    if (!mod.IsValid(damager)) {
        return;
    }
    if (!isEnemyTeam(teamIdOf(damager), rec.team)) {
        return;
    }
    try {
        mod.AISetTarget(victim, damager);
        mod.AIForceFire(victim, 2);
    } catch (e) {
        log("bots", "retaliate failed pid=" + pid + ": " + String(e));
    }
}

// Bot position, read from PlayerLocations' per-tick cache instead of
// mod.GetSoldierState. This is the module the utils docs are explicit about for
// hot loops: the engine call is made once per tick for every connected player,
// and everything after that is a typed-array read. The bot sweep runs 12 times a
// second across 48 bots, so this removes the single largest recurring FFI cost
// in the bot path without changing behaviour.
//
// Returns false when the bot is not currently active, which covers a soldier
// between spawn and deploy, and a bot that has already been recycled this tick.
function readPos(pid: number): boolean {
    const v = PlayerLocations.getPosition(pid, posScratch);
    return v !== null && v !== undefined;
}

// Vehicle boarding. mod.AllVehicles() returns an opaque mod.Array and costs an
// FFI to build, so the candidate list is rebuilt once per BOT_VEHICLE_SCAN_MS
// for the whole population rather than once per bot per sweep. Each candidate
// is a vehicle that exists and still has a free seat, which is the same
// availability test CustomConquest V15 AI_VehicleDeploy performs before it
// commits a bot to a seat.
const vehicleCand: mod.Vehicle[] = [];
const vScratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };
let vehicleScannedAt: number = 0;

function scanVehicles(nowMs: number): void {
    if (nowMs - vehicleScannedAt < BOT_VEHICLE_SCAN_MS) {
        return;
    }
    vehicleScannedAt = nowMs;
    vehicleCand.length = 0;
    let arr: mod.Array | undefined;
    try {
        arr = mod.AllVehicles();
    } catch (e) {
        return;
    }
    if (arr === undefined) {
        return;
    }
    const n: number = mod.CountOf(arr);
    for (let i: number = 0; i < n; i++) {
        try {
            const v: mod.Vehicle = mod.ValueInArray(arr, i) as mod.Vehicle;
            if (!mod.IsValid(v)) {
                continue;
            }
            if (mod.CountOf(mod.GetAllPlayersInVehicle(v)) >= BOT_VEHICLE_FREE_SEATS) {
                continue;
            }
            vehicleCand.push(v);
        } catch (e) {
        }
    }
    if (willLogDebug() && vehicleCand.length > 0) {
        log("bots", "vehicle scan: " + vehicleCand.length + " with a free seat");
    }
}

// Try to put this bot in a nearby free vehicle. Bots only do this while they are
// on foot, and a bot already in a seat skips the whole thing.
//
// Boarding is CQ's AI_VehicleDeploy pair, both Tier 0: AIBattlefieldBehavior
// hands the bot to the normal vehicle AI, then ForcePlayerToSeat puts it in seat
// -1, which is the engine's "any free seat" seat. Seat -1 rather than a seat
// index is deliberate: it is what the template uses, and it means a bot does not
// fail because the driver slot was taken between the scan and the board.
function tryBoardVehicle(rec: BotRec, x: number, y: number, z: number): boolean {
    if (rec.inVehicle || vehicleCand.length === 0) {
        return false;
    }
    // Only a slice of the population ever tries, so a parked tank is not
    // stripped by every bot within earshot in the same second.
    if (rec.pid % BOT_VEHICLE_MOD !== rec.team) {
        return false;
    }
    const rSq: number = BOT_VEHICLE_RADIUS_M * BOT_VEHICLE_RADIUS_M;
    for (const v of vehicleCand) {
        try {
            Vectors.toVector3(
                mod.GetVehicleState(v, mod.VehicleStateVector.VehiclePosition), vScratch
            );
            const dx: number = vScratch.x - x;
            const dy: number = vScratch.y - y;
            const dz: number = vScratch.z - z;
            if (dx * dx + dy * dy + dz * dz > rSq) {
                continue;
            }
            mod.AIBattlefieldBehavior(rec.player);
            mod.ForcePlayerToSeat(rec.player, v, -1);
            rec.inVehicle = true;
            if (willLogDebug()) {
                log("bots", "pid=" + rec.pid + " boarded a vehicle");
            }
            return true;
        } catch (e) {
        }
    }
    return false;
}

// Keep the in-vehicle flag honest. Only bots that are allowed to board pay for
// this, so it is one FFI for a fraction of the population, and it means a bot
// that got out again is back under stuck detection instead of being treated as
// permanently seated.
function syncVehicleState(rec: BotRec): void {
    if (rec.pid % BOT_VEHICLE_MOD !== rec.team) {
        rec.inVehicle = false;
        return;
    }
    try {
        rec.inVehicle = mod.GetSoldierState(rec.player, mod.SoldierStateBool.IsInVehicle);
    } catch (e) {
        rec.inVehicle = false;
    }
}

function sweep(): void {
    drainSpawns();
    if (ownersNeedRefresh()) {
        refreshOwners();
        markFullRethink();
    }
    // Degraded engine: keep the population correct, skip the thinking.
    // Same 0.7 gate the Rorsch probe uses.
    if (healthFactor() < 0.7) {
        return;
    }
    const nowMs: number = Date.now();
    scanVehicles(nowMs);
    const n: number = botOrder.length;
    if (n === 0) {
        return;
    }
    const count: number = fullRethink ? n : Math.min(BOT_SLICE, n);
    for (let k: number = 0; k < count; k++) {
        const pid: number = botOrder[cursor % n];
        cursor++;
        const rec: BotRec | undefined = bots[pid];
        if (rec === undefined || rec.dead) {
            continue;
        }
        try {
            if (!mod.IsValid(rec.player)) {
                continue;
            }
            if (!readPos(pid)) {
                continue;
            }
            syncVehicleState(rec);
            if (rec.inVehicle) {
                // A bot driving a vehicle is not walking, so position-based stuck
                // detection would read it as frozen and recycle it out of the
                // seat. The vehicle AI is in charge from here.
                continue;
            }
            if (tryBoardVehicle(rec, posScratch.x, posScratch.y, posScratch.z)) {
                continue;
            }
            if (handleStuck(rec, posScratch.x, posScratch.y, posScratch.z)) {
                // Recycled: mod.Kill routes it through the ordinary death and
                // respawn path, so it comes back at a spawner instead of
                // wedged. Skip this think, the body is going away.
                continue;
            }
            thinkBot(rec.player, pid, rec.team, posScratch.x, posScratch.y, posScratch.z, rec.mind, nowMs);
        } catch (e) {
            log("bots", "think failed pid=" + pid + ": " + String(e));
        }
    }
    fullRethink = false;
}

function markFullRethink(): void {
    fullRethink = true;
}

// Move a freshly deployed bot into a bunker its team owns. Bots must appear in
// the bunkers, never on the resource or factory AreaTriggers, so the candidate
// list is bunker-only (see pickSpawnObjective).
//
// The destination is read from the native CapturePoint with
// mod.GetObjectPosition rather than from the cached anchor, which is what
// CustomConquest V15 AI_ObjectiveSpawn does and what the user asked for
// explicitly. It is one extra FFI per deploy, against the alternative of a
// separate AI_Spawner object at every bunker, which would mean editing the map.
//
// A team that owns no bunker yet leaves the bot at its spawner rather than
// dropping it on a contested point.
function teleportToObjective(p: mod.Player, team: number, pid: number): void {
    // Deterministic per-bot roll, so this costs no FFI and is stable for replays.
    const roll: number = ((pid * 2654435761) % 10007) / 10007;
    const idx: number = pickSpawnObjective(team, roll);
    if (idx < 0) {
        if (willLogDebug()) {
            log("bots", "pid=" + pid + " stays at spawner, team owns no bunker");
        }
        return;
    }
    try {
        const cp: mod.CapturePoint | undefined = bunkerCapturePoint(idx);
        // Orientation 0: the template also passes a fixed 1. Bots re-aim on their
        // first think, so this only decides which way they face as they land.
        if (cp === undefined) {
            log("bots", "pid=" + pid + " bunker " + objectiveKey(idx) + " has no CapturePoint");
            return;
        }
        mod.Teleport(p, mod.GetObjectPosition(cp), 0);
        const rec: BotRec | undefined = bots[pid];
        if (rec !== undefined) {
            // The mind thinks it is at the spawner, so a stale intent would walk
            // it straight back out. Clear it and let the next sweep re-decide.
            rec.mind.state = -1;
            rec.mind.obj = idx;
            rec.mind.speed = -1;
            rec.mind.age = 0;
            rec.lastX = 0;
            rec.lastY = 0;
            rec.lastZ = 0;
        }
        if (willLogDebug()) {
            log("bots", "pid=" + pid + " teleported onto " + objectiveKey(idx));
        }
    } catch (e) {
        log("bots", "teleport failed pid=" + pid + ": " + String(e));
    }
}

// A bot is stuck when it has barely moved across a whole window of thinks. The
// first window only forces a re-pick (clearing the recorded intent makes the
// next think pick something else); a bot that is still stuck after
// BOT_STUCK_STRIKES windows is killed so the respawn path replaces it. Without
// this, a bot that ended up against a wall, or whose behavior expired silently,
// stood there for the rest of the match - which is what the playtest showed.
//
// Returns true when the bot was recycled and should not be thought this sweep.
function handleStuck(rec: BotRec, x: number, y: number, z: number): boolean {
    // First think after spawn has no baseline to compare against.
    if (rec.stillFor === 0 && rec.lastX === 0 && rec.lastY === 0 && rec.lastZ === 0) {
        rec.lastX = x;
        rec.lastY = y;
        rec.lastZ = z;
        return false;
    }
    const dx: number = x - rec.lastX;
    const dy: number = y - rec.lastY;
    const dz: number = z - rec.lastZ;
    rec.lastX = x;
    rec.lastY = y;
    rec.lastZ = z;
    const minSq: number = BOT_STUCK_MIN_M * BOT_STUCK_MIN_M;
    if (dx * dx + dy * dy + dz * dz > minSq) {
        rec.stillFor = 0;
        rec.strikes = 0;
        return false;
    }
    rec.stillFor++;
    if (rec.stillFor < BOT_STUCK_WINDOW_SWEEPS) {
        return false;
    }
    rec.stillFor = 0;
    rec.strikes++;
    if (rec.strikes < BOT_STUCK_STRIKES) {
        // First offence: break the dirty-check by clearing the intent, so the
        // next think issues a fresh behavior toward a re-picked objective.
        rec.mind.state = -1;
        rec.mind.obj = -1;
        rec.mind.speed = -1;
        rec.mind.failUntil = {};
        return false;
    }
    rec.strikes = 0;
    log("bots", "pid=" + rec.pid + " stuck, recycling");
    try {
        mod.AIIdleBehavior(rec.player);
        mod.Kill(rec.player);
    } catch (e) {
        log("bots", "stuck recycle failed pid=" + rec.pid + ": " + String(e));
    }
    return true;
}

export function initBots(): void {
    if (botsInited) {
        // A second OnGameModeStarted must not append a second copy of every
        // spawner to the pool or re-queue the whole initial burst on top of the
        // live population. initBotObjectives guards its own state, but the
        // spawner arrays and the queue below are module level, so without this
        // they accumulate.
        log("bots", "already initialised, ignoring repeat init");
        return;
    }
    botsInited = true;
    initBotNames();
    initBotObjectives();
    // PlayerLocations is the vetted zero-FFI position cache: it subscribes to
    // its own tick updates on initialize, so the bot sweep can read every
    // bot's position and every proximity query from memory instead of calling
    // mod.GetSoldierState per bot per second. initialize() is idempotent, and it
    // is safe to call here because the module owns its own subscriptions.
    try {
        PlayerLocations.initialize();
    } catch (e) {
        log("bots", "PlayerLocations init failed: " + String(e));
    }
    if (!fixerWired) {
        fixerWired = true;
        // Import-only activation plus quota-safe logging. The fixer re-fires
        // our OnPlayerUndeploy subscriber for bots stuck in deploy limbo;
        // that subscriber is idempotent, as the fixer README requires.
        PlayerUndeployFixer.setLogging((text: string) => {
            try {
                log("undeploy", text);
            } catch (e) {
            }
        }, PlayerUndeployFixer.LogLevel.Warning, false);
    }
    for (const def of AI_SPAWNERS) {
        if (def.spawnerId <= 0) {
            continue;
        }
        try {
            const sp: mod.Spawner = mod.GetSpawner(def.spawnerId);
            if (!mod.IsValid(sp)) {
                log("bots", "spawner " + def.spawnerId + " did not resolve");
                continue;
            }
            spawnerByTeam[def.team].push(sp);
            mod.AISetUnspawnOnDead(sp, true);
            mod.SetUnspawnDelayInSeconds(sp, BOT_CORPSE_SECONDS);
            log("bots", "spawner " + def.spawnerId + " bound for team " + def.team);
        } catch (e) {
            log("bots", "spawner " + def.spawnerId + " failed: " + String(e));
        }
    }
    if (spawnerByTeam[1].length === 0 && spawnerByTeam[2].length === 0) {
        log("bots", "no AI spawners configured - bot system idle");
        return;
    }
    try {
        mod.SetAIToHumanDamageModifier(BOT_DAMAGE_MULT);
    } catch (e) {
        log("bots", "damage modifier refused: " + String(e));
    }
    // Initial burst goes through the same drain queue as respawns, so mode
    // start never fires 48 spawns in one tick.
    for (let i: number = 0; i < BOT_COUNT_PER_TEAM; i++) {
        queueSpawn(1);
        queueSpawn(2);
    }
    if (sweepTimer === null) {
        sweepTimer = Timers.setInterval(() => { safe("bots.sweep", sweep); }, BOT_SWEEP_MS);
        if (sweepTimer === null) {
            logAdmin("bots", "FATAL: Timers pool full, bot sweep not scheduled");
        }
    }
    log("bots", "init: spawners t1=" + spawnerByTeam[1].length
        + " t2=" + spawnerByTeam[2].length
        + " queued=" + spawnQueue.length);
}

export function configureBotEvents(): void {
    Events.OnSpawnerSpawned.subscribe((p: mod.Player) => {
        safe("bots.spawned", () => { onSpawnerSpawned(p); });
    });
    Events.OnPlayerDied.subscribe((victim: mod.Player) => {
        safe("bots.died", () => {
            const pid: number = mod.GetObjId(victim);
            if (isBotPid(pid)) {
                onBotDead(pid);
            }
        });
    });
    Events.OnPlayerUndeploy.subscribe((p: mod.Player) => {
        safe("bots.undeployed", () => {
            const pid: number = mod.GetObjId(p);
            if (isBotPid(pid)) {
                onBotUndeployed(p, pid);
            }
        });
    });
    Events.OnPlayerLeaveGame.subscribe((id: number) => {
        safe("bots.leave", () => {
            if (isBotPid(id)) {
                forgetBot(id);
            }
        });
    });
    Events.OnPlayerDeployed.subscribe((p: mod.Player) => {
        safe("bots.deployed", () => {
            if (!isBotPlayer(p)) {
                return;
            }
            const pid: number = mod.GetObjId(p);
            const team: number = teamIdOf(p);
            if (team !== 1 && team !== 2) {
                return;
            }
            registerBot(p, pid, team);
            // Incoming damage scaling has to wait for deployment. Calling it from
            // the spawn event threw PlayerNotDeployed for every one of the 48
            // bots, so the factor was never actually applied.
            //
            // The Rorsch is deliberately NOT stripped here. Bots never receive
            // one (the gadget grant is gated to human players), so RemoveEquipment
            // threw NoSpecifiedWeapon twice per bot for an absent weapon. nuke.ts
            // skips bots with a set lookup, so they can never fire it anyway.
            safe("bots.incoming", () => {
                mod.SetPlayerIncomingDamageFactor(p, BOT_INCOMING_DAMAGE);
            });
            teleportToObjective(p, team, pid);
        });
    });
    Events.OnAIMoveToFailed.subscribe((p: mod.Player) => {
        safe("bots.movefail", () => { onMoveFailed(p); });
    });
    Events.OnAIMoveToSucceeded.subscribe((p: mod.Player) => {
        safe("bots.movesok", () => { onMoveSucceeded(p); });
    });
    Events.OnPlayerDamaged.subscribe((victim: mod.Player, damager: mod.Player) => {
        safe("bots.damaged", () => { onDamaged(victim, damager); });
    });
    // Ownership flips invalidate every brain next sweep. The dirty flag lives
    // in botobjectives; the sweep consumes it (see sweep()).
    markOwnersDirty();
}

// Diagnostics for the DEBUG tab, split into numeric accessors rather than one
// composed string. mod.Message will not substitute a string into a {} slot (it
// renders as <string>), so each value has to be passed as a number. Zero FFI.
export function botLiveCount(team: number): number {
    return liveCount(team);
}

export function botRosterSize(): number {
    return botOrder.length;
}


// --- SOURCE: src\stats.ts ---








// Why a player was paid. Drives the prestige amount, the score amount and the
// reason text shown in their personal feed.
//
// "vehicle" is intentionally absent: Tier 0 exposes no damager and no
// OnVehicleDamaged event, so a destroyer cannot be identified. Adding it back
// means either trusting the opposing team wholesale or inferring the killer from
// raycast proximity - see PRESTIGE_VEHICLE in config.ts.
export type AwardKind = "bunker" | "energy" | "factory" | "kill" | "assist";

const PRESTIGE_FOR: { [k: string]: number } = {
    bunker: PRESTIGE_BUNKER,
    energy: PRESTIGE_ENERGY,
    factory: PRESTIGE_FACTORY,
    kill: PRESTIGE_KILL,
    assist: PRESTIGE_ASSIST
};

const SCORE_FOR: { [k: string]: number } = {
    bunker: SCORE_BUNKER,
    energy: SCORE_ENERGY,
    factory: SCORE_FACTORY,
    kill: SCORE_KILL,
    assist: SCORE_ASSIST
};

export function prestigeFor(kind: AwardKind): number {
    return PRESTIGE_FOR[kind];
}

// Fired from inside award() so the notification can never drift away from the
// payout again. It did once: captures paid out silently because only the kill and
// assist handlers remembered to announce themselves.
export type AwardListener = (p: mod.Player, kind: AwardKind, prestige: number) => void;

const awardListeners: AwardListener[] = [];

export function onAward(fn: AwardListener): void {
    awardListeners.push(fn);
}

function fireAward(p: mod.Player, kind: AwardKind, prestige: number): void {
    for (const fn of awardListeners) {
        invokeSubscriber(fn, p, kind, prestige, undefined, "stats.award." + kind);
    }
}

// ------------------------------------------------------------------ the filter
// Single source of truth for "does this combat event count". A self kill, a
// teamkill, a redeploy and a deserting are all worth nothing to anybody: no
// score, no prestige and no counter. The team comparison is the same pattern
// CustomConquest V15 uses and it subsumes the self-kill case, because a player
// killing themselves is trivially on their own team.
export function countsAsCombat(player: mod.Player, victim: mod.Player, deathType?: mod.DeathType): boolean {
    if (!mod.IsValid(player) || !mod.IsValid(victim)) {
        return false;
    }
    if (mod.Equals(player, victim)) {
        return false;
    }
    if (!isEnemyTeam(teamIdOf(player), teamIdOf(victim))) {
        return false;
    }
    if (deathType !== undefined) {
        if (mod.EventDeathTypeCompare(deathType, mod.PlayerDeathTypes.Redeploy)) {
            return false;
        }
        if (mod.EventDeathTypeCompare(deathType, mod.PlayerDeathTypes.Deserting)) {
            return false;
        }
    }
    return true;
}

// A death is only recorded for a real combat death. Friendly fire and suicide
// are not counted; environmental deaths (fall, drowning, an invalid killer) are.
export function countsAsDeath(victim: mod.Player, killer: mod.Player, deathType: mod.DeathType): boolean {
    if (!mod.IsValid(victim)) {
        return false;
    }
    if (mod.EventDeathTypeCompare(deathType, mod.PlayerDeathTypes.Redeploy)) {
        return false;
    }
    if (mod.EventDeathTypeCompare(deathType, mod.PlayerDeathTypes.Deserting)) {
        return false;
    }
    if (mod.IsValid(killer) && !isEnemyTeam(teamIdOf(killer), teamIdOf(victim))) {
        return false;
    }
    return true;
}

// ------------------------------------------------------------------- the stats

export type PlayerStats = {
    score: number;
    kills: number;
    deaths: number;
    assists: number;
};

let stats: { [id: number]: PlayerStats } = {};

export function statsOf(id: number): PlayerStats {
    let s: PlayerStats | undefined = stats[id];
    if (s === undefined) {
        s = { score: 0, kills: 0, deaths: 0, assists: 0 };
        stats[id] = s;
    }
    return s;
}

export function forgetPlayer(id: number): void {
    delete stats[id];
}

export function resetStats(): void {
    // Rebind rather than delete-by-key: Object.keys yields strings while this
    // map is number-keyed, so walking it would need a parse.
    stats = {};
}

// Pays prestige and score for one action. Kills, deaths and assists must be
// filtered through countsAsCombat / countsAsDeath before this is reached.
export function award(p: mod.Player, kind: AwardKind): boolean {
    if (!mod.IsValid(p)) {
        return false;
    }
    const id: number = mod.GetObjId(p);
    if (id < 0) {
        return false;
    }
    const s: PlayerStats = statsOf(id);
    s.score += SCORE_FOR[kind];
    if (kind === "kill") {
        s.kills++;
    } else if (kind === "assist") {
        s.assists++;
    }
    // Bots earn score (they stay on the scoreboard) but never prestige: with
    // no UI they could never spend it, so paying it would only inflate a dead
    // record. The personal award feed is skipped with it - pushPlayerFeed
    // no-ops for HUD-less players anyway.
    const bot: boolean = isBotPid(id);
    if (!bot) {
        addPrestige(id, PRESTIGE_FOR[kind]);
    }
    pushRow(p);
    if (!bot) {
        fireAward(p, kind, PRESTIGE_FOR[kind]);
    }
    const team: number = teamIdOf(p);
    // Deliberately does NOT print the team total: teamScore() walks the entire
    // roster, costing roughly 400 FFI per award purely to format a string.
    // teamScore() stays exported for diagnostics that are not on a hot path.
    log("stats", "pid=" + id + " team " + String(team) + " " + kind
        + (bot ? " +0 prestige (bot)" : " +" + String(PRESTIGE_FOR[kind]) + " prestige")
        + " +" + String(SCORE_FOR[kind]) + " score (player total " + String(s.score) + ")");
    return true;
}

export function countDeath(p: mod.Player): void {
    if (!mod.IsValid(p)) {
        return;
    }
    statsOf(mod.GetObjId(p)).deaths++;
    pushRow(p);
}

// Pays the listed players only. Captures pass the players who were physically
// on the objective, so a teammate capturing alone no longer funds the team.
//
// Returns how many players actually received PRESTIGE. Bots earn score but no
// prestige, so they must not be counted here: the caller uses this number to
// detect a capture that had bodies on the point yet paid no human, and counting
// bots would make that check permanently unreachable.
export function awardPlayers(players: mod.Player[], kind: AwardKind): number {
    let paid: number = 0;
    for (const p of players) {
        if (!award(p, kind)) {
            continue;
        }
        if (!isBotPid(mod.GetObjId(p))) {
            paid++;
        }
    }
    return paid;
}

// ------------------------------------------------------------------ scoreboard

let headerReady: boolean = false;

export function initScoreboard(): void {
    safe("scoreboard.init", () => {
        mod.SetScoreboardType(mod.ScoreboardType.CustomTwoTeams);
        mod.SetScoreboardColumnNames(
            mod.Message("colScore"),
            mod.Message("colPrestige"),
            mod.Message("colKills"),
            mod.Message("colDeaths"),
            mod.Message("colAssists")
        );
        mod.SetScoreboardColumnWidths(1, 1, 0.75, 0.75, 0.75);
        // Column 1 is score, highest first.
        mod.SetScoreboardSorting(1, false);
        headerReady = true;
        pushHeader();
        log("scoreboard", "custom two-team scoreboard configured");
    });
}

// Team 1 is NATO, team 2 is PAX. CustomTwoTeams has no per-team value call, so
// the banked power percentage is carried in the header name.
//
// Do NOT try to show the team total through mod.SetGameModeScore. That call
// writes the gamemode score, which is the victory condition, so raising it to
// the player score total ended the round the instant the first capture paid
// out. Round victory belongs to mod.EndGameMode in turrets.ts and nowhere
// else. teamScore() below is log-only for that reason.
export function pushHeader(): void {
    if (!headerReady) {
        return;
    }
    safe("scoreboard.header", () => {
        mod.SetScoreboardHeader(
            mod.Message("sbNato", Math.round(powerVal[1])),
            mod.Message("sbPax", Math.round(powerVal[2]))
        );
    });
}

export function pushRow(p: mod.Player): void {
    if (!headerReady || !mod.IsValid(p)) {
        return;
    }
    const id: number = mod.GetObjId(p);
    const s: PlayerStats = statsOf(id);
    safe("scoreboard.row", () => {
        mod.SetScoreboardPlayerValues(p, s.score, prestigeOf(id), s.kills, s.deaths, s.assists);
    });
}

export function pushAllRows(): void {
    if (!headerReady) {
        return;
    }
    for (const p of allPlayers()) {
        pushRow(p);
    }
}

// Log-only team aggregate. Never write this to the gamemode score - see the
// warning above pushHeader().
export function teamScore(team: number): number {
    let sum: number = 0;
    for (const p of playersInTeam(team)) {
        sum += statsOf(mod.GetObjId(p)).score;
    }
    return sum;
}

// Zeroes each team's ticket at round start so nothing carries over between
// rounds. This is an initialiser, not a score write, so it cannot end the
// round on its own.
export function resetTeamScores(): void {
    for (const team of [1, 2]) {
        const handle: mod.Team | undefined = teamHandle(team);
        if (handle === undefined) {
            continue;
        }
        const h: mod.Team = handle;
        safe("scoreboard.reset", () => {
            mod.SetGameModeInitialScore(h, 0);
        });
    }
}


// --- SOURCE: src\energy.ts ---






const SITE_SLOTS: number = 3;

export function energySitesHeld(team: number): number {
    const sites: BuildingState[] = buildingsOfKind("energy");
    if (sites.length === 0) {
        const st: number[] = siteState[team] || [];
        let n: number = 0;
        for (let i: number = 0; i < SITE_SLOTS; i++) {
            if (st[i] === team) {
                n++;
            }
        }
        return n;
    }
    let n: number = 0;
    for (const s of sites) {
        if (s.owner === team) {
            n++;
        }
    }
    return n;
}

export function energyMultiplier(team: number): number {
    const held: number = energySitesHeld(team);
    if (held <= 0) {
        return 0;
    }
    return held * CHARGE_PER_SITE;
}

export function initEnergy(): void {
    const sites: BuildingState[] = buildingsOfKind("energy");
    log("energy", "energy sites bound: " + sites.length);
    onCaptured((def: AreaBuildingDef, owner: number) => {
        if (def.kind === "energy") {
            safe("energy.capture", () => {
                log("energy", def.id + " -> team " + owner + " (mult now " + energyMultiplier(owner) + ")");
            });
        }
    });
}


// --- SOURCE: src\factory.ts ---







export type ChargeListener = (team: number, before: number, after: number) => void;

const listeners_4: ChargeListener[] = [];

// Fired whenever banked charge moves so the HUD can repaint and milestones can
// be announced. The charge itself advances here every frame, so nothing else
// in the codebase would notice it.
export function onCharge(fn: ChargeListener): void {
    listeners_4.push(fn);
}

function fireCharge(team: number, before: number, after: number): void {
    for (const fn of listeners_4) {
        invokeSubscriber(fn, team, before, after, undefined, "factory.charge");
    }
}

// The set of buildings is frozen after initCapture, so the proto owner and the
// per-team charge rate only change when an objective flips. They are recomputed
// on capture instead of being re-derived from buildingsOfKind on every tick.
let cachedOwner: number = -1;
const rateCache: { [t: number]: number } = { 1: 0, 2: 0 };

function refreshCaches(): void {
    cachedOwner = 0;
    for (const s of buildingsOfKind("proto")) {
        if (s.owner === 1 || s.owner === 2) {
            cachedOwner = s.owner;
            break;
        }
    }
    rateCache[1] = computeRate(1);
    rateCache[2] = computeRate(2);
}

function computeRate(team: number): number {
    if (CHARGE_REQUIRES_FACTORY && cachedOwner !== team) {
        return 0;
    }
    const mult: number = energyMultiplier(team);
    if (mult <= 0) {
        return 0;
    }
    return mult / CHARGE_BASE_SECONDS * 100;
}

export function factoryOwner(): number {
    if (cachedOwner < 0) {
        refreshCaches();
    }
    return cachedOwner;
}

export function chargePercent(team: number): number {
    return powerVal[team];
}

export function chargeRatePerSec(team: number): number {
    if (cachedOwner < 0) {
        refreshCaches();
    }
    return rateCache[team] === undefined ? 0 : rateCache[team];
}

function crossedMilestone(before: number, after: number): boolean {
    if (Math.round(before) !== Math.round(after)) {
        return true;
    }
    for (const at of POWER_MILESTONES) {
        if (before < at && after >= at) {
            return true;
        }
    }
    return false;
}

// Driven from index.ts onOngoingGlobal so charge advances smoothly every frame
// instead of jumping in large steps from a separate timer.
export function tickCharge(dtSeconds: number): void {
    tick_2(dtSeconds);
}

function tick_2(dt: number): void {
    for (const team of [1, 2]) {
        const rate: number = chargeRatePerSec(team);
        if (rate <= 0) {
            continue;
        }
        const before: number = powerVal[team];
        let after: number = before + rate * dt;
        if (after > 100) {
            after = 100;
        }
        if (after === before) {
            continue;
        }
        powerVal[team] = after;
        const unlocked: boolean = before < CHARGE_UNLOCK_100 && after >= CHARGE_UNLOCK_100;
        // The fractional charge keeps advancing every tick, but firing the
        // listener on every frame meant SetScoreboardHeader ran at frame rate.
        // Only speak up when the displayed whole number moves or a milestone
        // (50/75/100) is crossed, so the scoreboard and the HUD stay in step.
        if (unlocked || crossedMilestone(before, after)) {
            fireCharge(team, before, after);
        }
    }
}

export function initFactory(): void {
    const f: BuildingState[] = buildingsOfKind("proto");
    log("factory", "proto factories bound: " + f.length);
    if (f.length === 0) {
        log("factory", "no proto factory configured - charge system idle");
        refreshCaches();
        return;
    }
    // Prime the owner/rate caches now that initCapture has populated the
    // building states, instead of relying on the first lazy read happening to
    // land after initialisation.
    refreshCaches();
    // Charge is advanced from onOngoingGlobal (see tickCharge).
    onCaptured((def: AreaBuildingDef, owner: number) => {
        if (def.kind === "proto" || def.kind === "energy") {
            // Either objective changes the rate, so the caches are rebuilt here
            // rather than per tick.
            refreshCaches();
        }
        if (def.kind === "proto") {
            log("factory", def.id + " -> team " + owner + " (rate " + chargeRatePerSec(owner) + "%/s)");
        }
    });
}

export function moacUnlocked(team: number): boolean {
    return chargePercent(team) >= CHARGE_UNLOCK_50;
}

export function nukeUnlocked(team: number): boolean {
    return chargePercent(team) >= CHARGE_UNLOCK_100;
}

export function shutdownFactory(): void {
    // No dedicated timer: charge is driven by tickCharge.
}


// --- SOURCE: src\winner.ts ---
// Pure end-of-match rules, kept free of mod.* so scripts/test-winner.js can
// unit-test them in node.
//
// "base" throughout turrets.ts and nuke.ts is the team id that OWNS the HQ:
// nuke.ts only lets a shooter hit a base whose id differs from their own team.
// So when an HQ falls, the winner is the other team.

export function winnerForDestroyedBase(base: number): number {
    return base === 1 ? 2 : 1;
}

// Team 1 is NATO, team 2 is PAX (teams.ts).
//   winT1 = "NATO destroyed the PAX HQ"
//   winT2 = "PAX destroyed the NATO HQ"
export function winMessageKey(winner: number): string {
    return winner === 1 ? "winT1" : "winT2";
}

// HQ health shown on the HUD, as a whole percent. 3 required hits paint
// 100 -> 67 -> 33 -> 0.
export function hqHpPercent(hits: number, required: number): number {
    if (required <= 0 || hits >= required) {
        return 0;
    }
    return Math.round(100 * (required - hits) / required);
}

export interface HqHitKeys {
    defender: string;
    attacker: string;
}

// Feed keys for a non-final HQ hit. Defenders are told their HQ is under
// attack, attackers that the enemy HQ took a hit; with one hit left both get
// the critical variant. The final hit returns null: the win message covers it.
export function hqHitKeys(hits: number, required: number): HqHitKeys | null {
    const left: number = required - hits;
    if (left <= 0) {
        return null;
    }
    if (left === 1) {
        return { defender: "hqCritical", attacker: "hqFoeCritical" };
    }
    return { defender: "hqUnderAttack", attacker: "hqHit" };
}


// --- SOURCE: src\turrets.ts ---











const turretByZone: { [zoneId: number]: TurretDef } = {};
const zoneHandles: { [zoneId: number]: mod.AreaTrigger } = {};
const destroyed: { [emplId: number]: boolean } = {};
const playerZones: { [pid: number]: number[] } = {};
const pending: { [pid: number]: Timers.TimerID | null } = {};
const clusterDestroyed: { [key: string]: number } = {};
const losOpen: { [base: string]: boolean } = {};

let hqHp: number[] = [0, 0, 0];
let matchOver: boolean = false;

// HQ damage listeners: (base, hits, required). index.ts uses this to drive the
// HUD's HQ health, which turrets.ts cannot reach directly.
export type HqHitListener = (base: number, hits: number, required: number) => void;
const hqHitListeners: HqHitListener[] = [];

export function onHqHit(fn: HqHitListener): void {
    hqHitListeners.push(fn);
}

export function initTurrets(): void {
    let zones: number = 0;
    for (let ti: number = 0; ti < TURRETS.length; ti++) {
        const t: TurretDef = TURRETS[ti];
        if (!isConfigured(t.zoneId)) {
            log("turrets", "skip turret " + t.emplId + " (zone id 0)");
            continue;
        }
        zones++;
        turretByZone[t.zoneId] = t;
        const zone: mod.AreaTrigger = mod.GetAreaTrigger(t.zoneId);
        if (!mod.IsValid(zone)) {
            log("turrets", "FAIL zone " + t.zoneId + " did not resolve");
            delete turretByZone[t.zoneId];
            zones--;
            continue;
        }
        // One-time position snapshot so the per-hit read path is FFI-free.
        cacheTurretPos(ti, t);
        zoneHandles[t.zoneId] = zone;
        if (isConfigured(t.vfxId)) {
            safe("turret.vfxhide", () => {
                mod.EnableVFX(mod.GetVFX(t.vfxId), false);
            });
        }
    }
    log("turrets", "zones bound: " + zones + "/" + TURRETS.length);
    if (zones === 0) {
        log("turrets", "no turret zones configured - kill zones idle");
    }
    resetMatch();
}

export function resetMatch(): void {
    hqHp = [0, 0, 0];
    matchOver = false;
    losOpen["1"] = false;
    losOpen["2"] = false;
    for (const k of Object.keys(clusterDestroyed)) {
        delete clusterDestroyed[k];
    }
    for (const k of Object.keys(destroyed)) {
        delete destroyed[Number(k)];
    }
    for (const t of TURRETS) {
        if (isConfigured(t.vfxId)) {
            safe("turret.vfxreset", () => {
                mod.EnableVFX(mod.GetVFX(t.vfxId), false);
            });
        }
        if (isConfigured(t.emplId)) {
            safe("turret.modelreset", () => {
                const o: mod.SpatialObject = mod.GetSpatialObject(t.emplId);
                if (mod.IsType(o, mod.Types.SpatialObject)) {
                    log("turret", "model " + t.emplId + " is a SpatialObject");
                }
            });
        }
    }
}

// Turret zone positions never move: the trigger layout in objids is static and
// the AreaTriggers are fixed map geometry. Resolving each one cost a
// GetAreaTrigger plus GetObjectPosition plus three component reads, and
// resolveHit called this sixteen times per ray. They are resolved once into a
// flat Float32Array at init, so the read path contains zero mod.* calls.
//
// Index layout is position * 3, with the y offset already applied.
const turretXYZ: Float32Array = new Float32Array(TURRETS.length * 3);
const turretResolved: { [index: number]: boolean } = {};

function cacheTurretPos(index: number, t: TurretDef): void {
    const base: number = index * 3;
    try {
        const v: Vectors.Vector3 = Vectors.toVector3(
            mod.GetObjectPosition(mod.GetAreaTrigger(t.zoneId))
        );
        turretXYZ[base] = v.x;
        turretXYZ[base + 1] = v.y + t.yOffset;
        turretXYZ[base + 2] = v.z;
        turretResolved[index] = true;
    } catch (e) {
        turretResolved[index] = false;
        log("turrets", "pos failed for turret " + t.emplId + ": " + String(e));
    }
}

// Squared distance from a hit point to a cached turret. No allocation, no mod.*.
export function turretResolvedAt(index: number): boolean {
    return turretResolved[index] === true;
}
// One cached coordinate of the turret base: axis 0 = x, 1 = y, 2 = z.
export function turretCoord(index: number, axis: number): number {
    return turretXYZ[index * 3 + axis];
}

export function turretDistSq(
    index: number,
    px: number,
    py: number,
    pz: number
): number {
    const base: number = index * 3;
    const dx: number = px - turretXYZ[base];
    const dy: number = py - turretXYZ[base + 1];
    const dz: number = pz - turretXYZ[base + 2];
    return dx * dx + dy * dy + dz * dz;
}


function addZone(pid: number, zoneId: number): void {
    let list: number[] = playerZones[pid];
    if (list === undefined) {
        list = [];
        playerZones[pid] = list;
    }
    if (list.indexOf(zoneId) < 0) {
        list.push(zoneId);
    }
}

function removeZone(pid: number, zoneId: number): void {
    const list: number[] | undefined = playerZones[pid];
    if (list === undefined) {
        return;
    }
    const i: number = list.indexOf(zoneId);
    if (i >= 0) {
        list.splice(i, 1);
    }
    if (list.length === 0) {
        delete playerZones[pid];
    }
}

function clearWarning(pid: number): void {
    const h: Timers.TimerID | null = pending[pid];
    if (h !== null && h !== undefined) {
        Timers.clear(h);
        pending[pid] = null;
    }
}

function armWarning(p: mod.Player, intruderTeam: number): void {
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    if (pending[pid] !== undefined && pending[pid] !== null) {
        return;
    }
    const h: Timers.TimerID | null = Timers.setTimeout(() => {
        safe("turret.kill", () => {
            pending[pid] = null;
            const zones: number[] | undefined = playerZones[pid];
            if (zones === undefined || zones.length === 0) {
                return;
            }
            try {
                mod.Kill(p);
                logAdmin("turrets", "KILLED pid " + pid + " in zone " + String(zones[0]));
            } catch (e) {
                log("turrets", "kill failed pid " + pid);
            }
        });
    }, TURRET_WARNING_SECS * 1000);
    if (h !== null) {
        pending[pid] = h;
    }
    playSfxTeam("killZone", intruderTeam, 0.5);
    notifyTeam(intruderTeam, "killZone", 0, 0);
}

function onEnterZone(p: mod.Player, at: mod.AreaTrigger): void {
    const zoneId: number = turretZoneId(at);
    const t: TurretDef | undefined = turretByZone[zoneId];
    if (!t) {
        // Gated: the message calls mod.GetObjId twice more purely to build a
        // string nobody reads at the default log level.
        if (willLogDebug()) {
            log("turrets", "UNMATCHED ENTER trigger=" + mod.GetObjId(at)
                + " pid=" + mod.GetObjId(p));
        }
        return;
    }
    const pid: number = mod.GetObjId(p);
    const team: number = teamIdOf(p);
    if (pid < 0 || team === 0) {
        log("turrets", "ENTER ignored invalid player/team zone=" + zoneId + " pid=" + pid + " team=" + team);
        return;
    }
    if (destroyed[t.emplId]) {
        log("turrets", "ENTER ignored destroyed turret zone=" + zoneId + " pid=" + pid);
        return;
    }
    if (team === t.base) {
        log("turrets", "ENTER friendly zone=" + zoneId + " pid=" + pid + " team=" + team);
        return;
    }
    addZone(pid, zoneId);
    log("turrets", "ENTER zone=" + zoneId + " pid=" + pid + " team=" + team + " base=" + t.base + " secs=" + String(TURRET_WARNING_SECS));
    armWarning(p, team);
}

// Exact ObjId only - see the note in capture.ts about the removed mod.Equals
// fallback, which mis-routed gates and turret zones.
function turretZoneId(at: mod.AreaTrigger): number {
    const id: number = mod.GetObjId(at);
    return turretByZone[id] !== undefined ? id : 0;
}

function onExitZone(p: mod.Player, at: mod.AreaTrigger): void {
    const pid: number = mod.GetObjId(p);
    const zoneId: number = turretZoneId(at);
    if (zoneId === 0) {
        if (willLogDebug()) {
            log("turrets", "UNMATCHED EXIT trigger=" + mod.GetObjId(at) + " pid=" + pid);
        }
        return;
    }
    removeZone(pid, zoneId);
    log("turrets", "EXIT zone=" + zoneId + " pid=" + pid);
    if (playerZones[pid] === undefined) {
        clearWarning(pid);
    }
}

export function destroyTurret(emplId: number): boolean {
    if (destroyed[emplId]) {
        return false;
    }
    let def: TurretDef | undefined;
    for (const t of TURRETS) {
        if (t.emplId === emplId) {
            def = t;
        }
    }
    if (!def) {
        return false;
    }
    destroyed[emplId] = true;

    if (isConfigured(def.vfxId)) {
        safe("turret.vfxon", () => {
            mod.EnableVFX(mod.GetVFX(def.vfxId), true);
        });
    }
    playSfxAll("turretDown", 0.7);

    if (isConfigured(def.emplId)) {
        // Scene-placed emplacements resolve to an invalid handle (ObjId -1);
        // UnspawnObject on those throws UnspawnObjectInvalidObject. Only try
        // when the handle is genuinely valid, otherwise rely on the VFX above.
        safe("turret.model", () => {
            const model: mod.Object = mod.GetSpatialObject(def.emplId);
            if (mod.IsValid(model)) {
                mod.UnspawnObject(model);
            } else {
                log("turrets", "turret " + emplId + " handle invalid - skipping unspawn");
            }
        });
    }

    const key: string = String(def.base) + "_" + String(def.cluster);
    clusterDestroyed[key] = (clusterDestroyed[key] || 0) + 1;
    log("turrets", "turret " + emplId + " destroyed (cluster " + key + " now " + String(clusterDestroyed[key]) + ")");

    notifyTeam(3 - def.base, "turretDestroyed", 0, 0);

    const bk: string = String(def.base);
    if (!losOpen[bk] && countDestroyed(def.base) >= TURRET_CLUSTER_REQ) {
        losOpen[bk] = true;
        playSfxAll("losOpen", 0.9);
        logAdmin("turrets", "base " + bk + " LINE OF SIGHT OPEN");
        notifyTeam(3 - Number(bk), "losOpen", 0, 0);
    }
    return true;
}

// Number of turrets actually destroyed at this base. This must count individual
// kills, not members of a destroyed cluster: every turret in a base shares one
// cluster, so counting per-cluster members opened the base after a single kill.
function countDestroyed(base: number): number {
    let n: number = 0;
    for (const t of TURRETS) {
        if (t.base === base && destroyed[t.emplId]) {
            n++;
        }
    }
    return n;
}

export function losOpenFor(base: number): boolean {
    return losOpen[String(base)] === true;
}

export function turretIsDestroyed(emplId: number): boolean {
    return destroyed[emplId] === true;
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
        invokeSubscriber(fn, base, hits, HQ_HITS_REQUIRED, undefined, "turrets.hqHit");
    }
    // base owns the HQ, so the attackers are the other team. The final hit is
    // announced by endMatchFor instead (keys === null).
    const keys: HqHitKeys | null = hqHitKeys(hits, HQ_HITS_REQUIRED);
    if (keys !== null) {
        const left: number = HQ_HITS_REQUIRED - hits;
        notifyTeam(base, keys.defender, left, HQ_HITS_REQUIRED);
        notifyTeam(winnerForDestroyedBase(base), keys.attacker, left, HQ_HITS_REQUIRED);
    }
    log("turrets", "HQ base " + base + " hit " + String(hqHp[base]) + "/" + String(HQ_HITS_REQUIRED));
    if (hqHp[base] >= HQ_HITS_REQUIRED) {
        matchOver = true;
        endMatchFor(base);
    }
    return true;
}

function endMatchFor(base: number): void {
    safe("turrets.end", () => {
        const idx: number = base === 1 ? 0 : 1;
        const vfx: number = HQ_EXPLOSION[idx];
        if (isConfigured(vfx)) {
            safe("turrets.explosion", () => {
                mod.EnableVFX(mod.GetVFX(vfx), true);
            });
        }
        playSfxAll("nukeFire", 1.0);
        // 'base' is the team that owned the destroyed HQ, so the winner is the
        // other team. The previous GetTeam(base - 1) passed team 0 when HQ 1
        // fell, and EndGameMode(team 0) is a draw (Tier 0). Both teams get the
        // same factual message: "NATO destroyed the PAX HQ" or the reverse.
        const winner: number = winnerForDestroyedBase(base);
        const msg: string = winMessageKey(winner);
        notifyTeam(1, msg, 0, 0);
        notifyTeam(2, msg, 0, 0);
        logAdmin("turrets", "HQ " + base + " destroyed - team " + winner + " WINS - EndGameMode");
        mod.EndGameMode(mod.GetTeam(winner));
    });
}

export function configureTurretEvents(): void {
    Events.OnPlayerEnterAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("turret.enter", () => { onEnterZone(p, at); });
    });
    Events.OnPlayerExitAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("turret.exit", () => { onExitZone(p, at); });
    });
    Events.OnPlayerLeaveGame.subscribe((id: number) => {
        safe("turret.leave", () => {
            clearWarning(id);
            delete playerZones[id];
        });
    });
}

export function playerZoneCount(pid: number): number {
    const l: number[] | undefined = playerZones[pid];
    return l === undefined ? 0 : l.length;
}


// --- SOURCE: src\slots.ts ---




// A VehicleSpawner silently refuses to spawn while it still holds a vehicle, and
// the engine exposes no way to ask which vehicle a spawner owns. So a slot counts
// as busy when a live vehicle is parked within VEHICLE_SLOT_RADIUS_M of that
// spawner.
//
// Occupancy is measured on demand from AllVehicles() rather than tracked via
// events, because events only fire on a successful spawn and a refused spawn
// produces no signal at all.
//
// Spawner positions are static, so they resolve once into a flat array. Vehicle
// positions do change, so those are snapshotted fresh per decision - but
// exactly once, and each converted once, then tested against every slot in the
// same pass. The previous version re-walked the whole vehicle list once per
// slot, then walked it up to three more times in pickSpawner, and the denial
// path called freeSlots() for another three.
export type SlotState = {
    spawnerIds: number[];
    positions: number[]; // flat x,y,z per slot
};

export type SlotReport = {
    busy: boolean[]; // one entry per slot, length === spawnerIds.length
    free: number;
    vehicleCount: number;
};

const byFactory: { [facId: string]: SlotState } = {};
const RADIUS_SQ: number = VEHICLE_SLOT_RADIUS_M * VEHICLE_SLOT_RADIUS_M;

export function initSlots(facId: string, spawnerIds: number[]): void {
    const st: SlotState = {
        spawnerIds: spawnerIds.slice(),
        positions: []
    };
    for (const sid of st.spawnerIds) {
        let x: number = 0;
        let y: number = 0;
        let z: number = 0;
        try {
            const sp: mod.VehicleSpawner = mod.GetVehicleSpawner(sid);
            if (mod.IsValid(sp)) {
                const v: Vectors.Vector3 = Vectors.toVector3(mod.GetObjectPosition(sp));
                x = v.x;
                y = v.y;
                z = v.z;
            }
        } catch (e) {
        }
        st.positions.push(x, y, z);
    }
    byFactory[facId] = st;
    const report: SlotReport = markBusy(st);
    let occupied: number = 0;
    for (let i: number = 0; i < report.busy.length; i++) {
        if (report.busy[i]) {
            occupied++;
        }
    }
    log("shop", facId + " slots " + String(st.spawnerIds.length)
        + " (" + String(occupied) + " already occupied)");
}

// A single AllVehicles() walk fills the busy flags for every slot at once and
// stops early once every slot is accounted for.
function markBusy(st: SlotState): SlotReport {
    const slots: number = st.spawnerIds.length;
    const busy: boolean[] = [];
    for (let i: number = 0; i < slots; i++) {
        busy.push(false);
    }
    let vehicles: number = 0;
    let remaining: number = slots;
    let arr: mod.Array;
    try {
        arr = mod.AllVehicles();
    } catch (e) {
        return { busy: busy, free: slots, vehicleCount: 0 };
    }
    const n: number = mod.CountOf(arr);
    for (let vi: number = 0; vi < n; vi++) {
        const v: mod.Vehicle = mod.ValueInArray(arr, vi) as mod.Vehicle;
        if (!mod.IsValid(v)) {
            continue;
        }
        vehicles++;
        // Converted once per vehicle, then compared against each free slot.
        const p: Vectors.Vector3 = Vectors.toVector3(mod.GetObjectPosition(v));
        for (let i: number = 0; i < slots; i++) {
            if (busy[i]) {
                continue;
            }
            const base: number = i * 3;
            const dx: number = p.x - st.positions[base];
            const dy: number = p.y - st.positions[base + 1];
            const dz: number = p.z - st.positions[base + 2];
            if (dx * dx + dy * dy + dz * dz <= RADIUS_SQ) {
                busy[i] = true;
                remaining--;
                break;
            }
        }
        if (remaining === 0) {
            break;
        }
    }
    let free: number = 0;
    for (let i: number = 0; i < slots; i++) {
        if (!busy[i]) {
            free++;
        }
    }
    return { busy: busy, free: free, vehicleCount: vehicles };
}

// Picks the spawner for the requested item, preferring the item's own slot but
// falling back to any free one. Returns slot -1 when every slot is busy so the
// purchase can be refused instead of charged for nothing. The free count comes
// from the same single pass, so the denial log needs no second walk.
export type SpawnChoice = { slot: number; free: number; vehicles: number };

export function pickSpawner(facId: string, wantIndex: number): SpawnChoice {
    const st: SlotState | undefined = byFactory[facId];
    if (st === undefined) {
        return { slot: -1, free: 0, vehicles: 0 };
    }
    const slots: number = st.spawnerIds.length;
    if (slots === 0) {
        return { slot: -1, free: 0, vehicles: 0 };
    }
    const report: SlotReport = markBusy(st);
    if (report.free === 0) {
        return { slot: -1, free: 0, vehicles: report.vehicleCount };
    }
    const start: number = wantIndex < 0 ? 0 : wantIndex % slots;
    for (let off: number = 0; off < slots; off++) {
        const idx: number = (start + off) % slots;
        if (!report.busy[idx]) {
            if (willLogDebug()) {
                log("shop", "picked slot " + String(idx) + " of " + String(slots)
                    + " (" + String(report.free) + " free, "
                    + String(report.vehicleCount) + " vehicles)");
            }
            return { slot: idx, free: report.free, vehicles: report.vehicleCount };
        }
    }
    return { slot: -1, free: report.free, vehicles: report.vehicleCount };
}


// --- SOURCE: src\weapons.ts ---
export const RORSCH: mod.Weapons = mod.Weapons.BattlePickup_Rorsch_Mk_2_SMRW;
export const MOAC: mod.Weapons = mod.Weapons.BattlePickup_MP_RMG;

export const PRIMARIES: mod.Weapons[] = [
    mod.Weapons.BattlePickup_Rorsch_Mk_2_SMRW,
    mod.Weapons.BattlePickup_MP_RMG,
    mod.Weapons.AssaultRifle_AK4D,
    mod.Weapons.AssaultRifle_B36A4,
    mod.Weapons.AssaultRifle_KORD_6P67,
    mod.Weapons.AssaultRifle_L85A3,
    mod.Weapons.AssaultRifle_M16A4,
    mod.Weapons.AssaultRifle_M433,
    mod.Weapons.AssaultRifle_NVO_228E,
    mod.Weapons.AssaultRifle_SOR_556_Mk2,
    mod.Weapons.AssaultRifle_TR_7,
    mod.Weapons.AssaultRifle_VCR_2,
    mod.Weapons.Carbine_M4A1,
    mod.Weapons.Carbine_AK_205,
    mod.Weapons.Carbine_GRT_BC,
    mod.Weapons.Carbine_M277,
    mod.Weapons.Carbine_M417_A2,
    mod.Weapons.Carbine_QBZ_192,
    mod.Weapons.Carbine_SG_553R,
    mod.Weapons.Carbine_SOR_300SC,
    mod.Weapons.DMR_GRT_CPS,
    mod.Weapons.DMR_LMR27,
    mod.Weapons.DMR_M39_EMR,
    mod.Weapons.DMR_SVDM,
    mod.Weapons.DMR_SVK_86,
    mod.Weapons.LMG_DRS_IAR,
    mod.Weapons.LMG_KTS100_MK8,
    mod.Weapons.LMG_L110,
    mod.Weapons.LMG_M_60,
    mod.Weapons.LMG_M121_A2,
    mod.Weapons.LMG_M123K,
    mod.Weapons.LMG_M240L,
    mod.Weapons.LMG_M250,
    mod.Weapons.LMG_RPK_74M,
    mod.Weapons.LMG_RPKM,
    mod.Weapons.Shotgun__185KS_K,
    mod.Weapons.Shotgun_DB_12,
    mod.Weapons.Shotgun_M1014,
    mod.Weapons.Shotgun_M87A1,
    mod.Weapons.SMG_CZ3A1,
    mod.Weapons.SMG_KV9,
    mod.Weapons.SMG_PP_19,
    mod.Weapons.SMG_PW5A3,
    mod.Weapons.SMG_PW7A2,
    mod.Weapons.SMG_SCW_10,
    mod.Weapons.SMG_SGX,
    mod.Weapons.SMG_SL9,
    mod.Weapons.SMG_UMG_40,
    mod.Weapons.SMG_USG_90,
    mod.Weapons.Sniper_L115,
    mod.Weapons.Sniper_M2010_ESR,
    mod.Weapons.Sniper_Mini_Scout,
    mod.Weapons.Sniper_PSR,
    mod.Weapons.Sniper_SV_98
];

export const SECONDARIES: mod.Weapons[] = [
    mod.Weapons.Sidearm_M45A1,
    mod.Weapons.Sidearm_ES_57,
    mod.Weapons.Sidearm_GGH_22,
    mod.Weapons.Sidearm_M357_Trait,
    mod.Weapons.Sidearm_M44,
    mod.Weapons.Sidearm_P18,
    mod.Weapons.Sidearm_VZ_61
];

export function weaponName(w: mod.Weapons | undefined): string {
    if (w === undefined) {
        return "none";
    }
    for (const e of PRIMARIES) {
        if (mod.Equals(e, w)) {
            return "P:" + primNames[PRIMARIES.indexOf(e)];
        }
    }
    for (const e of SECONDARIES) {
        if (mod.Equals(e, w)) {
            return "S:" + secNames[SECONDARIES.indexOf(e)];
        }
    }
    return "[Weapons]";
}

const primNames: string[] = [
    "Rorsch", "RMG", "AR_AK4D", "AR_B36A4", "AR_KORD", "AR_L85A3", "AR_M16A4", "AR_M433",
    "AR_NVO", "AR_SOR556", "AR_TR7", "AR_VCR2",
    "C_AK205", "C_GRTBC", "C_M277", "C_M417A2", "C_M4A1", "C_QBZ192", "C_SG553R", "C_SOR300",
    "D_GRTCPS", "D_LMR27", "D_M39EMR", "D_SVDM", "D_SVK86",
    "L_DRSIAR", "L_KTS100", "L_L110", "L_M60", "L_M121A2", "L_M123K", "L_M240L", "L_M250",
    "L_RPK74M", "L_RPKM",
    "Sh_185KS", "Sh_DB12", "Sh_M1014", "Sh_M87A1",
    "SM_CZ3A1", "SM_KV9", "SM_PP19", "SM_PW5A3", "SM_PW7A2", "SM_SCW10", "SM_SGX", "SM_SL9",
    "SM_UMG40", "SM_USG90",
    "Sn_L115", "Sn_M2010", "Sn_MiniScout", "Sn_PSR", "Sn_SV98"
];

const secNames: string[] = [
    "M45A1", "ES_57", "GGH_22", "M357", "M44", "P18", "VZ_61"
];

export function GetCurrentWeaponInSlot(
    player: mod.Player | undefined,
    slot: mod.InventorySlots,
    weaponFilter?: mod.Weapons
): mod.Weapons | undefined {
    if (!player) {
        return undefined;
    }

    const mapToSearch: mod.Weapons[] = slot === mod.InventorySlots.PrimaryWeapon ? PRIMARIES : SECONDARIES;
    for (const weaponEnum of mapToSearch) {
        if (weaponFilter !== undefined && mod.Equals(weaponEnum, weaponFilter)) {
            continue;
        }
        if (mod.HasEquipment(player, weaponEnum)) {
            return weaponEnum;
        }
    }

    const otherMap: mod.Weapons[] = slot === mod.InventorySlots.PrimaryWeapon ? SECONDARIES : PRIMARIES;
    for (const weaponEnum of otherMap) {
        if (weaponFilter !== undefined && mod.Equals(weaponEnum, weaponFilter)) {
            continue;
        }
        if (mod.HasEquipment(player, weaponEnum)) {
            return weaponEnum;
        }
    }
    return undefined;
}

export function heldWeapon(player: mod.Player): mod.Weapons | undefined {
    const sec = GetCurrentWeaponInSlot(player, mod.InventorySlots.SecondaryWeapon);
    return GetCurrentWeaponInSlot(player, mod.InventorySlots.PrimaryWeapon, sec);
}

export function isRorschInHand(player: mod.Player): boolean {
    return mod.HasEquipment(player, RORSCH);
}

export function debugWeaponReport(player: mod.Player): string {
    const sec = GetCurrentWeaponInSlot(player, mod.InventorySlots.SecondaryWeapon);
    const full = GetCurrentWeaponInSlot(player, mod.InventorySlots.PrimaryWeapon, sec);
    const cheap = isRorschInHand(player);
    const rorschEq = mod.HasEquipment(player, RORSCH);
    return "held=" + weaponName(full)
        + " secondary=" + weaponName(sec)
        + " hasRorsch=" + String(rorschEq)
        + " inHand=" + String(cheap)
        + " agree=" + String((full === RORSCH) === cheap);
}


// --- SOURCE: src\raygeom.ts ---
// Ray geometry for the Rorsch turret test, kept free of mod.* so
// scripts/test-raygeom.js can unit-test it in node.
//
// mod.RayCast passes straight through the stationary AA turrets (17:38 log:
// rays aimed at them carried on to the HQ or the sky), so a turret cannot be
// found from the ray's hit point. Instead the ray's path is tested against an
// upright cylinder around the turret's base.

// True when the segment start + dir * [0, len] passes through the vertical
// cylinder of the given radius around (cx, cz), spanning cy - below to
// cy + above. dir must be normalised.
export function rayThroughUpright(
    sx: number, sy: number, sz: number,
    dx: number, dy: number, dz: number,
    len: number,
    cx: number, cy: number, cz: number,
    radius: number, below: number, above: number
): boolean {
    // Horizontal part: the s range where the ray is within radius of the axis.
    const ox: number = sx - cx;
    const oz: number = sz - cz;
    const a: number = dx * dx + dz * dz;
    const c: number = ox * ox + oz * oz - radius * radius;
    let s0: number;
    let s1: number;
    if (a < 1e-9) {
        // Straight up or down: inside the circle for the whole ray, or never.
        if (c > 0) {
            return false;
        }
        s0 = 0;
        s1 = len;
    } else {
        const b: number = ox * dx + oz * dz;
        const disc: number = b * b - a * c;
        if (disc < 0) {
            return false;
        }
        const root: number = Math.sqrt(disc);
        s0 = (-b - root) / a;
        s1 = (-b + root) / a;
    }
    if (s0 < 0) {
        s0 = 0;
    }
    if (s1 > len) {
        s1 = len;
    }
    if (s0 > s1) {
        return false;
    }
    // Vertical part: y is linear in s, so the highest and lowest points of that
    // stretch are its ends.
    const y0: number = sy + dy * s0;
    const y1: number = sy + dy * s1;
    const lo: number = y0 < y1 ? y0 : y1;
    const hi: number = y0 < y1 ? y1 : y0;
    return hi >= cy - below && lo <= cy + above;
}


// --- SOURCE: src\rorschshot.ts ---
// Rorsch shot detection, kept free of mod.* so scripts/test-rorsch.js can
// unit-test it in node.
//
// Evidence from the 2026-10-01 playtests, do not re-try these:
//   - GetInventoryMagazineAmmo / GetInventoryAmmo never change for the Rorsch
//     in any slot, and the MiscGadget slot throws GetAmmoRequest every call.
//   - IsFiring's rising edge is the trigger press, not the shot.
//   - A fixed timer after the press (1 s) cast the ray ~1.2 s before the beam.
//
// What the 15:20 trace showed: IsFiring goes false 2200-2212 ms after the press
// on every shot, even with the trigger still held, and IsReloading follows. A
// release at 1644 ms got no reload, i.e. no shot. So the discharge is the
// IsFiring falling edge after a full charge; a shorter hold is a cancelled
// charge. Wall-clock time, not ticks, so lag cannot stretch or shrink a hold.

export interface HoldState {
    pressMs: number;
    // A press that must never count, e.g. made with another weapon.
    ignored: boolean;
}

export interface HoldResult {
    next: HoldState | undefined;
    fire: boolean;
}

export function holdStep(st: HoldState | undefined, firing: boolean, nowMs: number, minChargeMs: number): HoldResult {
    if (firing) {
        return { next: st === undefined ? { pressMs: nowMs, ignored: false } : st, fire: false };
    }
    if (st === undefined || st.ignored) {
        return { next: undefined, fire: false };
    }
    return { next: undefined, fire: nowMs - st.pressMs >= minChargeMs };
}


// --- SOURCE: src\nuke.ts ---












interface PendingRay {
    pid: number;
    team: number;
    start: Vectors.Vector3;
    // Wall-clock cast time, so a ray that never reports back is visible in
    // the RORSCH_TRACE "RAY skipped" line.
    castMs: number;
    // Normalised ray direction, set at cast, for the turret path test.
    dir: Vectors.Vector3 | undefined;
}

const inFlight: { [pid: number]: PendingRay } = {};
// Per-player trigger hold while in an HQ fire zone with the Rorsch; see
// rorschshot.ts for why the shot is the IsFiring falling edge after a charge.
const hold: { [pid: number]: HoldState } = {};
// RORSCH_TRACE only: last IsReloading value, to log its edges.
const wasReloading: { [pid: number]: boolean } = {};
// RORSCH_TRACE only: time of the last Rorsch press, kept past release.
const lastPressMs: { [pid: number]: number } = {};
// RORSCH_TRACE only: when IsReloading last turned on, to time the reload.
const reloadOnMs: { [pid: number]: number } = {};

function sincePress(pid: number, nowMs: number): string {
    const pressed: number | undefined = lastPressMs[pid];
    return pressed === undefined ? "(no press seen)" : "+" + String(nowMs - pressed) + "ms after press";
}

// Diagnostic, one cheap soldier-state read per tick for players in a fire zone
// with the Rorsch. Logs both IsReloading edges with the time since the press
// and the trigger state, to test whether the reload marks the actual shot and
// whether IsFiring drops during the reload while the trigger is still held.
function traceReload(p: mod.Player, pid: number, nowMs: number, firing: boolean): void {
    let reloading: boolean;
    try {
        reloading = mod.GetSoldierState(p, mod.SoldierStateBool.IsReloading);
    } catch (e) {
        return;
    }
    const was: boolean = wasReloading[pid] === true;
    if (reloading && !was) {
        reloadOnMs[pid] = nowMs;
        log("nuke", "TRACE pid=" + pid + " IsReloading ON " + sincePress(pid, nowMs)
            + " firing=" + String(firing));
    } else if (!reloading && was) {
        const on: number | undefined = reloadOnMs[pid];
        log("nuke", "TRACE pid=" + pid + " IsReloading OFF after "
            + (on === undefined ? "?" : String(nowMs - on)) + "ms, " + sincePress(pid, nowMs)
            + " firing=" + String(firing));
    }
    wasReloading[pid] = reloading;
}

// RORSCH_TRACE only, read once per press: which inventory slot is active.
// isRorschInHand is HasEquipment, which is true whenever the Rorsch is carried,
// so this shows whether a press came from the Rorsch or from another weapon.
function traceSlot(p: mod.Player): string {
    try {
        return "slot pri=" + String(mod.IsInventorySlotActive(p, mod.InventorySlots.PrimaryWeapon))
            + " sec=" + String(mod.IsInventorySlotActive(p, mod.InventorySlots.SecondaryWeapon))
            + " misc=" + String(mod.IsInventorySlotActive(p, mod.InventorySlots.MiscGadget));
    } catch (e) {
        return "slot read threw " + String(e);
    }
}

function forgetHold(pid: number): void {
    delete hold[pid];
    delete wasReloading[pid];
    delete lastPressMs[pid];
    delete reloadOnMs[pid];
    delete chargeAim[pid];
}
const gateOccupants: { [gateId: number]: number[] } = {};
const gateHandles: { [gateId: number]: mod.AreaTrigger } = {};
const playerGate: { [pid: number]: number } = {};
const deployed_2: { [pid: number]: boolean } = {};

let inited_2: boolean = false;

export function initNuke(): void {
    inited_2 = true;
    cacheHqTargets();
    let gates: number = 0;
    for (const g of HQ_GATES) {
        if (!isConfigured(g)) {
            continue;
        }
        const trigger: mod.AreaTrigger = mod.GetAreaTrigger(g);
        if (!mod.IsValid(trigger)) {
            log("nuke", "FAIL gate " + g + " did not resolve");
            continue;
        }
        gateOccupants[g] = [];
        gateHandles[g] = trigger;
        gates++;
    }
    log("nuke", "ready: Rorsch-gated, ray on discharge (IsFiring off after charge), one ray per player, gates="
        + String(gates) + "/" + String(HQ_GATES.length));
}

// Exact ObjId only - see the note in capture.ts about the removed mod.Equals
// fallback, which mis-routed gates and turret zones.
function gateIdFor(at: mod.AreaTrigger): number {
    const id: number = mod.GetObjId(at);
    return gateOccupants[id] !== undefined ? id : 0;
}

function onGateEnter(p: mod.Player, at: mod.AreaTrigger): void {
    const gid: number = gateIdFor(at);
    const list: number[] | undefined = gateOccupants[gid];
    const pid: number = mod.GetObjId(p);
    if (list === undefined) {
        if (willLogDebug()) {
            log("nuke", "UNMATCHED gate ENTER trigger=" + mod.GetObjId(at) + " pid=" + pid);
        }
        return;
    }
    if (pid < 0) {
        return;
    }
    if (list.indexOf(pid) < 0) {
        list.push(pid);
    }
    playerGate[pid] = gid;
    log("nuke", "gate ENTER id=" + gid + " pid=" + pid);
}

function onGateExit(p: mod.Player, at: mod.AreaTrigger): void {
    const gid: number = gateIdFor(at);
    const list: number[] | undefined = gateOccupants[gid];
    const pid: number = mod.GetObjId(p);
    if (list === undefined) {
        if (willLogDebug()) {
            log("nuke", "UNMATCHED gate EXIT trigger=" + mod.GetObjId(at) + " pid=" + pid);
        }
        return;
    }
    if (list !== undefined) {
        const i: number = list.indexOf(pid);
        if (i >= 0) {
            list.splice(i, 1);
        }
    }
    if (playerGate[pid] === gid) {
        delete playerGate[pid];
    }
    log("nuke", "gate EXIT id=" + gid + " pid=" + pid);
}

function onGateLeave(pid: number): void {
    const gid: number | undefined = playerGate[pid];
    if (gid !== undefined) {
        const list: number[] | undefined = gateOccupants[gid];
        if (list !== undefined) {
            const i: number = list.indexOf(pid);
            if (i >= 0) {
                list.splice(i, 1);
            }
        }
    }
    delete playerGate[pid];
}

export function playerInGate(pid: number): boolean {
    return playerGate[pid] !== undefined;
}

function nearEnemyBase(pid: number): boolean {
    if (Object.keys(gateOccupants).length === 0) {
        return true;
    }
    return playerGate[pid] !== undefined;
}

function shootRay(p: mod.Player): void {
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    const pending: PendingRay | undefined = inFlight[pid];
    if (pending !== undefined) {
        if (RORSCH_TRACE) {
            log("nuke", "RAY skipped pid=" + pid + " - previous ray still in flight ("
                + String(Date.now() - pending.castMs) + "ms)");
        }
        return;
    }
    const team: number = teamIdOf(p);
    // Aim from the last charging tick, before the discharge kick; the live read
    // is only a fallback for a shot with no captured aim.
    const aim: Aim | undefined = chargeAim[pid];
    delete chargeAim[pid];
    // EyePosition is one FFI call and is needed both for the inFlight origin and
    // for the ray start, so it is read exactly once.
    const eye: mod.Vector = aim !== undefined
        ? mod.CreateVector(aim.ex, aim.ey, aim.ez)
        : mod.GetSoldierState(p, mod.SoldierStateVector.EyePosition);
    const pendingRay: PendingRay = { pid: pid, team: team, start: Vectors.toVector3(eye), castMs: Date.now(), dir: undefined };
    inFlight[pid] = pendingRay;
    safe("nuke.cast", () => {
        const facing: mod.Vector = aim !== undefined
            ? mod.CreateVector(aim.fx, aim.fy, aim.fz)
            : mod.Normalize(mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection));
        // Start ahead of the soldier. A ray originating at the eye position hits
        // the player's own body/weapon ~0.24 m out (see the 03:29 log), so the
        // hit point never came near a turret and nothing was ever destroyed.
        const start: mod.Vector = mod.Add(eye, mod.Multiply(facing, RAY_START_OFFSET_M));
        const end: mod.Vector = mod.Add(start, mod.Multiply(facing, RAY_MAX_DIST_M));
        mod.RayCast(p, start, end);
        const e3: Vectors.Vector3 = Vectors.toVector3(eye);
        const f3: Vectors.Vector3 = Vectors.toVector3(facing);
        pendingRay.dir = f3;
        if (RORSCH_TRACE || willLogDebug()) {
            // After the cast, so the extra read adds no latency: the facing on
            // the discharge tick itself, to measure the kick the snapshot avoids.
            const live: Vectors.Vector3 = Vectors.toVector3(mod.Normalize(
                mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection)));
            log("nuke", "CAST pid=" + pid + " team=" + team + " from "
                + String(e3.x) + "," + String(e3.y) + "," + String(e3.z)
                + " dir " + String(f3.x) + "," + String(f3.y) + "," + String(f3.z)
                + (aim !== undefined ? " (charge aim)" : " (live aim, none captured)")
                + " dischargeTickDirY=" + String(live.y));
        }
    });
}

// Aim captured on every tick the Rorsch is charging, used for the shot. By the
// tick the discharge is seen, the weapon's kick has already pitched the view
// up: the 16:32 log shows every turret shot ~0.06 (3.5 deg) higher than the
// line to the turret while the yaw was exact, so rays passed over the turrets.
// Plain numbers, so no engine handle is held across ticks.
interface Aim {
    ex: number;
    ey: number;
    ez: number;
    fx: number;
    fy: number;
    fz: number;
}

const chargeAim: { [pid: number]: Aim } = {};

function captureAim(p: mod.Player, pid: number): void {
    try {
        const e: Vectors.Vector3 = Vectors.toVector3(
            mod.GetSoldierState(p, mod.SoldierStateVector.EyePosition));
        const f: Vectors.Vector3 = Vectors.toVector3(mod.Normalize(
            mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection)));
        chargeAim[pid] = { ex: e.x, ey: e.y, ez: e.z, fx: f.x, fy: f.y, fz: f.z };
    } catch (e) {
        // Keep the previous tick's aim, if any.
    }
}

// Hot-path comparisons use distanceSquared so they skip the sqrt. dist() is
// kept only where a metre value is actually printed.
// Squared once so the read path compares against a number, not a radius.
const HQ_HIT_RADIUS_SQ: number = HQ_HIT_RADIUS_M * HQ_HIT_RADIUS_M;

// HQ dummy target positions, resolved once at init. The targets are static
// map geometry, so resolving them per shot was two FFI calls for a constant.
// A NaN marks a target that never resolved.
const hqX: number[] = [NaN, NaN];
const hqY: number[] = [NaN, NaN];
const hqZ: number[] = [NaN, NaN];

function cacheHqTargets(): void {
    for (let i: number = 0; i < 2; i++) {
        const target: number = HQ_TARGETS[i];
        if (!isConfigured(target)) {
            continue;
        }
        safe("nuke.hqpos", () => {
            const v: Vectors.Vector3 = Vectors.toVector3(
                mod.GetObjectPosition(mod.GetSpatialObject(target)));
            hqX[i] = v.x;
            hqY[i] = v.y;
            hqZ[i] = v.z;
        });
    }
}

function dist(a: Vectors.Vector3, b: Vectors.Vector3): number {
    return Math.sqrt(Vectors.distanceSquared(a, b));
}

// Radius squared, computed once, so the hot loop never squares a literal.
const TURRET_HIT_RADIUS_SQ: number = TURRET_HIT_RADIUS_M * TURRET_HIT_RADIUS_M;

// Destroys every live enemy turret the ray hit. len is how far the ray got from
// the eye (to the hit point, or its full length on a miss), so a wall in front
// of a turret still shields it. Two tests, either is enough:
//   - path: the ray crossed the upright cylinder around the turret. RayCast
//     itself passes through the AA turrets, so this is the main test.
//   - point: the ray's hit point landed within TURRET_HIT_RADIUS_M of the
//     turret base, e.g. the ground at its foot. The original test, kept so
//     nothing that destroyed a turret before stops doing so.
function checkTurrets(ray: PendingRay, len: number, hit: Vectors.Vector3 | undefined): void {
    const d: Vectors.Vector3 | undefined = ray.dir;
    for (let ti: number = 0; ti < TURRETS.length; ti++) {
        const t: TurretDef = TURRETS[ti];
        if (!isConfigured(t.zoneId) || turretIsDestroyed(t.emplId) || t.base === ray.team) {
            continue;
        }
        if (!turretResolvedAt(ti)) {
            continue;
        }
        // Cached coordinates, no mod.* calls in this loop.
        const byPath: boolean = d !== undefined && rayThroughUpright(
            ray.start.x, ray.start.y, ray.start.z, d.x, d.y, d.z, len,
            turretCoord(ti, 0), turretCoord(ti, 1), turretCoord(ti, 2),
            TURRET_RAY_RADIUS_M, TURRET_RAY_BELOW_M, TURRET_RAY_ABOVE_M);
        const byPoint: boolean = hit !== undefined
            && turretDistSq(ti, hit.x, hit.y, hit.z) <= TURRET_HIT_RADIUS_SQ;
        if (byPath || byPoint) {
            if (RORSCH_TRACE || willLogDebug()) {
                log("nuke", "turret " + t.emplId + " hit by "
                    + (byPath && byPoint ? "path+point" : byPath ? "path" : "point"));
            }
            destroyTurret(t.emplId);
        }
    }
}

function resolveHit(p: mod.Player, point: mod.Vector): void {
    const pid: number = mod.GetObjId(p);
    const ray: PendingRay | undefined = inFlight[pid];
    if (ray === undefined) {
        return;
    }
    delete inFlight[pid];
    const team: number = ray.team;
    if (team !== 1 && team !== 2) {
        return;
    }
    const hit: Vectors.Vector3 = Vectors.toVector3(point);
    const travelled: number = dist(ray.start, hit);
    if (travelled < RAY_MIN_HIT_DIST_M) {
        if (RORSCH_TRACE || willLogDebug()) {
            log("nuke", "HIT ignored (self) pid=" + pid + " dist=" + String(travelled.toFixed(2)));
        }
        return;
    }
    if (RORSCH_TRACE || willLogDebug()) {
        log("nuke", "HIT pid=" + pid + " team=" + team + " dist=" + String(travelled.toFixed(1))
            + " at " + String(hit.x) + "," + String(hit.y) + "," + String(hit.z));
    }

    checkTurrets(ray, travelled, hit);

    for (const base of [1, 2]) {
        if (base === team) {
            continue;
        }
        const target: number = HQ_TARGETS[base - 1];
        if (!isConfigured(target)) {
            continue;
        }
        const losOk: boolean = losOpenFor(base);
        let d: number = -1;
        let inRange: boolean = false;
        safe("nuke.hq", () => {
            // Cached: no GetSpatialObject, no GetObjectPosition, no allocation.
            const hx: number = hqX[base - 1];
            const hy: number = hqY[base - 1];
            const hz: number = hqZ[base - 1];
            if (hx !== hx) {
                // NaN sentinel: the target never resolved at init.
                return;
            }
            const dx: number = hit.x - hx;
            const dy: number = hit.y - hy;
            const dz: number = hit.z - hz;
            const sq: number = dx * dx + dy * dy + dz * dz;
            inRange = sq <= HQ_HIT_RADIUS_SQ;
            // d is printed by the always-on log below, so it must hold the real
            // distance. Only the hit test itself (sq) stays sqrt-free, and this
            // runs once per cast, not per frame.
            d = Math.sqrt(sq);
            if (inRange && losOk) {
                hitHq(base);
            }
        });
        // Log every attempt so a miss is distinguishable from a silent failure:
        // "no LOS" and "out of range" need different fixes.
        log("nuke", "hq base " + base + " dist=" + String(d.toFixed(1))
            + " range=" + String(HQ_HIT_RADIUS_M)
            + " inRange=" + String(inRange) + " losOpen=" + String(losOk)
            + (inRange && losOk ? " -> HIT" : (inRange ? " -> blocked by LOS" : " -> out of range")));
    }
}

function probe(): void {
    if (!inited_2) {
        return;
    }
    safe("nuke.probe", () => {
        let arr: mod.Array;
        try {
            arr = mod.AllPlayers();
        } catch (e) {
            return;
        }
        const n: number = mod.CountOf(arr);
        for (let i: number = 0; i < n; i++) {
            const p: mod.Player = mod.ValueInArray(arr, i) as mod.Player;
            const pid: number = mod.GetObjId(p);
            if (pid < 0) {
                continue;
            }
            if (deployed_2[pid] !== true) {
                continue;
            }
            // Bots never fire the Rorsch: zero-FFI registry test, before any
            // soldier-state read. The Rorsch is also stripped at bot deploy.
            if (isBotPid(pid)) {
                continue;
            }
            // Gate check first: playerGate is a plain map read, so this rejects
            // every player who is not standing in an HQ gate without a single
            // mod.* FFI call. This is the whole point of the reorder.
            if (!nearEnemyBase(pid)) {
                // A hold that started outside the zone restarts on entry.
                forgetHold(pid);
                continue;
            }
            let firing: boolean = false;
            try {
                firing = mod.GetSoldierState(p, mod.SoldierStateBool.IsFiring);
            } catch (e) {
                continue;
            }
            const nowMs: number = Date.now();
            const st: HoldState | undefined = hold[pid];
            if (firing && st === undefined) {
                // New press: check the weapon once per press, not per tick.
                if (!isRorschInHand(p)) {
                    logNukeOnce(pid, "noRorsch");
                    if (RORSCH_TRACE) {
                        log("nuke", "PRESS pid=" + pid + " ignored - Rorsch not carried, " + traceSlot(p));
                    }
                    hold[pid] = { pressMs: nowMs, ignored: true };
                    continue;
                }
                logNukeOnce(pid, "charging");
                lastPressMs[pid] = nowMs;
                log("nuke", "PRESS pid=" + pid + " charging, discharge counts after "
                    + String(RORSCH_MIN_CHARGE_MS) + "ms held"
                    + (RORSCH_TRACE ? ", " + traceSlot(p) : ""));
            }
            const r: HoldResult = holdStep(st, firing, nowMs, RORSCH_MIN_CHARGE_MS);
            if (r.next === undefined) {
                delete hold[pid];
            } else {
                hold[pid] = r.next;
                if (!r.next.ignored) {
                    captureAim(p, pid);
                }
            }
            if (r.fire) {
                // Cast first, in the same tick the discharge is seen; the logs
                // and the reload trace come after so they add no latency.
                shootRay(p);
                logNukeOnce(pid, "fired");
                log("nuke", "SHOT pid=" + pid + " discharge after "
                    + String(nowMs - (st === undefined ? nowMs : st.pressMs)) + "ms - ray cast");
            } else if (r.next === undefined && st !== undefined && !st.ignored) {
                log("nuke", "RELEASED pid=" + pid + " after "
                    + String(nowMs - st.pressMs) + "ms - charge cancelled, no shot");
            }
            if (RORSCH_TRACE) {
                traceReload(p, pid, nowMs, firing);
            }
        }
    });
}

const nukeDiag: { [pid: number]: string } = {};

function logNukeOnce(pid: number, reason: string): void {
    if (nukeDiag[pid] === reason) {
        return;
    }
    nukeDiag[pid] = reason;
    log("nuke", "probe pid=" + pid + " -> " + reason
        + " deployed=" + String(deployed_2[pid] === true)
        + " inGate=" + String(playerInGate(pid)));
}

export function configureNukeEvents(): void {
    Events.OnRayCastHit.subscribe((p: mod.Player, point: mod.Vector, _n: mod.Vector) => {
        safe("nuke.hit", () => { resolveHit(p, point); });
    });
    Events.OnRayCastMissed.subscribe((p: mod.Player) => {
        const pid: number = mod.GetObjId(p);
        const ray: PendingRay | undefined = inFlight[pid];
        delete inFlight[pid];
        if (ray === undefined) {
            return;
        }
        if (RORSCH_TRACE) {
            log("nuke", "RAY miss pid=" + pid + " - nothing hit within " + String(RAY_MAX_DIST_M) + "m");
        }
        // A ray aimed at a turret against the sky misses everything, because
        // RayCast passes through the turret; the path test still finds it.
        if (ray.team === 1 || ray.team === 2) {
            safe("nuke.miss", () => {
                checkTurrets(ray, RAY_START_OFFSET_M + RAY_MAX_DIST_M, undefined);
            });
        }
    });
    Events.OnPlayerEnterAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("nuke.gate.enter", () => { onGateEnter(p, at); });
    });
    Events.OnPlayerExitAreaTrigger.subscribe((p: mod.Player, at: mod.AreaTrigger) => {
        safe("nuke.gate.exit", () => { onGateExit(p, at); });
    });
    Events.OnPlayerLeaveGame.subscribe((pid: number) => {
        safe("nuke.gate.leave", () => {
            onGateLeave(pid);
            delete inFlight[pid];
            forgetHold(pid);
            delete deployed_2[pid];
        });
    });
    Events.OnPlayerDeployed.subscribe((p: mod.Player) => {
        safe("nuke.deployed", () => {
            deployed_2[mod.GetObjId(p)] = true;
        });
    });
    Events.OnPlayerUndeploy.subscribe((p: mod.Player) => {
        safe("nuke.undeployed", () => {
            const pid: number = mod.GetObjId(p);
            deployed_2[pid] = false;
            forgetHold(pid);
            delete inFlight[pid];
        });
    });
}

export function tickNukeProbe(): void {
    probe();
}

export function inFlightCount(): number {
    return Object.keys(inFlight).length;
}


// --- SOURCE: src\worldicons.ts ---






export type LocationState = "friendly" | "enemy" | "neutral" | "destroyed";

export interface StrategicLocation {
    // Stable index into the flat position array, assigned at registration.
    index: number;
    id: string;
    kind: string;
    label: string;
    state: LocationState;
    worldIconId: number;
    parentKind: "capturePoint" | "areaTrigger" | "spatial";
    parentId: number;
}

const locations: StrategicLocation[] = [];
const byId: { [id: string]: StrategicLocation } = {};

// Flat x,y,z per registered location. The parents are static map geometry, so
// resolving one inside distanceMeters cost an FFI call per menu row per
// location. A NaN triple marks a parent that failed to resolve.
const locXYZ: number[] = [];
const highlighted: { [pid: number]: string } = {};
const highlightIcons: { [pid: number]: mod.WorldIcon } = {};

export function highlightedFor(pid: number): string {
    const v: string | undefined = highlighted[pid];
    return v === undefined ? "" : v;
}

const ICON_BY_KIND: { [kind: string]: mod.WorldIconImages } = {
    bunker: mod.WorldIconImages.Flag,
    energy: mod.WorldIconImages.Bomb,
    proto: mod.WorldIconImages.Cross,
    war: mod.WorldIconImages.Alert,
    air: mod.WorldIconImages.Assist,
    naval: mod.WorldIconImages.DangerPing,
    hq: mod.WorldIconImages.Explosion
};

export function initWorldIcons(): void {
    for (const b of BUNKERS) {
        if (!isConfigured(b.capturePointId)) {
            continue;
        }
        addLocation(b.id, "bunker", b.worldIconId, "capturePoint", b.capturePointId);
    }
    for (const a of allAreaBuildings()) {
        if (!isConfigured(a.areaTriggerId)) {
            continue;
        }
        addLocation(a.id, a.kind, a.worldIconId, "areaTrigger", a.areaTriggerId);
    }
    for (const base of [0, 1]) {
        const t: number = HQ_TARGETS[base];
        if (isConfigured(t)) {
            addLocation("hq" + String(base + 1), "hq", 0, "spatial", t);
        }
    }
    log("worldicons", "strategic locations: " + locations.length);
    onCaptured((def: AreaBuildingDef, owner: number) => {
        safe("worldicons.capture", () => {
            refreshLocation(def.id, owner);
        });
    });
    onBunkerCaptured((def, owner) => {
        safe("worldicons.bunker", () => {
            refreshLocation(def.id, owner);
        });
    });
}

function addLocation(
    id: string,
    kind: string,
    worldIconId: number,
    parentKind: "capturePoint" | "areaTrigger" | "spatial",
    parentId: number
): void {
    if (byId[id] !== undefined) {
        return;
    }
    const loc: StrategicLocation = {
        index: locations.length,
        id: id,
        kind: kind,
        label: labelForId(id),
        state: "neutral",
        worldIconId: worldIconId,
        parentKind: parentKind,
        parentId: parentId
    };
    // One-time position snapshot for the distance read path. NaN marks a parent
    // that could not be resolved, which distanceMeters treats as unknown.
    const parent: mod.Object | undefined = resolveParent(loc);
    if (parent === undefined) {
        locXYZ.push(NaN, NaN, NaN);
    } else {
        try {
            const v: Vectors.Vector3 = Vectors.toVector3(mod.GetObjectPosition(parent));
            locXYZ.push(v.x, v.y, v.z);
        } catch (e) {
            locXYZ.push(NaN, NaN, NaN);
        }
    }
    locations.push(loc);
    byId[id] = loc;
}

function refreshLocation(id: string, owner: number): void {
    const loc: StrategicLocation | undefined = byId[id];
    if (!loc) {
        return;
    }
    loc.state = owner === 1 || owner === 2 ? "friendly" : "neutral";
}

// Reused scratch for toVector3. Passing no out param allocates a fresh Vector3
// on every call, and this runs once per tactical row per refresh.
const eyeScratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

// Straight-line metres from the player to the location's parent object.
export function distanceMeters(player: mod.Player, id: string): number {
    const loc: StrategicLocation | undefined = byId[id];
    if (!loc) {
        return -1;
    }
    // The parent position was snapshotted at registration, so this no longer
    // resolves the object or reads its position. Only the player's eye position
    // is read, once per row.
    const base: number = loc.index * 3;
    const bx: number = locXYZ[base];
    if (bx !== bx) {
        // NaN sentinel: the parent never resolved at registration.
        return -1;
    }
    // Scratch reused across calls. toVector3 allocates a fresh Vector3 when no
    // out param is given, and this runs once per tactical row per refresh, so
    // the single reusable object avoids that garbage.
    try {
        const a: Vectors.Vector3 = Vectors.toVector3(
            mod.GetSoldierState(player, mod.SoldierStateVector.EyePosition), eyeScratch);
        const dx: number = a.x - bx;
        const dy: number = a.y - locXYZ[base + 1];
        const dz: number = a.z - locXYZ[base + 2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    } catch (e) {
        return -1;
    }
}

export function stateFor(viewer: number, id: string): LocationState {
    const loc: StrategicLocation | undefined = byId[id];
    if (!loc) {
        return "neutral";
    }
    let owner: number = 0;
    const bunker: BunkerState | undefined = bunkerById(id);
    if (bunker !== undefined) {
        owner = bunker.owner;
    } else {
        const st: BuildingState | undefined = buildingById(id);
        if (st !== undefined) {
            owner = st.owner;
        }
    }
    if (owner === 0) {
        return "neutral";
    }
    if (viewer === 0) {
        return owner === 1 ? "friendly" : "enemy";
    }
    return owner === viewer ? "friendly" : "enemy";
}

export function highlightFor(player: mod.Player, locationId: string): void {
    const id: number = mod.GetObjId(player);
    if (id < 0) {
        return;
    }
    const prev: string | undefined = highlighted[id];
    if (prev !== undefined && prev === locationId) {
        clearHighlight(player);
        return;
    }
    if (prev !== undefined) {
        clearHighlight(player);
    }
    const loc: StrategicLocation | undefined = byId[locationId];
    if (!loc) {
        return;
    }
    const parent: mod.Object | undefined = resolveParent(loc);
    if (parent === undefined) {
        log("worldicons", "no parent for " + loc.id + " objId=" + loc.parentId);
        return;
    }
    const added: boolean = safe("worldicons.highlight", () => {
        let position: mod.Vector = mod.GetObjectPosition(parent);
        if (isConfigured(loc.worldIconId)) {
            const baseIcon: mod.WorldIcon = mod.GetWorldIcon(loc.worldIconId);
            if (mod.IsValid(baseIcon)) {
                position = mod.GetObjectPosition(baseIcon);
            }
        }
        position = mod.Add(position, mod.CreateVector(0, 4, 0));
        const icon: mod.WorldIcon = mod.SpawnObject(
            mod.RuntimeSpawn_Common.WorldIcon,
            position,
            mod.CreateVector(0, 0, 0),
            mod.CreateVector(1, 1, 1)
        ) as mod.WorldIcon;
        if (!mod.IsValid(icon)) {
            log("worldicons", "spawn failed for " + loc.id);
            return;
        }
        mod.SetWorldIconOwner(icon, player);
        mod.SetWorldIconImage(icon, ICON_BY_KIND[loc.kind] || mod.WorldIconImages.Flag);
        mod.SetWorldIconColor(icon, mod.CreateVector(1, 0.78, 0.28));
        mod.SetWorldIconText(icon, mod.Message(loc.label));
        mod.EnableWorldIconImage(icon, true);
        mod.EnableWorldIconText(icon, true);
        highlightIcons[id] = icon;
    });
    if (added) {
        highlighted[id] = locationId;
        log("worldicons", "personal world-icon spawned pid=" + id + " location=" + locationId);
    }
}

function resolveParent(loc: StrategicLocation): mod.Object | undefined {
    if (!isConfigured(loc.parentId)) {
        return undefined;
    }
    try {
        let parent: mod.Object;
        if (loc.parentKind === "capturePoint") {
            parent = mod.GetCapturePoint(loc.parentId);
        } else if (loc.parentKind === "areaTrigger") {
            parent = mod.GetAreaTrigger(loc.parentId);
        } else {
            parent = mod.GetSpatialObject(loc.parentId);
        }
        return mod.IsValid(parent) ? parent : undefined;
    } catch (e) {
        return undefined;
    }
}

function labelForId(id: string): string {
    if (id === "bunker1") return "locBunker1";
    if (id === "bunker2") return "locBunker2";
    if (id === "bunker3") return "locBunker3";
    if (id === "site1") return "locSite1";
    if (id === "site2") return "locSite2";
    if (id === "site3") return "locSite3";
    if (id === "proto1") return "locProto";
    if (id === "war1") return "locWar1";
    if (id === "war2") return "locWar2";
    if (id === "air1") return "locAir";
    if (id === "naval1") return "locNaval1";
    if (id === "naval2") return "locNaval2";
    return id;
}

export function clearHighlight(player: mod.Player): void {
    const id: number = mod.GetObjId(player);
    const icon: mod.WorldIcon | undefined = highlightIcons[id];
    if (icon === undefined) {
        return;
    }
    safe("worldicons.clear", () => {
        if (mod.IsValid(icon)) {
            mod.UnspawnObject(icon);
        }
    });
    delete highlightIcons[id];
    delete highlighted[id];
}

export function allLocations(): StrategicLocation[] {
    return locations;
}

export function locationById(id: string): StrategicLocation | undefined {
    return byId[id];
}


// --- SOURCE: src\index.ts ---
// PowerStruggle HUD - v0.49



// Import for side effects only. Subscribes to OnPlayerDied/OnPlayerUndeploy/
// OnPlayerLeaveGame and force-triggers OnPlayerUndeploy for a player stuck in
// limbo for 30s, so a dropped engine event cannot leave a live HUD plus a stale
// deployed flag keeping the player in the nuke probe set. Both of our
// OnPlayerUndeploy handlers are idempotent, so the synthetic event is safe.
// Cost: one Uint32Array(100) and a 1 Hz timer that early-returns when no one is
// pending. Not combined with multi-click-detector, which would multiply the
// synthetic event across its own subscribers.



























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

const SITE_SLOTS_2: number = 3;

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

const CLUSTER: number = SITE * SITE_SLOTS_2 + SITE_GAP * (SITE_SLOTS_2 - 1);
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
          const p: any = playerById_2(id);
          if (p) {
              return mod.Message(isRorschInHand(p) ? "dbgRorschYes" : "dbgRorschNo");
          }
          return mod.Message("dbgAction");
      }
      if (act.substring(0, 4) === "loc:") {
          const p: any = playerById_2(id);
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
        const p: any = playerById_2(id);
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
    const p: any = playerById_2(id);
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
    const p: any = playerById_2(id);
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
        const p: any = playerById_2(id);
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
          const p: any = playerById_2(id);
          if (p) {
              const rep: string = debugWeaponReport(p);
              log("rorsch", "pid=" + id + " " + rep);
              pushPlayerFeed(p, isRorschInHand(p) ? "dbgRorschYes" : "dbgRorschNo", 0, 0);
          }
          return;
      }
      if (act.substring(0, 4) === "loc:") {
          const p: any = playerById_2(id);
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
        const p: any = playerById_2(id);
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
function playerById_2(id: number): mod.Player | undefined {
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
    for (let k: number = 0; k < SITE_SLOTS_2; k++) {
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

    const who: mod.Player | undefined = playerById_2(id);
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
        for (let k: number = 0; k < SITE_SLOTS_2; k++) {
            const lx: number = leftBase - (SITE_SLOTS_2 - 1 - k) * (SITE + SITE_GAP);
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
    const pl: mod.Player | undefined = playerById_2(id);
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
            const owner: any = playerById_2(id);
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

