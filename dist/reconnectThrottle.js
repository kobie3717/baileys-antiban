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
const DEFAULT_CONFIG = {
    enabled: false,
    rampDurationMs: 60_000,
    initialRateMultiplier: 0.1,
    rampSteps: 6,
    baselineRatePerMinute: null,
};
export class PostReconnectThrottle {
    config;
    throttledSince = null;
    throttledSendCount = 0;
    lifetimeReconnects = 0;
    rampTimer = null;
    currentStep = 0;
    // Tracking sends in current window
    sendsInCurrentWindow = 0;
    currentWindowStart = 0;
    WINDOW_DURATION_MS = 60_000; // 1 minute window
    constructor(config) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
            baselineRatePerMinute: config?.baselineRatePerMinute || null,
        };
    }
    /**
     * Call when connection is re-established. Starts throttle window.
     */
    onReconnect() {
        if (!this.config.enabled)
            return;
        this.throttledSince = Date.now();
        this.currentStep = 0;
        this.throttledSendCount = 0;
        this.lifetimeReconnects++;
        this.sendsInCurrentWindow = 0;
        this.currentWindowStart = Date.now();
        // Clear any existing ramp timer
        if (this.rampTimer) {
            clearTimeout(this.rampTimer);
        }
        // Set up ramp schedule
        this.scheduleNextRampStep();
    }
    /**
     * Call when connection drops (optional — reset state).
     */
    onDisconnect() {
        // Keep throttle state for now — it will expire naturally
        // This prevents rapid reconnect/disconnect cycles from resetting throttle too early
    }
    /**
     * Schedule the next ramp step
     */
    scheduleNextRampStep() {
        if (this.currentStep >= this.config.rampSteps) {
            // Ramp complete — no longer throttled
            this.throttledSince = null;
            this.rampTimer = null;
            return;
        }
        const stepDuration = this.config.rampDurationMs / this.config.rampSteps;
        this.rampTimer = setTimeout(() => {
            this.currentStep++;
            this.scheduleNextRampStep();
        }, stepDuration);
    }
    /**
     * Returns current rate multiplier (1.0 = no throttle)
     */
    getCurrentMultiplier() {
        if (!this.config.enabled || !this.throttledSince) {
            return 1.0;
        }
        const elapsed = Date.now() - this.throttledSince;
        if (elapsed >= this.config.rampDurationMs) {
            // Ramp complete
            return 1.0;
        }
        // Linear ramp from initialRateMultiplier to 1.0 across rampSteps
        const progress = this.currentStep / this.config.rampSteps;
        const multiplier = this.config.initialRateMultiplier +
            (1.0 - this.config.initialRateMultiplier) * progress;
        return Math.min(1.0, multiplier);
    }
    /**
     * Checks if a send should be gated. Returns {allowed, reason, retryAfterMs?}
     */
    beforeSend() {
        if (!this.config.enabled || !this.throttledSince) {
            return { allowed: true };
        }
        const now = Date.now();
        const multiplier = this.getCurrentMultiplier();
        // If fully ramped up, allow all sends
        if (multiplier >= 1.0) {
            this.throttledSince = null;
            return { allowed: true };
        }
        // Reset window if needed
        if (now - this.currentWindowStart >= this.WINDOW_DURATION_MS) {
            this.sendsInCurrentWindow = 0;
            this.currentWindowStart = now;
        }
        // Calculate budget for current window
        const baselineRate = this.config.baselineRatePerMinute ? this.config.baselineRatePerMinute() : 8;
        const allowedInWindow = Math.max(1, Math.floor(baselineRate * multiplier));
        // Check if we're over budget
        if (this.sendsInCurrentWindow >= allowedInWindow) {
            const windowRemaining = this.WINDOW_DURATION_MS - (now - this.currentWindowStart);
            return {
                allowed: false,
                reason: `Post-reconnect throttle: ${Math.floor(multiplier * 100)}% rate (${this.sendsInCurrentWindow}/${allowedInWindow} sends in window)`,
                retryAfterMs: windowRemaining,
            };
        }
        // Allow send and increment counter
        this.sendsInCurrentWindow++;
        this.throttledSendCount++;
        return { allowed: true };
    }
    /**
     * Get current stats
     */
    getStats() {
        const multiplier = this.getCurrentMultiplier();
        const isThrottled = this.throttledSince !== null && multiplier < 1.0;
        const remainingMs = isThrottled && this.throttledSince
            ? Math.max(0, this.config.rampDurationMs - (Date.now() - this.throttledSince))
            : 0;
        return {
            isThrottled,
            currentMultiplier: multiplier,
            throttledSinceMs: this.throttledSince,
            remainingMs,
            throttledSendCount: this.throttledSendCount,
            lifetimeReconnects: this.lifetimeReconnects,
        };
    }
    /**
     * Destroy and clean up timers
     */
    destroy() {
        if (this.rampTimer) {
            clearTimeout(this.rampTimer);
            this.rampTimer = null;
        }
        this.throttledSince = null;
    }
}
