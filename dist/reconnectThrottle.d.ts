/**
 * PostReconnectThrottle — Throttle outbound messages after reconnection
 *
 * Inspired by whatsapp-rust's client/sessions.rs which uses semaphore=1 during
 * offline sync (serializes all processing), then swaps to semaphore=64 when sync
 * completes. This prevents burst-floods on reconnect that trigger WA rate limits.
 *
 * In middleware layer: on reconnect, enter a throttled window where beforeSend()
 * gates outbound messages to an artificially low rate, then ramps back to normal
 * over a configurable period.
 *
 * Usage:
 *   const throttle = new PostReconnectThrottle({
 *     enabled: true,
 *     rampDurationMs: 60_000,
 *     initialRateMultiplier: 0.1,
 *   });
 *
 *   // On connection.update with connection === 'open':
 *   throttle.onReconnect();
 *
 *   // Before sending:
 *   const decision = throttle.beforeSend();
 *   if (!decision.allowed) {
 *     // Wait decision.retryAfterMs
 *   }
 *
 *   // Get current throttle multiplier (1.0 = no throttle):
 *   const multiplier = throttle.getCurrentMultiplier();
 */
export interface ReconnectThrottleConfig {
    enabled?: boolean;
    rampDurationMs?: number;
    initialRateMultiplier?: number;
    rampSteps?: number;
    baselineRatePerMinute?: () => number;
}
export interface ReconnectThrottleStats {
    isThrottled: boolean;
    currentMultiplier: number;
    throttledSinceMs: number | null;
    remainingMs: number;
    throttledSendCount: number;
    lifetimeReconnects: number;
}
export declare class PostReconnectThrottle {
    private config;
    private throttledSince;
    private throttledSendCount;
    private lifetimeReconnects;
    private rampTimer;
    private currentStep;
    private sendsInCurrentWindow;
    private currentWindowStart;
    private readonly WINDOW_DURATION_MS;
    constructor(config?: ReconnectThrottleConfig);
    /**
     * Call when connection is re-established. Starts throttle window.
     */
    onReconnect(): void;
    /**
     * Call when connection drops (optional — reset state).
     */
    onDisconnect(): void;
    /**
     * Schedule the next ramp step
     */
    private scheduleNextRampStep;
    /**
     * Returns current rate multiplier (1.0 = no throttle)
     */
    getCurrentMultiplier(): number;
    /**
     * Checks if a send should be gated. Returns {allowed, reason, retryAfterMs?}
     */
    beforeSend(): {
        allowed: boolean;
        reason?: string;
        retryAfterMs?: number;
    };
    /**
     * Get current stats
     */
    getStats(): ReconnectThrottleStats;
    /**
     * Destroy and clean up timers
     */
    destroy(): void;
}
