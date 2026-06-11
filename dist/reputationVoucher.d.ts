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
export interface VouchTarget {
    jid: string;
    qualifyingEvents?: number;
    requestedAt: number;
    vouchedAt?: number;
    vouchedBy?: string;
    status: 'pending' | 'active' | 'completed' | 'failed';
}
export interface VouchingAccount {
    jid: string;
    trustScore: number;
    accountAgeDays: number;
    vouchesThisWeek: number;
    totalVouches: number;
    failedVouches: number;
    strikes: number;
    suspendedUntil?: number;
    lastVouchAt?: number;
}
export interface VouchConversation {
    targetJid: string;
    voucherJid: string;
    messages: Array<{
        direction: 'outbound' | 'inbound';
        timestamp: number;
        text: string;
    }>;
    startedAt: number;
    completedAt?: number;
    success: boolean;
}
export interface ReputationVoucherConfig {
    maxVouchesPerWeek?: number;
    qualifyingEventsRequired?: number;
    strikesForSuspension?: number;
    suspensionDurationMs?: number;
    minVoucherTrustScore?: number;
    minVoucherAgeDays?: number;
    warmupMessages?: string[];
}
export interface ReputationVoucherState {
    version: number;
    exportedAt: number;
    vouchers: VouchingAccount[];
    targets: VouchTarget[];
    conversations: VouchConversation[];
}
export declare class ReputationVoucher {
    private config;
    private vouchers;
    private targets;
    private conversations;
    constructor(config?: ReputationVoucherConfig);
    /**
     * Register a vouching account (high-trust, established number)
     */
    registerVoucher(account: Omit<VouchingAccount, 'vouchesThisWeek' | 'totalVouches' | 'failedVouches' | 'strikes'>): void;
    /**
     * Queue a target for vouching
     */
    queueTarget(target: Omit<VouchTarget, 'status' | 'requestedAt'>): void;
    /**
     * Check if a target qualifies for vouching
     */
    targetQualifies(jid: string): {
        qualified: boolean;
        reason?: string;
        eventsNeeded?: number;
    };
    /**
     * Record a qualifying event for a target (e.g., auction completion, payment cleared)
     */
    recordQualifyingEvent(jid: string): void;
    /**
     * Get next available voucher for a target (respects limits + suspension)
     */
    getAvailableVoucher(): VouchingAccount | null;
    /**
     * Plan a vouch conversation.
     * Returns a conversation plan — caller executes the sends.
     */
    planVouchConversation(voucherJid: string, targetJid: string): VouchConversation;
    /**
     * Record outcome of a vouch.
     * success = true if target replied within reasonable time (e.g., 7 days)
     * success = false if target got banned within 7 days of vouch
     */
    recordVouchOutcome(targetJid: string, success: boolean): void;
    /**
     * Calculate warmup credit for a successfully vouched target.
     * Returns number of warmup days that can be skipped (0-3).
     *
     * Credit logic:
     * - 1 reply = 1 day credit
     * - 2+ replies = 2 days credit
     * - Reply + 3+ days elapsed = 3 days credit (max)
     */
    calculateWarmupCredit(targetJid: string): number;
    /**
     * Get stats for a specific voucher
     */
    getVoucherStats(jid: string): VouchingAccount | null;
    /**
     * Get all pending targets (awaiting vouching)
     */
    getPendingTargets(): VouchTarget[];
    /**
     * Get vouch history
     */
    getVouchHistory(): VouchConversation[];
    /**
     * Export state for persistence
     */
    exportState(): ReputationVoucherState;
    /**
     * Import state from persistence
     */
    importState(state: ReputationVoucherState): void;
}
