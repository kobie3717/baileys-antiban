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
export { AntiBan } from './antiban.js';
export { RateLimiter } from './rateLimiter.js';
export { WarmUp } from './warmup.js';
export { HealthMonitor } from './health.js';
export { TimelockGuard } from './timelockGuard.js';
// v1.3 new modules
export { ReplyRatioGuard } from './replyRatio.js';
export { ContactGraphWarmer } from './contactGraph.js';
export { PresenceChoreographer, getCircadianMultiplier, } from './presenceChoreographer.js';
// v1.5 new modules
export { RetryReasonTracker } from './retryTracker.js';
export { PostReconnectThrottle } from './reconnectThrottle.js';
// v1.6 new modules
export { LidResolver } from './lidResolver.js';
export { JidCanonicalizer } from './jidCanonicalizer.js';
// v2.0 new modules
export { SessionHealthMonitor, wrapWithSessionStability, classifyDisconnect, } from './sessionStability.js';
// v2.1 new modules
export { LidFirstResolver, createLidFirstResolver, } from './lidFirstResolver.js';
export { MessageRetryReason, MAC_ERROR_CODES, parseRetryReason, isMacError, getRetryReasonDescription, } from './retryReason.js';
// Socket wrapper
export { wrapSocket } from './wrapper.js';
// Optional features
export { MessageQueue } from './messageQueue.js';
export { ContentVariator } from './contentVariator.js';
export { WebhookAlerts } from './webhooks.js';
export { Scheduler } from './scheduler.js';
// State persistence
export { FileStateAdapter } from './stateAdapter.js';
// v3.0 new modules
export { resolveConfig, PRESETS } from './presets.js';
export { StateManager } from './persist.js';
export { isGroup, isNewsletter, isBroadcast, shouldUseGroupProfile, applyGroupMultiplier } from './profiles.js';
// v3.1 new modules
export { messageRecovery } from './messageRecovery.js';
// v3.2 new modules
export { generateFingerprint, applyFingerprint, } from './deviceFingerprint.js';
export { credsSnapshot, } from './credsSnapshot.js';
export { readReceiptVariance, } from './readReceiptVariance.js';
// v3.5 new modules
export { proxyRotator, } from './proxyRotator.js';
