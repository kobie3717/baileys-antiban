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
const DEFAULT_CONFIG = {
    disconnectWarningThreshold: 3,
    disconnectCriticalThreshold: 5,
    failedMessageThreshold: 5,
    autoPauseAt: 'high',
};
export class HealthMonitor {
    config;
    events = [];
    startTime = Date.now();
    paused = false;
    lastRisk = 'low';
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Record a disconnection event
     */
    recordDisconnect(reason) {
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
    recordReconnect() {
        this.events.push({ type: 'reconnect', timestamp: Date.now() });
    }
    /**
     * Record a failed message send
     */
    recordMessageFailed(error) {
        this.events.push({ type: 'messageFailed', timestamp: Date.now(), detail: error });
        this.checkAndNotify();
    }
    /**
     * Record a 463 reachout timelock error
     */
    recordReachoutTimelock(detail) {
        this.events.push({ type: 'reachoutTimelocked', timestamp: Date.now(), detail });
        this.checkAndNotify();
    }
    /**
     * Get current health status
     */
    getStatus() {
        const now = Date.now();
        this.cleanup(now);
        const hourEvents = this.events.filter(e => now - e.timestamp < 3600000);
        const disconnects = hourEvents.filter(e => e.type === 'disconnect').length;
        const forbidden = hourEvents.filter(e => e.type === 'forbidden').length;
        const loggedOut = hourEvents.filter(e => e.type === 'loggedOut').length;
        const failedMessages = hourEvents.filter(e => e.type === 'messageFailed').length;
        let score = 0;
        const reasons = [];
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
        // Reachout timelocked (463)
        const timelocked = hourEvents.filter(e => e.type === 'reachoutTimelocked').length;
        if (timelocked > 0) {
            score += 25;
            reasons.push(`${timelocked} reachout timelock (463) error${timelocked > 1 ? 's' : ''} in last hour`);
        }
        // Frequent disconnects
        if (disconnects >= this.config.disconnectCriticalThreshold) {
            score += 30;
            reasons.push(`${disconnects} disconnects in last hour (critical threshold)`);
        }
        else if (disconnects >= this.config.disconnectWarningThreshold) {
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
        let risk;
        if (score >= 85)
            risk = 'critical';
        else if (score >= 60)
            risk = 'high';
        else if (score >= 30)
            risk = 'medium';
        else
            risk = 'low';
        // Determine recommendation
        let recommendation;
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
        const lastDisconnect = [...this.events].reverse().find(e => e.type === 'disconnect' || e.type === 'forbidden' || e.type === 'loggedOut');
        return {
            risk,
            score,
            reasons: reasons.length ? reasons : ['No issues detected'],
            recommendation,
            stats: {
                disconnectsLastHour: disconnects,
                failedMessagesLastHour: failedMessages,
                forbiddenErrors: forbidden,
                timelockErrors: timelocked,
                uptimeMs: now - this.startTime,
                lastDisconnectReason: lastDisconnect?.detail,
            },
        };
    }
    /**
     * Check if sending should be paused
     */
    isPaused() {
        if (this.paused)
            return true;
        const status = this.getStatus();
        const riskOrder = ['low', 'medium', 'high', 'critical'];
        return riskOrder.indexOf(status.risk) >= riskOrder.indexOf(this.config.autoPauseAt);
    }
    /**
     * Manually pause/resume
     */
    setPaused(paused) {
        this.paused = paused;
    }
    /**
     * Reset all tracked events
     */
    reset() {
        this.events = [];
        this.startTime = Date.now();
        this.paused = false;
        this.lastRisk = 'low';
    }
    cleanup(now) {
        // Keep last 6 hours of events
        this.events = this.events.filter(e => now - e.timestamp < 21600000);
    }
    checkAndNotify() {
        const status = this.getStatus();
        if (status.risk !== this.lastRisk) {
            this.lastRisk = status.risk;
            this.config.onRiskChange?.(status);
        }
    }
}
