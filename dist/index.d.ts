/**
 * baileys-antiban — Anti-ban middleware for Baileys
 *
 * Wraps a Baileys socket with human-like messaging patterns
 * to minimize the risk of WhatsApp banning your number.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
export { AntiBan, type AntiBanConfig, type AntiBanStats, type SendDecision } from './antiban.js';
export { RateLimiter, type RateLimiterConfig, type RateLimiterStats } from './rateLimiter.js';
export { WarmUp, type WarmUpConfig, type WarmUpState, type WarmUpStatus } from './warmup.js';
export { HealthMonitor, type HealthStatus, type HealthMonitorConfig, type BanRiskLevel } from './health.js';
export { TimelockGuard, type TimelockGuardConfig, type TimelockState } from './timelockGuard.js';
export { ReplyRatioGuard, type ReplyRatioConfig, type ReplyRatioStats } from './replyRatio.js';
export { ContactGraphWarmer, type ContactGraphConfig, type ContactGraphStats, type ContactState } from './contactGraph.js';
export { PresenceChoreographer, type PresenceChoreographerConfig, type PresenceChoreographerStats, type TypingPlanStep } from './presenceChoreographer.js';
export { RetryReasonTracker, type RetryTrackerConfig, type RetryStats, type RetryReason } from './retryTracker.js';
export { PostReconnectThrottle, type ReconnectThrottleConfig, type ReconnectThrottleStats } from './reconnectThrottle.js';
export { LidResolver, type LidResolverConfig, type LidResolverStats, type LidMapping } from './lidResolver.js';
export { JidCanonicalizer, type JidCanonicalizerConfig, type JidCanonicalizerStats } from './jidCanonicalizer.js';
export { SessionHealthMonitor, type SessionHealthStats, type SessionHealthConfig, wrapWithSessionStability, type SessionStabilityConfig, classifyDisconnect, type DisconnectClassification, type DisconnectCategory, } from './sessionStability.js';
export { LidFirstResolver, createLidFirstResolver, type LidPhoneMapping, } from './lidFirstResolver.js';
export { MessageRetryReason, MAC_ERROR_CODES, parseRetryReason, isMacError, getRetryReasonDescription, } from './retryReason.js';
export { wrapSocket, type WrappedSocket, type WrapSocketOptions } from './wrapper.js';
export { MessageQueue, type QueuedMessage, type MessageQueueConfig } from './messageQueue.js';
export { ContentVariator, type VariatorConfig } from './contentVariator.js';
export { WebhookAlerts, type WebhookConfig } from './webhooks.js';
export { Scheduler, type SchedulerConfig } from './scheduler.js';
export { type StateAdapter, FileStateAdapter } from './stateAdapter.js';
export { resolveConfig, PRESETS, type AntiBanInput, type ResolvedConfig, type PresetName } from './presets.js';
export { StateManager, type PersistedState } from './persist.js';
export { isGroup, isNewsletter, isBroadcast, shouldUseGroupProfile, applyGroupMultiplier, type RateLimits } from './profiles.js';
export { messageRecovery, type MessageRecoveryConfig, type MessageRecoveryStats, type MessageRecoveryHandle } from './messageRecovery.js';
export { generateFingerprint, applyFingerprint, type DeviceFingerprint, type DeviceFingerprintConfig, } from './deviceFingerprint.js';
export { credsSnapshot, type CredsSnapshot, type CredsSnapshotConfig, } from './credsSnapshot.js';
export { readReceiptVariance, type ReadReceiptVariance, type ReadReceiptVarianceConfig, } from './readReceiptVariance.js';
