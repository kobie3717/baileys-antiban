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
export { PresenceChoreographer } from './presenceChoreographer.js';
// Socket wrapper
export { wrapSocket } from './wrapper.js';
// Optional features
export { MessageQueue } from './messageQueue.js';
export { ContentVariator } from './contentVariator.js';
export { WebhookAlerts } from './webhooks.js';
export { Scheduler } from './scheduler.js';
// State persistence
export { FileStateAdapter } from './stateAdapter.js';
