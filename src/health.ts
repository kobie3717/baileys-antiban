/**
 * Health Monitor — Detect ban warning signs early
 * 
 * Tracks connection patterns to identify when WhatsApp is
 * getting suspicious. Gives you time to back off before a ban.
 * 
 * Warning signs:
 * - Frequent disconnections (connection.update → close)
 * - 403 Forbidden errors
 * - 401 Logged Out (possible temp ban)
 * - Messages failing silently (sent but not delivered)
 * - QR re-request loops
 * - Rate limit responses (429-like behavior)
 */

export type BanRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface HealthStatus {
  risk: BanRiskLevel;
  score: number; // 0-100, higher = more danger
  reasons: string[];
  recommendation: string;
  stats: {
    disconnectsLastHour: number;
    failedMessagesLastHour: number;
    forbiddenErrors: number;
    uptimeMs: number;
    lastDisconnectReason?: string;
  };
}

export interface HealthMonitorConfig {
  /** Disconnects per hour before warning (default: 3) */
  disconnectWarningThreshold: number;
  /** Disconnects per hour before critical (default: 5) */
  disconnectCriticalThreshold: number;
  /** Failed messages per hour before warning (default: 5) */
  failedMessageThreshold: number;
  /** Callback when risk level changes */
  onRiskChange?: (status: HealthStatus) => void;
  /** Auto-pause sending at this risk level (default: 'high') */
  autoPauseAt: BanRiskLevel;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
  disconnectWarningThreshold: 3,
  disconnectCriticalThreshold: 5,
  failedMessageThreshold: 5,
  autoPauseAt: 'high',
};

interface Event {
  type: 'disconnect' | 'forbidden' | 'loggedOut' | 'messageFailed' | 'reconnect';
  timestamp: number;
  detail?: string;
}

const RISK_SCORES: Record<BanRiskLevel, number> = {
  low: 0,
  medium: 30,
  high: 60,
  critical: 85,
};

export class HealthMonitor {
  private config: HealthMonitorConfig;
  private events: Event[] = [];
  private startTime = Date.now();
  private paused = false;
  private lastRisk: BanRiskLevel = 'low';

  constructor(config: Partial<HealthMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a disconnection event
   */
  recordDisconnect(reason: string | number): void {
    const reasonStr = String(reason);
    
    // 403 = Forbidden (WhatsApp blocking)
    if (reasonStr === '403' || reasonStr === 'forbidden') {
      this.events.push({ type: 'forbidden', timestamp: Date.now(), detail: reasonStr });
    }
    // 401 = Logged out (possible temp ban)
    else if (reasonStr === '401' || reasonStr === 'loggedOut') {
      this.events.push({ type: 'loggedOut', timestamp: Date.now(), detail: reasonStr });
    }
    else {
      this.events.push({ type: 'disconnect', timestamp: Date.now(), detail: reasonStr });
    }

    this.checkAndNotify();
  }

  /**
   * Record a successful reconnection
   */
  recordReconnect(): void {
    this.events.push({ type: 'reconnect', timestamp: Date.now() });
  }

  /**
   * Record a failed message send
   */
  recordMessageFailed(error?: string): void {
    this.events.push({ type: 'messageFailed', timestamp: Date.now(), detail: error });
    this.checkAndNotify();
  }

  /**
   * Get current health status
   */
  getStatus(): HealthStatus {
    const now = Date.now();
    this.cleanup(now);

    const hourEvents = this.events.filter(e => now - e.timestamp < 3600000);
    const disconnects = hourEvents.filter(e => e.type === 'disconnect').length;
    const forbidden = hourEvents.filter(e => e.type === 'forbidden').length;
    const loggedOut = hourEvents.filter(e => e.type === 'loggedOut').length;
    const failedMessages = hourEvents.filter(e => e.type === 'messageFailed').length;

    let score = 0;
    const reasons: string[] = [];

    // Forbidden errors are serious
    if (forbidden > 0) {
      score += 40 * forbidden;
      reasons.push(`${forbidden} forbidden (403) error${forbidden > 1 ? 's' : ''} in last hour`);
    }

    // Logged out is very serious
    if (loggedOut > 0) {
      score += 60;
      reasons.push('Logged out by WhatsApp — possible temporary ban');
    }

    // Frequent disconnects
    if (disconnects >= this.config.disconnectCriticalThreshold) {
      score += 30;
      reasons.push(`${disconnects} disconnects in last hour (critical threshold)`);
    } else if (disconnects >= this.config.disconnectWarningThreshold) {
      score += 15;
      reasons.push(`${disconnects} disconnects in last hour`);
    }

    // Failed messages
    if (failedMessages >= this.config.failedMessageThreshold) {
      score += 20;
      reasons.push(`${failedMessages} failed messages in last hour`);
    }

    // Determine risk level
    score = Math.min(100, score);
    let risk: BanRiskLevel;
    if (score >= 85) risk = 'critical';
    else if (score >= 60) risk = 'high';
    else if (score >= 30) risk = 'medium';
    else risk = 'low';

    // Determine recommendation
    let recommendation: string;
    switch (risk) {
      case 'critical':
        recommendation = 'STOP ALL MESSAGING IMMEDIATELY. Disconnect and wait 24-48 hours before reconnecting.';
        break;
      case 'high':
        recommendation = 'Reduce messaging rate by 80%. Consider pausing for 1-2 hours.';
        break;
      case 'medium':
        recommendation = 'Reduce messaging rate by 50%. Increase delays between messages.';
        break;
      default:
        recommendation = 'Operating normally. Continue monitoring.';
    }

    const lastDisconnect = [...this.events].reverse().find(e => 
      e.type === 'disconnect' || e.type === 'forbidden' || e.type === 'loggedOut'
    );

    return {
      risk,
      score,
      reasons: reasons.length ? reasons : ['No issues detected'],
      recommendation,
      stats: {
        disconnectsLastHour: disconnects,
        failedMessagesLastHour: failedMessages,
        forbiddenErrors: forbidden,
        uptimeMs: now - this.startTime,
        lastDisconnectReason: lastDisconnect?.detail,
      },
    };
  }

  /**
   * Check if sending should be paused
   */
  isPaused(): boolean {
    if (this.paused) return true;
    const status = this.getStatus();
    const riskOrder: BanRiskLevel[] = ['low', 'medium', 'high', 'critical'];
    return riskOrder.indexOf(status.risk) >= riskOrder.indexOf(this.config.autoPauseAt);
  }

  /**
   * Manually pause/resume
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /**
   * Reset all tracked events
   */
  reset(): void {
    this.events = [];
    this.startTime = Date.now();
    this.paused = false;
    this.lastRisk = 'low';
  }

  private cleanup(now: number): void {
    // Keep last 6 hours of events
    this.events = this.events.filter(e => now - e.timestamp < 21600000);
  }

  private checkAndNotify(): void {
    const status = this.getStatus();
    if (status.risk !== this.lastRisk) {
      this.lastRisk = status.risk;
      this.config.onRiskChange?.(status);
    }
  }
}
