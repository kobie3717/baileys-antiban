/**
 * Timelock Guard — Manages reachout timelock state and routing decisions
 *
 * When WhatsApp timelocks an account (463 error), this guard:
 * - Tracks the timelock state (active, expiry, enforcement type)
 * - Blocks messages to NEW contacts (no tctoken / no prior chat)
 * - Allows messages to EXISTING contacts (have tctoken / prior chat history)
 * - Auto-resumes when the timelock expires
 * - Fires callbacks for alerting (Telegram/Discord/webhook)
 */
export interface TimelockState {
    isActive: boolean;
    enforcementType?: string;
    expiresAt?: Date;
    detectedAt?: Date;
    /** Number of 463 errors seen in current lock period */
    errorCount: number;
}
export interface TimelockGuardConfig {
    /** Callback when timelock is detected */
    onTimelockDetected?: (state: TimelockState) => void;
    /** Callback when timelock expires/lifts */
    onTimelockLifted?: (state: TimelockState) => void;
    /** Extra safety buffer after expiry before resuming (default: 10000ms / 10s) */
    resumeBufferMs: number;
}
export declare class TimelockGuard {
    private config;
    private state;
    private knownChats;
    private resumeTimer;
    private timerGeneration;
    constructor(config?: Partial<TimelockGuardConfig>);
    /**
     * Update timelock state from Baileys connection.update event
     */
    onTimelockUpdate(data: {
        isActive?: boolean;
        timeEnforcementEnds?: Date;
        enforcementType?: string;
    }): void;
    /**
     * Record a 463 error from a failed send
     */
    record463Error(): void;
    /**
     * Register a JID as a known/existing chat (has tctoken / prior history)
     */
    registerKnownChat(jid: string): void;
    /**
     * Register multiple known chats at once (e.g. from chat list on connect)
     */
    registerKnownChats(jids: string[]): void;
    /**
     * Check if a message to this recipient should be allowed
     */
    canSend(jid: string): {
        allowed: boolean;
        reason?: string;
    };
    /**
     * Get current timelock state
     */
    getState(): TimelockState;
    /**
     * Check if currently timelocked
     */
    isTimelocked(): boolean;
    /**
     * Get the set of known chat JIDs
     */
    getKnownChats(): Set<string>;
    /**
     * Manually lift the timelock
     */
    lift(): void;
    /**
     * Reset all state
     */
    reset(): void;
    private scheduleResume;
    private clearResumeTimer;
}
