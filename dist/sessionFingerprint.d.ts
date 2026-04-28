/**
 * Session Fingerprint Randomization (Obscura-inspired)
 *
 * Per-session fingerprint randomization to prevent device tracking.
 * Scavenged patterns from Obscura headless browser's stealth mode.
 *
 * Key principles from Obscura:
 * 1. Per-session randomization (not per-request)
 * 2. Consistent within session (same session = same fingerprint)
 * 3. Feature-flag pattern for optional anti-detection
 * 4. Emulation of real device profiles (not synthetic values)
 *
 * Browser fingerprint → WhatsApp signal mapping:
 * - TLS fingerprint → WA protocol version
 * - Canvas noise → message timing jitter
 * - Audio fingerprint → voice note metadata
 * - GPU info → device model/brand
 * - Battery → connection state variation
 * - User agent → WA client version
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
import { type DeviceFingerprint } from './deviceFingerprint.js';
export interface SessionFingerprintConfig {
    /** Master switch for enhanced fingerprinting */
    enabled?: boolean;
    /** Device profile randomization (from deviceFingerprint.ts) */
    deviceProfile?: {
        randomizeAppVersion?: boolean;
        randomizeOsVersion?: boolean;
        randomizeDeviceModel?: boolean;
        appVersionPool?: number[][];
        osVersionPool?: string[];
        deviceModelPool?: string[];
    };
    /** Network timing variance (anti-pattern detection) */
    networkTiming?: {
        /** Add jitter to message send timing (ms) */
        sendJitterMs?: [number, number];
        /** Add jitter to typing indicators (ms) */
        typingJitterMs?: [number, number];
        /** Vary connection retry backoff */
        retryJitterMs?: [number, number];
    };
    /** Voice note metadata randomization */
    voiceNote?: {
        /** Vary waveform pattern slightly */
        randomizeWaveform?: boolean;
        /** Vary duration by small amount (ms) */
        durationJitterMs?: number;
        /** Randomize sample rate from pool */
        sampleRatePool?: number[];
    };
    /** Connection state variance */
    connectionState?: {
        /** Vary idle timeout */
        idleTimeoutJitterMs?: [number, number];
        /** Vary keepalive interval */
        keepaliveJitterMs?: [number, number];
        /** Randomize battery state reported */
        randomizeBattery?: boolean;
        /** Battery level pool (0-100) */
        batteryLevelPool?: number[];
    };
    /** Protocol version variance */
    protocolVersion?: {
        /** Randomize protocol sub-version */
        randomizeSubVersion?: boolean;
        /** Protocol version pool (e.g., different patch versions) */
        versionPool?: string[];
    };
    /** Seed for deterministic randomization (testing/debugging) */
    seed?: string;
}
export interface SessionFingerprint {
    /** Core device profile */
    device: DeviceFingerprint;
    /** Network timing variances (stable per session) */
    networkTiming: {
        sendJitterMs: number;
        typingJitterMs: number;
        retryJitterMs: number;
    };
    /** Voice note profile */
    voiceNote: {
        waveformSeed: number;
        durationJitterMs: number;
        sampleRate: number;
    };
    /** Connection state profile */
    connectionState: {
        idleTimeoutMs: number;
        keepaliveMs: number;
        batteryLevel: number;
        batteryCharging: boolean;
    };
    /** Protocol version */
    protocolVersion: string;
    /** Session identifier (stable for this fingerprint) */
    sessionId: string;
    /** Timestamp when fingerprint was generated */
    createdAt: number;
}
/**
 * Generate a comprehensive session fingerprint.
 * Call once per session (socket initialization).
 *
 * Obscura pattern: consistent per session, randomized across sessions.
 */
export declare function generateSessionFingerprint(config?: SessionFingerprintConfig, sessionId?: string): SessionFingerprint;
/**
 * Apply session fingerprint to Baileys socket config.
 *
 * Usage:
 *   const fingerprint = generateSessionFingerprint({ enabled: true });
 *   const sock = makeWASocket(applySessionFingerprint(config, fingerprint));
 */
export declare function applySessionFingerprint(socketConfig: any, fingerprint: SessionFingerprint): any;
/**
 * Get timing jitter for message send (helper for presenceChoreographer/rateLimiter)
 *
 * Usage in beforeSend():
 *   const jitter = getMessageSendJitter(fingerprint);
 *   await sleep(baseDelay + jitter);
 */
export declare function getMessageSendJitter(fingerprint: SessionFingerprint): number;
/**
 * Get typing indicator jitter (helper for presenceChoreographer)
 */
export declare function getTypingJitter(fingerprint: SessionFingerprint): number;
/**
 * Get retry backoff jitter (helper for reconnectThrottle)
 */
export declare function getRetryJitter(fingerprint: SessionFingerprint): number;
/**
 * Get voice note metadata (helper for voice message encoding)
 *
 * Returns suggested sample rate and duration adjustment based on session fingerprint.
 */
export declare function getVoiceNoteMetadata(fingerprint: SessionFingerprint): {
    sampleRate: number;
    durationJitterMs: number;
    waveformSeed: number;
};
/**
 * Get battery state (helper for presence/connection state signals)
 */
export declare function getBatteryState(fingerprint: SessionFingerprint): {
    level: number;
    charging: boolean;
};
/**
 * Create a session fingerprint preset (Obscura-inspired feature flag pattern)
 */
export declare function createStealthFingerprint(sessionId?: string): SessionFingerprint;
