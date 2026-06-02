/**
 * DeliveryTracker — tracks actual delivery rate vs sent
 *
 * WhatsApp delivery receipts arrive via messages.update events as
 * update.update.status = 3 (DELIVERY_ACK) or 4 (READ).
 *
 * Low delivery rate (< 60%) = strong soft-ban signal.
 * Exposes deliveryRate for health monitoring and stats.
 */
export interface DeliveryTrackerConfig {
    /** Window for rate calculation in ms (default: 3600000 = 1h) */
    windowMs?: number;
    /** Min messages before rate is meaningful (default: 10) */
    minSampleSize?: number;
    /** Callback when delivery rate drops below threshold */
    onLowDeliveryRate?: (rate: number) => void;
    /** Low delivery rate threshold (default: 0.6 = 60%) */
    lowRateThreshold?: number;
}
export interface DeliveryTrackerStats {
    sentInWindow: number;
    deliveredInWindow: number;
    deliveryRate: number | null;
    windowMs: number;
}
export declare class DeliveryTracker {
    private config;
    private messages;
    private lastLowRateAlert;
    constructor(config?: DeliveryTrackerConfig);
    /**
     * Register a sent message.
     */
    onMessageSent(msgId: string): void;
    /**
     * Mark a message as delivered (status 3 or 4).
     */
    onDeliveryReceipt(msgId: string): void;
    /**
     * Get current delivery statistics.
     */
    getStats(): DeliveryTrackerStats;
    /**
     * Prune messages older than the window.
     */
    private pruneOldMessages;
    /**
     * Check delivery rate and trigger callback if below threshold.
     */
    private checkDeliveryRate;
    /**
     * Reset all tracked messages.
     */
    reset(): void;
}
