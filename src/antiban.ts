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

import { RateLimiter, type RateLimiterConfig, type RateLimiterStats } from './rateLimiter.js';
import { WarmUp, type WarmUpConfig, type WarmUpState, type WarmUpStatus } from './warmup.js';
import { HealthMonitor, type HealthMonitorConfig, type HealthStatus } from './health.js';
import { TimelockGuard, type TimelockGuardConfig } from './timelockGuard.js';
import { ReplyRatioGuard, type ReplyRatioConfig, type ReplyRatioStats } from './replyRatio.js';
import { ContactGraphWarmer, type ContactGraphConfig, type ContactGraphStats } from './contactGraph.js';
import { PresenceChoreographer, type PresenceChoreographerConfig, type PresenceChoreographerStats } from './presenceChoreographer.js';
import { RetryReasonTracker, type RetryTrackerConfig, type RetryStats } from './retryTracker.js';
import { PostReconnectThrottle, type ReconnectThrottleConfig, type ReconnectThrottleStats } from './reconnectThrottle.js';
import { LidResolver, type LidResolverConfig, type LidResolverStats } from './lidResolver.js';
import { JidCanonicalizer, type JidCanonicalizerConfig, type JidCanonicalizerStats } from './jidCanonicalizer.js';
import { SessionHealthMonitor, type SessionHealthConfig, type SessionHealthStats } from './sessionStability.js';

export interface AntiBanConfig {
  rateLimiter?: Partial<RateLimiterConfig>;
  warmUp?: Partial<WarmUpConfig>;
  health?: Partial<HealthMonitorConfig>;
  timelock?: Partial<TimelockGuardConfig>;
  replyRatio?: Partial<ReplyRatioConfig>;
  contactGraph?: Partial<ContactGraphConfig>;
  presence?: Partial<PresenceChoreographerConfig>;
  retryTracker?: Partial<RetryTrackerConfig>;
  reconnectThrottle?: Partial<ReconnectThrottleConfig>;
  lidResolver?: LidResolverConfig;      // if set, creates a resolver accessible at antiban.lidResolver
  jidCanonicalizer?: JidCanonicalizerConfig;  // opt-in module
  /** Session stability features (v2.0) — default disabled for backward compatibility */
  sessionStability?: {
    enabled: boolean;
    /** Enable canonical JID normalization before sendMessage (default: true if enabled) */
    canonicalJidNormalization?: boolean;
    /** Enable session health monitoring (default: true if enabled) */
    healthMonitoring?: boolean;
    /** Bad MAC threshold before declaring session degraded (default: 3) */
    badMacThreshold?: number;
    /** Time window for Bad MAC threshold in ms (default: 60000) */
    badMacWindowMs?: number;
  };
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
  replyRatio?: ReplyRatioStats;
  contactGraph?: ContactGraphStats;
  presence?: PresenceChoreographerStats;
  retryTracker?: RetryStats | null;
  reconnectThrottle?: ReconnectThrottleStats | null;
  lidResolver?: LidResolverStats | null;
  jidCanonicalizer?: JidCanonicalizerStats | null;
  sessionStability?: SessionHealthStats | null;
}

export class AntiBan {
  private rateLimiter: RateLimiter;
  private warmUp: WarmUp;
  private health: HealthMonitor;
  private timelockGuard: TimelockGuard;
  private replyRatioGuard: ReplyRatioGuard;
  private contactGraphWarmer: ContactGraphWarmer;
  private presenceChoreographer: PresenceChoreographer;
  private retryTrackerModule: RetryReasonTracker;
  private reconnectThrottleModule: PostReconnectThrottle;
  private lidResolverModule: LidResolver | null = null;
  private jidCanonicalizerModule: JidCanonicalizer | null = null;
  private sessionStabilityMonitor: SessionHealthMonitor | null = null;
  private logging: boolean;

  private stats = {
    messagesAllowed: 0,
    messagesBlocked: 0,
    totalDelayMs: 0,
  };

  constructor(config: AntiBanConfig = {}, warmUpState?: WarmUpState) {
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

    // Initialize LID resolver and canonicalizer if configured
    // If jidCanonicalizer is enabled but no resolver provided, create standalone resolver
    if (config.jidCanonicalizer?.enabled) {
      // Create or use provided resolver
      if (config.jidCanonicalizer.resolver) {
        // User provided their own resolver
        this.jidCanonicalizerModule = new JidCanonicalizer(config.jidCanonicalizer);
        this.lidResolverModule = config.jidCanonicalizer.resolver;
      } else {
        // Create new resolver using lidResolver config if provided
        const resolverConfig = config.lidResolver || config.jidCanonicalizer.resolverConfig;
        const resolver = new LidResolver(resolverConfig);
        this.lidResolverModule = resolver;
        this.jidCanonicalizerModule = new JidCanonicalizer({
          ...config.jidCanonicalizer,
          resolver,
        });
      }
    } else if (config.lidResolver) {
      // Standalone resolver without canonicalizer
      this.lidResolverModule = new LidResolver(config.lidResolver);
    }

    // Initialize session stability monitor if enabled
    if (config.sessionStability?.enabled) {
      const healthConfig: SessionHealthConfig = {
        badMacThreshold: config.sessionStability.badMacThreshold,
        badMacWindowMs: config.sessionStability.badMacWindowMs,
        onDegraded: (stats) => {
          if (this.logging) {
            console.log(`[baileys-antiban] 🔴 SESSION DEGRADED — Bad MAC rate: ${stats.badMacCount} in last ${config.sessionStability?.badMacWindowMs || 60000}ms`);
            console.log(`[baileys-antiban] Consider restarting session or switching to LID-based canonical form`);
          }
        },
        onRecovered: () => {
          if (this.logging) {
            console.log(`[baileys-antiban] 🟢 SESSION RECOVERED — decrypt success rate improved`);
          }
        },
      };
      this.sessionStabilityMonitor = new SessionHealthMonitor(healthConfig);
    }
  }

