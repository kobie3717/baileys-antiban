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
import { TopologyThrottler, type TopologyThrottlerConfig } from './topologyThrottler.js';
import { PostReconnectThrottle, type ReconnectThrottleConfig, type ReconnectThrottleStats } from './reconnectThrottle.js';
import { LidResolver, type LidResolverConfig, type LidResolverStats } from './lidResolver.js';
import { JidCanonicalizer, type JidCanonicalizerConfig, type JidCanonicalizerStats } from './jidCanonicalizer.js';
import { SessionHealthMonitor, type SessionHealthConfig, type SessionHealthStats } from './sessionStability.js';
import { BanRecoveryOrchestrator, type RecoveryStatus } from './banRecoveryOrchestrator.js';
import { resolveConfig, type AntiBanInput, type ResolvedConfig } from './presets.js';
import { StateManager, type PersistedState } from './persist.js';
import { shouldUseGroupProfile, applyGroupMultiplier } from './profiles.js';
import { DeliveryTracker, type DeliveryTrackerStats } from './deliveryTracker.js';
import { InstanceCoordinator, type InstanceCoordinatorStats } from './instanceCoordinator.js';
import { MessageTypeRegistry } from './messageTypeRegistry.js';
import { exportAntibanState, importAntibanState, type AntibanSnapshot } from './stateExport.js';
import { ReputationVoucher } from './reputationVoucher.js';
import { JidCircuitBreaker } from './jidCircuitBreaker.js';

// Legacy v2 nested config shape — kept for compat shim
export interface AntiBanConfigLegacy {
  rateLimiter?: Partial<RateLimiterConfig>;
  warmUp?: Partial<WarmUpConfig>;
  health?: Partial<HealthMonitorConfig>;
  timelock?: Partial<TimelockGuardConfig>;
  replyRatio?: Partial<ReplyRatioConfig>;
  contactGraph?: Partial<ContactGraphConfig>;
  presence?: Partial<PresenceChoreographerConfig>;
  retryTracker?: Partial<RetryTrackerConfig>;
  reconnectThrottle?: Partial<ReconnectThrottleConfig>;
  topologyThrottler?: Partial<TopologyThrottlerConfig>;
  lidResolver?: LidResolverConfig;
  jidCanonicalizer?: JidCanonicalizerConfig;
  sessionStability?: {
    enabled: boolean;
    canonicalJidNormalization?: boolean;
    healthMonitoring?: boolean;
    badMacThreshold?: number;
    badMacWindowMs?: number;
  };
  logging?: boolean;
}

// v3 flat config (exported for type-safe usage) — also allows legacy for backward compat
export type AntiBanConfig = AntiBanInput | AntiBanConfigLegacy;

function isLegacyConfig(cfg: unknown): cfg is AntiBanConfigLegacy {
  if (typeof cfg !== 'object' || cfg === null) return false;
  return 'rateLimiter' in cfg || 'warmUp' in cfg || 'health' in cfg || 'timelock' in cfg ||
    'replyRatio' in cfg || 'contactGraph' in cfg || 'presence' in cfg || 'retryTracker' in cfg ||
    'reconnectThrottle' in cfg || 'lidResolver' in cfg || 'jidCanonicalizer' in cfg ||
    'sessionStability' in cfg;
}

