/**
 * Unified State Export — Single-call export/import of ALL antiban state
 *
 * Enables Redis failover and cross-instance state migration.
 * CRDT-safe rate limit counters using increment-only approach.
 *
 * Features:
 * - Single snapshot of all module states
 * - CRDT-safe rate limiter state (never overwrites higher counts)
 * - Version tracking for migration
 * - Instance tracking for debugging
 */
import type { WarmUpState } from './warmup.js';
import type { MessageTypeRegistryState } from './messageTypeRegistry.js';
import type { TopologyThrottlerState } from './topologyThrottler.js';
import type { ReputationVoucherState } from './reputationVoucher.js';
export interface DisconnectEvent {
    type: 'disconnect' | 'forbidden' | 'loggedOut' | 'messageFailed' | 'reconnect' | 'reachoutTimelocked';
    timestamp: number;
    detail?: string;
}
export interface CircuitState {
    jid: string;
    state: 'open' | 'half-open' | 'closed';
    failures: number;
    openedAt: number | null;
    halfOpenProbeUsed?: boolean;
}
export interface RateLimiterState {
    /** Message records for time-window tracking */
    messages: Array<{
        timestamp: number;
        recipient: string;
        contentHash: string;
    }>;
    /** Known chat JIDs */
    knownChats: string[];
    /** Identical message tracking */
    identicalCount: Record<string, {
        count: number;
        firstSeen: number;
        lastSeen: number;
    }>;
    /** Burst count */
    burstCount: number;
    /** Last message timestamp */
    lastMessageTime: number;
    /** Current adaptive factor */
    currentFactor: number;
    /** Increment-only counter for CRDT safety */
    sentSinceExport: number;
}
export interface TimelockGuardState {
    active: boolean;
    expiresAt?: number;
    affectedJids: string[];
    enforcementType?: string;
}
export interface AntibanSnapshot {
    /** Schema version for migration */
    version: number;
    /** Export timestamp (ms since epoch) */
    exportedAt: number;
    /** Which instance exported this snapshot */
    instanceId: string;
    /** Warm-up state */
    warmup?: WarmUpState;
    /** Health monitor state */
    health?: {
        riskScore: number;
        disconnectEvents: DisconnectEvent[];
    };
    /** Rate limiter state (CRDT-safe) */
    rateLimiter?: RateLimiterState;
    /** Circuit breaker states */
    circuits?: CircuitState[];
    /** Timelock guard state */
    timelockGuard?: TimelockGuardState;
    /** Message type registry state */
    messageRegistry?: MessageTypeRegistryState;
    /** Topology throttler state */
    topologyThrottler?: TopologyThrottlerState;
    /** Reputation voucher state */
    reputationVoucher?: ReputationVoucherState;
    /** Per-JID engagement scores */
    engagementScores?: Record<string, number>;
}
/**
 * Export antiban state from individual modules.
 * Call with references to active module instances.
 */
export declare function exportAntibanState(modules: {
    warmup?: {
        exportState: () => WarmUpState;
    };
    health?: {
        getStatus: () => any;
    };
    rateLimiter?: {
        getStats: () => any;
        getKnownChats: () => Set<string>;
        getCurrentFactor: () => number;
    };
    circuits?: {
        exportState?: () => Array<{
            jid: string;
            state: 'open' | 'half-open' | 'closed';
            failures: number;
            openedAt: number | null;
            halfOpenProbeUsed?: boolean;
        }>;
    };
    timelockGuard?: {
        getState: () => {
            isActive: boolean;
            expiresAt?: Date;
            enforcementType?: string;
        };
        getKnownChats?: () => Set<string>;
    };
    messageRegistry?: {
        exportState: () => MessageTypeRegistryState;
    };
    topologyThrottler?: {
        exportState: () => TopologyThrottlerState;
    };
    reputationVoucher?: {
        exportState: () => ReputationVoucherState;
    };
    engagementScores?: Map<string, number>;
    instanceId?: string;
}): AntibanSnapshot;
/**
 * Import antiban state into modules.
 * CRDT-safe for rate limiters (never overwrites higher counts).
 */
export declare function importAntibanState(snapshot: AntibanSnapshot, modules: {
    warmup?: {
        importState?: (state: WarmUpState) => void;
    };
    health?: {
        reset?: () => void;
    };
    rateLimiter?: {
        restoreKnownChats: (chats: string[]) => void;
        adaptLimits: (factor: number) => void;
        getStats: () => any;
    };
    circuits?: {
        importState?: (states: Array<{
            jid: string;
            state: 'open' | 'half-open' | 'closed';
            failures: number;
            openedAt: number | null;
            halfOpenProbeUsed?: boolean;
        }>) => void;
    };
    timelockGuard?: {
        reset: () => void;
        onTimelockUpdate?: (update: any) => void;
        registerKnownChats?: (jids: string[]) => void;
    };
    messageRegistry?: {
        importState: (state: MessageTypeRegistryState) => void;
    };
    topologyThrottler?: {
        importState: (state: TopologyThrottlerState) => void;
    };
    reputationVoucher?: {
        importState: (state: ReputationVoucherState) => void;
    };
    engagementScores?: Map<string, number>;
}): void;
