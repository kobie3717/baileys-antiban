"use strict";
/**
 * ReputationVoucher — High-trust accounts vouch for new numbers
 *
 * Establishes genuine conversation history between trusted accounts and new numbers
 * before those new numbers contact customers. Reduces warmup time and makes new
 * accounts appear established with real bidirectional message history.
 *
 * Key design principles:
 * - Dedicated sacrificial vouch accounts (separate from business accounts)
 * - Max 5 vouches per week per vouching account (not per day)
 * - Targets must complete 3 qualifying events before vouching
 * - Strike system: 3 failed vouches = 90-day suspension for voucher
 * - Blast radius containment: vouching accounts isolated from main business
 *
 * Usage:
 *   const rv = new ReputationVoucher();
 *
 *   // Register a trusted account
 *   rv.registerVoucher({
 *     jid: '27123456789@s.whatsapp.net',
 *     trustScore: 85,
 *     accountAgeDays: 240
 *   });
 *
 *   // Queue a new number for vouching
 *   rv.queueTarget({ jid: '27987654321@s.whatsapp.net' });
 *
 *   // Record qualifying events (auction completion, payment, etc)
 *   rv.recordQualifyingEvent('27987654321@s.whatsapp.net');
 *   rv.recordQualifyingEvent('27987654321@s.whatsapp.net');
 *   rv.recordQualifyingEvent('27987654321@s.whatsapp.net');
 *
 *   // Check if target qualifies
 *   const check = rv.targetQualifies('27987654321@s.whatsapp.net');
 *   if (check.qualified) {
 *     const voucher = rv.getAvailableVoucher();
 *     if (voucher) {
 *       // Plan the conversation
 *       const conversation = rv.planVouchConversation(voucher.jid, '27987654321@s.whatsapp.net');
 *
 *       // Execute sends (caller must have separate socket for voucher account)
 *       // ... send conversation.messages ...
 *
 *       // After target replies
 *       rv.recordVouchOutcome('27987654321@s.whatsapp.net', true);
 *
 *       // Calculate warmup credit
 *       const daysCredit = rv.calculateWarmupCredit('27987654321@s.whatsapp.net');
 *       // Skip daysCredit days of warmup for this target
 *     }
 *   }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReputationVoucher = void 0;
const DEFAULT_CONFIG = {
    maxVouchesPerWeek: 5,
    qualifyingEventsRequired: 3,
    strikesForSuspension: 3,
    suspensionDurationMs: 90 * 24 * 60 * 60 * 1000, // 90 days
    minVoucherTrustScore: 60,
    minVoucherAgeDays: 180, // 6 months
    warmupMessages: [
        "Hey, just checking this is the right number?",
        "Hi! Got your details from the group",
        "Morning! Are you available this week?",
        "Hey there, hope this is a good time to connect",
        "Hi, just wanted to reach out",
    ],
};
class ReputationVoucher {
    config;
    vouchers = new Map();
    targets = new Map();
    conversations = [];
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Register a vouching account (high-trust, established number)
     */
    registerVoucher(account) {
        // Validate account meets minimum requirements
        if (account.trustScore < this.config.minVoucherTrustScore) {
            throw new Error(`Voucher trust score ${account.trustScore} below minimum ${this.config.minVoucherTrustScore}`);
        }
        if (account.accountAgeDays < this.config.minVoucherAgeDays) {
            throw new Error(`Voucher account age ${account.accountAgeDays} days below minimum ${this.config.minVoucherAgeDays} days`);
        }
        const existing = this.vouchers.get(account.jid);
        if (existing) {
            // Update existing voucher (preserve counters)
            this.vouchers.set(account.jid, {
                ...account,
                vouchesThisWeek: existing.vouchesThisWeek,
                totalVouches: existing.totalVouches,
                failedVouches: existing.failedVouches,
                strikes: existing.strikes,
                suspendedUntil: existing.suspendedUntil,
                lastVouchAt: existing.lastVouchAt,
            });
        }
        else {
            // New voucher
            this.vouchers.set(account.jid, {
                ...account,
                vouchesThisWeek: 0,
                totalVouches: 0,
                failedVouches: 0,
                strikes: 0,
            });
        }
    }
    /**
     * Queue a target for vouching
     */
    queueTarget(target) {
        const existing = this.targets.get(target.jid);
        if (existing && existing.status !== 'failed') {
            // Already queued or in progress
            return;
        }
        this.targets.set(target.jid, {
            ...target,
            qualifyingEvents: target.qualifyingEvents || 0,
            requestedAt: Date.now(),
            status: 'pending',
        });
    }
    /**
     * Check if a target qualifies for vouching
     */
    targetQualifies(jid) {
        const target = this.targets.get(jid);
        if (!target) {
            return { qualified: false, reason: 'Target not queued', eventsNeeded: this.config.qualifyingEventsRequired };
        }
        const events = target.qualifyingEvents || 0;
        if (events < this.config.qualifyingEventsRequired) {
            return {
                qualified: false,
                reason: `Not enough qualifying events (${events}/${this.config.qualifyingEventsRequired})`,
                eventsNeeded: this.config.qualifyingEventsRequired - events,
            };
        }
        if (target.status === 'completed') {
            return { qualified: false, reason: 'Already vouched' };
        }
        if (target.status === 'failed') {
            return { qualified: false, reason: 'Previous vouch failed' };
        }
        return { qualified: true };
    }
    /**
     * Record a qualifying event for a target (e.g., auction completion, payment cleared)
     */
    recordQualifyingEvent(jid) {
        const target = this.targets.get(jid);
        if (!target) {
            // Auto-queue with first event
            this.queueTarget({ jid, qualifyingEvents: 1 });
            return;
        }
        target.qualifyingEvents = (target.qualifyingEvents || 0) + 1;
    }
    /**
     * Get next available voucher for a target (respects limits + suspension)
     */
    getAvailableVoucher() {
        const now = Date.now();
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        // Find eligible vouchers
        const eligible = [];
        for (const voucher of this.vouchers.values()) {
            // Check suspension
            if (voucher.suspendedUntil && voucher.suspendedUntil > now) {
                continue;
            }
            // Reset weekly counter if 7 days have passed since last vouch
            if (voucher.lastVouchAt && now - voucher.lastVouchAt > weekMs) {
                voucher.vouchesThisWeek = 0;
            }
            // Check weekly limit
            if (voucher.vouchesThisWeek >= this.config.maxVouchesPerWeek) {
                continue;
            }
            eligible.push(voucher);
        }
        if (eligible.length === 0) {
            return null;
        }
        // Sort by:
        // 1. Lowest vouchesThisWeek (spread load)
        // 2. Highest trustScore (best vouchers first)
        // 3. Lowest totalVouches (rotate usage)
        eligible.sort((a, b) => {
            if (a.vouchesThisWeek !== b.vouchesThisWeek) {
                return a.vouchesThisWeek - b.vouchesThisWeek;
            }
            if (a.trustScore !== b.trustScore) {
                return b.trustScore - a.trustScore;
            }
            return a.totalVouches - b.totalVouches;
        });
        return eligible[0];
    }
    /**
     * Plan a vouch conversation.
     * Returns a conversation plan — caller executes the sends.
     */
    planVouchConversation(voucherJid, targetJid) {
        const voucher = this.vouchers.get(voucherJid);
        if (!voucher) {
            throw new Error(`Voucher ${voucherJid} not registered`);
        }
        const target = this.targets.get(targetJid);
        if (!target) {
            throw new Error(`Target ${targetJid} not queued`);
        }
        const check = this.targetQualifies(targetJid);
        if (!check.qualified) {
            throw new Error(`Target ${targetJid} not qualified: ${check.reason}`);
        }
        // Update voucher counters
        voucher.vouchesThisWeek++;
        voucher.totalVouches++;
        voucher.lastVouchAt = Date.now();
        // Update target status
        target.status = 'active';
        target.vouchedAt = Date.now();
        target.vouchedBy = voucherJid;
        // Pick 2-3 warmup messages randomly
        const messageCount = 2 + Math.floor(Math.random() * 2); // 2-3 messages
        const selectedMessages = [];
        const pool = [...this.config.warmupMessages];
        for (let i = 0; i < messageCount && pool.length > 0; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            selectedMessages.push(pool[idx]);
            pool.splice(idx, 1); // Remove to avoid duplicates
        }
        // Create conversation plan
        const conversation = {
            targetJid,
            voucherJid,
            messages: selectedMessages.map((text, idx) => ({
                direction: 'outbound',
                timestamp: Date.now() + idx * 5000, // Stagger by 5s
                text,
            })),
            startedAt: Date.now(),
            success: false, // Will be updated when recordVouchOutcome is called
        };
        this.conversations.push(conversation);
        return conversation;
    }
    /**
     * Record outcome of a vouch.
     * success = true if target replied within reasonable time (e.g., 7 days)
     * success = false if target got banned within 7 days of vouch
     */
    recordVouchOutcome(targetJid, success) {
        const target = this.targets.get(targetJid);
        if (!target || !target.vouchedBy) {
            throw new Error(`Target ${targetJid} not vouched`);
        }
        const voucher = this.vouchers.get(target.vouchedBy);
        if (!voucher) {
            throw new Error(`Voucher ${target.vouchedBy} not found`);
        }
        // Find the conversation
        const conversation = this.conversations.find((c) => c.targetJid === targetJid && c.voucherJid === target.vouchedBy);
        if (conversation) {
            conversation.success = success;
            conversation.completedAt = Date.now();
        }
        if (success) {
            target.status = 'completed';
        }
        else {
            // Failed vouch — apply strike to voucher
            target.status = 'failed';
            voucher.failedVouches++;
            voucher.strikes++;
            // Check if suspension threshold reached
            if (voucher.strikes >= this.config.strikesForSuspension) {
                voucher.suspendedUntil = Date.now() + this.config.suspensionDurationMs;
            }
        }
    }
    /**
     * Calculate warmup credit for a successfully vouched target.
     * Returns number of warmup days that can be skipped (0-3).
     *
     * Credit logic:
     * - 1 reply = 1 day credit
     * - 2+ replies = 2 days credit
     * - Reply + 3+ days elapsed = 3 days credit (max)
     */
    calculateWarmupCredit(targetJid) {
        const target = this.targets.get(targetJid);
        if (!target || target.status !== 'completed') {
            return 0;
        }
        const conversation = this.conversations.find((c) => c.targetJid === targetJid && c.success);
        if (!conversation) {
            return 0;
        }
        // Count inbound messages (replies from target)
        const inboundCount = conversation.messages.filter((m) => m.direction === 'inbound').length;
        if (inboundCount === 0) {
            return 0;
        }
        if (inboundCount === 1) {
            return 1;
        }
        if (inboundCount >= 2) {
            // Check if 3+ days elapsed
            const daysElapsed = (Date.now() - conversation.startedAt) / (24 * 60 * 60 * 1000);
            if (daysElapsed >= 3) {
                return 3; // Max credit
            }
            return 2;
        }
        return 0;
    }
    /**
     * Get stats for a specific voucher
     */
    getVoucherStats(jid) {
        const voucher = this.vouchers.get(jid);
        return voucher ? { ...voucher } : null;
    }
    /**
     * Get all pending targets (awaiting vouching)
     */
    getPendingTargets() {
        return Array.from(this.targets.values()).filter((t) => t.status === 'pending');
    }
    /**
     * Get vouch history
     */
    getVouchHistory() {
        return [...this.conversations];
    }
    /**
     * Export state for persistence
     */
    exportState() {
        return {
            version: 1,
            exportedAt: Date.now(),
            vouchers: Array.from(this.vouchers.values()),
            targets: Array.from(this.targets.values()),
            conversations: [...this.conversations],
        };
    }
    /**
     * Import state from persistence
     */
    importState(state) {
        // Clear existing state
        this.vouchers.clear();
        this.targets.clear();
        this.conversations = [];
        // Import vouchers
        for (const voucher of state.vouchers) {
            this.vouchers.set(voucher.jid, { ...voucher });
        }
        // Import targets
        for (const target of state.targets) {
            this.targets.set(target.jid, { ...target });
        }
        // Import conversations
        this.conversations = [...state.conversations];
    }
}
exports.ReputationVoucher = ReputationVoucher;
