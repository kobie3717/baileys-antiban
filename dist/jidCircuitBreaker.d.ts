/**
 * JID Circuit Breaker — Per-recipient circuit breaker for send protection
 *
 * Tracks failures per JID and opens circuit after threshold to prevent
 * cascading failures and reduce ban risk on problematic recipients.
 *
 * State machine:
 * - closed: Normal operation, sends allowed
 * - open: Threshold exceeded, sends blocked until cooldown
 * - half-open: Cooldown elapsed, allow one probe send
 *
 * Usage:
 *   const breaker = createJidCircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
 *   if (!breaker.canSend(jid)) throw new Error('circuit open');
 *   // ... send message ...
 *   breaker.recordSuccess(jid);  // or recordFailure(jid)
 */
export interface JidCircuitBreakerConfig {
    failureThreshold?: number;
    cooldownMs?: number;
    logger?: {
        warn(msg: string, ctx?: object): void;
        info(msg: string, ctx?: object): void;
    };
}
export type CircuitState = 'closed' | 'open' | 'half-open';
export interface JidCircuitBreakerStats {
    open: number;
    halfOpen: number;
    closed: number;
    total: number;
}
export declare class JidCircuitBreaker {
    private readonly failureThreshold;
    private readonly cooldownMs;
    private readonly logger?;
    private readonly circuits;
    constructor(config?: JidCircuitBreakerConfig);
    private evictStale;
    private getOrCreateEntry;
    canSend(jid: string): boolean;
    recordSuccess(jid: string): void;
    recordFailure(jid: string): void;
    getState(jid: string): CircuitState;
    getJitter(isBroadcast: boolean): number;
    getStats(): JidCircuitBreakerStats;
    /**
     * BUG FIX 2: Export all circuit states for persistence
     * Returns array of { jid, state, failures, openedAt, halfOpenProbeUsed }
     */
    exportState(): Array<{
        jid: string;
        state: CircuitState;
        failures: number;
        openedAt: number | null;
        halfOpenProbeUsed: boolean;
    }>;
    /**
     * BUG FIX 2: Import circuit states from persistence
     * Restores open/half-open circuits so blocked JIDs remain blocked after restart
     */
    importState(states: Array<{
        jid: string;
        state: CircuitState;
        failures: number;
        openedAt: number | null;
        halfOpenProbeUsed?: boolean;
    }>): void;
}
export declare function createJidCircuitBreaker(config?: JidCircuitBreakerConfig): JidCircuitBreaker;
