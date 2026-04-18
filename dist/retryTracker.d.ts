/**
 * RetryReasonTracker — Track message retry reasons and detect retry spirals
 *
 * Inspired by whatsapp-rust's protocol/retry.rs module which defines 13 typed
 * RetryReason codes with MAX_RETRY=5 and optimized key-include behavior.
 *
 * In the middleware layer, we can't control key inclusion (that's transport-level),
 * but we CAN observe retry patterns from messages.update events and classify them.
 * High retry rates per reason = ban signal precursor.
 *
 * Usage:
 *   const tracker = new RetryReasonTracker({ enabled: true, maxRetries: 5 });
 *
 *   // In messages.update handler:
 *   tracker.onMessageUpdate(update);
 *
 *   // Check for spirals:
 *   if (tracker.isSpiraling(msgId)) {
 *     console.warn('Message stuck in retry spiral, dropping');
 *   }
 *
 *   // On successful send:
 *   tracker.clear(msgId);
 *
 *   // Get stats:
 *   const stats = tracker.getStats();
 */
export type RetryReason = 'no_session' | 'invalid_key' | 'bad_mac' | 'decryption_failure' | 'server_error_463' | 'server_error_429' | 'timeout' | 'no_route' | 'node_malformed' | 'unknown';
export interface RetryTrackerConfig {
    enabled?: boolean;
    maxRetries?: number;
    spiralThreshold?: number;
    onSpiral?: (msgId: string, reason: RetryReason) => void;
}
export interface RetryStats {
    totalRetries: number;
    byReason: Record<RetryReason, number>;
    spiralsDetected: number;
    activeRetries: number;
}
export declare class RetryReasonTracker {
    private config;
    private retries;
    private totalRetries;
    private reasonCounts;
    private spiralsDetected;
    constructor(config?: RetryTrackerConfig);
    /**
     * Call when a messages.update event arrives with a status/error.
     * Classifies and records the retry.
     */
    onMessageUpdate(update: {
        key: {
            id?: string;
        };
        status?: number;
        error?: any;
    }): void;
    /**
     * Classify an arbitrary error object into a RetryReason
     */
    classify(err: any): RetryReason;
    /**
     * Record a retry for a message
     */
    private recordRetry;
    /**
     * Should we warn the user this message is spiraling?
     */
    isSpiraling(msgId: string): boolean;
    /**
     * Reset counters for a specific message (call on successful delivery)
     */
    clear(msgId: string): void;
    /**
     * Get current stats
     */
    getStats(): RetryStats;
    /**
     * Clean up old retry records (>5 minutes old)
     */
    private cleanup;
    /**
     * Destroy and clean up
     */
    destroy(): void;
}
