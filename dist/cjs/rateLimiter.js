"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
// Time constants for clarity
const TIME_CONSTANTS = {
    MS_PER_SECOND: 1000,
    MS_PER_MINUTE: 60000,
    MS_PER_HOUR: 3600000,
    MS_PER_DAY: 86400000,
    BURST_RESET_MS: 30000,
    IDENTICAL_WINDOW_MS: 3600000, // 1 hour
};
const DEFAULT_CONFIG = {
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
class RateLimiter {
    config;
    originalConfig;
    messages = [];
    identicalCount = new Map();
    knownChats = new Set();
    burstCount = 0;
    lastMessageTime = 0;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.originalConfig = { ...this.config };
    }
    /**
     * Calculate delay before next message can be sent.
     * Returns 0 if message can be sent immediately.
     * Returns -1 if message should be blocked entirely.
     */
    async getDelay(recipient, content) {
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
        }
        else {
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
    record(recipient, content) {
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
            }
            else {
                // Start new window
                this.identicalCount.set(contentHash, { count: 1, firstSeen: now, lastSeen: now });
            }
        }
        else {
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
            currentFactor: this.getCurrentFactor(),
        };
    }
    /**
     * Dynamically scale rate limits by a factor (0.1–1.0).
     * factor=1.0 = original config limits (full speed)
     * factor=0.5 = 50% of configured limits
     * Floors: perMinute >= 1, perHour >= 5, perDay >= 20
     * Also scales minDelayMs/maxDelayMs inversely (slower sends when throttled).
     */
    adaptLimits(factor) {
        const f = Math.max(0.1, Math.min(1.0, factor));
        this.config.maxPerMinute = Math.max(1, Math.floor(this.originalConfig.maxPerMinute * f));
        this.config.maxPerHour = Math.max(5, Math.floor(this.originalConfig.maxPerHour * f));
        this.config.maxPerDay = Math.max(20, Math.floor(this.originalConfig.maxPerDay * f));
        // Inverse: lower factor = longer delays (more human when throttled)
        const delayScale = 1 + (1 - f) * 2; // f=1.0→1x, f=0.5→2x, f=0.1→3.8x
        this.config.minDelayMs = Math.floor(this.originalConfig.minDelayMs * delayScale);
        this.config.maxDelayMs = Math.floor(this.originalConfig.maxDelayMs * delayScale);
    }
    /** Return current effective factor (0.1–1.0) */
    getCurrentFactor() {
        return this.config.maxPerMinute / this.originalConfig.maxPerMinute;
    }
    /** Get the set of known chat JIDs (for state persistence) */
    getKnownChats() {
        return this.knownChats;
    }
    /** Restore known chats from persisted state */
    restoreKnownChats(chats) {
        for (const jid of chats) {
            this.knownChats.add(jid);
        }
    }
    /**
     * BUG FIX 3: Inject historical timestamps into the sliding window
     * Used by InstanceCoordinator to sync local limiter with shared pool after reconnect.
     * This prevents the double-spend window where local limiter thinks it has full budget
     * but the shared pool already shows most slots used.
     */
    injectTimestamps(timestamps) {
        const now = Date.now();
        // Filter to last 24 hours only (our cleanup window)
        const recentTimestamps = timestamps.filter(ts => now - ts < TIME_CONSTANTS.MS_PER_DAY);
        // Merge with existing messages, avoiding duplicates by timestamp
        const existingTimes = new Set(this.messages.map(m => m.timestamp));
        for (const ts of recentTimestamps) {
            if (!existingTimes.has(ts)) {
                // Create synthetic message record with placeholder data
                this.messages.push({
                    timestamp: ts,
                    recipient: '__injected__', // placeholder - we don't know the actual recipient
                    contentHash: '__injected__', // placeholder - we don't know the content
                });
            }
        }
        // Update lastMessageTime if injected timestamps are more recent
        const maxInjected = Math.max(...recentTimestamps, 0);
        if (maxInjected > this.lastMessageTime) {
            this.lastMessageTime = maxInjected;
        }
        // Sort messages by timestamp to maintain sliding window integrity
        this.messages.sort((a, b) => a.timestamp - b.timestamp);
    }
    cleanup(now) {
        // Remove messages older than 24 hours
        this.messages = this.messages.filter(m => now - m.timestamp < TIME_CONSTANTS.MS_PER_DAY);
        // Clean up identicalCount Map based on time windows (not just message presence)
        // Remove trackers where the window has expired
        for (const [hash, tracker] of this.identicalCount.entries()) {
            if (now - tracker.lastSeen > this.config.identicalMessageWindowMs) {
                this.identicalCount.delete(hash);
            }
        }
        // LRU size cap — prevents unbounded growth when sending many unique messages.
        // Evict oldest-by-lastSeen entries when map exceeds 10,000 entries.
        const IDENTICAL_COUNT_MAX = 10_000;
        if (this.identicalCount.size > IDENTICAL_COUNT_MAX) {
            const sorted = [...this.identicalCount.entries()].sort(([, a], [, b]) => a.lastSeen - b.lastSeen);
            const excess = this.identicalCount.size - IDENTICAL_COUNT_MAX;
            for (let i = 0; i < excess; i++)
                this.identicalCount.delete(sorted[i][0]);
        }
    }
    /** Random delay between min and max (gaussian-ish distribution) */
    jitter(min, max) {
        // Use Box-Muller for more human-like distribution (clustered around middle)
        const u1 = Math.random();
        const u2 = Math.random();
        const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const normalized = (normal + 3) / 6; // Map to ~0-1 range
        const clamped = Math.max(0, Math.min(1, normalized));
        return Math.round(min + clamped * (max - min));
    }
    /** Simple hash for content dedup */
    hashContent(content) {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString(36);
    }
}
exports.RateLimiter = RateLimiter;
