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
export declare class ReplyRatioGuard {
    private config;
    private contacts;
    constructor(config?: ReplyRatioConfig);
    /**
     * Check if message can be sent to this contact based on reply ratio.
     * Call before sending.
     */
    beforeSend(jid: string): {
        allowed: boolean;
        reason?: string;
    };
    /**
     * Record an outbound message sent to this contact.
     */
    recordSent(jid: string): void;
    /**
     * Record an inbound message received from this contact.
     */
    recordReceived(jid: string): void;
    /**
     * Suggest whether to send an auto-reply to this incoming message.
     * Returns { shouldReply: true, suggestedText: '👍' } if probability check passes.
     * Caller is responsible for actually sending the message.
     */
    suggestReply(jid: string, _msgText?: string): {
        shouldReply: boolean;
        suggestedText?: string;
    };
    /**
     * Get statistics for all contacts and global metrics.
     */
    getStats(): ReplyRatioStats;
    /**
     * Reset all counters.
     */
    reset(): void;
    /**
     * Export state for persistence.
     */
    exportState(): object;
    /**
     * Restore state from persistence.
     */
    restoreState(state: any): void;
    /**
     * Check if JID is a group.
     */
    private isGroup;
}
