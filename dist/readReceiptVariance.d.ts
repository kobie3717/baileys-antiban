/**
 * Read Receipt Timing Variance
 *
 * Extends presence choreography to randomize read-receipt delay.
 * Instant reads = bot signal. Gaussian jitter makes reads feel human.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
export interface ReadReceiptVarianceConfig {
    /** Mean delay before sending read receipt, ms */
    meanMs?: number;
    /** Standard deviation, ms */
    stdDevMs?: number;
    /** Min clamp, ms */
    minMs?: number;
    /** Max clamp, ms */
    maxMs?: number;
    /** Skip variance for messages older than this (already-read backlog) */
    skipIfOlderThanMs?: number;
}
export interface ReadReceiptVariance {
    /** Wrap a sock — call sock.readMessages internally with jittered delay */
    wrap<T extends {
        readMessages: Function;
    }>(sock: T): T;
    /** Manually compute jittered delay (for users wiring their own receipt logic) */
    delayMs(): number;
    /** Stop pending timers */
    stop(): void;
}
export declare function readReceiptVariance(config?: ReadReceiptVarianceConfig): ReadReceiptVariance;
