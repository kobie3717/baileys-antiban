/**
 * BanRecoveryOrchestrator — Structured recovery after ban/restriction events
 *
 * When WhatsApp restricts your account, the worst thing to do is immediately
 * resume normal activity. This module provides a evidence-based recovery protocol:
 *
 * - Timelocked (reachout_restricted): 24h pause, resume at 10% rate, ramp 15%/week
 * - Rate-overlimit (429): 4h pause, resume at 25% rate, ramp 25%/week
 * - Soft-ban (repeated disconnects): 48h pause, resume at 5% rate, ramp 10%/week
 * - Hard-ban (loggedOut): account is dead, signal for replacement
 *
 * Based on observed recovery times from community reports. Not guaranteed —
 * WA's enforcement is non-deterministic. Treat as best-effort guidance.
 */

export type BanEventType = 'timelock' | 'rate_overlimit' | 'soft_ban' | 'hard_ban';
export type RecoveryPhase = 'paused' | 'recovering' | 'ramping' | 'graduated' | 'dead';

export interface RecoveryPlan {
  eventType: BanEventType;
  pauseDurationMs: number;       // Initial silence period
  resumeRateMultiplier: number;  // 0.1 = 10% of normal rate
  weeklyRampPercent: number;     // How much to increase each week
  estimatedRecoveryDays: number; // Conservative estimate
  description: string;
}

export interface BanRecoveryConfig {
  /** Custom recovery plans per event type (overrides defaults) */
  plans?: Partial<Record<BanEventType, Partial<RecoveryPlan>>>;
  /** Called when recovery phase changes */
  onPhaseChange?: (phase: RecoveryPhase, plan: RecoveryPlan) => void;
  /** Called when account appears dead (hard ban) — signal to replace SIM */
  onHardBan?: () => void;
  /** Max weeks before giving up on recovery and declaring dead (default: 8) */
  maxRecoveryWeeks?: number;
}

export interface RecoveryState {
  active: boolean;
  eventType?: BanEventType;
  phase: RecoveryPhase;
  banDetectedAt?: number;
  pauseUntil?: number;
  currentRateMultiplier: number;
  weeksSinceResume: number;
  banCount30d: number;         // bans in last 30 days
  lastBanAt?: number;
}

export interface RecoveryStatus {
  phase: RecoveryPhase;
  rateMultiplier: number;        // Current allowed rate as fraction (0-1)
  pauseRemainingMs?: number;     // ms until pause ends
  estimatedFullRecoveryDate?: number;
  recommendation: string;
  shouldReplaceNumber: boolean;  // true if hard ban or 3+ bans in 30 days
}

const DEFAULT_PLANS: Record<BanEventType, RecoveryPlan> = {
  timelock: {
    eventType: 'timelock',
    pauseDurationMs: 24 * 60 * 60 * 1000,  // 24 hours
    resumeRateMultiplier: 0.10,             // 10% of normal
    weeklyRampPercent: 15,                  // +15% per week
    estimatedRecoveryDays: 14,
    description: 'WA reachout timelock — 24h pause then slow ramp',
  },
  rate_overlimit: {
    eventType: 'rate_overlimit',
    pauseDurationMs: 4 * 60 * 60 * 1000,   // 4 hours
    resumeRateMultiplier: 0.25,             // 25% of normal
    weeklyRampPercent: 25,                  // +25% per week
    estimatedRecoveryDays: 7,
    description: 'Rate limit hit — 4h pause then moderate ramp',
  },
  soft_ban: {
    eventType: 'soft_ban',
    pauseDurationMs: 48 * 60 * 60 * 1000,  // 48 hours
    resumeRateMultiplier: 0.05,             // 5% of normal
    weeklyRampPercent: 10,                  // +10% per week
    estimatedRecoveryDays: 21,
    description: 'Soft ban detected — 48h pause then very slow ramp',
  },
  hard_ban: {
    eventType: 'hard_ban',
    pauseDurationMs: Infinity,
    resumeRateMultiplier: 0,
    weeklyRampPercent: 0,
    estimatedRecoveryDays: Infinity,
    description: 'Hard ban — number is dead, replace SIM',
  },
};

export class BanRecoveryOrchestrator {
  private config: Required<BanRecoveryConfig>;
  private state: RecoveryState;
  private plans: Record<BanEventType, RecoveryPlan>;

