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
export type BanRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export interface HealthStatus {
    risk: BanRiskLevel;
    score: number;
    reasons: string[];
    recommendation: string;
    stats: {
        disconnectsLastHour: number;
        failedMessagesLastHour: number;
        forbiddenErrors: number;
        timelockErrors: number;
        uptimeMs: number;
        lastDisconnectReason?: string;
    };
}
export interface HealthMonitorConfig {
    /** Disconnects per hour before warning (default: 3) */
    disconnectWarningThreshold: number;
    /** Disconnects per hour before critical (default: 5) */
    disconnectCriticalThreshold: number;
    /** Failed messages per hour before warning (default: 5) */
    failedMessageThreshold: number;
    /** Callback when risk level changes */
    onRiskChange?: (status: HealthStatus) => void;
    /** Auto-pause sending at this risk level (default: 'high') */
    autoPauseAt: BanRiskLevel;
}
export declare class HealthMonitor {
    private config;
    private events;
    private startTime;
    private paused;
    private lastRisk;
    constructor(config?: Partial<HealthMonitorConfig>);
    /**
     * Record a disconnection event
     */
    recordDisconnect(reason: string | number): void;
    /**
     * Record a successful reconnection
     */
    recordReconnect(): void;
    /**
     * Record a failed message send
     */
    recordMessageFailed(error?: string): void;
    /**
     * Record a 463 reachout timelock error
     */
    recordReachoutTimelock(detail?: string): void;
    /**
     * Get current health status
     */
    getStatus(): HealthStatus;
    /**
     * Check if sending should be paused
     */
    isPaused(): boolean;
    /**
     * Manually pause/resume
     */
    setPaused(paused: boolean): void;
    /**
     * Reset all tracked events
     */
    reset(): void;
    private cleanup;
    private checkAndNotify;
}
