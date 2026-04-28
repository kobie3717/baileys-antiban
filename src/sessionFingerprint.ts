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

import { generateFingerprint, type DeviceFingerprint } from './deviceFingerprint.js';

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
    sendJitterMs?: [number, number]; // [min, max]
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
 * Simple deterministic PRNG using mulberry32
 * Same as deviceFingerprint.ts for consistency
 */
class SeededRandom {
  private state: number;

  constructor(seed: string) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash = hash & hash;
    }
    this.state = Math.abs(hash) || 1;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  rangeFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  pick<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }

  boolean(probability = 0.5): boolean {
    return this.next() < probability;
  }
}

// Default configuration values (conservative, realistic)
const DEFAULT_SEND_JITTER_MS: [number, number] = [50, 300];
const DEFAULT_TYPING_JITTER_MS: [number, number] = [30, 150];
const DEFAULT_RETRY_JITTER_MS: [number, number] = [100, 500];
const DEFAULT_DURATION_JITTER_MS = 200;
const DEFAULT_SAMPLE_RATE_POOL = [8000, 16000, 44100, 48000];
const DEFAULT_IDLE_TIMEOUT_JITTER_MS: [number, number] = [25000, 35000];
const DEFAULT_KEEPALIVE_JITTER_MS: [number, number] = [15000, 25000];
const DEFAULT_BATTERY_LEVEL_POOL = [20, 35, 50, 65, 80, 95, 100];
const DEFAULT_PROTOCOL_VERSION_POOL = ['2.24.5', '2.24.4', '2.24.3'];

/**
 * Generate a comprehensive session fingerprint.
 * Call once per session (socket initialization).
 *
 * Obscura pattern: consistent per session, randomized across sessions.
 */
export function generateSessionFingerprint(
  config: SessionFingerprintConfig = {},
  sessionId?: string
): SessionFingerprint {
  const {
    enabled = true,
    deviceProfile = {},
    networkTiming = {},
    voiceNote = {},
    connectionState = {},
    protocolVersion = {},
    seed,
  } = config;

  const finalSessionId = sessionId || `session-${Date.now()}-${Math.random()}`;
  const rng = new SeededRandom(seed || finalSessionId);

  // Generate base device fingerprint (delegates to deviceFingerprint.ts)
  const device = generateFingerprint(
    {
      enabled,
      randomizeAppVersion: deviceProfile.randomizeAppVersion ?? true,
      randomizeOsVersion: deviceProfile.randomizeOsVersion ?? true,
      randomizeDeviceModel: deviceProfile.randomizeDeviceModel ?? true,
      seed: seed || finalSessionId,
      appVersionPool: deviceProfile.appVersionPool,
      osVersionPool: deviceProfile.osVersionPool,
      deviceModelPool: deviceProfile.deviceModelPool,
    },
    finalSessionId
  );

  // Network timing variances (Obscura: prevent timing pattern detection)
  const sendJitterRange = networkTiming.sendJitterMs || DEFAULT_SEND_JITTER_MS;
  const typingJitterRange = networkTiming.typingJitterMs || DEFAULT_TYPING_JITTER_MS;
  const retryJitterRange = networkTiming.retryJitterMs || DEFAULT_RETRY_JITTER_MS;

  const networkTimingProfile = enabled
    ? {
        sendJitterMs: rng.range(sendJitterRange[0], sendJitterRange[1]),
        typingJitterMs: rng.range(typingJitterRange[0], typingJitterRange[1]),
        retryJitterMs: rng.range(retryJitterRange[0], retryJitterRange[1]),
      }
    : {
        sendJitterMs: 0,
        typingJitterMs: 0,
        retryJitterMs: 0,
      };

  // Voice note profile (Obscura: audio fingerprint variance)
  const sampleRatePool = voiceNote.sampleRatePool || DEFAULT_SAMPLE_RATE_POOL;
  const voiceNoteProfile = {
    waveformSeed: enabled ? rng.range(0, 2147483647) : 0,
    durationJitterMs:
      enabled && voiceNote.randomizeWaveform !== false
        ? rng.range(0, voiceNote.durationJitterMs || DEFAULT_DURATION_JITTER_MS)
        : 0,
    sampleRate: enabled ? rng.pick(sampleRatePool) : sampleRatePool[0],
  };

  // Connection state profile (Obscura: battery/network state variance)
  const idleTimeoutRange =
    connectionState.idleTimeoutJitterMs || DEFAULT_IDLE_TIMEOUT_JITTER_MS;
  const keepaliveRange =
    connectionState.keepaliveJitterMs || DEFAULT_KEEPALIVE_JITTER_MS;
  const batteryLevelPool =
    connectionState.batteryLevelPool || DEFAULT_BATTERY_LEVEL_POOL;

  const connectionStateProfile = {
    idleTimeoutMs: enabled
      ? rng.range(idleTimeoutRange[0], idleTimeoutRange[1])
      : 30000,
    keepaliveMs: enabled
      ? rng.range(keepaliveRange[0], keepaliveRange[1])
      : 20000,
    batteryLevel:
      enabled && connectionState.randomizeBattery !== false
        ? rng.pick(batteryLevelPool)
        : 100,
    batteryCharging: enabled ? rng.boolean(0.3) : false, // 30% charging probability
  };

  // Protocol version (Obscura: TLS fingerprint variance → WA protocol variance)
  const versionPool = protocolVersion.versionPool || DEFAULT_PROTOCOL_VERSION_POOL;
  const protocolVersionStr =
    enabled && protocolVersion.randomizeSubVersion !== false
      ? rng.pick(versionPool)
      : versionPool[0];

  return {
    device,
    networkTiming: networkTimingProfile,
    voiceNote: voiceNoteProfile,
    connectionState: connectionStateProfile,
    protocolVersion: protocolVersionStr,
    sessionId: finalSessionId,
    createdAt: Date.now(),
  };
}