  constructor(config: BanRecoveryConfig = {}) {
    this.config = {
      plans: config.plans || {},
      onPhaseChange: config.onPhaseChange || (() => {}),
      onHardBan: config.onHardBan || (() => {}),
      maxRecoveryWeeks: config.maxRecoveryWeeks ?? 8,
    };

    // Merge custom plans with defaults
    this.plans = { ...DEFAULT_PLANS };
    if (config.plans) {
      for (const eventType in config.plans) {
        const customPlan = config.plans[eventType as BanEventType];
        if (customPlan) {
          this.plans[eventType as BanEventType] = {
            ...this.plans[eventType as BanEventType],
            ...customPlan,
          };
        }
      }
    }

    this.state = {
      active: false,
      phase: 'graduated',
      currentRateMultiplier: 1.0,
      weeksSinceResume: 0,
      banCount30d: 0,
    };
  }

  /**
   * Record a ban event and start recovery protocol
   */
  recordBanEvent(eventType: BanEventType): RecoveryStatus {
    const now = Date.now();
    const plan = this.plans[eventType];

    // Update ban count (reset if >30 days since last ban)
    if (this.state.lastBanAt) {
      const daysSinceLastBan = (now - this.state.lastBanAt) / (86400000);
      if (daysSinceLastBan > 30) {
        this.state.banCount30d = 0;
      }
    }

    this.state.banCount30d++;
    this.state.lastBanAt = now;

    // Upgrade to hard_ban if 3+ bans in 30 days (unless already hard_ban)
    if (this.state.banCount30d >= 3 && eventType !== 'hard_ban') {
      eventType = 'hard_ban';
    }

    this.state.active = true;
    this.state.eventType = eventType;
    this.state.banDetectedAt = now;
    this.state.pauseUntil = plan.pauseDurationMs === Infinity ? Infinity : now + plan.pauseDurationMs;
    this.state.currentRateMultiplier = plan.resumeRateMultiplier;
    this.state.weeksSinceResume = 0;
    this.state.phase = eventType === 'hard_ban' ? 'dead' : 'paused';

    this.config.onPhaseChange(this.state.phase, plan);

    if (eventType === 'hard_ban') {
      this.config.onHardBan();
    }

    return this.getStatus();
  }

  /**
   * Get current recovery status (call before sending to check rate)
   */
  getStatus(): RecoveryStatus {
    if (!this.state.active || !this.state.eventType) {
      return {
        phase: 'graduated',
        rateMultiplier: 1.0,
        recommendation: 'No active recovery — operating normally',
        shouldReplaceNumber: false,
      };
    }

    const now = Date.now();
    const plan = this.plans[this.state.eventType];

    // Check if pause period has ended
    if (this.state.phase === 'paused' && this.state.pauseUntil !== undefined && this.state.pauseUntil !== Infinity && now >= this.state.pauseUntil) {
      this.state.phase = 'recovering';
      this.config.onPhaseChange(this.state.phase, plan);
    }

    // Check if we've exceeded max recovery weeks (give up)
    if (this.state.phase === 'recovering' || this.state.phase === 'ramping') {
      if (this.state.weeksSinceResume >= this.config.maxRecoveryWeeks) {
        this.state.phase = 'dead';
        this.config.onPhaseChange(this.state.phase, plan);
        this.config.onHardBan();
      }
    }

    const shouldReplaceNumber = this.state.phase === 'dead' || this.state.banCount30d >= 3;

    let recommendation: string;
    switch (this.state.phase) {
      case 'dead':
        recommendation = 'Account is permanently restricted. Replace number and start fresh.';
        break;
      case 'paused':
        if (this.state.pauseUntil === Infinity) {
          recommendation = 'Account is dead. Do not attempt to send messages.';
        } else {
          const remainingMs = this.state.pauseUntil! - now;
          const remainingHours = Math.ceil(remainingMs / 3600000);
          recommendation = `Pause period active. Wait ${remainingHours}h before resuming. ${plan.description}`;
        }
        break;
      case 'recovering':
        recommendation = `Recovery phase. Operating at ${Math.round(this.state.currentRateMultiplier * 100)}% capacity. Ramp: ${plan.weeklyRampPercent}%/week.`;
        break;
      case 'ramping':
        recommendation = `Ramping phase. Operating at ${Math.round(this.state.currentRateMultiplier * 100)}% capacity. Ramp: ${plan.weeklyRampPercent}%/week.`;
        break;
      case 'graduated':
        recommendation = 'Recovery complete. Operating at full capacity.';
        break;
    }

    const pauseRemainingMs = this.state.pauseUntil !== undefined && this.state.pauseUntil !== Infinity && now < this.state.pauseUntil
      ? this.state.pauseUntil - now
      : undefined;

    let estimatedFullRecoveryDate: number | undefined;
    if (this.state.phase === 'recovering' || this.state.phase === 'ramping') {
      const rateToGain = 1.0 - this.state.currentRateMultiplier;
      const weeksNeeded = Math.ceil((rateToGain / (plan.weeklyRampPercent / 100)) * (1 / this.state.currentRateMultiplier));
      estimatedFullRecoveryDate = now + weeksNeeded * 7 * 86400000;
    }

    return {
      phase: this.state.phase,
      rateMultiplier: this.state.currentRateMultiplier,
      pauseRemainingMs,
      estimatedFullRecoveryDate,
      recommendation,
      shouldReplaceNumber,
    };
  }

