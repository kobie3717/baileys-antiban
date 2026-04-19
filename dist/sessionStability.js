/**
 * Session Stability Module — Middleware layer for Baileys socket stability
 *
 * Wraps Baileys socket to provide:
 * 1. Canonical JID normalization before sendMessage (reduces mutex race triggers)
 * 2. Typed disconnect reason classification with recovery recommendations
 * 3. Session health monitoring (Bad MAC detection and degradation alerts)
 *
 * This is a pure middleware layer — cannot modify Baileys internals, but can wrap
 * the socket interface to provide stability improvements.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
/**
 * Classify Baileys DisconnectReason codes into typed categories.
 * Based on PR #2367 and observed behavior from production bots.
 */
export function classifyDisconnect(statusCode) {
    // Fatal errors — logged out or banned, need QR restart
    if (statusCode === 401 || statusCode === 440) {
        return {
            category: 'fatal',
            shouldReconnect: false,
            message: 'Logged out — restart with QR code required',
            code: statusCode,
        };
    }
    if (statusCode === 515) {
        return {
            category: 'fatal',
            shouldReconnect: false,
            message: 'Restart required by WhatsApp — client too old or protocol mismatch',
            code: statusCode,
        };
    }
    // Connection replaced — user logged in elsewhere or multi-device conflict
    if (statusCode === 428) {
        return {
            category: 'fatal',
            shouldReconnect: false,
            message: 'Connection replaced — another device logged in',
            code: statusCode,
        };
    }
    // Rate limited — back off before reconnecting
    if (statusCode === 429) {
        return {
            category: 'rate-limited',
            shouldReconnect: true,
            backoffMs: 300_000, // 5 minutes
            message: 'Rate limited by WhatsApp — cool-off period required',
            code: statusCode,
        };
    }
    if (statusCode === 503) {
        return {
            category: 'rate-limited',
            shouldReconnect: true,
            backoffMs: 60_000, // 1 minute
            message: 'WhatsApp service unavailable — temporary outage',
            code: statusCode,
        };
    }
    // Timeout — transient network issue
    if (statusCode === 408) {
        return {
            category: 'recoverable',
            shouldReconnect: true,
            backoffMs: 5_000, // 5 seconds
            message: 'Connection timeout — network issue, safe to retry',
            code: statusCode,
        };
    }
    // Internal server error — WhatsApp hiccup
    if (statusCode === 500) {
        return {
            category: 'recoverable',
            shouldReconnect: true,
            backoffMs: 10_000, // 10 seconds
            message: 'WhatsApp internal error — temporary server issue',
            code: statusCode,
        };
    }
    // Connection closed gracefully
    if (statusCode === 1000) {
        return {
            category: 'recoverable',
            shouldReconnect: true,
            backoffMs: 2_000, // 2 seconds
            message: 'Connection closed gracefully — safe to reconnect',
            code: statusCode,
        };
    }
    // Unknown code — conservative approach
    return {
        category: 'unknown',
        shouldReconnect: true,
        backoffMs: 15_000, // 15 seconds
        message: `Unknown disconnect reason (code ${statusCode}) — reconnect with caution`,
        code: statusCode,
    };
}
const DEFAULT_HEALTH_CONFIG = {
    badMacThreshold: 3,
    badMacWindowMs: 60_000,
};
/**
 * Track session health via decrypt success/failure ratio.
 * Emits 'session:degraded' event when Bad MAC rate exceeds threshold.
 */
export class SessionHealthMonitor {
    config;
    onDegraded;
    onRecovered;
    stats = {
        decryptSuccess: 0,
        decryptFail: 0,
        badMacCount: 0,
        isDegraded: false,
    };
    badMacTimestamps = [];
    constructor(config = {}) {
        this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
        this.onDegraded = config.onDegraded;
        this.onRecovered = config.onRecovered;
    }
    /**
     * Record successful decrypt
     */
    recordDecryptSuccess() {
        this.stats.decryptSuccess++;
        this.checkRecovery();
    }
    /**
     * Record failed decrypt (Bad MAC or similar)
     */
    recordDecryptFail(isBadMac = false) {
        this.stats.decryptFail++;
        if (isBadMac) {
            const now = Date.now();
            this.stats.badMacCount++;
            this.stats.lastBadMac = new Date(now);
            this.badMacTimestamps.push(now);
            // Clean up old timestamps outside window
            const cutoff = now - this.config.badMacWindowMs;
            this.badMacTimestamps = this.badMacTimestamps.filter(ts => ts > cutoff);
            // Check if we've crossed threshold
            if (!this.stats.isDegraded && this.badMacTimestamps.length >= this.config.badMacThreshold) {
                this.stats.isDegraded = true;
                this.stats.degradedSince = new Date(now);
                this.onDegraded?.(this.getStats());
            }
        }
    }
    /**
     * Check if session has recovered from degraded state
     */
    checkRecovery() {
        if (!this.stats.isDegraded)
            return;
        const now = Date.now();
        const cutoff = now - this.config.badMacWindowMs;
        this.badMacTimestamps = this.badMacTimestamps.filter(ts => ts > cutoff);
        // Recovered if Bad MAC count dropped below threshold
        if (this.badMacTimestamps.length < this.config.badMacThreshold) {
            this.stats.isDegraded = false;
            this.stats.degradedSince = undefined;
            this.onRecovered?.(this.getStats());
        }
    }
    /**
     * Get current health stats
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * Reset all counters
     */
    reset() {
        this.stats = {
            decryptSuccess: 0,
            decryptFail: 0,
            badMacCount: 0,
            isDegraded: false,
        };
        this.badMacTimestamps = [];
    }
}
/**
 * Wrap a Baileys socket with session stability features.
 * Returns a Proxy that intercepts sendMessage to canonicalize JIDs.
 */
export function wrapWithSessionStability(sock, config = {}) {
    const { canonicalJidNormalization = true, healthMonitoring = true, health: healthConfig, lidResolver, } = config;
    // Initialize health monitor if enabled
    const healthMonitor = healthMonitoring ? new SessionHealthMonitor(healthConfig) : null;
    // Return a Proxy that intercepts method calls
    return new Proxy(sock, {
        get(target, prop) {
            // Intercept sendMessage for JID canonicalization
            if (prop === 'sendMessage' && canonicalJidNormalization && lidResolver) {
                return async (jid, content, options) => {
                    // Canonicalize JID using LID resolver
                    const canonical = lidResolver.resolveCanonical(jid);
                    return target.sendMessage(canonical, content, options);
                };
            }
            // Expose health monitor stats via a getter
            if (prop === 'sessionHealthStats' && healthMonitor) {
                return healthMonitor.getStats();
            }
            // Expose health monitor instance
            if (prop === 'sessionHealthMonitor' && healthMonitor) {
                return healthMonitor;
            }
            // Pass through everything else
            return target[prop];
        },
    });
}