  /**
   * Check if a message can be sent and get required delay.
   * Call this BEFORE every sendMessage().
   */
  async beforeSend(recipient: string, content: string): Promise<SendDecision> {
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
  afterSend(recipient: string, content: string): void {
    this.rateLimiter.record(recipient, content);
    this.warmUp.record();
    this.replyRatioGuard.recordSent(recipient);
    this.stats.messagesAllowed++;
  }

  /**
   * Record a failed message send
   */
  afterSendFailed(error?: string): void {
    this.health.recordMessageFailed(error);
  }

  /**
   * Record a disconnection (call from connection.update handler)
   */
  onDisconnect(reason: string | number): void {
    this.health.recordDisconnect(reason);
    this.reconnectThrottleModule.onDisconnect();
  }

  /**
   * Record a successful reconnection
   */
  onReconnect(): void {
    this.health.recordReconnect();
    this.reconnectThrottleModule.onReconnect();
  }

  /**
   * Handle incoming message — record in reply ratio + contact graph.
   * Returns suggested reply if reply ratio suggests auto-reply.
   */
  onIncomingMessage(jid: string, msgText?: string): { shouldReply: boolean; suggestedText?: string } {
    this.replyRatioGuard.recordReceived(jid);
    this.contactGraphWarmer.onIncomingMessage(jid);

    return this.replyRatioGuard.suggestReply(jid, msgText);
  }

  /**
   * Get comprehensive stats
   */
  getStats(): AntiBanStats {
    const stats: AntiBanStats = {
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
    if (this.lidResolverModule) {
      stats.lidResolver = this.lidResolverModule.getStats();
    }
    if (this.jidCanonicalizerModule) {
      stats.jidCanonicalizer = this.jidCanonicalizerModule.getStats();
    }
    if (this.sessionStabilityMonitor) {
      stats.sessionStability = this.sessionStabilityMonitor.getStats();
    }

    return stats;
  }

  /** Get the timelock guard for direct access */
  get timelock(): TimelockGuard {
    return this.timelockGuard;
  }

  /** Get the reply ratio guard for direct access */
  get replyRatio(): ReplyRatioGuard {
    return this.replyRatioGuard;
  }

  /** Get the contact graph warmer for direct access */
  get contactGraph(): ContactGraphWarmer {
    return this.contactGraphWarmer;
  }

  /** Get the presence choreographer for direct access */
  get presence(): PresenceChoreographer {
    return this.presenceChoreographer;
  }

  /** Get the retry tracker for direct access */
  get retryTracker(): RetryReasonTracker {
    return this.retryTrackerModule;
  }

  /** Get the reconnect throttle for direct access */
  get reconnectThrottle(): PostReconnectThrottle {
    return this.reconnectThrottleModule;
  }

  /** Get the LID resolver for direct access */
  get lidResolver(): LidResolver | null {
    return this.lidResolverModule;
  }

  /** Get the JID canonicalizer for direct access */
  get jidCanonicalizer(): JidCanonicalizer | null {
    return this.jidCanonicalizerModule;
  }

  /** Get the session stability monitor for direct access */
  get sessionStability(): SessionHealthMonitor | null {
    return this.sessionStabilityMonitor;
  }

  /**
   * Export warm-up state for persistence between restarts
   */
  exportWarmUpState(): WarmUpState {
    return this.warmUp.exportState();
  }

  /**
   * Force pause all sending
   */
  pause(): void {
    this.health.setPaused(true);
    if (this.logging) {
      console.log('[baileys-antiban] ⏸️  Sending paused manually');
    }
  }

  /**
   * Resume sending
   */
  resume(): void {
    this.health.setPaused(false);
    if (this.logging) {
      console.log('[baileys-antiban] ▶️  Sending resumed');
    }
  }

  /**
   * Reset everything (use after a ban period)
   */
  reset(): void {
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
  destroy(): void {
    this.timelockGuard.reset(); // Clears the resumeTimer
    this.replyRatioGuard.reset();
    this.contactGraphWarmer.reset();
    this.presenceChoreographer.reset();
    this.retryTrackerModule.destroy();
    this.reconnectThrottleModule.destroy();
    this.jidCanonicalizerModule?.destroy();
    this.lidResolverModule?.destroy();
    this.sessionStabilityMonitor?.reset();
    if (this.logging) {
      console.log('[baileys-antiban] 🧹 Destroyed — all timers cleared');
    }
  }
}
