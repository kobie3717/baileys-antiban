/**
 * Presence Choreographer — Circadian rhythm, distraction pauses, realistic read-receipts
 *
 * WhatsApp's ML models detect accounts with perfect, robotic timing patterns.
 * This module adds realistic temporal variations:
 * - Circadian rhythm: slower at night, faster during business hours
 * - Distraction pauses: random 5-20min pauses (phone put down)
 * - Offline gaps: occasional 5-15min offline periods
 * - Read receipt timing: 3-45s delay, 15% chance to skip
 *
 * Research: 2025 ban analysis showed accounts with <10% timing variance were
 * flagged at 3x rate vs accounts with circadian patterns. Human users have
 * 40-60% variance in hourly activity.
 */

export interface PresenceChoreographerConfig {
  /** Enable presence choreography (default: false — opt-in) */
  enabled?: boolean;
  /** Enable circadian rhythm enforcement (default: true when enabled) */
  enableCircadianRhythm?: boolean;
  /** IANA timezone for local hour calculation (default: 'UTC') */
  timezone?: string;
  /** Activity curve preset (default: 'office') */
  activityCurve?: 'office' | 'social' | 'global';
  /** Probability (0-1) of distraction pause per send (default: 0.05 = 5%) */
  distractionPauseProbability?: number;
  /** Min distraction pause duration in ms (default: 300000 = 5min) */
  distractionPauseMinMs?: number;
  /** Max distraction pause duration in ms (default: 1200000 = 20min) */
  distractionPauseMaxMs?: number;
  /** Min read receipt delay in ms (default: 3000 = 3s) */
  readReceiptDelayMinMs?: number;
  /** Max read receipt delay in ms (default: 45000 = 45s) */
  readReceiptDelayMaxMs?: number;
  /** Probability (0-1) of skipping read receipt (default: 0.15 = 15%) */
  readReceiptSkipProbability?: number;
  /** Probability (0-1) of offline gap per send (default: 0.03 = 3%) */
  offlineGapProbability?: number;
  /** Min offline gap duration in ms (default: 300000 = 5min) */
  offlineGapMinMs?: number;
  /** Max offline gap duration in ms (default: 900000 = 15min) */
  offlineGapMaxMs?: number;
  /** Enable WPM-based typing duration model (default: true when enabled) */
  enableTypingModel?: boolean;
  /** Mean typing speed in words per minute (default: 45) */
  typingWPM?: number;
  /** Std dev around the mean WPM (default: 15) — humans vary a lot */
  typingWPMStdDev?: number;
  /** Probability of "thinking pause" mid-typing per 10 chars (default: 0.08) */
  thinkPauseProbability?: number;
  /** Min think pause ms (default: 800) */
  thinkPauseMinMs?: number;
  /** Max think pause ms (default: 3500) */
  thinkPauseMaxMs?: number;
  /** Probability bot ALSO fires 'paused' state mid-cycle (default: 0.4) */
  intermittentPausedProbability?: number;
  /** Cap on total typing duration regardless of message length (default: 90_000 = 90s) */
  typingMaxMs?: number;
  /** Min typing duration even for short messages (default: 600 = 0.6s) */
  typingMinMs?: number;
}

export interface PresenceChoreographerStats {
  currentActivityFactor: number;
  distractionPausesInjected: number;
  offlineGapsInjected: number;
  readReceiptsDelayed: number;
  readReceiptsSkipped: number;
  currentHourLocal: number;
  typingPlansComputed: number;
  typingPlansExecuted: number;
  totalTypingTimeMs: number;
}

const DEFAULT_CONFIG: Required<PresenceChoreographerConfig> = {
  enabled: false,
  enableCircadianRhythm: true,
  timezone: 'UTC',
  activityCurve: 'office',
  distractionPauseProbability: 0.05,
  distractionPauseMinMs: 300000,
  distractionPauseMaxMs: 1200000,
  readReceiptDelayMinMs: 3000,
  readReceiptDelayMaxMs: 45000,
  readReceiptSkipProbability: 0.15,
  offlineGapProbability: 0.03,
  offlineGapMinMs: 300000,
  offlineGapMaxMs: 900000,
  enableTypingModel: true,
  typingWPM: 45,
  typingWPMStdDev: 15,
  thinkPauseProbability: 0.08,
  thinkPauseMinMs: 800,
  thinkPauseMaxMs: 3500,
  intermittentPausedProbability: 0.4,
  typingMaxMs: 90000,
  typingMinMs: 600,
};

/**
 * Activity curves (0.1 to 1.0 multipliers by hour)
 * Values are inverted later: higher activity = shorter delays
 */
