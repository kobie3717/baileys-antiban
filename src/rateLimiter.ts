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
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxPerMinute: 8,
  maxPerHour: 200,
  maxPerDay: 1500,
  minDelayMs: 1500,
  maxDelayMs: 5000,
  newChatDelayMs: 3000,
  maxIdenticalMessages: 3,
  burstAllowance: 3,
};

interface MessageRecord {
  timestamp: number;
  recipient: string;
  contentHash: string;
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private messages: MessageRecord[] = [];
  private identicalCount = new Map<string, number>();
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
    const dayMessages = this.messages.filter(m => now - m.timestamp < 86400000);
    if (dayMessages.length >= this.config.maxPerDay) {
      return -1; // Hard block — daily limit reached
    }

    // Check hourly limit
    const hourMessages = this.messages.filter(m => now - m.timestamp < 3600000);
    if (hourMessages.length >= this.config.maxPerHour) {
      const oldestInHour = hourMessages[0];
      return oldestInHour ? (oldestInHour.timestamp + 3600000) - now : 60000;
    }

    // Check per-minute limit
    const minuteMessages = this.messages.filter(m => now - m.timestamp < 60000);
    if (minuteMessages.length >= this.config.maxPerMinute) {
      const oldestInMinute = minuteMessages[0];
      return oldestInMinute ? (oldestInMinute.timestamp + 60000) - now : 10000;
    }

    // Check identical message limit
    const identicalKey = `${contentHash}`;
    const identicalSent = this.identicalCount.get(identicalKey) || 0;
    if (identicalSent >= this.config.maxIdenticalMessages) {
      return -1; // Block identical spam
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

    this.messages.push({ timestamp: now, recipient, contentHash });
    this.knownChats.add(recipient);
    this.lastMessageTime = now;

    // Track identical messages
    const count = (this.identicalCount.get(contentHash) || 0) + 1;
    this.identicalCount.set(contentHash, count);

    // Reset burst counter after inactivity
    if (now - this.lastMessageTime > 30000) {
      this.burstCount = 0;
    }
  }

  /**
   * Get current usage stats
   */
  getStats() {
    const now = Date.now();
    this.cleanup(now);
    return {
      lastMinute: this.messages.filter(m => now - m.timestamp < 60000).length,
      lastHour: this.messages.filter(m => now - m.timestamp < 3600000).length,
      lastDay: this.messages.filter(m => now - m.timestamp < 86400000).length,
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
    this.messages = this.messages.filter(m => now - m.timestamp < 86400000);

    // Reset identical counters every hour
    if (this.messages.length === 0) {
      this.identicalCount.clear();
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
