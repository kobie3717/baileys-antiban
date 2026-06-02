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
  deliveryRate: number | null; // null if below minSampleSize
  windowMs: number;
}

interface MessageRecord {
  sentAt: number;
  delivered: boolean;
}

const DEFAULT_CONFIG: Required<DeliveryTrackerConfig> = {
  windowMs: 3600000, // 1 hour
  minSampleSize: 10,
  onLowDeliveryRate: () => {},
  lowRateThreshold: 0.6,
};

export class DeliveryTracker {
  private config: Required<DeliveryTrackerConfig>;
  private messages = new Map<string, MessageRecord>();
  private lastLowRateAlert = 0;

  constructor(config: DeliveryTrackerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a sent message.
   */
  onMessageSent(msgId: string): void {
    this.messages.set(msgId, {
      sentAt: Date.now(),
      delivered: false,
    });
    this.pruneOldMessages();
  }

  /**
   * Mark a message as delivered (status 3 or 4).
   */
  onDeliveryReceipt(msgId: string): void {
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
  getStats(): DeliveryTrackerStats {
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

    const deliveryRate =
      sentInWindow >= this.config.minSampleSize
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
  private pruneOldMessages(): void {
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
  private checkDeliveryRate(): void {
    const stats = this.getStats();

    // Only alert if we have enough samples
    if (stats.deliveryRate === null) return;

    // Only alert once per hour to avoid spam
    const now = Date.now();
    if (now - this.lastLowRateAlert < 3600000) return;

    if (stats.deliveryRate < this.config.lowRateThreshold) {
      this.lastLowRateAlert = now;
      this.config.onLowDeliveryRate(stats.deliveryRate);
    }
  }

  /**
   * Reset all tracked messages.
   */
  reset(): void {
    this.messages.clear();
    this.lastLowRateAlert = 0;
  }
}
