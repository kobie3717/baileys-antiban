/**
 * Reply Ratio Guard — Tracks outbound:inbound ratio per contact
 *
 * WhatsApp's ML models flag accounts that blast messages with low engagement.
 * This module:
 * - Tracks sent/received counts per JID
 * - Blocks sends to non-responsive contacts (ratio collapse)
 * - Suggests auto-replies to maintain healthy inbound/outbound balance
 *
 * Research: 2025-2026 ban waves correlated with <5% reply rates on accounts
 * sending >100 messages/day. This module enforces a configurable floor.
 */

export interface ReplyRatioConfig {
  /** Enable reply ratio enforcement (default: false — opt-in) */
  enabled?: boolean;
  /** Minimum ratio (received/sent) before blocking sends (default: 0.10 = 10% reply rate) */
  minRatio?: number;
  /** Don't enforce ratio until this many outbound messages to a contact (default: 5) */
  minMessagesBeforeEnforce?: number;
  /** Probability (0-1) of suggesting a reply to an incoming message (default: 0.25) */
  inboundAutoReplyProbability?: number;
  /** Default reply templates for suggested replies */
  autoReplyTemplates?: string[];
  /** Hours to block sends to a contact after ratio violation (default: 24) */
  cooldownHoursOnViolation?: number;
  /** Enforcement scope: 'individual' = 1:1 only, 'all' = groups too (default: 'individual') */
  scope?: 'individual' | 'all';
}

export interface ReplyRatioStats {
  perContact: Array<{
    jid: string;
    sent: number;
    received: number;
    ratio: number;
    cooledUntil?: number;
  }>;
  globalSent: number;
  globalReceived: number;
  globalRatio: number;
  contactsOnCooldown: number;
}

interface ContactRecord {
  sent: number;
  received: number;
  cooledUntil?: number;
}

const DEFAULT_CONFIG: Required<ReplyRatioConfig> = {
  enabled: false,
  minRatio: 0.10,
  minMessagesBeforeEnforce: 5,
  inboundAutoReplyProbability: 0.25,
  autoReplyTemplates: ['👍', '👌', 'ok', 'noted', 'thanks', '🙏', 'got it'],
  cooldownHoursOnViolation: 24,
  scope: 'individual',
};

export class ReplyRatioGuard {
  private config: Required<ReplyRatioConfig>;
  private contacts = new Map<string, ContactRecord>();

  constructor(config: ReplyRatioConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if message can be sent to this contact based on reply ratio.
   * Call before sending.
   */
  beforeSend(jid: string): { allowed: boolean; reason?: string } {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    // Skip groups unless scope === 'all'
    if (this.isGroup(jid) && this.config.scope === 'individual') {
      return { allowed: true };
    }

    const record = this.contacts.get(jid);
    if (!record) {
      // First message to this contact — allow
      return { allowed: true };
    }

    // Check cooldown
    if (record.cooledUntil && Date.now() < record.cooledUntil) {
      const hoursLeft = Math.ceil((record.cooledUntil - Date.now()) / 3600000);
      return {
        allowed: false,
        reason: `Reply ratio cooldown — ${record.sent} sent, ${record.received} received. Retry in ${hoursLeft}h`,
      };
    }

    // Check ratio if we've sent enough messages
    if (record.sent >= this.config.minMessagesBeforeEnforce) {
      const ratio = record.sent === 0 ? 1 : record.received / record.sent;

      if (ratio < this.config.minRatio) {
        // Ratio violation — apply cooldown
        record.cooledUntil = Date.now() + this.config.cooldownHoursOnViolation * 3600000;
        return {
          allowed: false,
          reason: `Reply ratio too low (${(ratio * 100).toFixed(1)}% < ${(this.config.minRatio * 100).toFixed(1)}%). Cooldown ${this.config.cooldownHoursOnViolation}h`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record an outbound message sent to this contact.
   */
  recordSent(jid: string): void {
    if (!this.config.enabled) return;

    const record = this.contacts.get(jid) || { sent: 0, received: 0 };
    record.sent++;
    this.contacts.set(jid, record);
  }

  /**
   * Record an inbound message received from this contact.
   */
  recordReceived(jid: string): void {
    if (!this.config.enabled) return;

    const record = this.contacts.get(jid) || { sent: 0, received: 0 };
    record.received++;
    // Clear cooldown on incoming message (they replied!)
    delete record.cooledUntil;
    this.contacts.set(jid, record);
  }

  /**
   * Suggest whether to send an auto-reply to this incoming message.
   * Returns { shouldReply: true, suggestedText: '👍' } if probability check passes.
   * Caller is responsible for actually sending the message.
   */
  suggestReply(jid: string, _msgText?: string): { shouldReply: boolean; suggestedText?: string } {
    if (!this.config.enabled) {
      return { shouldReply: false };
    }

    // Skip groups unless scope === 'all'
    if (this.isGroup(jid) && this.config.scope === 'individual') {
      return { shouldReply: false };
    }

    // Roll probability
    if (Math.random() < this.config.inboundAutoReplyProbability) {
      const templates = this.config.autoReplyTemplates;
      const suggestedText = templates[Math.floor(Math.random() * templates.length)];
      return { shouldReply: true, suggestedText };
    }

    return { shouldReply: false };
  }

  /**
   * Get statistics for all contacts and global metrics.
   */
  getStats(): ReplyRatioStats {
    const perContact = Array.from(this.contacts.entries()).map(([jid, record]) => ({
      jid,
      sent: record.sent,
      received: record.received,
      ratio: record.sent === 0 ? 0 : record.received / record.sent,
      cooledUntil: record.cooledUntil,
    }));

    const globalSent = perContact.reduce((sum, c) => sum + c.sent, 0);
    const globalReceived = perContact.reduce((sum, c) => sum + c.received, 0);
    const globalRatio = globalSent === 0 ? 0 : globalReceived / globalSent;
    const contactsOnCooldown = perContact.filter(c => c.cooledUntil && Date.now() < c.cooledUntil).length;

    return {
      perContact,
      globalSent,
      globalReceived,
      globalRatio,
      contactsOnCooldown,
    };
  }

  /**
   * Reset all counters.
   */
  reset(): void {
    this.contacts.clear();
  }

  /**
   * Export state for persistence.
   */
  exportState(): object {
    return {
      contacts: Array.from(this.contacts.entries()),
    };
  }

  /**
   * Restore state from persistence.
   */
  restoreState(state: any): void {
    if (state?.contacts && Array.isArray(state.contacts)) {
      this.contacts = new Map(state.contacts);
    }
  }

  /**
   * Check if JID is a group.
   */
  private isGroup(jid: string): boolean {
    return jid.endsWith('@g.us');
  }
}
