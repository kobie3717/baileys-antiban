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
import * as fs from 'fs';
import * as path from 'path';
export class InstanceCoordinator {
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
}
