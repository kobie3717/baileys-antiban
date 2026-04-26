/**
 * Presence Choreographer — Circadian rhythm, distraction pauses, realistic read-receipts
 *
 * WhatsApp's ML models detect accounts with perfect, robotic timing patterns.
 * This module adds realistic temporal variations:
 * - Circadian rhythm: slower at night, faster during business hours
 * - Distraction pauses: random 5-20min pauses (phone put down)
 * - Offline gaps: occasional 5-15min offline periods
 * - Read receipt timing: 3-45s delay, 15% chance to skip
 *
 * Research: 2025 ban analysis showed accounts with <10% timing variance were
 * flagged at 3x rate vs accounts with circadian patterns. Human users have
 * 40-60% variance in hourly activity.
 */
const DEFAULT_CONFIG = {
    enabled: false,
    enableCircadianRhythm: true,
    timezone: 'UTC',
    activityCurve: 'office',
    circadian: {
        enabled: true,
        profile: 'default',
        timezone: 'UTC',
    },
    distractionPauseProbability: 0.05,
    distractionPauseMinMs: 300000,
    distractionPauseMaxMs: 1200000,
    readReceiptDelayMinMs: 3000,
    readReceiptDelayMaxMs: 45000,
    readReceiptSkipProbability: 0.15,
    offlineGapProbability: 0.03,
    offlineGapMinMs: 300000,
    offlineGapMaxMs: 900000,
    enableTypingModel: true,
    typingWPM: 45,
    typingWPMStdDev: 15,
    thinkPauseProbability: 0.08,
    thinkPauseMinMs: 800,
    thinkPauseMaxMs: 3500,
    intermittentPausedProbability: 0.4,
    typingMaxMs: 90000,
    typingMinMs: 600,
};
/**
 * Activity curves (0.1 to 1.0 multipliers by hour)
 * Values are inverted later: higher activity = shorter delays
 */
const ACTIVITY_CURVES = {
    office: [
        0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, // 0-7: night quiet
        0.5, 0.5, // 8-9: morning ramp
        0.95, 0.95, // 10-11: morning peak
        0.6, // 12: lunch dip
        0.9, 0.9, 0.9, 0.9, // 13-16: afternoon
        0.6, 0.6, // 17-18: wind-down
        0.4, 0.4, // 19-20: evening
        0.2, 0.2, 0.2, 0.2, // 21-24: taper
    ],
    social: [
        0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, // 0-7: night quiet
        0.3, 0.4, // 8-9: slow start
        0.7, 0.8, // 10-11: ramp up
        0.5, // 12: lunch
        0.7, 0.7, // 13-14: afternoon
        0.4, // 15: tea time dip
        0.8, 0.9, 0.9, // 16-18: active
        0.6, // 19: dinner dip
        0.8, 0.85, 0.9, 0.95, 1.0, // 20-24: evening peak
    ],
    global: [
        0.5, 0.5, 0.5, 0.5, 0.5, 0.5, // 0-5: night
        0.4, 0.4, // 6-7: dawn dip
        0.6, 0.7, 0.8, 0.8, // 8-11: morning
        0.6, // 12: lunch
        0.8, 0.8, 0.8, 0.8, // 13-16: afternoon
        0.7, 0.7, // 17-18: evening
        0.6, 0.5, 0.5, 0.5, 0.5, 0.5, // 19-24: night taper
    ],
};
/**
 * Get circadian delay multiplier based on hour of day.
 * Returns a multiplier to apply to base delays (typing, presence, etc.).
 *
 * Multiplier ranges:
 * - Awake hours (09:00-22:00): ~0.8-1.2 (near baseline)
 * - Evening (22:00-00:00): 1.2 → 2.5
 * - Late night (00:00-02:00): 2.5 → 4.0
 * - Dead zone (02:00-06:00): 4.0-6.0 (peak slow)
 * - Early morning (06:00-09:00): 4.0 → 1.0
 *
 * Uses cosine-based smooth transitions (not stepped).
 *
 * @param date - Date to check (uses hour from this)
 * @param profile - Circadian profile ('default' | 'nightOwl' | 'earlyBird' | 'always_on')
 * @param timezone - IANA timezone (optional, defaults to local)
 * @returns Delay multiplier (0.5 = 2x faster, 2.0 = 2x slower, 5.0 = 5x slower)
 */
