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
export { RateLimiter } from './rateLimiter.js';
export { WarmUp } from './warmup.js';
export { HealthMonitor, type HealthStatus, type BanRiskLevel } from './health.js';
export { wrapSocket } from './wrapper.js';
