/**
 * WarmUp — Gradual activity increase for new/reconnected numbers
 *
 * New numbers or numbers reconnecting after a break are under extra scrutiny.
 * This module enforces a gradual ramp-up of messaging activity.
 *
 * WhatsApp flags:
 * - New numbers sending many messages immediately
 * - Numbers going from 0 to 100 messages/day overnight
 * - Sudden pattern changes after period of inactivity
 */
export interface WarmUpConfig {
    /** Number of warm-up days (default: 7) */
    warmUpDays: number;
    /** Messages allowed on day 1 (default: 20) */
    day1Limit: number;
    /** Growth factor per day (default: 1.8 — roughly doubles daily) */
    growthFactor: number;
    /** Hours of inactivity before re-entering warm-up (default: 72) */
    inactivityThresholdHours: number;
}
export interface WarmUpState {
    /** When warm-up started */
    startedAt: number;
    /** Last message timestamp */
    lastActiveAt: number;
    /** Messages sent per day [day0count, day1count, ...] */
    dailyCounts: number[];
    /** Whether warm-up is complete */
    graduated: boolean;
}
export interface WarmUpStatus {
    phase: 'warming' | 'graduated';
    day: number;
    totalDays: number;
    todayLimit: number;
    todaySent: number;
    progress: number;
}
export declare class WarmUp {
    private config;
    private state;
    constructor(config?: Partial<WarmUpConfig>, existingState?: WarmUpState);
    /**
     * Get the current daily message limit based on warm-up phase
     */
    getDailyLimit(): number;
    /**
     * Check if a message can be sent (within warm-up limits)
     */
    canSend(): boolean;
    /**
     * Record a sent message
     */
    record(): void;
    /**
     * Get current warm-up status
     */
    getStatus(): WarmUpStatus;
    /**
     * Export state for persistence
     */
    exportState(): WarmUpState;
    /**
     * Reset warm-up (e.g., after detected ban risk)
     */
    reset(): void;
    private getCurrentDay;
    private checkInactivity;
    private freshState;
}
