/**
 * baileys-antiban — Anti-ban middleware for Baileys
 * 
 * Wraps a Baileys socket with human-like messaging patterns
 * to minimize the risk of WhatsApp banning your number.
 * 
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */

export { AntiBan, type AntiBanConfig, type AntiBanStats } from './antiban.js';
export { RateLimiter, type RateLimiterConfig } from './rateLimiter.js';
export { WarmUp, type WarmUpConfig, type WarmUpState } from './warmup.js';
export { HealthMonitor, type HealthStatus, type BanRiskLevel } from './health.js';
export { MessageQueue, type QueuedMessage, type MessageQueueConfig } from './messageQueue.js';
export { ContentVariator, type VariatorConfig } from './contentVariator.js';
export { WebhookAlerts, type WebhookConfig } from './webhooks.js';
export { Scheduler, type SchedulerConfig } from './scheduler.js';
export { wrapSocket, type WrappedSocket } from './wrapper.js';
