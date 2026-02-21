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

import { RateLimiter, type RateLimiterConfig } from './rateLimiter.js';
import { WarmUp, type WarmUpConfig, type WarmUpState } from './warmup.js';
import { HealthMonitor, type HealthMonitorConfig, type HealthStatus } from './health.js';

export interface AntiBanConfig {
  rateLimiter?: Partial<RateLimiterConfig>;
  warmUp?: Partial<WarmUpConfig>;
  health?: Partial<HealthMonitorConfig>;
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
  warmUp: ReturnType<WarmUp['getStatus']>;
  rateLimiter: ReturnType<RateLimiter['getStats']>;
}

export class AntiBan {
  private rateLimiter: RateLimiter;
  private warmUp: WarmUp;
  private health: HealthMonitor;
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
  afterSend(recipient: string, content: string): void {
    this.rateLimiter.record(recipient, content);
    this.warmUp.record();
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
  }

  /**
   * Record a successful reconnection
   */
  onReconnect(): void {
    this.health.recordReconnect();
  }

  /**
   * Get comprehensive stats
   */
  getStats(): AntiBanStats {
    return {
      ...this.stats,
      health: this.health.getStatus(),
      warmUp: this.warmUp.getStatus(),
      rateLimiter: this.rateLimiter.getStats(),
    };
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
    this.health.reset();
    this.warmUp.reset();
    this.stats = { messagesAllowed: 0, messagesBlocked: 0, totalDelayMs: 0 };
    if (this.logging) {
      console.log('[baileys-antiban] 🔄 Reset — starting fresh warm-up');
    }
  }
}
