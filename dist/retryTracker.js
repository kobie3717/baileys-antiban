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
const DEFAULT_CONFIG = {
    enabled: false,
    maxRetries: 5,
    spiralThreshold: 3,
    onSpiral: () => { },
};
export class RetryReasonTracker {
    config;
    retries = new Map();
    totalRetries = 0;
    reasonCounts = {
        no_session: 0,
        invalid_key: 0,
        bad_mac: 0,
        decryption_failure: 0,
        server_error_463: 0,
        server_error_429: 0,
        timeout: 0,
        no_route: 0,
        node_malformed: 0,
        unknown: 0,
    };
    spiralsDetected = 0;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Call when a messages.update event arrives with a status/error.
     * Classifies and records the retry.
     */
    onMessageUpdate(update) {
        if (!this.config.enabled)
            return;
        const msgId = update.key?.id;
        if (!msgId)
            return;
        // Only track error statuses
        if (update.status !== 0 && !update.error)
            return;
        const reason = this.classify(update.error || update);
        this.recordRetry(msgId, reason);
    }
    /**
     * Classify an arbitrary error object into a RetryReason
     */
    classify(err) {
        if (!err)
            return 'unknown';
        // Check for HTTP status codes
        const statusCode = err.output?.statusCode || err.statusCode || err.status;
        if (statusCode === 463)
            return 'server_error_463';
        if (statusCode === 429)
            return 'server_error_429';
        // Extract error message/text for pattern matching
        const errorMsg = (err.message || err.text || String(err)).toLowerCase();
        // Pattern matching for known errors
        if (errorMsg.includes('bad mac'))
            return 'bad_mac';
        if (errorMsg.includes('no session') || errorMsg.includes('session not found'))
            return 'no_session';
        if (errorMsg.includes('invalid key') || errorMsg.includes('key error'))
            return 'invalid_key';
        if (errorMsg.includes('decryption') || errorMsg.includes('decrypt'))
            return 'decryption_failure';
        if (errorMsg.includes('timeout') || errorMsg.includes('timed out'))
            return 'timeout';
        if (errorMsg.includes('no route') || errorMsg.includes('unreachable') || errorMsg.includes('offline'))
            return 'no_route';
        if (errorMsg.includes('malformed') || errorMsg.includes('invalid node'))
            return 'node_malformed';
        return 'unknown';
    }
    /**
     * Record a retry for a message
     */
    recordRetry(msgId, reason) {
        const now = Date.now();
        let record = this.retries.get(msgId);
        if (!record) {
            record = {
                msgId,
                count: 0,
                reasons: [],
                firstRetry: now,
                lastRetry: now,
            };
            this.retries.set(msgId, record);
        }
        record.count++;
        record.reasons.push(reason);
        record.lastRetry = now;
        this.totalRetries++;
        this.reasonCounts[reason]++;
        // Check for spiral
        if (record.count >= this.config.spiralThreshold) {
            this.spiralsDetected++;
            this.config.onSpiral(msgId, reason);
        }
    }
    /**
     * Should we warn the user this message is spiraling?
     */
    isSpiraling(msgId) {
        const record = this.retries.get(msgId);
        return record ? record.count >= this.config.spiralThreshold : false;
    }
    /**
     * Reset counters for a specific message (call on successful delivery)
     */
    clear(msgId) {
        this.retries.delete(msgId);
    }
    /**
     * Get current stats
     */
    getStats() {
        return {
            totalRetries: this.totalRetries,
            byReason: { ...this.reasonCounts },
            spiralsDetected: this.spiralsDetected,
            activeRetries: this.retries.size,
        };
    }
    /**
     * Clean up old retry records (>5 minutes old)
     */
    cleanup() {
        const now = Date.now();
        const maxAge = 5 * 60 * 1000; // 5 minutes
        for (const [msgId, record] of this.retries.entries()) {
            if (now - record.lastRetry > maxAge) {
                this.retries.delete(msgId);
            }
        }
    }
    /**
     * Destroy and clean up
     */
    destroy() {
        this.retries.clear();
        this.cleanup();
    }
}
