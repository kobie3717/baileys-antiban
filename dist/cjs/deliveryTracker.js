"use strict";
/**
 * DeliveryTracker — tracks actual delivery rate vs sent
 *
 * WhatsApp delivery receipts arrive via messages.update events as
 * update.update.status = 3 (DELIVERY_ACK) or 4 (READ).
 *
 * Low delivery rate (< 60%) = strong soft-ban signal.
 * Exposes deliveryRate for health monitoring and stats.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeliveryTracker = void 0;
const DEFAULT_CONFIG = {
    windowMs: 3600000, // 1 hour
    minSampleSize: 10,
    onLowDeliveryRate: () => { },
    lowRateThreshold: 0.6,
};
class DeliveryTracker {
    config;
    messages = new Map();
    lastLowRateAlert = 0;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Register a sent message.
     */
    onMessageSent(msgId) {
        this.messages.set(msgId, {
            sentAt: Date.now(),
            delivered: false,
        });
        this.pruneOldMessages();
    }
    /**
     * Mark a message as delivered (status 3 or 4).
     */
    onDeliveryReceipt(msgId) {
        const record = this.messages.get(msgId);
        if (record) {
            record.delivered = true;
        }
        this.pruneOldMessages();
        this.checkDeliveryRate();
    }
    /**
     * Get current delivery statistics.
     */
    getStats() {
        this.pruneOldMessages();
        const now = Date.now();
        const cutoff = now - this.config.windowMs;
        let sentInWindow = 0;
        let deliveredInWindow = 0;
        for (const record of this.messages.values()) {
            if (record.sentAt >= cutoff) {
                sentInWindow++;
                if (record.delivered) {
                    deliveredInWindow++;
                }
            }
        }
        const deliveryRate = sentInWindow >= this.config.minSampleSize
            ? deliveredInWindow / sentInWindow
            : null;
        return {
            sentInWindow,
            deliveredInWindow,
            deliveryRate,
            windowMs: this.config.windowMs,
        };
    }
    /**
     * Prune messages older than the window.
     */
    pruneOldMessages() {
        const now = Date.now();
        const cutoff = now - this.config.windowMs;
        for (const [msgId, record] of this.messages.entries()) {
            if (record.sentAt < cutoff) {
                this.messages.delete(msgId);
            }
        }
    }
    /**
     * Check delivery rate and trigger callback if below threshold.
     */
    checkDeliveryRate() {
        const stats = this.getStats();
        // Only alert if we have enough samples
        if (stats.deliveryRate === null)
            return;
        // Only alert once per hour to avoid spam
        const now = Date.now();
        if (now - this.lastLowRateAlert < 3600000)
            return;
        if (stats.deliveryRate < this.config.lowRateThreshold) {
            this.lastLowRateAlert = now;
            this.config.onLowDeliveryRate(stats.deliveryRate);
        }
    }
    /**
     * Reset all tracked messages.
     */
    reset() {
        this.messages.clear();
        this.lastLowRateAlert = 0;
    }
}
exports.DeliveryTracker = DeliveryTracker;
