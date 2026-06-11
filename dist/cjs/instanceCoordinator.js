"use strict";
/**
 * InstanceCoordinator — cross-process rate pool via shared state file
 *
 * Problem: N bot instances on the same IP each enforce their own per-minute
 * limit. Collectively they can exceed safe IP-level thresholds.
 *
 * Solution: shared JSON file updated on every send. Each instance reads the
 * shared pool before sending and deducts from a shared per-minute budget.
 *
 * File format: { sends: number[], updatedAt: number }
 *   sends = array of timestamps (ms) of recent sends across ALL instances
 *
 * Coordination model: optimistic read-modify-write with rename-swap atomicity.
 * Race window is tiny (sub-ms) and consequences are minor (brief over-limit).
 * No hard lock needed — this is best-effort coordination, not a mutex.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstanceCoordinator = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class InstanceCoordinator {
    config;
    constructor(config) {
        this.config = {
            sharedFilePath: config.sharedFilePath,
            poolMaxPerMinute: config.poolMaxPerMinute ?? 20,
            poolMaxPerHour: config.poolMaxPerHour ?? 500,
            poolExhaustedDelayMs: config.poolExhaustedDelayMs ?? 5000,
            staleThresholdMs: config.staleThresholdMs ?? 120000, // 2 minutes
        };
        // Ensure directory exists
        const dir = path.dirname(this.config.sharedFilePath);
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            }
            catch (err) {
                console.warn(`[baileys-antiban] instanceCoordinator: Failed to create directory ${dir}:`, err);
            }
        }
    }
    /**
     * Try to acquire a send slot from the shared pool.
     * Returns { allowed: true } if send is allowed, or { allowed: false, retryAfterMs } if pool is exhausted.
     */
    tryAcquireSlot() {
        try {
            const now = Date.now();
            let state = this.readState();
            // Filter stale timestamps (older than staleThreshold)
            const staleThreshold = now - this.config.staleThresholdMs;
            state.sends = state.sends.filter(ts => ts > staleThreshold);
            // Calculate time windows
            const oneMinuteAgo = now - 60000;
            const oneHourAgo = now - 3600000;
            const sendsLastMinute = state.sends.filter(ts => ts > oneMinuteAgo).length;
            const sendsLastHour = state.sends.filter(ts => ts > oneHourAgo).length;
            // Check minute limit
            if (sendsLastMinute >= this.config.poolMaxPerMinute) {
                const oldestInWindow = state.sends.filter(ts => ts > oneMinuteAgo).sort((a, b) => a - b)[0];
                const retryAfterMs = oldestInWindow ? Math.max(1000, oldestInWindow + 60000 - now) : this.config.poolExhaustedDelayMs;
                return { allowed: false, retryAfterMs };
            }
            // Check hour limit
            if (sendsLastHour >= this.config.poolMaxPerHour) {
                const oldestInWindow = state.sends.filter(ts => ts > oneHourAgo).sort((a, b) => a - b)[0];
                const retryAfterMs = oldestInWindow ? Math.max(10000, oldestInWindow + 3600000 - now) : 60000;
                return { allowed: false, retryAfterMs };
            }
            // Acquire slot — add current timestamp
            state.sends.push(now);
            state.updatedAt = now;
            // Prune to last 2 hours to prevent unbounded growth
            const twoHoursAgo = now - 7200000;
            state.sends = state.sends.filter(ts => ts > twoHoursAgo);
            // Write back atomically
            this.writeState(state);
            return { allowed: true };
        }
        catch (err) {
            // Fail open — coordination failure should never block sends
            console.warn('[baileys-antiban] instanceCoordinator: Error in tryAcquireSlot, failing open:', err);
            return { allowed: true };
        }
    }
    /**
     * Get current statistics for the shared pool
     */
    getStats() {
        try {
            const now = Date.now();
            const state = this.readState();
            const oneMinuteAgo = now - 60000;
            const oneHourAgo = now - 3600000;
            const sendsLastMinute = state.sends.filter(ts => ts > oneMinuteAgo).length;
            const sendsLastHour = state.sends.filter(ts => ts > oneHourAgo).length;
            return {
                poolSendsLastMinute: sendsLastMinute,
                poolSendsLastHour: sendsLastHour,
                poolMaxPerMinute: this.config.poolMaxPerMinute,
                poolMaxPerHour: this.config.poolMaxPerHour,
                poolUtilization: sendsLastMinute / this.config.poolMaxPerMinute,
                coordinationFilePath: this.config.sharedFilePath,
            };
        }
        catch (err) {
            console.warn('[baileys-antiban] instanceCoordinator: Error in getStats:', err);
            return {
                poolSendsLastMinute: 0,
                poolSendsLastHour: 0,
                poolMaxPerMinute: this.config.poolMaxPerMinute,
                poolMaxPerHour: this.config.poolMaxPerHour,
                poolUtilization: 0,
                coordinationFilePath: this.config.sharedFilePath,
            };
        }
    }
    /**
     * Read coordination state from file. Returns empty state if file doesn't exist.
     */
    readState() {
        try {
            if (!fs.existsSync(this.config.sharedFilePath)) {
                return { sends: [], updatedAt: Date.now() };
            }
            const content = fs.readFileSync(this.config.sharedFilePath, 'utf-8');
            const parsed = JSON.parse(content);
            // Validate structure
            if (!Array.isArray(parsed.sends) || typeof parsed.updatedAt !== 'number') {
                console.warn('[baileys-antiban] instanceCoordinator: Invalid state file format, resetting');
                return { sends: [], updatedAt: Date.now() };
            }
            return parsed;
        }
        catch (err) {
            // File doesn't exist or is corrupt — return empty state
            return { sends: [], updatedAt: Date.now() };
        }
    }
    /**
     * Write coordination state to file atomically using rename-swap
     */
    writeState(state) {
        try {
            const tmp = `${this.config.sharedFilePath}.tmp.${process.pid}`;
            fs.writeFileSync(tmp, JSON.stringify(state), 'utf-8');
            fs.renameSync(tmp, this.config.sharedFilePath);
        }
        catch (err) {
            console.warn('[baileys-antiban] instanceCoordinator: Failed to write state file:', err);
            // Fail silently — don't throw, this is best-effort coordination
        }
    }
    /**
     * BUG FIX 3: Sync local rate limiter with shared pool after reconnect
     * Reads shared pool timestamps and injects them into the local limiter's sliding window.
     * This prevents the double-spend window where the limiter thinks it has full budget
     * post-reconnect but the shared pool already shows most slots used.
     */
    syncLocalLimiter(rateLimiter) {
        try {
            const state = this.readState();
            const now = Date.now();
            // Filter to last 24 hours (rate limiter's cleanup window)
            const recentTimestamps = state.sends.filter(ts => now - ts < 86400000);
            // Inject into local rate limiter
            rateLimiter.injectTimestamps(recentTimestamps);
            if (recentTimestamps.length > 0) {
                console.log(`[baileys-antiban] instanceCoordinator: Synced ${recentTimestamps.length} shared pool timestamps to local limiter after reconnect`);
            }
        }
        catch (err) {
            console.warn('[baileys-antiban] instanceCoordinator: Failed to sync local limiter:', err);
            // Fail silently — this is best-effort sync
        }
    }
}
exports.InstanceCoordinator = InstanceCoordinator;
