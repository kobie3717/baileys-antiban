/**
 * Message Type Registry — Track message types with priority, legitimacy, and engagement
 *
 * Developers register message types upfront with priority and legitimacy requirements.
 * Library tracks engagement metrics per type and enforces provenance on critical sends.
 *
 * Features:
 * - Type registration (immutable after first send)
 * - Provenance validation for critical messages
 * - Per-type engagement tracking (sent/delivered/read/replied/blocked)
 * - Per-pool rate limiting
 * - Warning emission (NO auto-throttling)
 */
export interface MessageTypeDefinition {
    /** Message priority tier */
    priority: 'critical' | 'normal' | 'bulk';
    /** Rate limit pool name (e.g. 'bid_confirmations', 'broadcasts') */
    rateLimitPool?: string;
    /** Required provenance fields for this type */
    requiresProvenance?: string[];
    /** Legitimacy signal requirements */
    legitimacySignals?: {
        /** Critical messages must be sent within N ms of user action */
        maxActionDeltaMs?: number;
        /** Min engagement score for recipient (0-100) */
        minEngagementScore?: number;
        /** Min subscription age in days (for bulk) */
        minSubscriptionAgeDays?: number;
    };
    /** Delivery guarantee level */
    deliveryGuarantee?: 'at_least_once' | 'best_effort';
    /** Engagement tracking config */
    engagementTracking?: {
        /** True = track reply rate, false = track read rate */
        expectReply?: boolean;
    };
}
export interface MessageProvenance {
    /** What triggered this message */
    trigger: 'user_action' | 'user_subscription' | 'system_event';
    /** User action ID (e.g. 'bid_892') */
    user_action_id?: string;
    /** When user action occurred (ms since epoch) */
    action_timestamp?: number;
    /** When subscription was verified (ms since epoch) */
    subscription_verified_at?: number;
}
export interface MessageTypeStats {
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    blocked: number;
    /** Avg time between user action and send (ms) */
    avgActionDeltaMs: number;
    /** Engagement score 0-100, rolling 7-day */
    engagementScore: number;
    /** Last warning timestamp */
    lastWarningAt?: number;
}
export interface MessageTypeWarning {
    type: string;
    metric: 'engagement' | 'action_delta' | 'delivery_rate' | 'blocked_rate';
    current: number;
    threshold: number;
    message: string;
}
export interface MessageTypeRegistryState {
    types: Record<string, MessageTypeDefinition>;
    stats: Record<string, MessageTypeStats>;
    pools: Record<string, {
        sent: number[];
        timestamps: number[];
    }>;
    pendingMessages: Record<string, {
        type: string;
        sentAt: number;
        provenance?: MessageProvenance;
    }>;
    locked: Set<string>;
}
export declare class MessageTypeRegistry {
    private types;
    private stats;
    private pools;
    private pendingMessages;
    private locked;
    /**
     * Register a message type with priority and legitimacy requirements.
     * Registration is immutable after first message of that type is sent.
     */
    registerMessageType(name: string, definition: MessageTypeDefinition): void;
    /**
     * Send a message through the registry.
     * Validates provenance and enforces rate limiting based on priority pool.
     * Returns delay in ms before message can be sent.
     */
    send(sock: {
        sendMessage: (jid: string, content: any, options?: any) => Promise<any>;
    }, jid: string, content: any, options: {
        type: string;
        provenance?: MessageProvenance;
        engagementScore?: number;
    }): Promise<any>;
    /**
     * Record message delivered (status 3 = DELIVERY_ACK)
     */
    recordDelivered(messageId: string): void;
    /**
     * Record message read (status 4 = READ)
     */
    recordRead(messageId: string): void;
    /**
     * Record reply received
     */
    recordReplied(messageId: string): void;
    /**
     * Record message blocked (send failed with block error)
     */
    recordBlocked(_jid: string): void;
    /**
     * Get stats for a message type
     */
    getStats(type: string): MessageTypeStats | null;
    /**
     * Get warnings for all message types.
     * Returns array of warnings where metrics are below thresholds.
     * NEVER auto-throttles — warnings only.
     */
    getWarnings(): MessageTypeWarning[];
    /**
     * Export state for persistence
     */
    exportState(): MessageTypeRegistryState;
    /**
     * Import state from persistence
     */
    importState(state: MessageTypeRegistryState): void;
    /**
     * Clean up old pending messages (call periodically)
     */
    cleanup(): void;
    private updateEngagementScore;
    private getPoolConfig;
}