  /**
   * Current rate multiplier — multiply your normal limits by this
   */
  getRateMultiplier(): number {
    return this.state.currentRateMultiplier;
  }

  /**
   * Should be called daily/weekly to advance the ramp
   */
  tick(): void {
    if (!this.state.active || !this.state.eventType) {
      return;
    }

    const now = Date.now();
    const plan = this.plans[this.state.eventType];

    // Transition from paused to recovering
    if (this.state.phase === 'paused' && this.state.pauseUntil !== undefined && this.state.pauseUntil !== Infinity && now >= this.state.pauseUntil) {
      this.state.phase = 'recovering';
      this.config.onPhaseChange(this.state.phase, plan);
    }

    // Advance the ramp if in recovering/ramping phase
    if (this.state.phase === 'recovering' || this.state.phase === 'ramping') {
      this.state.weeksSinceResume++;

      // Check if exceeded max recovery weeks
      if (this.state.weeksSinceResume >= this.config.maxRecoveryWeeks) {
        this.state.phase = 'dead';
        this.state.currentRateMultiplier = 0;
        this.config.onPhaseChange(this.state.phase, plan);
        this.config.onHardBan();
        return;
      }

      // Apply weekly ramp
      const rampMultiplier = 1 + (plan.weeklyRampPercent / 100);
      const newMultiplier = this.state.currentRateMultiplier * rampMultiplier;

      if (newMultiplier >= 1.0) {
        // Graduated
        this.state.currentRateMultiplier = 1.0;
        this.state.phase = 'graduated';
        this.state.active = false;
        this.config.onPhaseChange(this.state.phase, plan);
      } else {
        // Still ramping
        this.state.currentRateMultiplier = newMultiplier;
        this.state.phase = 'ramping';
      }
    }
  }

  /**
   * Classify a raw error into a BanEventType
   */
  static classifyError(err: unknown): BanEventType | null {
    if (!err) return null;

    const errorStr = String(err).toLowerCase();
    const errorMsg = (err as any).message?.toLowerCase() || '';
    const errorCode = (err as any).code || '';

    // Timelock patterns
    if (
      errorStr.includes('reachout') ||
      errorStr.includes('account_reachout_restricted') ||
      errorMsg.includes('reachout') ||
      errorCode === 463 ||
      errorCode === '463'
    ) {
      return 'timelock';
    }

    // Rate overlimit patterns
    if (
      errorStr.includes('rate-overlimit') ||
      errorStr.includes('rate_overlimit') ||
      errorStr.includes('429') ||
      errorCode === 429 ||
      errorCode === '429'
    ) {
      return 'rate_overlimit';
    }

    // Hard ban patterns
    if (
      errorStr.includes('loggedout') ||
      errorStr.includes('logged_out') ||
      errorStr.includes('logged out') ||
      errorMsg.includes('loggedout') ||
      errorCode === 401 ||
      errorCode === '401'
    ) {
      return 'hard_ban';
    }

    // Note: soft_ban detection requires context (multiple disconnects)
    // and should be determined by the caller using HealthMonitor

    return null;
  }

  /**
   * Serializable state for persistence
   */
  getState(): RecoveryState {
    return { ...this.state };
  }

  /**
   * Restore from persisted state
   */
  static fromState(state: RecoveryState, config?: BanRecoveryConfig): BanRecoveryOrchestrator {
    const orchestrator = new BanRecoveryOrchestrator(config);
    orchestrator.state = { ...state };
    return orchestrator;
  }
}
