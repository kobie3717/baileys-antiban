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
import { RateLimiter } from './rateLimiter.js';
const DEFAULT_POOL_CONFIG = {
    maxPerMinute: 8,
    maxPerHour: 200,
    maxPerDay: 1500,
    minDelayMs: 1500,
    maxDelayMs: 5000,
    newChatDelayMs: 3000,
    maxIdenticalMessages: 3,
    burstAllowance: 3,
    identicalMessageWindowMs: 3600000,
};
export class MessageTypeRegistry {
    types = new Map();
    stats = new Map();
    pools = new Map();
    pendingMessages = new Map();
    locked = new Set();
    /**
     * Register a message type with priority and legitimacy requirements.
     * Registration is immutable after first message of that type is sent.
     */
    registerMessageType(name, definition) {
        if (this.locked.has(name)) {
            throw new Error(`[MessageTypeRegistry] Type '${name}' is locked (messages already sent)`);
        }
        this.types.set(name, { ...definition });
        this.stats.set(name, {
            sent: 0,
            delivered: 0,
            read: 0,
            replied: 0,
            blocked: 0,
            avgActionDeltaMs: 0,
            engagementScore: 100, // Start optimistic
        });
        // Create pool rate limiter if specified
        if (definition.rateLimitPool && !this.pools.has(definition.rateLimitPool)) {
            const poolConfig = this.getPoolConfig(definition.priority);
            this.pools.set(definition.rateLimitPool, {
                limiter: new RateLimiter(poolConfig),
                config: poolConfig,
            });
        }
    }
    /**
     * Send a message through the registry.
     * Validates provenance and enforces rate limiting based on priority pool.
     * Returns delay in ms before message can be sent.
     */
    async send(sock, jid, content, options) {
        const { type, provenance, engagementScore } = options;
        // Validate type is registered
        const definition = this.types.get(type);
        if (!definition) {
            throw new Error(`[MessageTypeRegistry] Type '${type}' not registered`);
        }
        // Lock type after first send
        this.locked.add(type);
        // Validate provenance for critical messages
        if (definition.requiresProvenance && definition.requiresProvenance.length > 0) {
            if (!provenance) {
                throw new Error(`[MessageTypeRegistry] Type '${type}' requires provenance: ${definition.requiresProvenance.join(', ')}`);
            }
            // Check required fields
            for (const field of definition.requiresProvenance) {
                if (!(field in provenance)) {
                    throw new Error(`[MessageTypeRegistry] Type '${type}' requires provenance.${field}`);
                }
            }
        }
        // Validate legitimacy signals
        if (definition.legitimacySignals) {
            const signals = definition.legitimacySignals;
            // Check action delta for critical messages
            if (signals.maxActionDeltaMs !== undefined && provenance?.action_timestamp) {
                const delta = Date.now() - provenance.action_timestamp;
                if (delta > signals.maxActionDeltaMs) {
                    throw new Error(`[MessageTypeRegistry] Type '${type}' maxActionDeltaMs exceeded: ${delta}ms > ${signals.maxActionDeltaMs}ms`);
                }
            }
            // Check engagement score
            if (signals.minEngagementScore !== undefined && engagementScore !== undefined) {
                if (engagementScore < signals.minEngagementScore) {
                    throw new Error(`[MessageTypeRegistry] Type '${type}' minEngagementScore not met: ${engagementScore} < ${signals.minEngagementScore}`);
                }
            }
            // Check subscription age
            if (signals.minSubscriptionAgeDays !== undefined && provenance?.subscription_verified_at) {
                const ageDays = (Date.now() - provenance.subscription_verified_at) / (24 * 60 * 60 * 1000);
                if (ageDays < signals.minSubscriptionAgeDays) {
                    throw new Error(`[MessageTypeRegistry] Type '${type}' minSubscriptionAgeDays not met: ${ageDays.toFixed(1)} < ${signals.minSubscriptionAgeDays}`);
                }
            }
        }
        // Apply rate limiting based on pool
        if (definition.rateLimitPool) {
            const pool = this.pools.get(definition.rateLimitPool);
            if (pool) {
                const text = content?.text || content?.caption || '';
                const delay = await pool.limiter.getDelay(jid, text);
                if (delay === -1) {
                    throw new Error(`[MessageTypeRegistry] Rate limit exceeded for pool '${definition.rateLimitPool}'`);
                }
                if (delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        // Send message
        const result = await sock.sendMessage(jid, content);
        const msgId = result?.key?.id;
        // Record send
        const stat = this.stats.get(type);
        stat.sent++;
        // Track action delta
        if (provenance?.action_timestamp) {
            const delta = Date.now() - provenance.action_timestamp;
            // Rolling average
            stat.avgActionDeltaMs = Math.floor((stat.avgActionDeltaMs * (stat.sent - 1) + delta) / stat.sent);
        }
        // Track pending message for delivery/read/reply tracking
        if (msgId) {
            this.pendingMessages.set(msgId, {
                type,
                sentAt: Date.now(),
                provenance,
            });
        }
        // Record in pool
        if (definition.rateLimitPool) {
            const pool = this.pools.get(definition.rateLimitPool);
            if (pool) {
                pool.limiter.record(jid, content?.text || '');
            }
        }
        return result;
    }
    /**
     * Record message delivered (status 3 = DELIVERY_ACK)
     */
    recordDelivered(messageId) {
        const record = this.pendingMessages.get(messageId);
        if (!record)
            return;
        const stat = this.stats.get(record.type);
        if (stat) {
            stat.delivered++;
            this.updateEngagementScore(record.type);
        }
    }
    /**
     * Record message read (status 4 = READ)
     */
    recordRead(messageId) {
        const record = this.pendingMessages.get(messageId);
        if (!record)
            return;
        const stat = this.stats.get(record.type);
        if (stat) {
            stat.read++;
            this.updateEngagementScore(record.type);
        }
    }
    /**
     * Record reply received
     */
    recordReplied(messageId) {
        const record = this.pendingMessages.get(messageId);
        if (!record)
            return;
        const stat = this.stats.get(record.type);
        if (stat) {
            stat.replied++;
            this.updateEngagementScore(record.type);
        }
        // Clean up after reply
        this.pendingMessages.delete(messageId);
    }
    /**
     * Record message blocked (send failed with block error)
     */
    recordBlocked(_jid) {
        // Find recent messages and mark as blocked
        for (const [_msgId, record] of this.pendingMessages.entries()) {
            // Only count recent blocks (last 5 minutes)
            if (Date.now() - record.sentAt < 5 * 60 * 1000) {
                const stat = this.stats.get(record.type);
                if (stat) {
                    stat.blocked++;
                    this.updateEngagementScore(record.type);
                }
            }
        }
    }
    /**
     * Get stats for a message type
     */
    getStats(type) {
        const stat = this.stats.get(type);
        return stat ? { ...stat } : null;
    }
    /**
     * Get warnings for all message types.
     * Returns array of warnings where metrics are below thresholds.
     * NEVER auto-throttles — warnings only.
     */
    getWarnings() {
        const warnings = [];
        const now = Date.now();
        for (const [type, stat] of this.stats.entries()) {
            // Skip types with insufficient data
            if (stat.sent < 10)
                continue;
            // Engagement score warning (threshold: 50)
            if (stat.engagementScore < 50) {
                warnings.push({
                    type,
                    metric: 'engagement',
                    current: stat.engagementScore,
                    threshold: 50,
                    message: `Low engagement score for '${type}': ${stat.engagementScore.toFixed(1)}/100`,
                });
                const s = this.stats.get(type);
                s.lastWarningAt = now;
            }
            // Delivery rate warning (threshold: 70%)
            const deliveryRate = stat.sent > 0 ? stat.delivered / stat.sent : 1;
            if (deliveryRate < 0.7 && stat.sent >= 20) {
                warnings.push({
                    type,
                    metric: 'delivery_rate',
                    current: deliveryRate,
                    threshold: 0.7,
                    message: `Low delivery rate for '${type}': ${(deliveryRate * 100).toFixed(1)}%`,
                });
                const s = this.stats.get(type);
                s.lastWarningAt = now;
            }
            // Blocked rate warning (threshold: 10%)
            const blockedRate = stat.sent > 0 ? stat.blocked / stat.sent : 0;
            if (blockedRate > 0.1 && stat.sent >= 20) {
                warnings.push({
                    type,
                    metric: 'blocked_rate',
                    current: blockedRate,
                    threshold: 0.1,
                    message: `High blocked rate for '${type}': ${(blockedRate * 100).toFixed(1)}%`,
                });
                const s = this.stats.get(type);
                s.lastWarningAt = now;
            }
            // Action delta warning for critical messages (threshold: 5 seconds)
            const definition = this.types.get(type);
            if (definition?.priority === 'critical' && stat.avgActionDeltaMs > 5000 && stat.sent >= 10) {
                warnings.push({
                    type,
                    metric: 'action_delta',
                    current: stat.avgActionDeltaMs,
                    threshold: 5000,
                    message: `High action delta for '${type}': ${(stat.avgActionDeltaMs / 1000).toFixed(1)}s`,
                });
                const s = this.stats.get(type);
                s.lastWarningAt = now;
            }
        }
        return warnings;
    }
    /**
     * Export state for persistence
     */
    exportState() {
        const poolsState = {};
        for (const [name, _pool] of this.pools.entries()) {
            poolsState[name] = {
                sent: [],
                timestamps: [],
            };
        }
        return {
            types: Object.fromEntries(this.types.entries()),
            stats: Object.fromEntries(this.stats.entries()),
            pools: poolsState,
            pendingMessages: Object.fromEntries(this.pendingMessages.entries()),
            locked: Array.from(this.locked), // Will be converted to Set on import
        };
    }
    /**
     * Import state from persistence
     */
    importState(state) {
        // Restore types
        this.types = new Map(Object.entries(state.types));
        // Restore stats
        this.stats = new Map(Object.entries(state.stats));
        // Restore pools (recreate rate limiters)
        for (const [_name, definition] of this.types.entries()) {
            if (definition.rateLimitPool && !this.pools.has(definition.rateLimitPool)) {
                const poolConfig = this.getPoolConfig(definition.priority);
                this.pools.set(definition.rateLimitPool, {
                    limiter: new RateLimiter(poolConfig),
                    config: poolConfig,
                });
            }
        }
        // Restore pending messages
        this.pendingMessages = new Map(Object.entries(state.pendingMessages));
        // Restore locked types
        this.locked = new Set(Array.isArray(state.locked) ? state.locked : []);
    }
    /**
     * Clean up old pending messages (call periodically)
     */
    cleanup() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        for (const [msgId, record] of this.pendingMessages.entries()) {
            if (now - record.sentAt > maxAge) {
                this.pendingMessages.delete(msgId);
            }
        }
    }
    updateEngagementScore(type) {
        const stat = this.stats.get(type);
        if (!stat || stat.sent === 0)
            return;
        // Engagement score = weighted: (read*0.3 + replied*0.5 + (1-blocked)*0.2) × 100
        // Rolling 7-day window (use all stats for simplicity)
        const readRate = stat.read / stat.sent;
        const replyRate = stat.replied / stat.sent;
        const notBlockedRate = 1 - (stat.blocked / stat.sent);
        stat.engagementScore = Math.round((readRate * 0.3 + replyRate * 0.5 + notBlockedRate * 0.2) * 100);
    }
    getPoolConfig(priority) {
        switch (priority) {
            case 'critical':
                return {
                    ...DEFAULT_POOL_CONFIG,
                    maxPerMinute: 5,
                    maxPerHour: 100,
                    maxPerDay: 500,
                };
            case 'bulk':
                return {
                    ...DEFAULT_POOL_CONFIG,
                    maxPerMinute: 15,
                    maxPerHour: 300,
                    maxPerDay: 2000,
                    minDelayMs: 1000,
                    maxDelayMs: 3000,
                };
            default:
                return DEFAULT_POOL_CONFIG;
        }
    }
}
