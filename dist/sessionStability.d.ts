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
export interface DeafSessionConfig {
    /**
     * How long the session must be silent (no messages.upsert or messages.update)
     * while the WS connection is open before it is declared "deaf".
     * Default: 5 minutes.
     */
    timeoutMs?: number;
    /**
     * Minimum uptime before the detector starts checking.
     * Avoids false positives immediately after a fresh connect.
     * Default: 2 minutes.
     */
    minUptimeMs?: number;
    /**
     * Called when a deaf session is detected, before any auto-reconnect.
     * Use this to log, alert, or run custom recovery logic.
     */
    onDeafSession?: (info: DeafSessionInfo) => void;
    /**
     * If true, call sock.end(new Error('deaf-session')) automatically.
     * Set false if you want to handle reconnection yourself in onDeafSession.
     * Default: true.
     */
    autoReconnect?: boolean;
}
export interface DeafSessionInfo {
    /** Timestamp of last observed message activity, or null if none since connect. */
    lastMessageAt: Date | null;
    /** How long the session has been silent in ms. */
    silenceDurationMs: number;
    /** How long the WS has been open in ms. */
    connectedSinceMs: number;
}
/**
 * Detects "deaf sessions" — WebSocket connections that stay open but stop
 * delivering messages.upsert / messages.update events.
 *
 * Root cause (Baileys issue #2491): messageMutex holding ACKs hostage under
 * Redis latency spikes causes WhatsApp's server-side flow control to stop
 * delivering messages to that client, while keepAlive pings still succeed.
 *
 * Usage: call onConnect() / onDisconnect() from connection.update events,
 * onMessageActivity() from messages.upsert and messages.update events.
 * Pass a sock reference via attach() so auto-reconnect can call sock.end().
 */
export declare class DeafSessionDetector {
    private readonly timeoutMs;
    private readonly minUptimeMs;
    private readonly autoReconnect;
    private readonly onDeafSessionCb?;
    private lastMessageAt;
    private connectedAt;
    private timer;
    private sockRef;
    constructor(config?: DeafSessionConfig);
    /** Attach a socket so auto-reconnect can call sock.end() */
    attach(sock: {
        end: (err?: Error) => void;
    }): void;
    /** Call when connection.update → connection === 'open' */
    onConnect(): void;
    /** Call when connection.update → connection === 'close' */
    onDisconnect(): void;
    /** Call on every messages.upsert and messages.update event */
    onMessageActivity(): void;
    /** Release the interval — call when discarding the socket */
    destroy(): void;
    private startTimer;
    private stopTimer;
    private check;
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
