/**
 * Contact Graph Warmer — Requires 1:1 handshake before group/bulk sends
 *
 * WhatsApp's ML models weight "social graph distance" heavily. Accounts that
 * message strangers (contacts who never replied) have higher ban risk.
 *
 * This module:
 * - Tracks contact state: stranger → handshake_sent → handshake_complete → known
 * - Blocks sends to strangers unless handshake completed
 * - Enforces group lurk period (don't send immediately after joining)
 * - Caps daily new-contact messaging (prevent spray-and-pray patterns)
 * - Auto-registers inbound senders as "known contacts"
 *
 * Research: 2025 ban waves correlated with accounts joining groups + spamming
 * instantly. 12-24h lurk period significantly reduced bans.
 */
export interface ContactGraphConfig {
    /** Enable contact graph enforcement (default: false — opt-in) */
    enabled?: boolean;
    /** Require handshake completion before group/bulk sends (default: true) */
    requireHandshakeBeforeGroupSend?: boolean;
    /** Min wait time (ms) between handshake and first real message (default: 3600000 = 1h) */
    handshakeMinDelayMs?: number;
    /** Group lurk period (ms) before first send (default: 43200000 = 12h) */
    groupLurkPeriodMs?: number;
    /** Max new-contact messages per day (default: 5) */
    maxStrangerMessagesPerDay?: number;
    /** Auto-register inbound senders as known contacts (default: true) */
    autoRegisterOnIncoming?: boolean;
}
export type ContactState = 'stranger' | 'handshake_sent' | 'handshake_complete' | 'known';
export interface ContactGraphStats {
    knownContacts: number;
    pendingHandshakes: number;
    strangersToday: number;
    groupsJoined: Array<{
        groupJid: string;
        joinedAt: number;
        firstSendUnlocksAt: number;
    }>;
}
export declare class ContactGraphWarmer {
    private config;
    private contacts;
    private groups;
    private strangerMessagesToday;
    private lastStrangerResetDay;
    constructor(config?: ContactGraphConfig);
    /**
     * Check if message can be sent to this contact/group.
     * Returns { allowed: false, needsHandshake: true } if handshake required.
     */
    canMessage(jid: string): {
        allowed: boolean;
        reason?: string;
        needsHandshake?: boolean;
    };
    /**
     * Mark handshake as sent to this contact.
     */
    markHandshakeSent(jid: string): void;
    /**
     * Mark handshake as complete with this contact.
     */
    markHandshakeComplete(jid: string): void;
    /**
     * Register a contact as known (skip handshake requirement).
     */
    registerKnownContact(jid: string): void;
    /**
     * Register a group join event.
     */
    registerGroupJoin(groupJid: string): void;
    /**
     * Get contact state.
     */
    getContactState(jid: string): ContactState;
    /**
     * Handle incoming message — auto-register if enabled.
     */
    onIncomingMessage(jid: string): void;
    /**
     * Get statistics.
     */
    getStats(): ContactGraphStats;
    /**
     * Reset all state.
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
    private isGroup;
    private getCurrentDay;
    private checkGroupMessage;
    private checkIndividualMessage;
}
