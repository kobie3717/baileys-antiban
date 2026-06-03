/**
 * HumanEntropyService — Background noise for WA sessions
 *
 * Runs periodic human-like actions to make idle sessions appear more realistic:
 * - Random typing presence to recent contacts
 * - Delayed read receipts
 * - Availability status toggles
 *
 * Design:
 * - Works ONLY with WaSP's public API (no direct socket access)
 * - Fail-silent (never crashes wa-pa)
 * - Configurable intervals and probabilities
 * - Only interacts with contacts who messaged first (never strangers)
 */
export interface HumanEntropyConfig {
    /** Enable entropy service (default: true) */
    enabled?: boolean;
    /** Min interval between entropy cycles in ms (default: 2 hours) */
    minIntervalMs?: number;
    /** Max interval between entropy cycles in ms (default: 6 hours) */
    maxIntervalMs?: number;
    /** Max recent contacts to track (default: 30) */
    maxRecentContacts?: number;
    /** Probability of sending typing presence per cycle (default: 0.3) */
    typingProbability?: number;
    /** Min typing duration in ms (default: 3000) */
    typingMinMs?: number;
    /** Max typing duration in ms (default: 8000) */
    typingMaxMs?: number;
    /** Probability of marking recent message as read (default: 0.2) */
    readReceiptProbability?: number;
    /** Min delay before marking as read in ms (default: 10 min) */
    readReceiptMinDelayMs?: number;
    /** Max delay before marking as read in ms (default: 60 min) */
    readReceiptMaxDelayMs?: number;
    /** Probability of toggling presence status per cycle (default: 0.15) */
    presenceToggleProbability?: number;
    /** Min duration for presence toggle in ms (default: 30 sec) */
    presenceToggleMinMs?: number;
    /** Max duration for presence toggle in ms (default: 2 min) */
    presenceToggleMaxMs?: number;
}
export interface HumanEntropyStats {
    cyclesExecuted: number;
    typingActionsPerformed: number;
    readReceiptsMarked: number;
    presenceToggles: number;
    errors: number;
    lastCycleAt: Date | null;
    nextCycleAt: Date | null;
}
/**
 * Human entropy service
 *
 * Adds realistic background noise to WhatsApp sessions by performing
 * random human-like actions periodically.
 */
export declare class HumanEntropyService {
    private config;
    private wasp;
    private sessionId;
    private recentContacts;
    private unreadMessages;
    private cycleTimer;
    private isRunning;
    private stats;
    constructor(wasp: any, sessionId: string, config?: HumanEntropyConfig);
    /**
     * Start the entropy service
     */
    start(): void;
    /**
     * Stop the entropy service
     */
    stop(): void;
    /**
     * Get current statistics
     */
    getStats(): HumanEntropyStats;
    /**
     * Track incoming message to build recent contacts list
     */
    private trackIncomingMessage;
    /**
     * Schedule next entropy cycle
     */
    private scheduleNextCycle;
    /**
     * Execute one entropy cycle
     */
    private executeCycle;
    /**
     * Send typing presence to a random recent contact
     */
    private performTypingPresence;
    /**
     * Mark a random recent message as read with delay
     */
    private performReadReceipt;
    /**
     * Toggle presence status (available → unavailable)
     */
    private performPresenceToggle;
    /**
     * Random value between min and max (inclusive)
     */
    private randomBetween;
    /**
     * Sleep for specified milliseconds
     */
    private sleep;
    /**
     * Mask JID for logging (privacy)
     */
    private maskJid;
    /**
     * Log message
     */
    private log;
}
/**
 * Factory function to create HumanEntropyService
 *
 * @param wasp WaSP instance
 * @param sessionId Session ID
 * @param config Optional configuration
 * @returns HumanEntropyService instance with start() and stop() methods
 */
export declare function createHumanEntropyService(wasp: any, sessionId: string, config?: HumanEntropyConfig): {
    start: () => void;
    stop: () => void;
    getStats: () => HumanEntropyStats;
};
