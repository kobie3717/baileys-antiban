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
const DEFAULT_CONFIG = {
    enabled: false,
    requireHandshakeBeforeGroupSend: true,
    handshakeMinDelayMs: 3600000, // 1 hour
    groupLurkPeriodMs: 43200000, // 12 hours
    maxStrangerMessagesPerDay: 5,
    autoRegisterOnIncoming: true,
};
export class ContactGraphWarmer {
    config;
    contacts = new Map();
    groups = new Map();
    strangerMessagesToday = 0;
    lastStrangerResetDay = this.getCurrentDay();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Check if message can be sent to this contact/group.
     * Returns { allowed: false, needsHandshake: true } if handshake required.
     */
    canMessage(jid) {
        if (!this.config.enabled) {
            return { allowed: true };
        }
        // Reset daily stranger counter at UTC midnight
        const currentDay = this.getCurrentDay();
        if (currentDay !== this.lastStrangerResetDay) {
            this.strangerMessagesToday = 0;
            this.lastStrangerResetDay = currentDay;
        }
        // Handle groups
        if (this.isGroup(jid)) {
            return this.checkGroupMessage(jid);
        }
        // Handle individual contacts
        return this.checkIndividualMessage(jid);
    }
    /**
     * Mark handshake as sent to this contact.
     */
    markHandshakeSent(jid) {
        if (!this.config.enabled)
            return;
        if (this.isGroup(jid))
            return;
        const record = this.contacts.get(jid) || { state: 'stranger' };
        record.state = 'handshake_sent';
        record.handshakeSentAt = Date.now();
        this.contacts.set(jid, record);
    }
    /**
     * Mark handshake as complete with this contact.
     */
    markHandshakeComplete(jid) {
        if (!this.config.enabled)
            return;
        if (this.isGroup(jid))
            return;
        const record = this.contacts.get(jid) || { state: 'stranger' };
        record.state = 'handshake_complete';
        this.contacts.set(jid, record);
    }
    /**
     * Register a contact as known (skip handshake requirement).
     */
    registerKnownContact(jid) {
        if (!this.config.enabled)
            return;
        if (this.isGroup(jid))
            return;
        const record = this.contacts.get(jid) || { state: 'stranger' };
        record.state = 'known';
        this.contacts.set(jid, record);
    }
    /**
     * Register a group join event.
     */
    registerGroupJoin(groupJid) {
        if (!this.config.enabled)
            return;
        if (!this.isGroup(groupJid))
            return;
        this.groups.set(groupJid, { joinedAt: Date.now() });
    }
    /**
     * Get contact state.
     */
    getContactState(jid) {
        if (this.isGroup(jid))
            return 'known'; // Groups don't have handshake states
        return this.contacts.get(jid)?.state || 'stranger';
    }
    /**
     * Handle incoming message — auto-register if enabled.
     */
    onIncomingMessage(jid) {
        if (!this.config.enabled)
            return;
        if (this.isGroup(jid))
            return;
        if (this.config.autoRegisterOnIncoming) {
            this.registerKnownContact(jid);
        }
    }
    /**
     * Get statistics.
     */
    getStats() {
        const knownContacts = Array.from(this.contacts.values()).filter(c => c.state === 'known').length;
        const pendingHandshakes = Array.from(this.contacts.values()).filter(c => c.state === 'handshake_sent').length;
        const groupsJoined = Array.from(this.groups.entries()).map(([groupJid, record]) => ({
            groupJid,
            joinedAt: record.joinedAt,
            firstSendUnlocksAt: record.joinedAt + this.config.groupLurkPeriodMs,
        }));
        return {
            knownContacts,
            pendingHandshakes,
            strangersToday: this.strangerMessagesToday,
            groupsJoined,
        };
    }
    /**
     * Reset all state.
     */
    reset() {
        this.contacts.clear();
        this.groups.clear();
        this.strangerMessagesToday = 0;
        this.lastStrangerResetDay = this.getCurrentDay();
    }
    /**
     * Export state for persistence.
     */
    exportState() {
        return {
            contacts: Array.from(this.contacts.entries()),
            groups: Array.from(this.groups.entries()),
            strangerMessagesToday: this.strangerMessagesToday,
            lastStrangerResetDay: this.lastStrangerResetDay,
        };
    }
    /**
     * Restore state from persistence.
     */
    restoreState(state) {
        if (state?.contacts && Array.isArray(state.contacts)) {
            this.contacts = new Map(state.contacts);
        }
        if (state?.groups && Array.isArray(state.groups)) {
            this.groups = new Map(state.groups);
        }
        if (typeof state?.strangerMessagesToday === 'number') {
            this.strangerMessagesToday = state.strangerMessagesToday;
        }
        if (typeof state?.lastStrangerResetDay === 'number') {
            this.lastStrangerResetDay = state.lastStrangerResetDay;
        }
    }
    // Private helpers
    isGroup(jid) {
        return jid.endsWith('@g.us');
    }
    getCurrentDay() {
        return Math.floor(Date.now() / 86400000);
    }
    checkGroupMessage(groupJid) {
        const record = this.groups.get(groupJid);
        if (!record) {
            // Group not registered — allow (assume old membership)
            return { allowed: true };
        }
        const lurkEndsAt = record.joinedAt + this.config.groupLurkPeriodMs;
        if (Date.now() < lurkEndsAt) {
            const minutesLeft = Math.ceil((lurkEndsAt - Date.now()) / 60000);
            return {
                allowed: false,
                reason: `Group lurk period not elapsed — wait ${minutesLeft} minutes`,
            };
        }
        return { allowed: true };
    }
    checkIndividualMessage(jid) {
        const record = this.contacts.get(jid);
        // Unknown contact (stranger)
        if (!record || record.state === 'stranger') {
            if (this.config.requireHandshakeBeforeGroupSend) {
                // Check daily stranger quota
                if (this.strangerMessagesToday >= this.config.maxStrangerMessagesPerDay) {
                    return {
                        allowed: false,
                        reason: `Daily new-contact limit reached (${this.config.maxStrangerMessagesPerDay})`,
                        needsHandshake: true,
                    };
                }
                // Allow but increment counter
                this.strangerMessagesToday++;
            }
            return { allowed: true, needsHandshake: true };
        }
        // Handshake sent — check delay
        if (record.state === 'handshake_sent') {
            if (!record.handshakeSentAt) {
                // No timestamp — shouldn't happen, but allow
                return { allowed: true };
            }
            const elapsed = Date.now() - record.handshakeSentAt;
            if (elapsed < this.config.handshakeMinDelayMs) {
                const minutesLeft = Math.ceil((this.config.handshakeMinDelayMs - elapsed) / 60000);
                return {
                    allowed: false,
                    reason: `Handshake too recent — wait ${minutesLeft} minutes`,
                };
            }
        }
        // handshake_complete or known — allow
        return { allowed: true };
    }
}
