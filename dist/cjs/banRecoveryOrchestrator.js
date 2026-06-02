"use strict";
/**
 * BanRecoveryOrchestrator — Structured recovery after ban/restriction events
 *
 * When WhatsApp restricts your account, the worst thing to do is immediately
 * resume normal activity. This module provides a evidence-based recovery protocol:
 *
 * - Timelocked (reachout_restricted): 24h pause, resume at 10% rate, ramp 15%/week
 * - Rate-overlimit (429): 4h pause, resume at 25% rate, ramp 25%/week
 * - Soft-ban (repeated disconnects): 48h pause, resume at 5% rate, ramp 10%/week
 * - Hard-ban (loggedOut): account is dead, signal for replacement
 *
 * Based on observed recovery times from community reports. Not guaranteed —
 * WA's enforcement is non-deterministic. Treat as best-effort guidance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BanRecoveryOrchestrator = void 0;
const DEFAULT_PLANS = {
    timelock: {
        eventType: 'timelock',
        pauseDurationMs: 24 * 60 * 60 * 1000, // 24 hours
        resumeRateMultiplier: 0.10, // 10% of normal
        weeklyRampPercent: 15, // +15% per week
        estimatedRecoveryDays: 14,
        description: 'WA reachout timelock — 24h pause then slow ramp',
    },
    rate_overlimit: {
        eventType: 'rate_overlimit',
        pauseDurationMs: 4 * 60 * 60 * 1000, // 4 hours
        resumeRateMultiplier: 0.25, // 25% of normal
        weeklyRampPercent: 25, // +25% per week
        estimatedRecoveryDays: 7,
        description: 'Rate limit hit — 4h pause then moderate ramp',
    },
    soft_ban: {
        eventType: 'soft_ban',
        pauseDurationMs: 48 * 60 * 60 * 1000, // 48 hours
        resumeRateMultiplier: 0.05, // 5% of normal
        weeklyRampPercent: 10, // +10% per week
        estimatedRecoveryDays: 21,
        description: 'Soft ban detected — 48h pause then very slow ramp',
    },
    hard_ban: {
        eventType: 'hard_ban',
        pauseDurationMs: Infinity,
        resumeRateMultiplier: 0,
        weeklyRampPercent: 0,
        estimatedRecoveryDays: Infinity,
        description: 'Hard ban — number is dead, replace SIM',
    },
};
class BanRecoveryOrchestrator {
    config;
    state;
    plans;
    constructor(config = {}) {
        this.config = {
            plans: config.plans || {},
            onPhaseChange: config.onPhaseChange || (() => { }),
            onHardBan: config.onHardBan || (() => { }),
            maxRecoveryWeeks: config.maxRecoveryWeeks ?? 8,
        };
        // Merge custom plans with defaults
        this.plans = { ...DEFAULT_PLANS };
        if (config.plans) {
            for (const eventType in config.plans) {
                const customPlan = config.plans[eventType];
                if (customPlan) {
                    this.plans[eventType] = {
                        ...this.plans[eventType],
                        ...customPlan,
                    };
                }
            }
        }
        this.state = {
            active: false,
            phase: 'graduated',
            currentRateMultiplier: 1.0,
            weeksSinceResume: 0,
            banCount30d: 0,
        };
    }
    /**
     * Record a ban event and start recovery protocol
     */
    recordBanEvent(eventType) {
        const now = Date.now();
        const plan = this.plans[eventType];
        // Update ban count (reset if >30 days since last ban)
        if (this.state.lastBanAt) {
            const daysSinceLastBan = (now - this.state.lastBanAt) / (86400000);
            if (daysSinceLastBan > 30) {
                this.state.banCount30d = 0;
            }
        }
        this.state.banCount30d++;
        this.state.lastBanAt = now;
        // Upgrade to hard_ban if 3+ bans in 30 days (unless already hard_ban)
        if (this.state.banCount30d >= 3 && eventType !== 'hard_ban') {
            eventType = 'hard_ban';
        }
        this.state.active = true;
        this.state.eventType = eventType;
        this.state.banDetectedAt = now;
        this.state.pauseUntil = plan.pauseDurationMs === Infinity ? Infinity : now + plan.pauseDurationMs;
        this.state.currentRateMultiplier = plan.resumeRateMultiplier;
        this.state.weeksSinceResume = 0;
        this.state.phase = eventType === 'hard_ban' ? 'dead' : 'paused';
        this.config.onPhaseChange(this.state.phase, plan);
        if (eventType === 'hard_ban') {
            this.config.onHardBan();
        }
        return this.getStatus();
    }
    /**
     * Get current recovery status (call before sending to check rate)
     */
    getStatus() {
        if (!this.state.active || !this.state.eventType) {
            return {
                phase: 'graduated',
                rateMultiplier: 1.0,
                recommendation: 'No active recovery — operating normally',
                shouldReplaceNumber: false,
            };
        }
        const now = Date.now();
        const plan = this.plans[this.state.eventType];
        // Check if pause period has ended
        if (this.state.phase === 'paused' && this.state.pauseUntil !== undefined && this.state.pauseUntil !== Infinity && now >= this.state.pauseUntil) {
            this.state.phase = 'recovering';
            this.config.onPhaseChange(this.state.phase, plan);
        }
        // Check if we've exceeded max recovery weeks (give up)
        if (this.state.phase === 'recovering' || this.state.phase === 'ramping') {
            if (this.state.weeksSinceResume >= this.config.maxRecoveryWeeks) {
                this.state.phase = 'dead';
                this.config.onPhaseChange(this.state.phase, plan);
                this.config.onHardBan();
            }
        }
        const shouldReplaceNumber = this.state.phase === 'dead' || this.state.banCount30d >= 3;
        let recommendation;
        switch (this.state.phase) {
            case 'dead':
                recommendation = 'Account is permanently restricted. Replace number and start fresh.';
                break;
            case 'paused':
                if (this.state.pauseUntil === Infinity) {
                    recommendation = 'Account is dead. Do not attempt to send messages.';
                }
                else {
                    const remainingMs = this.state.pauseUntil - now;
                    const remainingHours = Math.ceil(remainingMs / 3600000);
                    recommendation = `Pause period active. Wait ${remainingHours}h before resuming. ${plan.description}`;
                }
                break;
            case 'recovering':
                recommendation = `Recovery phase. Operating at ${Math.round(this.state.currentRateMultiplier * 100)}% capacity. Ramp: ${plan.weeklyRampPercent}%/week.`;
                break;
            case 'ramping':
                recommendation = `Ramping phase. Operating at ${Math.round(this.state.currentRateMultiplier * 100)}% capacity. Ramp: ${plan.weeklyRampPercent}%/week.`;
                break;
            case 'graduated':
                recommendation = 'Recovery complete. Operating at full capacity.';
                break;
        }
        const pauseRemainingMs = this.state.pauseUntil !== undefined && this.state.pauseUntil !== Infinity && now < this.state.pauseUntil
            ? this.state.pauseUntil - now
            : undefined;
        let estimatedFullRecoveryDate;
        if (this.state.phase === 'recovering' || this.state.phase === 'ramping') {
            const rateToGain = 1.0 - this.state.currentRateMultiplier;
            const weeksNeeded = Math.ceil((rateToGain / (plan.weeklyRampPercent / 100)) * (1 / this.state.currentRateMultiplier));
            estimatedFullRecoveryDate = now + weeksNeeded * 7 * 86400000;
        }
        return {
            phase: this.state.phase,
            rateMultiplier: this.state.currentRateMultiplier,
            pauseRemainingMs,
            estimatedFullRecoveryDate,
            recommendation,
            shouldReplaceNumber,
        };
    }
    /**
     * Current rate multiplier — multiply your normal limits by this
     */
    getRateMultiplier() {
        return this.state.currentRateMultiplier;
    }
    /**
     * Should be called daily/weekly to advance the ramp
     */
    tick() {
        if (!this.state.active || !this.state.eventType) {
            return;
        }
        const now = Date.now();
        const plan = this.plans[this.state.eventType];
        // Transition from paused to recovering
        if (this.state.phase === 'paused' && this.state.pauseUntil !== undefined && this.state.pauseUntil !== Infinity && now >= this.state.pauseUntil) {
            this.state.phase = 'recovering';
            this.config.onPhaseChange(this.state.phase, plan);
        }
        // Advance the ramp if in recovering/ramping phase
        if (this.state.phase === 'recovering' || this.state.phase === 'ramping') {
            this.state.weeksSinceResume++;
            // Check if exceeded max recovery weeks
            if (this.state.weeksSinceResume >= this.config.maxRecoveryWeeks) {
                this.state.phase = 'dead';
                this.state.currentRateMultiplier = 0;
                this.config.onPhaseChange(this.state.phase, plan);
                this.config.onHardBan();
                return;
            }
            // Apply weekly ramp
            const rampMultiplier = 1 + (plan.weeklyRampPercent / 100);
            const newMultiplier = this.state.currentRateMultiplier * rampMultiplier;
            if (newMultiplier >= 1.0) {
                // Graduated
                this.state.currentRateMultiplier = 1.0;
                this.state.phase = 'graduated';
                this.state.active = false;
                this.config.onPhaseChange(this.state.phase, plan);
            }
            else {
                // Still ramping
                this.state.currentRateMultiplier = newMultiplier;
                this.state.phase = 'ramping';
            }
        }
    }
    /**
     * Classify a raw error into a BanEventType
     */
    static classifyError(err) {
        if (!err)
            return null;
        const errorStr = String(err).toLowerCase();
        const errorMsg = err.message?.toLowerCase() || '';
        const errorCode = err.code || '';
        // Timelock patterns
        if (errorStr.includes('reachout') ||
            errorStr.includes('account_reachout_restricted') ||
            errorMsg.includes('reachout') ||
            errorCode === 463 ||
            errorCode === '463') {
            return 'timelock';
        }
        // Rate overlimit patterns
        if (errorStr.includes('rate-overlimit') ||
            errorStr.includes('rate_overlimit') ||
            errorStr.includes('429') ||
            errorCode === 429 ||
            errorCode === '429') {
            return 'rate_overlimit';
        }
        // Hard ban patterns
        if (errorStr.includes('loggedout') ||
            errorStr.includes('logged_out') ||
            errorStr.includes('logged out') ||
            errorMsg.includes('loggedout') ||
            errorCode === 401 ||
            errorCode === '401') {
            return 'hard_ban';
        }
        // Note: soft_ban detection requires context (multiple disconnects)
        // and should be determined by the caller using HealthMonitor
        return null;
    }
    /**
     * Serializable state for persistence
     */
    getState() {
        return { ...this.state };
    }
    /**
     * Restore from persisted state
     */
    static fromState(state, config) {
        const orchestrator = new BanRecoveryOrchestrator(config);
        orchestrator.state = { ...state };
        return orchestrator;
    }
}
exports.BanRecoveryOrchestrator = BanRecoveryOrchestrator;
