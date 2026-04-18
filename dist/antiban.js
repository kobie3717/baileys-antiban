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
import { ReplyRatioGuard } from './replyRatio.js';
import { ContactGraphWarmer } from './contactGraph.js';
import { PresenceChoreographer } from './presenceChoreographer.js';
import { RetryReasonTracker } from './retryTracker.js';
import { PostReconnectThrottle } from './reconnectThrottle.js';
export class AntiBan {
    rateLimiter;
    warmUp;
    health;
    timelockGuard;
    replyRatioGuard;
    contactGraphWarmer;
    presenceChoreographer;
    retryTrackerModule;
    reconnectThrottleModule;
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
        this.replyRatioGuard = new ReplyRatioGuard(config.replyRatio);
        this.contactGraphWarmer = new ContactGraphWarmer(config.contactGraph);
        this.presenceChoreographer = new PresenceChoreographer(config.presence);
        this.retryTrackerModule = new RetryReasonTracker({
            ...config.retryTracker,
            onSpiral: (msgId, reason) => {
                if (this.logging) {
                    console.log(`[baileys-antiban] ⚠️  Message ${msgId} stuck in retry spiral (${reason})`);
                }
                config.retryTracker?.onSpiral?.(msgId, reason);
            },
        });
        this.reconnectThrottleModule = new PostReconnectThrottle({
            ...config.reconnectThrottle,
            baselineRatePerMinute: () => this.rateLimiter.getStats().limits.perMinute,
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
        // Contact graph check
        const contactGraphDecision = this.contactGraphWarmer.canMessage(recipient);
        if (!contactGraphDecision.allowed) {
            this.stats.messagesBlocked++;
            if (this.logging) {
                console.log(`[baileys-antiban] 📊 BLOCKED — contact graph: ${contactGraphDecision.reason}`);
            }
            return {
                allowed: false,
                delayMs: 0,
                reason: `Contact graph: ${contactGraphDecision.reason}`,
                health: healthStatus,
            };
        }
        // Reply ratio check
        const replyRatioDecision = this.replyRatioGuard.beforeSend(recipient);
        if (!replyRatioDecision.allowed) {
            this.stats.messagesBlocked++;
            if (this.logging) {
                console.log(`[baileys-antiban] 💬 BLOCKED — reply ratio: ${replyRatioDecision.reason}`);
            }
            return {
                allowed: false,
                delayMs: 0,
                reason: `Reply ratio: ${replyRatioDecision.reason}`,
                health: healthStatus,
            };
        }
        // Reconnect throttle check
        const reconnectThrottleDecision = this.reconnectThrottleModule.beforeSend();
        if (!reconnectThrottleDecision.allowed) {
            this.stats.messagesBlocked++;
            if (this.logging) {
                console.log(`[baileys-antiban] 🔄 BLOCKED — reconnect throttle: ${reconnectThrottleDecision.reason}`);
            }
            return {
                allowed: false,
                delayMs: reconnectThrottleDecision.retryAfterMs || 0,
                reason: reconnectThrottleDecision.reason || 'Post-reconnect throttle',
                health: healthStatus,
            };
        }
        // Rate limiter delay
        let delay = await this.rateLimiter.getDelay(recipient, content);
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
        // Apply circadian rhythm multiplier to delay
        const activityFactor = this.presenceChoreographer.getCurrentActivityFactor();
        if (activityFactor < 1.0) {
            // Lower activity = longer delays (cap at 5x)
            const multiplier = Math.min(5, 1 / activityFactor);
            delay = Math.floor(delay * multiplier);
        }
        // Roll for distraction pause
        const distractionCheck = this.presenceChoreographer.shouldPauseForDistraction();
        if (distractionCheck.pause) {
            delay += distractionCheck.durationMs;
            if (this.logging) {
                console.log(`[baileys-antiban] ⏸️  Distraction pause: +${Math.floor(distractionCheck.durationMs / 60000)}min`);
            }
        }
        // Roll for offline gap
        const offlineCheck = this.presenceChoreographer.shouldTakeOfflineGap();
        if (offlineCheck.offline) {
            delay += offlineCheck.durationMs;
            if (this.logging) {
                console.log(`[baileys-antiban] 📴 Offline gap: +${Math.floor(offlineCheck.durationMs / 60000)}min`);
            }
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
        this.replyRatioGuard.recordSent(recipient);
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
        this.reconnectThrottleModule.onDisconnect();
    }
    /**
     * Record a successful reconnection
     */
    onReconnect() {
        this.health.recordReconnect();
        this.reconnectThrottleModule.onReconnect();
    }
    /**
     * Handle incoming message — record in reply ratio + contact graph.
     * Returns suggested reply if reply ratio suggests auto-reply.
     */
    onIncomingMessage(jid, msgText) {
        this.replyRatioGuard.recordReceived(jid);
        this.contactGraphWarmer.onIncomingMessage(jid);
        return this.replyRatioGuard.suggestReply(jid, msgText);
    }
    /**
     * Get comprehensive stats
     */
    getStats() {
        const stats = {
            ...this.stats,
            health: this.health.getStatus(),
            warmUp: this.warmUp.getStatus(),
            rateLimiter: this.rateLimiter.getStats(),
        };
        // Only include new stats if enabled
        if (this.replyRatioGuard['config']?.enabled) {
            stats.replyRatio = this.replyRatioGuard.getStats();
        }
        if (this.contactGraphWarmer['config']?.enabled) {
            stats.contactGraph = this.contactGraphWarmer.getStats();
        }
        if (this.presenceChoreographer['config']?.enabled) {
            stats.presence = this.presenceChoreographer.getStats();
        }
        if (this.retryTrackerModule['config']?.enabled) {
            stats.retryTracker = this.retryTrackerModule.getStats();
        }
        if (this.reconnectThrottleModule['config']?.enabled) {
            stats.reconnectThrottle = this.reconnectThrottleModule.getStats();
        }
        return stats;
    }
    /** Get the timelock guard for direct access */
    get timelock() {
        return this.timelockGuard;
    }
    /** Get the reply ratio guard for direct access */
    get replyRatio() {
        return this.replyRatioGuard;
    }
    /** Get the contact graph warmer for direct access */
    get contactGraph() {
        return this.contactGraphWarmer;
    }
    /** Get the presence choreographer for direct access */
    get presence() {
        return this.presenceChoreographer;
    }
    /** Get the retry tracker for direct access */
    get retryTracker() {
        return this.retryTrackerModule;
    }
    /** Get the reconnect throttle for direct access */
    get reconnectThrottle() {
        return this.reconnectThrottleModule;
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
        this.replyRatioGuard.reset();
        this.contactGraphWarmer.reset();
        this.presenceChoreographer.reset();
        this.retryTrackerModule.destroy();
        this.reconnectThrottleModule.destroy();
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
        this.replyRatioGuard.reset();
        this.contactGraphWarmer.reset();
        this.presenceChoreographer.reset();
        this.retryTrackerModule.destroy();
        this.reconnectThrottleModule.destroy();
        if (this.logging) {
            console.log('[baileys-antiban] 🧹 Destroyed — all timers cleared');
        }
    }
}
