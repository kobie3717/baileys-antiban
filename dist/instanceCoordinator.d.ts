/**
 * InstanceCoordinator — cross-process rate pool via shared state file
 *
 * Problem: N bot instances on the same IP each enforce their own per-minute
 * limit. Collectively they can exceed safe IP-level thresholds.
 *
 * Solution: shared JSON file updated on every send. Each instance reads the
 * shared pool before sending and deducts from a shared per-minute budget.
 *
 * File format: { sends: number[], updatedAt: number }
 *   sends = array of timestamps (ms) of recent sends across ALL instances
 *
 * Coordination model: optimistic read-modify-write with rename-swap atomicity.
 * Race window is tiny (sub-ms) and consequences are minor (brief over-limit).
 * No hard lock needed — this is best-effort coordination, not a mutex.
 */
export interface InstanceCoordinatorConfig {
    /** Path to shared coordination file (all instances must use same path) */
    sharedFilePath: string;
    /** Max sends per minute across ALL instances (default: 20) */
    poolMaxPerMinute?: number;
    /** Max sends per hour across ALL instances (default: 500) */
    poolMaxPerHour?: number;
    /** How long to wait if pool is exhausted, ms (default: 5000) */
    poolExhaustedDelayMs?: number;
    /** Stale file threshold — ignore entries older than this, ms (default: 120000 = 2min) */
    staleThresholdMs?: number;
}
export interface InstanceCoordinatorStats {
    poolSendsLastMinute: number;
    poolSendsLastHour: number;
    poolMaxPerMinute: number;
    poolMaxPerHour: number;
    poolUtilization: number;
    coordinationFilePath: string;
}
export declare class InstanceCoordinator {
    private config;
    constructor(config: InstanceCoordinatorConfig);
    /**
     * Try to acquire a send slot from the shared pool.
     * Returns { allowed: true } if send is allowed, or { allowed: false, retryAfterMs } if pool is exhausted.
     */
    tryAcquireSlot(): {
        allowed: boolean;
        retryAfterMs?: number;
    };
    /**
     * Get current statistics for the shared pool
     */
    getStats(): InstanceCoordinatorStats;
    /**
     * Read coordination state from file. Returns empty state if file doesn't exist.
     */
    private readState;
    /**
     * Write coordination state to file atomically using rename-swap
     */
    private writeState;
}
