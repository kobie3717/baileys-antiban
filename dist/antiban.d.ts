/**
 * AntiBan — Main orchestrator combining rate limiting, warm-up, and health monitoring
 *
 * Usage:
 *   import { AntiBan } from 'baileys-antiban';
 *   const antiban = new AntiBan();
 *
 *   // Before sending a message:
 *   const result = await antiban.beforeSend(recipient, content);
 *   if (result.allowed) {
 *     await new Promise(r => setTimeout(r, result.delayMs));
 *     await sock.sendMessage(recipient, { text: content });
 *     antiban.afterSend(recipient, content);
 *   }
 */
import { type RateLimiterConfig, type RateLimiterStats } from './rateLimiter.js';
import { type WarmUpConfig, type WarmUpState, type WarmUpStatus } from './warmup.js';
import { type HealthMonitorConfig, type HealthStatus } from './health.js';
import { TimelockGuard, type TimelockGuardConfig } from './timelockGuard.js';
export interface AntiBanConfig {
    rateLimiter?: Partial<RateLimiterConfig>;
    warmUp?: Partial<WarmUpConfig>;
    health?: Partial<HealthMonitorConfig>;
    timelock?: Partial<TimelockGuardConfig>;
    /** Log warnings and blocks to console (default: true) */
    logging?: boolean;
}
export interface SendDecision {
    allowed: boolean;
    delayMs: number;
    reason?: string;
    health: HealthStatus;
    warmUpDay?: number;
}
export interface AntiBanStats {
    messagesAllowed: number;
    messagesBlocked: number;
    totalDelayMs: number;
    health: HealthStatus;
    warmUp: WarmUpStatus;
    rateLimiter: RateLimiterStats;
}
export declare class AntiBan {
    private rateLimiter;
    private warmUp;
    private health;
    private timelockGuard;
    private logging;
    private stats;
    constructor(config?: AntiBanConfig, warmUpState?: WarmUpState);
    /**
     * Check if a message can be sent and get required delay.
     * Call this BEFORE every sendMessage().
     */
    beforeSend(recipient: string, content: string): Promise<SendDecision>;
    /**
     * Record a successfully sent message.
     * Call this AFTER every successful sendMessage().
     */
    afterSend(recipient: string, content: string): void;
    /**
     * Record a failed message send
     */
    afterSendFailed(error?: string): void;
    /**
     * Record a disconnection (call from connection.update handler)
     */
    onDisconnect(reason: string | number): void;
    /**
     * Record a successful reconnection
     */
    onReconnect(): void;
    /**
     * Get comprehensive stats
     */
    getStats(): AntiBanStats;
    /** Get the timelock guard for direct access */
    get timelock(): TimelockGuard;
    /**
     * Export warm-up state for persistence between restarts
     */
    exportWarmUpState(): WarmUpState;
    /**
     * Force pause all sending
     */
    pause(): void;
    /**
     * Resume sending
     */
    resume(): void;
    /**
     * Reset everything (use after a ban period)
     */
    reset(): void;
    /**
     * Clean up all timers and resources.
     * Call this when disposing of the AntiBan instance or when the socket closes.
     */
    destroy(): void;
}
