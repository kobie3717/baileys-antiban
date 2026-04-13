/**
 * Rate Limiter — Enforces human-like message pacing
 *
 * WhatsApp's detection looks for:
 * - Too many messages per minute/hour
 * - Identical messages to multiple recipients
 * - No variation in timing between messages
 * - Sudden spikes in activity
 * - Messages sent at inhuman speed
 */
export interface RateLimiterConfig {
    /** Max messages per minute (default: 8) */
    maxPerMinute: number;
    /** Max messages per hour (default: 200) */
    maxPerHour: number;
    /** Max messages per day (default: 1500) */
    maxPerDay: number;
    /** Min delay between messages in ms (default: 1500) */
    minDelayMs: number;
    /** Max delay between messages in ms (default: 5000) */
    maxDelayMs: number;
    /** Extra delay for first message to a new chat in ms (default: 3000) */
    newChatDelayMs: number;
    /** Max identical messages before forcing variation (default: 3) */
    maxIdenticalMessages: number;
    /** Burst allowance - messages before rate limiting kicks in (default: 3) */
    burstAllowance: number;
    /** Time window for tracking identical messages in ms (default: 3600000 = 1 hour) */
    identicalMessageWindowMs: number;
}
export interface RateLimiterStats {
    lastMinute: number;
    lastHour: number;
    lastDay: number;
    limits: {
        perMinute: number;
        perHour: number;
        perDay: number;
    };
    knownChats: number;
}
export declare class RateLimiter {
    private config;
    private messages;
    private identicalCount;
    private knownChats;
    private burstCount;
    private lastMessageTime;
    constructor(config?: Partial<RateLimiterConfig>);
    /**
     * Calculate delay before next message can be sent.
     * Returns 0 if message can be sent immediately.
     * Returns -1 if message should be blocked entirely.
     */
    getDelay(recipient: string, content: string): Promise<number>;
    /**
     * Record a sent message
     */
    record(recipient: string, content: string): void;
    /**
     * Get current usage stats
     */
    getStats(): RateLimiterStats;
    private cleanup;
    /** Random delay between min and max (gaussian-ish distribution) */
    private jitter;
    /** Simple hash for content dedup */
    private hashContent;
}
