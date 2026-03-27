/**
 * Rate Limiter — Enforces human-like message pacing
 * 
 * WhatsApp's detection looks for:
 * - Too many messages per minute/hour
 * - Identical messages to multiple recipients
 * - No variation in timing between messages
 * - Sudden spikes in activity
 * - Messages sent at inhuman speed
 */

export interface RateLimiterConfig {
  /** Max messages per minute (default: 8) */
  maxPerMinute: number;
  /** Max messages per hour (default: 200) */
  maxPerHour: number;
  /** Max messages per day (default: 1500) */
  maxPerDay: number;
  /** Min delay between messages in ms (default: 1500) */
  minDelayMs: number;
  /** Max delay between messages in ms (default: 5000) */
  maxDelayMs: number;
  /** Extra delay for first message to a new chat in ms (default: 3000) */
  newChatDelayMs: number;
  /** Max identical messages before forcing variation (default: 3) */
  maxIdenticalMessages: number;
  /** Burst allowance - messages before rate limiting kicks in (default: 3) */
  burstAllowance: number;
  /** Time window for tracking identical messages in ms (default: 3600000 = 1 hour) */
  identicalMessageWindowMs: number;
}

// Time constants for clarity
const TIME_CONSTANTS = {
  MS_PER_SECOND: 1000,
  MS_PER_MINUTE: 60000,
  MS_PER_HOUR: 3600000,
  MS_PER_DAY: 86400000,
  BURST_RESET_MS: 30000,
  IDENTICAL_WINDOW_MS: 3600000, // 1 hour
} as const;

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxPerMinute: 8,
  maxPerHour: 200,
  maxPerDay: 1500,
  minDelayMs: 1500,
  maxDelayMs: 5000,
  newChatDelayMs: 3000,
  maxIdenticalMessages: 3,
  burstAllowance: 3,
  identicalMessageWindowMs: TIME_CONSTANTS.IDENTICAL_WINDOW_MS,
};

interface MessageRecord {
  timestamp: number;
  recipient: string;
  contentHash: string;
}

interface IdenticalMessageTracker {
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private messages: MessageRecord[] = [];
  private identicalCount = new Map<string, IdenticalMessageTracker>();
  private knownChats = new Set<string>();
  private burstCount = 0;
  private lastMessageTime = 0;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate delay before next message can be sent.
   * Returns 0 if message can be sent immediately.
   * Returns -1 if message should be blocked entirely.
   */
  async getDelay(recipient: string, content: string): Promise<number> {
    const now = Date.now();
    this.cleanup(now);

    const contentHash = this.hashContent(content);

    // Check daily limit
    const dayMessages = this.messages.filter(m => now - m.timestamp < TIME_CONSTANTS.MS_PER_DAY);
    if (dayMessages.length >= this.config.maxPerDay) {
      return -1; // Hard block — daily limit reached
    }

    // Check hourly limit
    const hourMessages = this.messages.filter(m => now - m.timestamp < TIME_CONSTANTS.MS_PER_HOUR);
    if (hourMessages.length >= this.config.maxPerHour) {
      // Sort by timestamp to find the oldest message in the window
      hourMessages.sort((a, b) => a.timestamp - b.timestamp);
      const oldestInHour = hourMessages[0];
      const delay = oldestInHour ? (oldestInHour.timestamp + TIME_CONSTANTS.MS_PER_HOUR) - now : TIME_CONSTANTS.MS_PER_HOUR;
      // Return a proper blocking delay (at least the time until the oldest message expires)
      return Math.max(delay, TIME_CONSTANTS.MS_PER_MINUTE);
    }

    // Check per-minute limit
    const minuteMessages = this.messages.filter(m => now - m.timestamp < TIME_CONSTANTS.MS_PER_MINUTE);
    if (minuteMessages.length >= this.config.maxPerMinute) {
      // Sort by timestamp to find the oldest message in the window
      minuteMessages.sort((a, b) => a.timestamp - b.timestamp);
      const oldestInMinute = minuteMessages[0];
      const delay = oldestInMinute ? (oldestInMinute.timestamp + TIME_CONSTANTS.MS_PER_MINUTE) - now : TIME_CONSTANTS.MS_PER_MINUTE;
      return Math.max(delay, TIME_CONSTANTS.MS_PER_SECOND);
    }

    // Check identical message limit (within time window)
    const tracker = this.identicalCount.get(contentHash);
    if (tracker) {
      // Check if tracker is still within the time window
      if (now - tracker.firstSeen < this.config.identicalMessageWindowMs) {
        if (tracker.count >= this.config.maxIdenticalMessages) {
          return -1; // Block identical spam within time window
        }
      }
    }

    // Calculate human-like delay
    let delay = 0;

    // Burst allowance — first few messages can be faster
    if (this.burstCount < this.config.burstAllowance) {
      this.burstCount++;
      delay = this.jitter(this.config.minDelayMs * 0.5, this.config.minDelayMs);
    } else {
      delay = this.jitter(this.config.minDelayMs, this.config.maxDelayMs);
    }

    // Extra delay for new chats (first message to this recipient)
    if (!this.knownChats.has(recipient)) {
      delay += this.jitter(this.config.newChatDelayMs * 0.5, this.config.newChatDelayMs);
    }

    // Ensure minimum time since last message
    const timeSinceLast = now - this.lastMessageTime;
    if (timeSinceLast < this.config.minDelayMs) {
      delay = Math.max(delay, this.config.minDelayMs - timeSinceLast);
    }

    // Add "typing simulation" delay based on content length
    const typingDelay = Math.min(content.length * 30, 3000); // ~30ms per char, max 3s
    delay += this.jitter(typingDelay * 0.5, typingDelay);

    return Math.round(delay);
  }