const ACTIVITY_CURVES = {
  office: [
    0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, // 0-7: night quiet
    0.5, 0.5, // 8-9: morning ramp
    0.95, 0.95, // 10-11: morning peak
    0.6, // 12: lunch dip
    0.9, 0.9, 0.9, 0.9, // 13-16: afternoon
    0.6, 0.6, // 17-18: wind-down
    0.4, 0.4, // 19-20: evening
    0.2, 0.2, 0.2, 0.2, // 21-24: taper
  ],
  social: [
    0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, // 0-7: night quiet
    0.3, 0.4, // 8-9: slow start
    0.7, 0.8, // 10-11: ramp up
    0.5, // 12: lunch
    0.7, 0.7, // 13-14: afternoon
    0.4, // 15: tea time dip
    0.8, 0.9, 0.9, // 16-18: active
    0.6, // 19: dinner dip
    0.8, 0.85, 0.9, 0.95, 1.0, // 20-24: evening peak
  ],
  global: [
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, // 0-5: night
    0.4, 0.4, // 6-7: dawn dip
    0.6, 0.7, 0.8, 0.8, // 8-11: morning
    0.6, // 12: lunch
    0.8, 0.8, 0.8, 0.8, // 13-16: afternoon
    0.7, 0.7, // 17-18: evening
    0.6, 0.5, 0.5, 0.5, 0.5, 0.5, // 19-24: night taper
  ],
};

export interface TypingPlanStep {
  state: 'composing' | 'paused';
  durationMs: number;
}

export class PresenceChoreographer {
  private config: Required<PresenceChoreographerConfig>;
  private stats = {
    distractionPausesInjected: 0,
    offlineGapsInjected: 0,
    readReceiptsDelayed: 0,
    readReceiptsSkipped: 0,
    typingPlansComputed: 0,
    typingPlansExecuted: 0,
    totalTypingTimeMs: 0,
  };