/**
 * Apply session fingerprint to Baileys socket config.
 *
 * Usage:
 *   const fingerprint = generateSessionFingerprint({ enabled: true });
 *   const sock = makeWASocket(applySessionFingerprint(config, fingerprint));
 */
export function applySessionFingerprint(
  socketConfig: any,
  fingerprint: SessionFingerprint
): any {
  const config = { ...socketConfig };

  // Apply device profile (appVersion, browser tuple)
  config.version = fingerprint.device.appVersion;
  config.browser = [
    fingerprint.device.deviceModel,
    fingerprint.device.osVersion,
    `WhatsApp/${fingerprint.device.appVersion.join('.')}`,
  ];

  // Apply connection timeouts if fields exist
  if ('connectTimeoutMs' in config || config.connectTimeoutMs !== undefined) {
    // Add idle timeout jitter to connection config
    config.connectTimeoutMs = fingerprint.connectionState.idleTimeoutMs;
  }

  // Apply keepalive if supported
  if ('keepAliveIntervalMs' in config || config.keepAliveIntervalMs !== undefined) {
    config.keepAliveIntervalMs = fingerprint.connectionState.keepaliveMs;
  }

  // Store fingerprint for runtime access (helpers can read this)
  config.__sessionFingerprint = fingerprint;

  return config;
}

/**
 * Get timing jitter for message send (helper for presenceChoreographer/rateLimiter)
 *
 * Usage in beforeSend():
 *   const jitter = getMessageSendJitter(fingerprint);
 *   await sleep(baseDelay + jitter);
 */
export function getMessageSendJitter(fingerprint: SessionFingerprint): number {
  // Return a random value within ±50% of the session's base jitter
  // This adds per-message variance while staying within session profile
  const base = fingerprint.networkTiming.sendJitterMs;
  return Math.floor(base * 0.5 + Math.random() * base * 0.5);
}

/**
 * Get typing indicator jitter (helper for presenceChoreographer)
 */
export function getTypingJitter(fingerprint: SessionFingerprint): number {
  const base = fingerprint.networkTiming.typingJitterMs;
  return Math.floor(base * 0.5 + Math.random() * base * 0.5);
}

/**
 * Get retry backoff jitter (helper for reconnectThrottle)
 */
export function getRetryJitter(fingerprint: SessionFingerprint): number {
  const base = fingerprint.networkTiming.retryJitterMs;
  return Math.floor(base * 0.5 + Math.random() * base * 0.5);
}

/**
 * Get voice note metadata (helper for voice message encoding)
 *
 * Returns suggested sample rate and duration adjustment based on session fingerprint.
 */
export function getVoiceNoteMetadata(fingerprint: SessionFingerprint): {
  sampleRate: number;
  durationJitterMs: number;
  waveformSeed: number;
} {
  return {
    sampleRate: fingerprint.voiceNote.sampleRate,
    durationJitterMs: fingerprint.voiceNote.durationJitterMs,
    waveformSeed: fingerprint.voiceNote.waveformSeed,
  };
}

/**
 * Get battery state (helper for presence/connection state signals)
 */
export function getBatteryState(fingerprint: SessionFingerprint): {
  level: number;
  charging: boolean;
} {
  return {
    level: fingerprint.connectionState.batteryLevel,
    charging: fingerprint.connectionState.batteryCharging,
  };
}

/**
 * Create a session fingerprint preset (Obscura-inspired feature flag pattern)
 */
export function createStealthFingerprint(sessionId?: string): SessionFingerprint {
  return generateSessionFingerprint(
    {
      enabled: true,
      deviceProfile: {
        randomizeAppVersion: true,
        randomizeOsVersion: true,
        randomizeDeviceModel: true,
      },
      networkTiming: {
        sendJitterMs: [100, 500],
        typingJitterMs: [50, 200],
        retryJitterMs: [200, 800],
      },
      voiceNote: {
        randomizeWaveform: true,
        durationJitterMs: 300,
      },
      connectionState: {
        randomizeBattery: true,
      },
      protocolVersion: {
        randomizeSubVersion: true,
      },
    },
    sessionId
  );
}
