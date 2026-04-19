/**
 * baileys-antiban — Anti-ban middleware for Baileys
 * 
 * Wraps a Baileys socket with human-like messaging patterns
 * to minimize the risk of WhatsApp banning your number.
 * 
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */

// Core
export { AntiBan, type AntiBanConfig, type AntiBanStats, type SendDecision } from './antiban.js';
export { RateLimiter, type RateLimiterConfig, type RateLimiterStats } from './rateLimiter.js';
export { WarmUp, type WarmUpConfig, type WarmUpState, type WarmUpStatus } from './warmup.js';
export { HealthMonitor, type HealthStatus, type HealthMonitorConfig, type BanRiskLevel } from './health.js';
export { TimelockGuard, type TimelockGuardConfig, type TimelockState } from './timelockGuard.js';

// v1.3 new modules
export { ReplyRatioGuard, type ReplyRatioConfig, type ReplyRatioStats } from './replyRatio.js';
export { ContactGraphWarmer, type ContactGraphConfig, type ContactGraphStats, type ContactState } from './contactGraph.js';
export { PresenceChoreographer, type PresenceChoreographerConfig, type PresenceChoreographerStats } from './presenceChoreographer.js';

// v1.5 new modules
export { RetryReasonTracker, type RetryTrackerConfig, type RetryStats, type RetryReason } from './retryTracker.js';
export { PostReconnectThrottle, type ReconnectThrottleConfig, type ReconnectThrottleStats } from './reconnectThrottle.js';

// v1.6 new modules
export { LidResolver, type LidResolverConfig, type LidResolverStats, type LidMapping } from './lidResolver.js';
export { JidCanonicalizer, type JidCanonicalizerConfig, type JidCanonicalizerStats } from './jidCanonicalizer.js';

// v2.0 new modules
export {
  SessionHealthMonitor,
  type SessionHealthStats,
  type SessionHealthConfig,
  wrapWithSessionStability,
  type SessionStabilityConfig,
  classifyDisconnect,
  type DisconnectClassification,
  type DisconnectCategory,
} from './sessionStability.js';

// v2.1 new modules
export {
  LidFirstResolver,
  createLidFirstResolver,
  type LidPhoneMapping,
} from './lidFirstResolver.js';
export {
  MessageRetryReason,
  MAC_ERROR_CODES,
  parseRetryReason,
  isMacError,
  getRetryReasonDescription,
} from './retryReason.js';

// Socket wrapper
export { wrapSocket, type WrappedSocket, type WrapSocketOptions } from './wrapper.js';

// Optional features
export { MessageQueue, type QueuedMessage, type MessageQueueConfig } from './messageQueue.js';
export { ContentVariator, type VariatorConfig } from './contentVariator.js';
export { WebhookAlerts, type WebhookConfig } from './webhooks.js';
export { Scheduler, type SchedulerConfig } from './scheduler.js';

// State persistence
export { type StateAdapter, FileStateAdapter } from './stateAdapter.js';