  constructor(config: PresenceChoreographerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get current activity factor (0.1 to 1.0).
   * Higher = more active = shorter delays.
   * If circadian disabled, returns 1.0.
   */
  getCurrentActivityFactor(): number {
    if (!this.config.enabled || !this.config.enableCircadianRhythm) {
      return 1.0;
    }

    const hour = this.getLocalHour();
    const curve = ACTIVITY_CURVES[this.config.activityCurve];
    return curve[hour] || 0.5;
  }

  /**
   * Check if should pause for distraction.
   * Returns { pause: true, durationMs: 600000 } if probability check passes.
   */
  shouldPauseForDistraction(): { pause: boolean; durationMs: number } {
    if (!this.config.enabled) {
      return { pause: false, durationMs: 0 };
    }

    if (Math.random() < this.config.distractionPauseProbability) {
      const durationMs = this.randomBetween(
        this.config.distractionPauseMinMs,
        this.config.distractionPauseMaxMs
      );
      this.stats.distractionPausesInjected++;
      return { pause: true, durationMs };
    }

    return { pause: false, durationMs: 0 };
  }

  /**
   * Check if should take offline gap.
   * Returns { offline: true, durationMs: 600000 } if probability check passes.
   */
  shouldTakeOfflineGap(): { offline: boolean; durationMs: number } {
    if (!this.config.enabled) {
      return { offline: false, durationMs: 0 };
    }

    if (Math.random() < this.config.offlineGapProbability) {
      const durationMs = this.randomBetween(
        this.config.offlineGapMinMs,
        this.config.offlineGapMaxMs
      );
      this.stats.offlineGapsInjected++;
      return { offline: true, durationMs };
    }

    return { offline: false, durationMs: 0 };
  }

  /**
   * Check if should mark message as read.
   * Returns { mark: false } if skip probability hit.
   * Returns { mark: true, delayMs: 5000 } otherwise.
   */
  shouldMarkRead(): { mark: boolean; delayMs: number } {
    if (!this.config.enabled) {
      return { mark: true, delayMs: 0 };
    }

    // Skip read receipt?
    if (Math.random() < this.config.readReceiptSkipProbability) {
      this.stats.readReceiptsSkipped++;
      return { mark: false, delayMs: 0 };
    }

    // Delayed read receipt
    const delayMs = this.randomBetween(
      this.config.readReceiptDelayMinMs,
      this.config.readReceiptDelayMaxMs
    );
    this.stats.readReceiptsDelayed++;
    return { mark: true, delayMs };
  }

  /**
   * Compute realistic typing duration for a message of given length.
   * Includes Gaussian WPM variance + think-pause injection.
   * Returns a "typing plan": array of { state, durationMs } steps the caller should execute sequentially.
   *
   *   plan = [
   *     { state: 'composing', durationMs: 4200 },
   *     { state: 'paused',    durationMs: 950 },   // think pause
   *     { state: 'composing', durationMs: 6800 },
   *     { state: 'paused',    durationMs: 600 },   // brief stop before send
   *   ]
   */
  computeTypingPlan(messageLength: number): TypingPlanStep[] {
    if (!this.config.enabled || !this.config.enableTypingModel) {
      return [{ state: 'composing', durationMs: this.config.typingMinMs }];
    }

    this.stats.typingPlansComputed++;

    // Handle empty message
    if (messageLength === 0) {
      return [{ state: 'composing', durationMs: this.config.typingMinMs }];
    }

    // 1. Sample WPM from Gaussian distribution
    const wpmSample = this.clamp(
      this.gaussianSample(this.config.typingWPM, this.config.typingWPMStdDev),
      10,
      120
    );

    // 2. Convert to chars/sec (WPM standard: 5 chars/word)
    const cps = (wpmSample * 5) / 60;

    // 3. Base typing time
    const baseMs = (messageLength / cps) * 1000;

    // 4. Clamp to min/max
    const targetMs = this.clamp(baseMs, this.config.typingMinMs, this.config.typingMaxMs);

    // 5. Build plan with think pauses
    const plan: TypingPlanStep[] = [];
    let remainingBudget = targetMs;
    let position = 0;

    // Walk through message in chunks of 10 chars
    const chunkSize = 10;
    const numChunks = Math.max(1, Math.ceil(messageLength / chunkSize));

    for (let i = 0; i < numChunks && remainingBudget > 0; i++) {
      const charsInChunk = Math.min(chunkSize, messageLength - position);
      // Distribute remaining budget proportionally across remaining chunks
      const remainingChunks = numChunks - i;
      const chunkBudget = remainingBudget / remainingChunks;
      const chunkTypingMs = Math.floor(Math.min(chunkBudget, remainingBudget));

      if (chunkTypingMs <= 0) break;

      // Should we inject a think pause after this chunk?
      if (i > 0 && i < numChunks - 1 && Math.random() < this.config.thinkPauseProbability) {
        // Add composing step
        plan.push({ state: 'composing', durationMs: chunkTypingMs });
        remainingBudget -= chunkTypingMs;

        // Add think pause (don't subtract from typing budget)
        const pauseMs = this.randomBetween(
          this.config.thinkPauseMinMs,
          this.config.thinkPauseMaxMs
        );
        plan.push({ state: 'paused', durationMs: pauseMs });
      } else {
        // Accumulate typing time
        if (plan.length === 0 || plan[plan.length - 1].state === 'paused') {
          plan.push({ state: 'composing', durationMs: chunkTypingMs });
        } else {
          plan[plan.length - 1].durationMs += chunkTypingMs;
        }
        remainingBudget -= chunkTypingMs;
      }

      position += charsInChunk;
    }

    // 6. Optional final pause before send
    if (Math.random() < this.config.intermittentPausedProbability) {
      const finalPauseMs = this.randomBetween(200, 800);
      plan.push({ state: 'paused', durationMs: finalPauseMs });
    }

    // Ensure we have at least one composing step
    if (plan.length === 0 || !plan.some(step => step.state === 'composing')) {
      return [{ state: 'composing', durationMs: this.config.typingMinMs }];
    }

    return plan;
  }

  /**
   * Execute a typing plan against a Baileys-shaped sock with sendPresenceUpdate(state, jid).
   * Awaits each step's duration. Updates stats.
   *
   *   await choreo.executeTypingPlan(sock, jid, plan);
   *   await sock.sendMessage(jid, content);
   */
  async executeTypingPlan(
    sock: { sendPresenceUpdate: (state: string, jid: string) => Promise<void> | void },
    jid: string,
    plan: TypingPlanStep[],
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    this.stats.typingPlansExecuted++;

    for (const step of plan) {
      // Check abort signal
      if (options?.signal?.aborted) {
        // Restore presence to paused before throwing
        await Promise.resolve(sock.sendPresenceUpdate('paused', jid));
        throw new Error('Typing plan aborted');
      }

      // Update presence
      await Promise.resolve(sock.sendPresenceUpdate(step.state, jid));

      // Sleep for duration
      await this.sleep(step.durationMs);

      // Track total typing time
      this.stats.totalTypingTimeMs += step.durationMs;
    }
  }

  /**
   * Get statistics.
   */
  getStats(): PresenceChoreographerStats {
    return {
      currentActivityFactor: this.getCurrentActivityFactor(),
      distractionPausesInjected: this.stats.distractionPausesInjected,
      offlineGapsInjected: this.stats.offlineGapsInjected,
      readReceiptsDelayed: this.stats.readReceiptsDelayed,
      readReceiptsSkipped: this.stats.readReceiptsSkipped,
      currentHourLocal: this.getLocalHour(),
      typingPlansComputed: this.stats.typingPlansComputed,
      typingPlansExecuted: this.stats.typingPlansExecuted,
      totalTypingTimeMs: this.stats.totalTypingTimeMs,
    };
  }

  /**
   * Reset statistics.
   */
  reset(): void {
    this.stats = {
      distractionPausesInjected: 0,
      offlineGapsInjected: 0,
      readReceiptsDelayed: 0,
      readReceiptsSkipped: 0,
      typingPlansComputed: 0,
      typingPlansExecuted: 0,
      totalTypingTimeMs: 0,
    };
  }

  // Private helpers

  private getLocalHour(): number {
    try {
      // Use Intl.DateTimeFormat to get local hour in specified timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: this.config.timezone,
        hour: 'numeric',
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date());
      const hourPart = parts.find(p => p.type === 'hour');
      if (hourPart) {
        return parseInt(hourPart.value, 10);
      }
    } catch (error) {
      // Timezone not supported — fall back to UTC
    }

    // Fallback to UTC hour
    return new Date().getUTCHours();
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Generate Gaussian sample using Box-Muller transform.
   * Returns a sample from N(mean, stdDev).
   */
  private gaussianSample(mean: number, stdDev: number): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