function mapLegacyToFlat(legacy: AntiBanConfigLegacy): Partial<ResolvedConfig> {
  console.warn(
    '[baileys-antiban] DEPRECATED: Nested config (v2 style) detected. ' +
    'Migrate to flat config: new AntiBan({ maxPerMinute: 8 }). ' +
    'See: https://github.com/kobie3717/baileys-antiban#migration'
  );
  const flat: Partial<ResolvedConfig> = {};
  if (legacy.rateLimiter?.maxPerMinute !== undefined) flat.maxPerMinute = legacy.rateLimiter.maxPerMinute;
  if (legacy.rateLimiter?.maxPerHour !== undefined) flat.maxPerHour = legacy.rateLimiter.maxPerHour;
  if (legacy.rateLimiter?.maxPerDay !== undefined) flat.maxPerDay = legacy.rateLimiter.maxPerDay;
  if (legacy.rateLimiter?.minDelayMs !== undefined) flat.minDelayMs = legacy.rateLimiter.minDelayMs;
  if (legacy.rateLimiter?.maxDelayMs !== undefined) flat.maxDelayMs = legacy.rateLimiter.maxDelayMs;
  if (legacy.rateLimiter?.newChatDelayMs !== undefined) flat.newChatDelayMs = legacy.rateLimiter.newChatDelayMs;
  if (legacy.warmUp?.warmUpDays !== undefined) flat.warmupDays = legacy.warmUp.warmUpDays;
  if (legacy.warmUp?.day1Limit !== undefined) flat.day1Limit = legacy.warmUp.day1Limit;
  if (legacy.warmUp?.growthFactor !== undefined) flat.growthFactor = legacy.warmUp.growthFactor;
  if (legacy.logging !== undefined) flat.logging = legacy.logging;

  // Preserve flat top-level fields that coexist with nested keys
  const legacyAsFlat = legacy as Record<string, unknown>;
  if (flat.warmupDays === undefined && typeof legacyAsFlat.warmUpDays === 'number') flat.warmupDays = legacyAsFlat.warmUpDays as number;
  if (flat.warmupDays === undefined && typeof legacyAsFlat.warmupDays === 'number') flat.warmupDays = legacyAsFlat.warmupDays as number;
  if (flat.day1Limit === undefined && typeof legacyAsFlat.day1Limit === 'number') flat.day1Limit = legacyAsFlat.day1Limit as number;
  if (flat.growthFactor === undefined && typeof legacyAsFlat.growthFactor === 'number') flat.growthFactor = legacyAsFlat.growthFactor as number;
  if (flat.inactivityThresholdHours === undefined && typeof legacyAsFlat.inactivityThresholdHours === 'number') flat.inactivityThresholdHours = legacyAsFlat.inactivityThresholdHours as number;
  if (flat.maxIdenticalMessages === undefined && typeof legacyAsFlat.maxIdenticalMessages === 'number') flat.maxIdenticalMessages = legacyAsFlat.maxIdenticalMessages as number;
  if (flat.identicalMessageWindowMs === undefined && typeof legacyAsFlat.identicalMessageWindowMs === 'number') flat.identicalMessageWindowMs = legacyAsFlat.identicalMessageWindowMs as number;
  if (flat.burstAllowance === undefined && typeof legacyAsFlat.burstAllowance === 'number') flat.burstAllowance = legacyAsFlat.burstAllowance as number;
  // v3 fields that may coexist with legacy nested keys
  if (flat.autoPauseAt === undefined && typeof legacyAsFlat.autoPauseAt === 'string') flat.autoPauseAt = legacyAsFlat.autoPauseAt as ResolvedConfig['autoPauseAt'];
  if (flat.groupMultiplier === undefined && typeof legacyAsFlat.groupMultiplier === 'number') flat.groupMultiplier = legacyAsFlat.groupMultiplier as number;
  if (flat.groupProfiles === undefined && typeof legacyAsFlat.groupProfiles === 'boolean') flat.groupProfiles = legacyAsFlat.groupProfiles as boolean;
  if (flat.persist === undefined && typeof legacyAsFlat.persist === 'string') flat.persist = legacyAsFlat.persist as string;

  return flat;
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
  topologyThrottler?: {
    newContactsThisHour: number;
    newContactsToday: number;
    replyRatio: number | null;
    blockedRatio: number | null;
    hotspots: Array<{ sourceGroup: string; count: number }>;
  } | null;
  lidResolver?: LidResolverStats | null;
  jidCanonicalizer?: JidCanonicalizerStats | null;
  sessionStability?: SessionHealthStats | null;
  banRecovery?: RecoveryStatus | null;
  deliveryTracker: DeliveryTrackerStats;
  instanceCoordinator?: InstanceCoordinatorStats | null;
  messageRegistry?: { typeCount: number; warningCount: number } | null;
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
  private topologyThrottlerModule: TopologyThrottler | null = null;
  private lidResolverModule: LidResolver | null = null;
  private jidCanonicalizerModule: JidCanonicalizer | null = null;
  private sessionStabilityMonitor: SessionHealthMonitor | null = null;
  private banRecovery: BanRecoveryOrchestrator;
  private deliveryTracker: DeliveryTracker;
  private instanceCoordinator: InstanceCoordinator | null = null;
  private messageTypeRegistry: MessageTypeRegistry | null = null;
  private jidCircuitBreakerModule: JidCircuitBreaker | null = null;
  private stateManager: StateManager | null = null;
  private resolvedConfig: ResolvedConfig;
  private logging: boolean;
  private hasDisconnected: boolean = false; // BUG FIX 3: Track if we've ever disconnected

  /** Optional reputation voucher (standalone — caller manages separate voucher sockets) */
  public reputationVoucher?: ReputationVoucher;

  private stats = {
    messagesAllowed: 0,
    messagesBlocked: 0,
    totalDelayMs: 0,
  };

  constructor(input?: AntiBanInput | AntiBanConfigLegacy, warmUpStateArg?: WarmUpState) {
    let flatConfig: Partial<ResolvedConfig>;
    let legacyPassthrough: AntiBanConfigLegacy | null = null;
    let warmUpState = warmUpStateArg;

    if (isLegacyConfig(input)) {
      legacyPassthrough = input as AntiBanConfigLegacy;
      flatConfig = mapLegacyToFlat(legacyPassthrough);
    } else {
      flatConfig = {};
      legacyPassthrough = null;
    }

    const cfg = isLegacyConfig(input)
      ? resolveConfig(flatConfig)
      : resolveConfig(input as AntiBanInput);

    this.resolvedConfig = cfg;

    // Initialize persistence — load state before constructing modules
    let savedState: PersistedState | null = null;
    if (cfg.persist) {
      this.stateManager = new StateManager(cfg.persist);
      savedState = this.stateManager.load();
      if (savedState) {
        warmUpState = savedState.warmup;
      }
    }

    this.logging = cfg.logging ?? true;

    this.rateLimiter = new RateLimiter({
      maxPerMinute: cfg.maxPerMinute,
      maxPerHour: cfg.maxPerHour,
      maxPerDay: cfg.maxPerDay,
      minDelayMs: cfg.minDelayMs,
      maxDelayMs: cfg.maxDelayMs,
      newChatDelayMs: cfg.newChatDelayMs,
      maxIdenticalMessages: cfg.maxIdenticalMessages,
      identicalMessageWindowMs: cfg.identicalMessageWindowMs,
      burstAllowance: cfg.burstAllowance,
      ...(legacyPassthrough?.rateLimiter || {}),
    });

    // Restore knownChats from persisted state after rateLimiter is constructed
    if (savedState?.knownChats) {
      this.rateLimiter.restoreKnownChats(savedState.knownChats);
    }

    this.warmUp = new WarmUp({
      warmUpDays: cfg.warmupDays,
      day1Limit: cfg.day1Limit,
      growthFactor: cfg.growthFactor,
      inactivityThresholdHours: cfg.inactivityThresholdHours,
      ...(legacyPassthrough?.warmUp || {}),
    }, warmUpState);

    this.health = new HealthMonitor({
      autoPauseAt: cfg.autoPauseAt,
      ...(legacyPassthrough?.health || {}),
      onRiskChange: (status) => {
        if (this.logging) {
          const emoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' };
          console.log(`[baileys-antiban] ${emoji[status.risk]} Risk level: ${status.risk.toUpperCase()} (score: ${status.score})`);
          console.log(`[baileys-antiban] ${status.recommendation}`);
          status.reasons.forEach(r => console.log(`[baileys-antiban]   → ${r}`));
        }
        if ((status.risk === 'high' || status.risk === 'critical') && cfg.onAtRisk) {
          cfg.onAtRisk(status);
        }
        // Trigger recovery orchestrator on critical risk
        if (status.risk === 'critical') {
          this.banRecovery.recordBanEvent('soft_ban');
        }
        cfg.onRiskChange?.(status);
        legacyPassthrough?.health?.onRiskChange?.(status);
      },
    });

    // Initialize ban recovery orchestrator
    this.banRecovery = new BanRecoveryOrchestrator({
      onPhaseChange: (phase, plan) => {
        if (this.logging) {
          console.log(`[baileys-antiban] 🔄 Recovery phase: ${phase} — ${plan.description}`);
        }
      },
      onHardBan: () => {
        if (this.logging) {
          console.log(`[baileys-antiban] 💀 HARD BAN detected — account likely dead, replace SIM`);
        }
      },
    });

    // Initialize delivery tracker
    this.deliveryTracker = new DeliveryTracker({
      onLowDeliveryRate: (rate) => {
        if (this.logging) {
          console.log(`[baileys-antiban] ⚠️  Low delivery rate detected: ${Math.round(rate * 100)}% — possible soft ban`);
        }
      },
    });

    this.timelockGuard = new TimelockGuard({
      ...(legacyPassthrough?.timelock || {}),
      onTimelockDetected: (state) => {
        this.health.recordReachoutTimelock(state.enforcementType);
        this.banRecovery.recordBanEvent('timelock');
        if (this.logging) {
          console.log(`[baileys-antiban] REACHOUT TIMELOCKED — ${state.enforcementType || 'unknown'}, expires ${state.expiresAt?.toISOString() || 'unknown'}`);
        }
        cfg.onTimelockDetected?.(state);
        legacyPassthrough?.timelock?.onTimelockDetected?.(state);
      },
      onTimelockLifted: (state) => {
        if (this.logging) {
          console.log(`[baileys-antiban] Timelock lifted — resuming new contact messages`);
        }
        cfg.onTimelockLifted?.(state);
        legacyPassthrough?.timelock?.onTimelockLifted?.(state);
      },
    });
    this.replyRatioGuard = new ReplyRatioGuard(legacyPassthrough?.replyRatio);
    this.contactGraphWarmer = new ContactGraphWarmer(legacyPassthrough?.contactGraph);
    this.presenceChoreographer = new PresenceChoreographer(legacyPassthrough?.presence);
    this.retryTrackerModule = new RetryReasonTracker({
      ...(legacyPassthrough?.retryTracker || {}),
      onSpiral: (msgId, reason) => {
        if (this.logging) {
          console.log(`[baileys-antiban] ⚠️  Message ${msgId} stuck in retry spiral (${reason})`);
        }
        legacyPassthrough?.retryTracker?.onSpiral?.(msgId, reason);
      },
    });
    this.reconnectThrottleModule = new PostReconnectThrottle({
      ...(legacyPassthrough?.reconnectThrottle || {}),
      baselineRatePerMinute: () => this.rateLimiter.getStats().limits.perMinute,
    });

    // Initialize topology throttler if configured
    if (legacyPassthrough?.topologyThrottler) {
      this.topologyThrottlerModule = new TopologyThrottler(legacyPassthrough.topologyThrottler);
      if (this.logging) {
        console.log(`[baileys-antiban] 🌐 Topology throttler enabled — max ${legacyPassthrough.topologyThrottler.maxNewContactsPerHour || 5}/hr, ${legacyPassthrough.topologyThrottler.maxNewContactsPerDay || 20}/day new contacts`);
      }
    }

    // Initialize LID resolver and canonicalizer if configured
    // If jidCanonicalizer is enabled but no resolver provided, create standalone resolver
    if (legacyPassthrough?.jidCanonicalizer?.enabled) {
      // Create or use provided resolver
      if (legacyPassthrough.jidCanonicalizer.resolver) {
        // User provided their own resolver
        this.jidCanonicalizerModule = new JidCanonicalizer(legacyPassthrough.jidCanonicalizer);
        this.lidResolverModule = legacyPassthrough.jidCanonicalizer.resolver;
      } else {
        // Create new resolver using lidResolver config if provided
        const resolverConfig = legacyPassthrough.lidResolver || legacyPassthrough.jidCanonicalizer.resolverConfig;
        const resolver = new LidResolver(resolverConfig);
        this.lidResolverModule = resolver;
        this.jidCanonicalizerModule = new JidCanonicalizer({
          ...legacyPassthrough.jidCanonicalizer,
          resolver,
        });
      }
    } else if (legacyPassthrough?.lidResolver) {
      // Standalone resolver without canonicalizer
      this.lidResolverModule = new LidResolver(legacyPassthrough.lidResolver);
    }

    // Initialize session stability monitor if enabled
    if (legacyPassthrough?.sessionStability?.enabled) {
      const healthConfig: SessionHealthConfig = {
        badMacThreshold: legacyPassthrough.sessionStability.badMacThreshold,
        badMacWindowMs: legacyPassthrough.sessionStability.badMacWindowMs,
        onDegraded: (stats) => {
          if (this.logging) {
            console.log(`[baileys-antiban] 🔴 SESSION DEGRADED — Bad MAC rate: ${stats.badMacCount} in last ${legacyPassthrough?.sessionStability?.badMacWindowMs || 60000}ms`);
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

    // Initialize instance coordinator if configured
    if (cfg.instanceCoordinator) {
      this.instanceCoordinator = new InstanceCoordinator({
        sharedFilePath: cfg.instanceCoordinator,
        poolMaxPerMinute: cfg.instancePoolMaxPerMinute,
        poolMaxPerHour: cfg.instancePoolMaxPerHour,
      });
      if (this.logging) {
        console.log(`[baileys-antiban] 🌐 Instance coordination enabled: ${cfg.instanceCoordinator}`);
      }
    }

    // Initialize message type registry if configured
    if ((cfg as any).messageTypeRegistry) {
      this.messageTypeRegistry = new MessageTypeRegistry();
      if (this.logging) {
        console.log(`[baileys-antiban] 📝 Message type registry enabled`);
      }
    }

    // Initialize JID circuit breaker if configured (BUG FIX 2)
    if ((cfg as any).circuitBreaker) {
      const cbConfig = typeof (cfg as any).circuitBreaker === 'object'
        ? (cfg as any).circuitBreaker
        : {};
      this.jidCircuitBreakerModule = new JidCircuitBreaker({
        ...cbConfig,
        logger: this.logging ? { warn: console.warn.bind(console), info: console.info.bind(console) } : undefined,
      });
      if (this.logging) {
        console.log(`[baileys-antiban] 🔌 JID circuit breaker enabled`);
      }
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

    // Recovery orchestrator rate multiplier
    const recoveryStatus = this.banRecovery.getStatus();
    if (recoveryStatus.phase === 'paused') {
      this.stats.messagesBlocked++;
      return {
        allowed: false,
        delayMs: recoveryStatus.pauseRemainingMs || 0,
        reason: `Ban recovery: ${recoveryStatus.recommendation}`,
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

    // Topology throttler check — only applies to DMs to new/unknown contacts
    if (this.topologyThrottlerModule && !this.isGroupJid(recipient)) {
      const knownChats = this.rateLimiter.getKnownChats();
      const isNewContact = !knownChats.has(recipient);

      if (isNewContact) {
        // Check if we can send to new contact based on topology limits
        const topologyDecision = this.topologyThrottlerModule.canSendToNewContact();
        if (!topologyDecision.allowed) {
          this.stats.messagesBlocked++;
          if (this.logging) {
            console.log(`[baileys-antiban] 🌐 BLOCKED — topology: ${topologyDecision.reason}`);
          }
          return {
            allowed: false,
            delayMs: topologyDecision.retryAfterMs || 0,
            reason: `Topology: ${topologyDecision.reason}`,
            health: healthStatus,
          };
        }

        // Assess contact risk
        const riskAssessment = this.topologyThrottlerModule.assessContact(recipient, {
          messageType: 'dm',
          hasReplied: false,
          knownGroups: [],
        });

        if (riskAssessment.recommendation === 'abort') {
          this.stats.messagesBlocked++;
          if (this.logging) {
            console.log(`[baileys-antiban] ⛔ BLOCKED — contact risk ${riskAssessment.risk} (score ${riskAssessment.score}): ${riskAssessment.reasons.join(', ')}`);
          }
          return {
            allowed: false,
            delayMs: 0,
            reason: `Contact risk too high: ${riskAssessment.reasons.join(', ')}`,
            health: healthStatus,
          };
        }

        // If delay recommended, we'll add it to the total delay later
      }
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

    // Cross-instance coordination — check shared IP-level pool
    if (this.instanceCoordinator) {
      const slot = this.instanceCoordinator.tryAcquireSlot();
      if (!slot.allowed) {
        this.stats.messagesBlocked++;
        if (this.logging) {
          console.log(`[baileys-antiban] 🌐 BLOCKED — instance pool exhausted (shared IP limit), retry in ${slot.retryAfterMs}ms`);
        }
        return {
          allowed: false,
          delayMs: slot.retryAfterMs || 5000,
          reason: 'Cross-instance rate pool exhausted',
          health: healthStatus,
        };
      }
    }

    // Group profile rate check (runs before rateLimiter.getDelay for timing)
    if (this.resolvedConfig.groupProfiles && shouldUseGroupProfile(recipient)) {
      const groupLimits = applyGroupMultiplier(
        {
          maxPerMinute: this.resolvedConfig.maxPerMinute,
          maxPerHour: this.resolvedConfig.maxPerHour,
          maxPerDay: this.resolvedConfig.maxPerDay,
        },
        this.resolvedConfig.groupMultiplier
      );
      const stats = this.rateLimiter.getStats();
      if (
        stats.lastMinute >= groupLimits.maxPerMinute ||
        stats.lastHour >= groupLimits.maxPerHour ||
        stats.lastDay >= groupLimits.maxPerDay
      ) {
        this.stats.messagesBlocked++;
        if (this.logging) {
          console.log(`[baileys-antiban] 🚫 BLOCKED — group rate limit exceeded for ${recipient}`);
        }
        return { allowed: false, delayMs: 0, reason: 'Group rate limit exceeded', health: healthStatus };
      }
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

    // Per-contact risk multiplier — cold contacts need longer delays
    // Only apply when contact graph is enabled, otherwise all contacts appear as 'stranger'
    if (this.contactGraphWarmer['config']?.enabled) {
      const contactState = this.contactGraphWarmer.getContactState(recipient);
      const coldMultiplier: Record<string, number> = {
        stranger: 2.5,
        handshake_sent: 1.8,
        handshake_complete: 1.3,
        known: 1.0,
      };
      const contactRiskMult = coldMultiplier[contactState] ?? 1.0;
      if (contactRiskMult > 1.0) {
        delay = Math.floor(delay * contactRiskMult);
        if (this.logging && contactRiskMult >= 2.0) {
          console.log(`[baileys-antiban] ⚠️  Cold contact ${recipient} — ${contactState}, delay ×${contactRiskMult}`);
        }
      }
    }

    // Topology throttler recommended delay
    if (this.topologyThrottlerModule && !this.isGroupJid(recipient)) {
      const knownChats = this.rateLimiter.getKnownChats();
      const isNewContact = !knownChats.has(recipient);

      if (isNewContact) {
        const riskAssessment = this.topologyThrottlerModule.assessContact(recipient, {
          messageType: 'dm',
          hasReplied: false,
          knownGroups: [],
        });

        if (riskAssessment.recommendation === 'delay' && riskAssessment.suggestedDelayMs) {
          delay += riskAssessment.suggestedDelayMs;
          if (this.logging) {
            console.log(`[baileys-antiban] ⚠️  Topology risk ${riskAssessment.risk} — adding ${Math.floor(riskAssessment.suggestedDelayMs / 60000)}min delay`);
          }
        }
      }
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
  afterSend(recipient: string, content: string, msgId?: string): void {
    this.rateLimiter.record(recipient, content);
    this.warmUp.record();
    this.replyRatioGuard.recordSent(recipient);
    this.topologyThrottlerModule?.recordSent(recipient);
    this.stats.messagesAllowed++;
    if (msgId) {
      this.deliveryTracker.onMessageSent(msgId);
    }
    this.runAdaptiveCheck();
    this.persistStateDebounced();
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
    this.hasDisconnected = true; // BUG FIX 3: Mark that we've disconnected
    this.health.recordDisconnect(reason);
    this.reconnectThrottleModule.onDisconnect();
    const reasonStr = String(reason);
    if (reasonStr === '403' || reasonStr === '401' || reasonStr === 'forbidden' || reasonStr === 'loggedOut') {
      this.persistStateImmediate();
    }
  }

  /**
   * Record a successful reconnection
   */
  onReconnect(): void {
    this.health.recordReconnect();
    this.reconnectThrottleModule.onReconnect();

    // BUG FIX 3: Sync local rate limiter with shared pool after reconnect
    // This prevents the double-spend window where DeafSessionDetector triggers
    // reconnect → in-memory rate limiter resets to 0 → thinks it has full budget
    // → sends 20 messages → THEN reads shared file and discovers 18/20 already used
    // Only sync if this is a TRUE reconnect (after disconnect), not first connect
    if (this.hasDisconnected && this.instanceCoordinator) {
      this.instanceCoordinator.syncLocalLimiter(this.rateLimiter);
    }

    this.rateLimiter.adaptLimits(1.0);
  }

  /**
   * Handle incoming message — record in reply ratio + contact graph.
   * Returns suggested reply if reply ratio suggests auto-reply.
   */
  onIncomingMessage(jid: string, msgText?: string): { shouldReply: boolean; suggestedText?: string } {
    this.replyRatioGuard.recordReceived(jid);
    this.contactGraphWarmer.onIncomingMessage(jid);
    this.topologyThrottlerModule?.recordReplied(jid);

    return this.replyRatioGuard.suggestReply(jid, msgText);
  }

  /**
   * Record a delivery receipt (status 3 = DELIVERY_ACK, status 4 = READ).
   * Call from messages.update handler when delivery status is received.
   */
  onDeliveryReceipt(msgId: string): void {
    this.deliveryTracker.onDeliveryReceipt(msgId);
  }

  /**
   * Get the resolved configuration
   */
  getConfig(): ResolvedConfig {
    return { ...this.resolvedConfig };
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
      banRecovery: this.banRecovery.getStatus(),
      deliveryTracker: this.deliveryTracker.getStats(),
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
    if (this.topologyThrottlerModule) {
      stats.topologyThrottler = this.topologyThrottlerModule.getTopologyStats();
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
    if (this.instanceCoordinator) {
      stats.instanceCoordinator = this.instanceCoordinator.getStats();
    }
    if (this.messageTypeRegistry) {
      const warnings = this.messageTypeRegistry.getWarnings();
      stats.messageRegistry = {
        typeCount: Array.from((this.messageTypeRegistry as any).types.keys()).length,
        warningCount: warnings.length,
      };
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

  /** Get the topology throttler for direct access */
  get topologyThrottler(): TopologyThrottler | null {
    return this.topologyThrottlerModule;
  }

  /** Get the topology throttler for direct access (alias) */
  get topology(): TopologyThrottler | null {
    return this.topologyThrottlerModule;
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

  /** Get the ban recovery orchestrator for direct access */
  get recoveryOrchestrator(): BanRecoveryOrchestrator {
    return this.banRecovery;
  }

  /** Get the message type registry for direct access */
  get messageRegistry(): MessageTypeRegistry | null {
    return this.messageTypeRegistry;
  }

  /** Get the JID circuit breaker for direct access (BUG FIX 2) */
  get circuitBreaker(): JidCircuitBreaker | null {
    return this.jidCircuitBreakerModule;
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

  private isGroupJid(jid: string): boolean {
    return jid.endsWith('@g.us') || jid.endsWith('@newsletter');
  }

  private runAdaptiveCheck(): void {
    const delivery = this.deliveryTracker.getStats();
    // Need min sample to be meaningful
    if (delivery.deliveryRate === null) return;

    const rate = delivery.deliveryRate;
    let targetFactor: number;

    if (rate >= 0.85) {
      targetFactor = 1.0; // Excellent — full speed
    } else if (rate >= 0.70) {
      targetFactor = 0.75; // Good — slight reduction
    } else if (rate >= 0.55) {
      targetFactor = 0.50; // Poor — halve throughput
    } else {
      targetFactor = 0.25; // Bad — severe throttle (soft ban likely)
    }

    const current = this.rateLimiter.getCurrentFactor();
    // Only log + adjust when factor changes meaningfully (>5% delta)
    if (Math.abs(targetFactor - current) > 0.05) {
      if (this.logging) {
        const dir = targetFactor > current ? '📈' : '📉';
        console.log(`[baileys-antiban] ${dir} Adaptive rate: delivery=${(rate*100).toFixed(0)}% → factor ${current.toFixed(2)}→${targetFactor.toFixed(2)}`);
      }
      this.rateLimiter.adaptLimits(targetFactor);
    }
  }

  private persistStateDebounced(): void {
    if (!this.stateManager) return;
    const state: PersistedState = {
      warmup: this.warmUp.exportState(),
      knownChats: Array.from(this.rateLimiter.getKnownChats()),
      savedAt: Date.now(),
      version: 3,
    };
    this.stateManager.saveDebounced(state);
  }

  private persistStateImmediate(): void {
    if (!this.stateManager) return;
    const state: PersistedState = {
      warmup: this.warmUp.exportState(),
      knownChats: Array.from(this.rateLimiter.getKnownChats()),
      savedAt: Date.now(),
      version: 3,
    };
    this.stateManager.saveImmediate(state);
  }

  /**
   * Export unified state snapshot for Redis failover or cross-instance migration.
   * Returns snapshot of all module states (warmup, health, rate limiter, circuits, etc.)
   */
  exportState(): AntibanSnapshot {
    return exportAntibanState({
      warmup: this.warmUp,
      health: this.health,
      rateLimiter: this.rateLimiter,
      timelockGuard: this.timelockGuard as any,
      messageRegistry: this.messageTypeRegistry || undefined,
      topologyThrottler: this.topologyThrottlerModule || undefined,
      reputationVoucher: this.reputationVoucher || undefined,
      circuits: this.jidCircuitBreakerModule || undefined, // BUG FIX 2
      instanceId: (this.resolvedConfig as any).instanceId,
    });
  }

  /**
   * Import unified state snapshot.
   * CRDT-safe for rate limiters (never overwrites higher counts).
   */
  importState(snapshot: AntibanSnapshot): void {
    importAntibanState(snapshot, {
      warmup: this.warmUp as any,
      health: this.health,
      rateLimiter: this.rateLimiter,
      timelockGuard: this.timelockGuard,
      messageRegistry: this.messageTypeRegistry || undefined,
      topologyThrottler: this.topologyThrottlerModule || undefined,
      reputationVoucher: this.reputationVoucher || undefined,
      circuits: this.jidCircuitBreakerModule || undefined, // BUG FIX 2
    });
  }

  /**
   * Clean up all timers and resources.
   * Call this when disposing of the AntiBan instance or when the socket closes.
   */
  destroy(): void {
    this.stateManager?.destroy();
    this.timelockGuard.reset(); // Clears the resumeTimer
    this.replyRatioGuard.reset();
    this.contactGraphWarmer.reset();
    this.presenceChoreographer.reset();
    this.retryTrackerModule.destroy();
    this.reconnectThrottleModule.destroy();
    this.jidCanonicalizerModule?.destroy();
    this.lidResolverModule?.destroy();
    this.sessionStabilityMonitor?.reset();
    this.messageTypeRegistry?.cleanup();
    if (this.logging) {
      console.log('[baileys-antiban] 🧹 Destroyed — all timers cleared');
    }
  }
}
