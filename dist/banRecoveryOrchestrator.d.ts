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
    pauseDurationMs: number;
    resumeRateMultiplier: number;
    weeklyRampPercent: number;
    estimatedRecoveryDays: number;
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
    banCount30d: number;
    lastBanAt?: number;
}
export interface RecoveryStatus {
    phase: RecoveryPhase;
    rateMultiplier: number;
    pauseRemainingMs?: number;
    estimatedFullRecoveryDate?: number;
    recommendation: string;
    shouldReplaceNumber: boolean;
}
export declare class BanRecoveryOrchestrator {
    private config;
    private state;
    private plans;
    constructor(config?: BanRecoveryConfig);
    /**
     * Record a ban event and start recovery protocol
     */
    recordBanEvent(eventType: BanEventType): RecoveryStatus;
    /**
     * Get current recovery status (call before sending to check rate)
     */
    getStatus(): RecoveryStatus;
    /**
     * Current rate multiplier — multiply your normal limits by this
     */
    getRateMultiplier(): number;
    /**
     * Should be called daily/weekly to advance the ramp
     */
    tick(): void;
    /**
     * Classify a raw error into a BanEventType
     */
    static classifyError(err: unknown): BanEventType | null;
    /**
     * Serializable state for persistence
     */
    getState(): RecoveryState;
    /**
     * Restore from persisted state
     */
    static fromState(state: RecoveryState, config?: BanRecoveryConfig): BanRecoveryOrchestrator;
}
