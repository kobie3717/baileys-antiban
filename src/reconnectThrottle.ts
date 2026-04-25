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
  rampDurationMs?: number;      // default 60_000 (60s ramp-up)
  initialRateMultiplier?: number; // default 0.1 (10% of normal rate during first window)
  rampSteps?: number;           // default 6 (10% → 25% → 50% → 75% → 90% → 100%)
  baselineRatePerMinute?: () => number; // Optional getter for baseline rate from RateLimiter
}

export interface ReconnectThrottleStats {
  isThrottled: boolean;
  currentMultiplier: number;  // 0.1 to 1.0
  throttledSinceMs: number | null;
  remainingMs: number;        // ms until full rate restored
  throttledSendCount: number; // how many sends gated since last reconnect
  lifetimeReconnects: number;
}

const DEFAULT_CONFIG: Required<Omit<ReconnectThrottleConfig, 'baselineRatePerMinute'>> & { baselineRatePerMinute: (() => number) | null } = {
  enabled: false,
  rampDurationMs: 60_000,
  initialRateMultiplier: 0.1,
  rampSteps: 6,
  baselineRatePerMinute: null,
};

export class PostReconnectThrottle {
  private config: Required<Omit<ReconnectThrottleConfig, 'baselineRatePerMinute'>> & { baselineRatePerMinute: (() => number) | null };
  private throttledSince: number | null = null;
  private throttledSendCount = 0;
  private lifetimeReconnects = 0;
  private rampTimer: NodeJS.Timeout | null = null;
  private currentStep = 0;

  // Tracking sends in current window
  private sendsInCurrentWindow = 0;
  private currentWindowStart = 0;
  private readonly WINDOW_DURATION_MS = 60_000; // 1 minute window

  constructor(config?: ReconnectThrottleConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      baselineRatePerMinute: config?.baselineRatePerMinute || null,
    };
  }

  /**
   * Call when connection is re-established. Starts throttle window.
   */
  onReconnect(): void {
    if (!this.config.enabled) return;

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
  onDisconnect(): void {
    // Keep throttle state for now — it will expire naturally
    // This prevents rapid reconnect/disconnect cycles from resetting throttle too early
  }

  /**
   * Schedule the next ramp step
   */
  private scheduleNextRampStep(): void {
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
  getCurrentMultiplier(): number {
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
  beforeSend(): { allowed: boolean; reason?: string; retryAfterMs?: number } {
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
  getStats(): ReconnectThrottleStats {
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
  destroy(): void {
    if (this.rampTimer) {
      clearTimeout(this.rampTimer);
      this.rampTimer = null;
    }
    this.throttledSince = null;
  }
}