export function getCircadianMultiplier(date = new Date(), profile = 'default', timezone) {
    // always_on profile returns flat 1.0
    if (profile === 'always_on') {
        return 1.0;
    }
    // Get hour in specified timezone
    let hour;
    if (timezone) {
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                hour: 'numeric',
                hour12: false,
            });
            const parts = formatter.formatToParts(date);
            const hourPart = parts.find(p => p.type === 'hour');
            hour = hourPart ? parseInt(hourPart.value, 10) : date.getHours();
        }
        catch {
            hour = date.getHours();
        }
    }
    else {
        hour = date.getHours();
    }
    // Apply profile shift
    let shiftedHour = hour;
    if (profile === 'nightOwl') {
        shiftedHour = (hour - 3 + 24) % 24; // shift +3hr (active until 02:00, dead 04:00-09:00)
    }
    else if (profile === 'earlyBird') {
        shiftedHour = (hour + 2) % 24; // shift -2hr (active 06:00-20:00, dead 23:00-04:00)
    }
    // Cosine-based smooth curve
    // Model: slow at night (02:00-06:00), fast during day (09:00-22:00)
    // Use piecewise cosine for smooth transitions
    if (shiftedHour >= 9 && shiftedHour < 22) {
        // Awake hours: 09:00-22:00 — baseline ~0.8-1.2
        // Add slight variance: cosine wave with period 13 hours
        const t = (shiftedHour - 9) / 13;
        return 1.0 + 0.2 * Math.cos(2 * Math.PI * t);
    }
    else if (shiftedHour >= 22 && shiftedHour < 24) {
        // Evening: 22:00-00:00 — ramp 1.2 → 2.5
        const t = (shiftedHour - 22) / 2;
        return 1.2 + 1.3 * t;
    }
    else if (shiftedHour >= 0 && shiftedHour < 2) {
        // Late night: 00:00-02:00 — ramp 2.5 → 4.0
        const t = shiftedHour / 2;
        return 2.5 + 1.5 * t;
    }
    else if (shiftedHour >= 2 && shiftedHour < 6) {
        // Dead zone: 02:00-06:00 — peak slow 4.0-6.0
        // Use cosine for smooth peak
        const t = (shiftedHour - 2) / 4;
        return 5.0 + 1.0 * Math.cos(Math.PI * t); // peaks at 6.0 around 04:00
    }
    else {
        // Early morning: 06:00-09:00 — ramp 4.0 → 1.0
        const t = (shiftedHour - 6) / 3;
        return 4.0 - 3.0 * t;
    }
}
export class PresenceChoreographer {
    config;
    stats = {
        distractionPausesInjected: 0,
        offlineGapsInjected: 0,
        readReceiptsDelayed: 0,
        readReceiptsSkipped: 0,
        typingPlansComputed: 0,
        typingPlansExecuted: 0,
        totalTypingTimeMs: 0,
    };
    constructor(config = {}) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
            circadian: {
                ...DEFAULT_CONFIG.circadian,
                ...(config.circadian || {}),
            },
        };
    }
    /**
     * Get current activity factor (0.1 to 1.0).
     * Higher = more active = shorter delays.
     * If circadian disabled, returns 1.0.
     */
    getCurrentActivityFactor() {
        if (!this.config.enabled || !this.config.enableCircadianRhythm) {
            return 1.0;
        }
        const hour = this.getLocalHour();
        const curve = ACTIVITY_CURVES[this.config.activityCurve];
        return curve[hour] || 0.5;
    }
    /**
     * Check if should pause for distraction.
     * Returns { pause: true, durationMs: 600000 } if probability check passes.
     */
    shouldPauseForDistraction() {
        if (!this.config.enabled) {
            return { pause: false, durationMs: 0 };
        }
        if (Math.random() < this.config.distractionPauseProbability) {
            const durationMs = this.randomBetween(this.config.distractionPauseMinMs, this.config.distractionPauseMaxMs);
            this.stats.distractionPausesInjected++;
            return { pause: true, durationMs };
        }
        return { pause: false, durationMs: 0 };
    }
    /**
     * Check if should take offline gap.
     * Returns { offline: true, durationMs: 600000 } if probability check passes.
     */
    shouldTakeOfflineGap() {
        if (!this.config.enabled) {
            return { offline: false, durationMs: 0 };
        }
        if (Math.random() < this.config.offlineGapProbability) {
            const durationMs = this.randomBetween(this.config.offlineGapMinMs, this.config.offlineGapMaxMs);
            this.stats.offlineGapsInjected++;
            return { offline: true, durationMs };
        }
        return { offline: false, durationMs: 0 };
    }
    /**
     * Check if should mark message as read.
     * Returns { mark: false } if skip probability hit.
     * Returns { mark: true, delayMs: 5000 } otherwise.
     * Applies circadian multiplier to delay.
     */
    shouldMarkRead() {
        if (!this.config.enabled) {
            return { mark: true, delayMs: 0 };
        }
        // Skip read receipt?
        if (Math.random() < this.config.readReceiptSkipProbability) {
            this.stats.readReceiptsSkipped++;
            return { mark: false, delayMs: 0 };
        }
        // Delayed read receipt
        const baseDelayMs = this.randomBetween(this.config.readReceiptDelayMinMs, this.config.readReceiptDelayMaxMs);
        // Apply circadian multiplier if enabled
        let delayMs = baseDelayMs;
        if (this.config.circadian.enabled) {
            const circadianMultiplier = getCircadianMultiplier(new Date(), this.config.circadian.profile, this.config.circadian.timezone);
            delayMs = Math.floor(baseDelayMs * circadianMultiplier);
        }
        this.stats.readReceiptsDelayed++;
        return { mark: true, delayMs };
    }
    /**
     * Compute realistic typing duration for a message of given length.
     * Includes Gaussian WPM variance + think-pause injection + circadian timing multiplier.
     * Returns a "typing plan": array of { state, durationMs } steps the caller should execute sequentially.
     *
     *   plan = [
     *     { state: 'composing', durationMs: 4200 },
     *     { state: 'paused',    durationMs: 950 },   // think pause
     *     { state: 'composing', durationMs: 6800 },
     *     { state: 'paused',    durationMs: 600 },   // brief stop before send
     *   ]
     */
    computeTypingPlan(messageLength) {
        if (!this.config.enabled || !this.config.enableTypingModel) {
            return [{ state: 'composing', durationMs: this.config.typingMinMs }];
        }
        this.stats.typingPlansComputed++;
        // Handle empty message
        if (messageLength === 0) {
            return [{ state: 'composing', durationMs: this.config.typingMinMs }];
        }
        // 1. Sample WPM from Gaussian distribution
        const wpmSample = this.clamp(this.gaussianSample(this.config.typingWPM, this.config.typingWPMStdDev), 10, 120);
        // 2. Convert to chars/sec (WPM standard: 5 chars/word)
        const cps = (wpmSample * 5) / 60;
        // 3. Base typing time
        const baseMs = (messageLength / cps) * 1000;
        // 4. Apply circadian multiplier if enabled
        let circadianMultiplier = 1.0;
        if (this.config.circadian.enabled) {
            circadianMultiplier = getCircadianMultiplier(new Date(), this.config.circadian.profile, this.config.circadian.timezone);
        }
        // 5. Clamp to min/max
        const targetMs = this.clamp(baseMs * circadianMultiplier, this.config.typingMinMs, this.config.typingMaxMs);
        // 6. Build plan with think pauses
        const plan = [];
        let remainingBudget = targetMs;
        let position = 0;
        // Walk through message in chunks of 10 chars
        const chunkSize = 10;
        const numChunks = Math.max(1, Math.ceil(messageLength / chunkSize));
        for (let i = 0; i < numChunks && remainingBudget > 0; i++) {
            const charsInChunk = Math.min(chunkSize, messageLength - position);
            // Distribute remaining budget proportionally across remaining chunks
            const remainingChunks = numChunks - i;
            const chunkBudget = remainingBudget / remainingChunks;
            const chunkTypingMs = Math.floor(Math.min(chunkBudget, remainingBudget));
            if (chunkTypingMs <= 0)
                break;
            // Should we inject a think pause after this chunk?
            if (i > 0 && i < numChunks - 1 && Math.random() < this.config.thinkPauseProbability) {
                // Add composing step
                plan.push({ state: 'composing', durationMs: chunkTypingMs });
                remainingBudget -= chunkTypingMs;
                // Add think pause (apply circadian multiplier to pause durations too)
                const basePauseMs = this.randomBetween(this.config.thinkPauseMinMs, this.config.thinkPauseMaxMs);
                const pauseMs = Math.floor(basePauseMs * circadianMultiplier);
                plan.push({ state: 'paused', durationMs: pauseMs });
            }
            else {
                // Accumulate typing time
                if (plan.length === 0 || plan[plan.length - 1].state === 'paused') {
                    plan.push({ state: 'composing', durationMs: chunkTypingMs });
                }
                else {
                    plan[plan.length - 1].durationMs += chunkTypingMs;
                }
                remainingBudget -= chunkTypingMs;
            }
            position += charsInChunk;
        }
        // 7. Optional final pause before send (apply circadian multiplier)
        if (Math.random() < this.config.intermittentPausedProbability) {
            const baseFinalPauseMs = this.randomBetween(200, 800);
            const finalPauseMs = Math.floor(baseFinalPauseMs * circadianMultiplier);
            plan.push({ state: 'paused', durationMs: finalPauseMs });
        }
        // 8. Ensure we have at least one composing step
        if (plan.length === 0 || !plan.some(step => step.state === 'composing')) {
            return [{ state: 'composing', durationMs: this.config.typingMinMs }];
        }
        return plan;
    }
    /**
     * Execute a typing plan against a Baileys-shaped sock with sendPresenceUpdate(state, jid).
     * Awaits each step's duration. Updates stats.
     *
     *   await choreo.executeTypingPlan(sock, jid, plan);
     *   await sock.sendMessage(jid, content);
     */
    async executeTypingPlan(sock, jid, plan, options) {
        this.stats.typingPlansExecuted++;
        for (const step of plan) {
            // Check abort signal
            if (options?.signal?.aborted) {
                // Restore presence to paused before throwing
                await Promise.resolve(sock.sendPresenceUpdate('paused', jid));
                throw new Error('Typing plan aborted');
            }
            // Update presence
            await Promise.resolve(sock.sendPresenceUpdate(step.state, jid));
            // Sleep for duration
            await this.sleep(step.durationMs);
            // Track total typing time
            this.stats.totalTypingTimeMs += step.durationMs;
        }
    }
    /**
     * Get statistics.
     */
    getStats() {
        return {
            currentActivityFactor: this.getCurrentActivityFactor(),
            distractionPausesInjected: this.stats.distractionPausesInjected,
            offlineGapsInjected: this.stats.offlineGapsInjected,
            readReceiptsDelayed: this.stats.readReceiptsDelayed,
            readReceiptsSkipped: this.stats.readReceiptsSkipped,
            currentHourLocal: this.getLocalHour(),
            typingPlansComputed: this.stats.typingPlansComputed,
            typingPlansExecuted: this.stats.typingPlansExecuted,
            totalTypingTimeMs: this.stats.totalTypingTimeMs,
        };
    }
    /**
     * Reset statistics.
     */
    reset() {
        this.stats = {
            distractionPausesInjected: 0,
            offlineGapsInjected: 0,
            readReceiptsDelayed: 0,
            readReceiptsSkipped: 0,
            typingPlansComputed: 0,
            typingPlansExecuted: 0,
            totalTypingTimeMs: 0,
        };
    }
    // Private helpers
    getLocalHour() {
        try {
            // Use Intl.DateTimeFormat to get local hour in specified timezone
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: this.config.timezone,
                hour: 'numeric',
                hour12: false,
            });
            const parts = formatter.formatToParts(new Date());
            const hourPart = parts.find(p => p.type === 'hour');
            if (hourPart) {
                return parseInt(hourPart.value, 10);
            }
        }
        catch (error) {
            // Timezone not supported — fall back to UTC
        }
        // Fallback to UTC hour
        return new Date().getUTCHours();
    }
    randomBetween(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
    /**
     * Generate Gaussian sample using Box-Muller transform.
     * Returns a sample from N(mean, stdDev).
     */
    gaussianSample(mean, stdDev) {
        // Box-Muller transform
        const u1 = Math.random();
        const u2 = Math.random();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return mean + z0 * stdDev;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
