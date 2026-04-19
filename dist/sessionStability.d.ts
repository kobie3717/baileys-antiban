/**
 * Session Stability Module — Middleware layer for Baileys socket stability
 *
 * Wraps Baileys socket to provide:
 * 1. Canonical JID normalization before sendMessage (reduces mutex race triggers)
 * 2. Typed disconnect reason classification with recovery recommendations
 * 3. Session health monitoring (Bad MAC detection and degradation alerts)
 *
 * This is a pure middleware layer — cannot modify Baileys internals, but can wrap
 * the socket interface to provide stability improvements.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
import { LidResolver } from './lidResolver.js';
export type DisconnectCategory = 'fatal' | 'recoverable' | 'rate-limited' | 'unknown';
export interface DisconnectClassification {
    category: DisconnectCategory;
    shouldReconnect: boolean;
    backoffMs?: number;
    message: string;
    code: number;
}
/**
 * Classify Baileys DisconnectReason codes into typed categories.
 * Based on PR #2367 and observed behavior from production bots.
 */
export declare function classifyDisconnect(statusCode: number): DisconnectClassification;
export interface SessionHealthStats {
    decryptSuccess: number;
    decryptFail: number;
    badMacCount: number;
    lastBadMac?: Date;
    isDegraded: boolean;
    degradedSince?: Date;
}
export interface SessionHealthConfig {
    /** Threshold for Bad MAC errors in window before declaring degraded (default: 3) */
    badMacThreshold?: number;
    /** Time window for Bad MAC threshold in ms (default: 60000 = 1 minute) */
    badMacWindowMs?: number;
    /** Callback when session enters degraded state */
    onDegraded?: (stats: SessionHealthStats) => void;
    /** Callback when session recovers from degraded state */
    onRecovered?: (stats: SessionHealthStats) => void;
}
/**
 * Track session health via decrypt success/failure ratio.
 * Emits 'session:degraded' event when Bad MAC rate exceeds threshold.
 */
export declare class SessionHealthMonitor {
    private config;
    private onDegraded?;
    private onRecovered?;
    private stats;
    private badMacTimestamps;
    constructor(config?: SessionHealthConfig);
    /**
     * Record successful decrypt
     */
    recordDecryptSuccess(): void;
    /**
     * Record failed decrypt (Bad MAC or similar)
     */
    recordDecryptFail(isBadMac?: boolean): void;
    /**
     * Check if session has recovered from degraded state
     */
    private checkRecovery;
    /**
     * Get current health stats
     */
    getStats(): SessionHealthStats;
    /**
     * Reset all counters
     */
    reset(): void;
}
export interface SessionStabilityConfig {
    /** Enable canonical JID normalization before sendMessage (default: true) */
    canonicalJidNormalization?: boolean;
    /** Enable session health monitoring (default: true) */
    healthMonitoring?: boolean;
    /** Session health config (only used if healthMonitoring enabled) */
    health?: SessionHealthConfig;
    /** LID resolver instance (required for canonicalJidNormalization) */
    lidResolver?: LidResolver;
}
/**
 * Wrap a Baileys socket with session stability features.
 * Returns a Proxy that intercepts sendMessage to canonicalize JIDs.
 */
export declare function wrapWithSessionStability<T extends Record<string, any>>(sock: T, config?: SessionStabilityConfig): T;
