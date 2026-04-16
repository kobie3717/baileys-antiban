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
}
export interface PresenceChoreographerStats {
    currentActivityFactor: number;
    distractionPausesInjected: number;
    offlineGapsInjected: number;
    readReceiptsDelayed: number;
    readReceiptsSkipped: number;
    currentHourLocal: number;
}
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
     */
    shouldMarkRead(): {
        mark: boolean;
        delayMs: number;
    };
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
}
