/**
 * Topology Throttler — Network topology-based anti-ban enforcement
 *
 * WhatsApp bans based on NETWORK TOPOLOGY, not just message timing:
 * - How fast you expand your contact graph
 * - Cold-contact ratio (strangers vs known contacts)
 * - Reply reciprocity
 * - Group-source clustering (mass-DMing group members)
 *
 * This module enforces graph expansion limits and scores contact risk
 * before each send, acting as the primary enforcement layer for high-risk
 * cold outreach.
 *
 * Key insight: A 30% reply rate is the minimum to unlock more cold sends.
 * Below that, WhatsApp's ML models flag you as a spammer.
 */
export type ContactRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export interface ContactRiskAssessment {
    jid: string;
    risk: ContactRisk;
    score: number;
    reasons: string[];
    recommendation: 'send' | 'delay' | 'abort';
    suggestedDelayMs?: number;
}
export interface ContactRiskConfig {
    firstContactPenalty?: number;
    noReplyPenalty?: number;
    noMutualGroupsPenalty?: number;
    recentContactBonus?: number;
    repliedBeforeBonus?: number;
    delayThreshold?: number;
    abortThreshold?: number;
}
export interface TopologyThrottlerConfig {
    maxNewContactsPerHour?: number;
    maxNewContactsPerDay?: number;
    minReplyRatioForNewContacts?: number;
    maxSameGroupContacts?: number;
    maxContactsFromSameSource?: number;
    blockOnLimitReached?: boolean;
    cooldownMs?: number;
    riskConfig?: ContactRiskConfig;
}
interface ContactRecord {
    firstContactAt: number;
    sendTimestamps: number[];
    replyTimestamps: number[];
    blocked: boolean;
    sourceGroup?: string;
}
interface TopologyLimits {
    newContactsThisHour: number;
    newContactsToday: number;
    lastHourResetAt: number;
    lastDayResetAt: number;
    limitHitAt?: number;
}
export interface TopologyThrottlerState {
    contacts: Array<[string, ContactRecord]>;
    limits: TopologyLimits;
    sourceGroupCounts: Array<[string, number]>;
}
export declare class TopologyThrottler {
    private config;
    private riskConfig;
    private contacts;
    private limits;
    private sourceGroupCounts;
    constructor(config?: TopologyThrottlerConfig);
    /**
     * Assess contact risk before sending.
     * This is the main check — call before every send to a new/unknown contact.
     */
    assessContact(jid: string, context: {
        messageType?: 'dm' | 'group' | 'broadcast';
        sourceGroup?: string;
        knownGroups?: string[];
        hasReplied?: boolean;
        lastContactAt?: number;
        lastReplyAt?: number;
    }): ContactRiskAssessment;
    /**
     * Record a sent message to this contact.
     */
    recordSent(jid: string, sourceGroup?: string): void;
    /**
     * Record a reply from this contact.
     */
    recordReplied(jid: string): void;
    /**
     * Record that this contact blocked you.
     */
    recordBlocked(jid: string): void;
    /**
     * Check if topology limits allow sending to a new contact.
     * Returns whether allowed and reason/retry time if blocked.
     */
    canSendToNewContact(): {
        allowed: boolean;
        reason?: string;
        retryAfterMs?: number;
    };
    /**
     * Get topology statistics.
     */
    getTopologyStats(): {
        newContactsThisHour: number;
        newContactsToday: number;
        replyRatio: number | null;
        blockedRatio: number | null;
        hotspots: Array<{
            sourceGroup: string;
            count: number;
        }>;
    };
    /**
     * Export state for persistence.
     */
    exportState(): TopologyThrottlerState;
    /**
     * Import state from persistence.
     */
    importState(state: TopologyThrottlerState): void;
    private resetLimitsIfNeeded;
    private calculateReplyRatio;
    private calculateBlockedRatio;
    private cleanupTimestamps;
}
export {};
