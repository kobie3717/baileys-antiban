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
import { RateLimiter } from './rateLimiter.js';
import { WarmUp } from './warmup.js';
import { HealthMonitor } from './health.js';
import { TimelockGuard } from './timelockGuard.js';
export class AntiBan {
    rateLimiter;
    warmUp;
    health;
    timelockGuard;
    logging;
    stats = {
        messagesAllowed: 0,
        messagesBlocked: 0,
        totalDelayMs: 0,
    };
    constructor(config = {}, warmUpState) {
        this.rateLimiter = new RateLimiter(config.rateLimiter);
        this.warmUp = new WarmUp(config.warmUp, warmUpState);
        this.health = new HealthMonitor({
            ...config.health,
            onRiskChange: (status) => {
                if (this.logging) {
                    const emoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' };
                    console.log(`[baileys-antiban] ${emoji[status.risk]} Risk level: ${status.risk.toUpperCase()} (score: ${status.score})`);
                    console.log(`[baileys-antiban] ${status.recommendation}`);
                    status.reasons.forEach(r => console.log(`[baileys-antiban]   → ${r}`));
                }
                config.health?.onRiskChange?.(status);
            },
        });
        this.logging = config.logging ?? true;
        this.timelockGuard = new TimelockGuard({
            ...config.timelock,
            onTimelockDetected: (state) => {
                this.health.recordReachoutTimelock(state.enforcementType);
                if (this.logging) {
                    console.log(`[baileys-antiban] REACHOUT TIMELOCKED — ${state.enforcementType || 'unknown'}, expires ${state.expiresAt?.toISOString() || 'unknown'}`);
                }
                config.timelock?.onTimelockDetected?.(state);
            },
            onTimelockLifted: (state) => {
                if (this.logging) {
                    console.log(`[baileys-antiban] Timelock lifted — resuming new contact messages`);
                }
                config.timelock?.onTimelockLifted?.(state);
            },
        });
    }
    /**
     * Check if a message can be sent and get required delay.
     * Call this BEFORE every sendMessage().
     */
    async beforeSend(recipient, content) {
        const healthStatus = this.health.getStatus();
        // Health monitor says stop
        if (this.health.isPaused()) {
            this.stats.messagesBlocked++;
            if (this.logging) {
                console.log(`[baileys-antiban] ⛔ BLOCKED — health risk too high (${healthStatus.risk})`);
            }
            return {
                allowed: false,
                delayMs: 0,
                reason: `Health risk ${healthStatus.risk}: ${healthStatus.recommendation}`,
                health: healthStatus,
            };
        }
        // Timelock guard (allows existing chats, blocks new contacts)
        const timelockDecision = this.timelockGuard.canSend(recipient);
        if (!timelockDecision.allowed) {
            this.stats.messagesBlocked++;
            if (this.logging) {
                console.log(`[baileys-antiban] TIMELOCKED — ${timelockDecision.reason}`);
            }
            return {
                allowed: false,
                delayMs: 0,
                reason: timelockDecision.reason,
                health: healthStatus,
            };
        }
        // Warm-up limit check
        if (!this.warmUp.canSend()) {
            this.stats.messagesBlocked++;
            const warmUpStatus = this.warmUp.getStatus();
            if (this.logging) {
                console.log(`[baileys-antiban] ⏳ BLOCKED — warm-up day ${warmUpStatus.day}/${warmUpStatus.totalDays}, limit reached (${warmUpStatus.todaySent}/${warmUpStatus.todayLimit})`);
            }
            return {
                allowed: false,
                delayMs: 0,
                reason: `Warm-up limit: ${warmUpStatus.todaySent}/${warmUpStatus.todayLimit} messages today (day ${warmUpStatus.day})`,
                health: healthStatus,
                warmUpDay: warmUpStatus.day,
            };
        }
        // Rate limiter delay
        const delay = await this.rateLimiter.getDelay(recipient, content);
        if (delay === -1) {
            this.stats.messagesBlocked++;
            if (this.logging) {
                console.log(`[baileys-antiban] 🚫 BLOCKED — rate limit or identical message spam`);
            }
            return {
                allowed: false,
                delayMs: 0,
                reason: 'Rate limit exceeded or identical message spam detected',
                health: healthStatus,
            };
        }
        this.stats.totalDelayMs += delay;
        return {
            allowed: true,
            delayMs: delay,
            health: healthStatus,
        };
    }
    /**
     * Record a successfully sent message.
     * Call this AFTER every successful sendMessage().
     */
    afterSend(recipient, content) {
        this.rateLimiter.record(recipient, content);
        this.warmUp.record();
        this.stats.messagesAllowed++;
    }
    /**
     * Record a failed message send
     */
    afterSendFailed(error) {
        this.health.recordMessageFailed(error);
    }
    /**
     * Record a disconnection (call from connection.update handler)
     */
    onDisconnect(reason) {
        this.health.recordDisconnect(reason);
    }
    /**
     * Record a successful reconnection
     */
    onReconnect() {
        this.health.recordReconnect();
    }
    /**
     * Get comprehensive stats
     */
    getStats() {
        return {
            ...this.stats,
            health: this.health.getStatus(),
            warmUp: this.warmUp.getStatus(),
            rateLimiter: this.rateLimiter.getStats(),
        };
    }
    /** Get the timelock guard for direct access */
    get timelock() {
        return this.timelockGuard;
    }
    /**
     * Export warm-up state for persistence between restarts
     */
    exportWarmUpState() {
        return this.warmUp.exportState();
    }
    /**
     * Force pause all sending
     */
    pause() {
        this.health.setPaused(true);
        if (this.logging) {
            console.log('[baileys-antiban] ⏸️  Sending paused manually');
        }
    }
    /**
     * Resume sending
     */
    resume() {
        this.health.setPaused(false);
        if (this.logging) {
            console.log('[baileys-antiban] ▶️  Sending resumed');
        }
    }
    /**
     * Reset everything (use after a ban period)
     */
    reset() {
        this.timelockGuard.reset();
        this.health.reset();
        this.warmUp.reset();
        this.stats = { messagesAllowed: 0, messagesBlocked: 0, totalDelayMs: 0 };
        if (this.logging) {
            console.log('[baileys-antiban] 🔄 Reset — starting fresh warm-up');
        }
    }
    /**
     * Clean up all timers and resources.
     * Call this when disposing of the AntiBan instance or when the socket closes.
     */
    destroy() {
        this.timelockGuard.reset(); // Clears the resumeTimer
        if (this.logging) {
            console.log('[baileys-antiban] 🧹 Destroyed — all timers cleared');
        }
    }
}
