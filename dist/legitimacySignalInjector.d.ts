/**
 * LegitimacySignalInjector — Human imperfection signals
 *
 * WhatsApp's detection looks for accounts that are TOO perfect:
 * - Never make typos
 * - Always reply at consistent speeds
 * - Typing duration linearly correlates with message length
 *
 * This module injects realistic imperfections:
 * - Typos followed by corrections (2-3% of messages)
 * - Read-receipt without immediate reply (read gap)
 * - Mid-typing pauses for longer messages
 *
 * Note: Complements PresenceChoreographer, doesn't replace it.
 * PC handles timing/circadian rhythm; this handles content imperfections.
 */
export interface LegitimacySignalInjectorConfig {
    /** Enable typo injection (default: true) */
    enableTypos?: boolean;
    /** Probability per message of injecting a typo (default: 0.025 = 2.5%) */
    typoProbability?: number;
    /** Min delay before sending the correction in ms (default: 500) */
    typoCorrectMinMs?: number;
    /** Max delay before sending the correction in ms (default: 2000) */
    typoCorrectMaxMs?: number;
    /** Enable read-without-immediate-reply gaps (default: true) */
    enableReadGaps?: boolean;
    /** Probability of inserting a read gap before reply (default: 0.15) */
    readGapProbability?: number;
    /** Min read gap duration in ms (default: 300_000 = 5min) */
    readGapMinMs?: number;
    /** Max read gap duration in ms (default: 3_600_000 = 60min) */
    readGapMaxMs?: number;
    /** Enable mid-typing pauses for long messages (default: true) */
    enableTypingPauses?: boolean;
    /** Message length (chars) above which mid-typing pauses may be injected (default: 50) */
    typingPauseLengthThreshold?: number;
    /** Probability of injecting a pause per threshold-crossing (default: 0.4) */
    typingPauseProbability?: number;
    /** Min pause duration in ms (default: 1_500) */
    typingPauseMinMs?: number;
    /** Max pause duration in ms (default: 6_000) */
    typingPauseMaxMs?: number;
}
export interface LegitimacySignalStats {
    typosInjected: number;
    correctionsGenerated: number;
    readGapsInjected: number;
    typingPausesInjected: number;
}
export interface TypoResult {
    typoText: string;
    correctionDelay: number;
    correctionText: string;
}
export interface TypingPause {
    afterChars: number;
    pauseDurationMs: number;
}
export declare class LegitimacySignalInjector {
    private config;
    private stats;
    constructor(config?: LegitimacySignalInjectorConfig);
    /**
     * Determine if a typo should be injected for this message.
     * Returns typo version of text + correction delay, or null if no typo.
     */
    shouldInjectTypo(text: string): TypoResult | null;
    /**
     * Determine if a read gap should be injected before sending a reply.
     * Returns gap duration in ms, or null if no gap.
     */
    shouldInjectReadGap(): number | null;
    /**
     * For a message of given length, calculate mid-typing pause positions.
     * Returns array of { afterChars, pauseDurationMs } or empty array.
     */
    getTypingPauses(messageLength: number): TypingPause[];
    /**
     * Get statistics.
     */
    getStats(): LegitimacySignalStats;
    /**
     * Reset statistics.
     */
    reset(): void;
    private injectTypoInWord;
    private containsUrl;
    private randomBetween;
}