  /**
   * Record a sent message
   */
  record(recipient: string, content: string): void {
    const now = Date.now();
    const contentHash = this.hashContent(content);

    // BUG FIX 1: Check burst reset BEFORE updating lastMessageTime
    const timeSinceLast = now - this.lastMessageTime;
    if (timeSinceLast > TIME_CONSTANTS.BURST_RESET_MS) {
      this.burstCount = 0;
    }

    this.messages.push({ timestamp: now, recipient, contentHash });
    this.knownChats.add(recipient);
    this.lastMessageTime = now;

    // Track identical messages with time window
    const tracker = this.identicalCount.get(contentHash);
    if (tracker) {
      // Check if within same window
      if (now - tracker.firstSeen < this.config.identicalMessageWindowMs) {
        tracker.count++;
        tracker.lastSeen = now;
      } else {
        // Start new window
        this.identicalCount.set(contentHash, { count: 1, firstSeen: now, lastSeen: now });
      }
    } else {
      this.identicalCount.set(contentHash, { count: 1, firstSeen: now, lastSeen: now });
    }
  }

  /**
   * Get current usage stats
   */
  getStats() {
    const now = Date.now();
    this.cleanup(now);
    return {
      lastMinute: this.messages.filter(m => now - m.timestamp < TIME_CONSTANTS.MS_PER_MINUTE).length,
      lastHour: this.messages.filter(m => now - m.timestamp < TIME_CONSTANTS.MS_PER_HOUR).length,
      lastDay: this.messages.filter(m => now - m.timestamp < TIME_CONSTANTS.MS_PER_DAY).length,
      limits: {
        perMinute: this.config.maxPerMinute,
        perHour: this.config.maxPerHour,
        perDay: this.config.maxPerDay,
      },
      knownChats: this.knownChats.size,
    };
  }

  private cleanup(now: number): void {
    // Remove messages older than 24 hours
    this.messages = this.messages.filter(m => now - m.timestamp < TIME_CONSTANTS.MS_PER_DAY);

    // Clean up identicalCount Map based on time windows (not just message presence)
    // Remove trackers where the window has expired
    for (const [hash, tracker] of this.identicalCount.entries()) {
      if (now - tracker.lastSeen > this.config.identicalMessageWindowMs) {
        this.identicalCount.delete(hash);
      }
    }
  }

  /** Random delay between min and max (gaussian-ish distribution) */
  private jitter(min: number, max: number): number {
    // Use Box-Muller for more human-like distribution (clustered around middle)
    const u1 = Math.random();
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const normalized = (normal + 3) / 6; // Map to ~0-1 range
    const clamped = Math.max(0, Math.min(1, normalized));
    return Math.round(min + clamped * (max - min));
  }

  /** Simple hash for content dedup */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }
}
