/**
 * Smart Scheduler — Send messages during safe hours only
 *
 * WhatsApp is more suspicious of messages sent at 3 AM.
 * This module ensures messages go out during "business hours"
 * and adds realistic daily activity patterns.
 */
export interface SchedulerConfig {
    /** Timezone (default: UTC) */
    timezone: string;
    /** Active hours [start, end] in 24h format (default: [8, 21]) */
    activeHours: [number, number];
    /** Reduce rate on weekends (default: 0.5 — half rate) */
    weekendFactor: number;
    /** Peak hours get slightly faster sending [start, end] (default: [10, 14]) */
    peakHours: [number, number];
    /** Peak hour speed multiplier (default: 1.3) */
    peakFactor: number;
    /** Lunch break — slight slowdown [start, end] (default: [12, 13]) */
    lunchBreak: [number, number];
    /** Lunch break speed factor (default: 0.5) */
    lunchFactor: number;
}
export declare class Scheduler {
    private config;
    constructor(config?: Partial<SchedulerConfig>);
    /**
     * Check if now is within active hours
     */
    isActiveTime(): boolean;
    /**
     * Get the speed multiplier for current time
     * > 1 = faster, < 1 = slower, 0 = don't send
     */
    getSpeedFactor(): number;
    /**
     * Get ms until next active window
     */
    msUntilActive(): number;
    /**
     * Adjust a delay based on current time factors
     */
    adjustDelay(baseDelayMs: number): number;
    /**
     * Get current schedule status
     */
    getStatus(): {
        active: boolean;
        currentHour: number;
        day: string;
        isWeekend: boolean;
        speedFactor: number;
        msUntilActive: number;
        activeWindow: string;
    };
    private getCurrentHour;
    private getCurrentDay;
}
