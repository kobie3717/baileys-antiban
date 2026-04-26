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
export type CircadianProfile = 'default' | 'nightOwl' | 'earlyBird' | 'always_on';
export interface PresenceChoreographerConfig {
    /** Enable presence choreography (default: false — opt-in) */
    enabled?: boolean;
    /** Enable circadian rhythm enforcement (default: true when enabled) */
    enableCircadianRhythm?: boolean;
    /** IANA timezone for local hour calculation (default: 'UTC') */
    timezone?: string;
    /** Activity curve preset (default: 'office') */
    activityCurve?: 'office' | 'social' | 'global';
    /** Circadian timing configuration (default: enabled with 'default' profile) */
    circadian?: {
        enabled?: boolean;
        profile?: CircadianProfile;
        timezone?: string;
    };
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
export interface TypingPlanStep {
    state: 'composing' | 'paused';
    durationMs: number;
}
/**
 * Get circadian delay multiplier based on hour of day.
 * Returns a multiplier to apply to base delays (typing, presence, etc.).
 *
 * Multiplier ranges:
 * - Awake hours (09:00-22:00): ~0.8-1.2 (near baseline)
 * - Evening (22:00-00:00): 1.2 → 2.5
 * - Late night (00:00-02:00): 2.5 → 4.0
 * - Dead zone (02:00-06:00): 4.0-6.0 (peak slow)
 * - Early morning (06:00-09:00): 4.0 → 1.0
 *
 * Uses cosine-based smooth transitions (not stepped).
 *
 * @param date - Date to check (uses hour from this)
 * @param profile - Circadian profile ('default' | 'nightOwl' | 'earlyBird' | 'always_on')
 * @param timezone - IANA timezone (optional, defaults to local)
 * @returns Delay multiplier (0.5 = 2x faster, 2.0 = 2x slower, 5.0 = 5x slower)
 */
export declare function getCircadianMultiplier(date?: Date, profile?: CircadianProfile, timezone?: string): number;
export declare class PresenceChoreographer {
    private config;
    private stats;
    constructor(config?: PresenceChoreographerConfig);
    /**
     * Get current activity factor (0.1 to 1.0).
     * Higher = more active = shorter delays.
     * If circadian disabled, returns 1.0.
     */
    getCurrentActivityFactor(): number;
    /**
     * Check if should pause for distraction.
     * Returns { pause: true, durationMs: 600000 } if probability check passes.
     */
    shouldPauseForDistraction(): {
        pause: boolean;
        durationMs: number;
    };
    /**
     * Check if should take offline gap.
     * Returns { offline: true, durationMs: 600000 } if probability check passes.
     */
    shouldTakeOfflineGap(): {
        offline: boolean;
        durationMs: number;
    };
    /**
     * Check if should mark message as read.
     * Returns { mark: false } if skip probability hit.
     * Returns { mark: true, delayMs: 5000 } otherwise.
     * Applies circadian multiplier to delay.
     */
    shouldMarkRead(): {
        mark: boolean;
        delayMs: number;
    };
    /**
     * Compute realistic typing duration for a message of given length.
     * Includes Gaussian WPM variance + think-pause injection + circadian timing multiplier.
     * Returns a "typing plan": array of { state, durationMs } steps the caller should execute sequentially.
     *
     *   plan = [
     *     { state: 'composing', durationMs: 4200 },
     *     { state: 'paused',    durationMs: 950 },   // think pause
     *     { state: 'composing', durationMs: 6800 },
     *     { state: 'paused',    durationMs: 600 },   // brief stop before send
     *   ]
     */
    computeTypingPlan(messageLength: number): TypingPlanStep[];
    /**
     * Execute a typing plan against a Baileys-shaped sock with sendPresenceUpdate(state, jid).
     * Awaits each step's duration. Updates stats.
     *
     *   await choreo.executeTypingPlan(sock, jid, plan);
     *   await sock.sendMessage(jid, content);
     */
    executeTypingPlan(sock: {
        sendPresenceUpdate: (state: string, jid: string) => Promise<void> | void;
    }, jid: string, plan: TypingPlanStep[], options?: {
        signal?: AbortSignal;
    }): Promise<void>;
    /**
     * Get statistics.
     */
    getStats(): PresenceChoreographerStats;
    /**
     * Reset statistics.
     */
    reset(): void;
    private getLocalHour;
    private randomBetween;
    private clamp;
    /**
     * Generate Gaussian sample using Box-Muller transform.
     * Returns a sample from N(mean, stdDev).
     */
    private gaussianSample;
    private sleep;
}
