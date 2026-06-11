/**
 * WarmUp — Gradual activity increase for new/reconnected numbers
 *
 * New numbers or numbers reconnecting after a break are under extra scrutiny.
 * This module enforces a gradual ramp-up of messaging activity.
 *
 * WhatsApp flags:
 * - New numbers sending many messages immediately
 * - Numbers going from 0 to 100 messages/day overnight
 * - Sudden pattern changes after period of inactivity
 */
/** Generate a random growth factor in [1.5, 2.2] to avoid cross-account clustering */
function randomGrowthFactor() {
    return Math.round((1.5 + Math.random() * 0.7) * 100) / 100;
}
const DEFAULT_CONFIG = {
    warmUpDays: 7,
    day1Limit: 20,
    growthFactor: randomGrowthFactor(), // intentionally non-deterministic
    inactivityThresholdHours: 72,
};
export class WarmUp {
    config;
    state;
    constructor(config = {}, existingState) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.state = existingState || this.freshState();
    }
    /**
     * Get the current daily message limit based on warm-up phase
     */
    getDailyLimit() {
        if (this.state.graduated)
            return Infinity;
        const day = this.getCurrentDay();
        if (day >= this.config.warmUpDays) {
            this.state.graduated = true;
            return Infinity;
        }
        return Math.round(this.config.day1Limit * Math.pow(this.config.growthFactor, day));
    }
    /**
     * Check if a message can be sent (within warm-up limits)
     */
    canSend() {
        this.checkInactivity();
        if (this.state.graduated)
            return true;
        const day = this.getCurrentDay();
        const todayCount = this.state.dailyCounts[day] || 0;
        return todayCount < this.getDailyLimit();
    }
    /**
     * Record a sent message
     */
    record() {
        const now = Date.now();
        const day = this.getCurrentDay();
        while (this.state.dailyCounts.length <= day) {
            this.state.dailyCounts.push(0);
        }
        this.state.dailyCounts[day]++;
        this.state.lastActiveAt = now;
    }
    /**
     * Get current warm-up status
     */
    getStatus() {
        const day = this.getCurrentDay();
        const todaySent = this.state.dailyCounts[day] || 0;
        const limit = this.getDailyLimit();
        return {
            phase: this.state.graduated ? 'graduated' : 'warming',
            day: Math.min(day + 1, this.config.warmUpDays),
            totalDays: this.config.warmUpDays,
            todayLimit: limit === Infinity ? -1 : limit,
            todaySent,
            progress: this.state.graduated ? 100 : Math.round((day / this.config.warmUpDays) * 100),
        };
    }
    /**
     * Export state for persistence
     */
    exportState() {
        const day = this.getCurrentDay();
        const todaySent = this.state.dailyCounts[day] || 0;
        const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return {
            ...this.state,
            todaySentCount: todaySent,
            todayDate,
        };
    }
    /**
     * Import state from persistence
     */
    importState(state) {
        this.state = { ...state };
        // BUG FIX 1: Restore today's send count from persisted state
        // If todayDate matches current date, restore the count to prevent
        // post-crash burst (issue: warmup day counter survives but send history lost)
        if (state.todayDate && state.todaySentCount !== undefined) {
            const todayDate = new Date().toISOString().split('T')[0];
            if (state.todayDate === todayDate) {
                const day = this.getCurrentDay();
                // Restore the persisted count if higher than current
                while (this.state.dailyCounts.length <= day) {
                    this.state.dailyCounts.push(0);
                }
                this.state.dailyCounts[day] = Math.max(this.state.dailyCounts[day] || 0, state.todaySentCount);
            }
        }
    }
    /**
     * Reset warm-up (e.g., after detected ban risk)
     */
    reset() {
        this.state = this.freshState();
    }
    getCurrentDay() {
        return Math.floor((Date.now() - this.state.startedAt) / 86400000);
    }
    checkInactivity() {
        const hoursSinceActive = (Date.now() - this.state.lastActiveAt) / 3600000;
        if (hoursSinceActive > this.config.inactivityThresholdHours && this.state.graduated) {
            // Re-enter warm-up after extended inactivity
            this.state = this.freshState();
            this.state.graduated = false;
        }
    }
    freshState() {
        const now = Date.now();
        return {
            startedAt: now,
            lastActiveAt: now,
            dailyCounts: [],
            graduated: false,
        };
    }
}
