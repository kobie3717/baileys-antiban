# Session Fingerprinting (Obscura-Inspired)

**Version**: v3.6+  
**Pattern Source**: [Obscura headless browser](https://github.com/h4ckf0r0day/obscura) stealth mode

## Overview

Session fingerprinting prevents device tracking by randomizing device and network signals **per-session** while maintaining **consistency within each session**. This mirrors Obscura's `--stealth` flag approach: randomize once per browser context, stay consistent throughout the session.

### Why Per-Session Randomization?

WhatsApp (like browser fingerprinting systems) tracks devices via consistent signals:
- Device model + OS version + app version = device fingerprint
- Network timing patterns = behavioral fingerprint
- Voice note metadata (sample rate, waveform) = audio fingerprint
- Battery state + connection timing = hardware fingerprint

**Problem**: Same fingerprint across all sessions → easy tracking → higher ban risk  
**Solution**: New fingerprint per session, consistent within session → harder to track, looks like legitimate device variety

## Obscura Patterns Applied

| Obscura Browser Pattern | baileys-antiban Implementation |
|------------------------|-------------------------------|
| TLS fingerprint emulation (Chrome145) | Protocol version variance |
| Per-session user agent | Per-session device profile (appVersion/OS/model) |
| Canvas noise injection | Message timing jitter |
| Audio fingerprint variance | Voice note metadata randomization |
| Battery API randomization | Battery level/charging state variance |
| Feature flag (`--stealth`) | Optional `enabled` config |
| Consistent per browser context | Consistent per session ID |

## Quick Start

### Basic Usage

```typescript
import { makeWASocket } from '@whiskeysockets/baileys';
import { 
  generateSessionFingerprint, 
  applySessionFingerprint 
} from 'baileys-antiban';

// Generate fingerprint once per session
const sessionId = 'user-12345-session';
const fingerprint = generateSessionFingerprint({ enabled: true }, sessionId);

// Apply to socket config
const sock = makeWASocket(
  applySessionFingerprint(
    {
      auth: state,
      printQRInTerminal: true,
    },
    fingerprint
  )
);
```

### Stealth Preset (Maximum Anti-Detection)

```typescript
import { createStealthFingerprint, applySessionFingerprint } from 'baileys-antiban';

const fingerprint = createStealthFingerprint('session-id');
const sock = makeWASocket(applySessionFingerprint(config, fingerprint));
```

**Stealth defaults:**
- Wide timing jitter ranges (100-500ms send jitter)
- Voice note randomization enabled
- Battery state randomization enabled
- Protocol sub-version randomization enabled

## Configuration

### Full Config

```typescript
import { generateSessionFingerprint, type SessionFingerprintConfig } from 'baileys-antiban';

const config: SessionFingerprintConfig = {
  // Master switch
  enabled: true,

  // Device profile (delegates to deviceFingerprint.ts)
  deviceProfile: {
    randomizeAppVersion: true,
    randomizeOsVersion: true,
    randomizeDeviceModel: true,
    // Optional custom pools
    appVersionPool: [[2, 24, 5, 18], [2, 24, 5, 17]],
    osVersionPool: ['12', '13', '14'],
    deviceModelPool: ['Pixel 6', 'Galaxy S22'],
  },

  // Network timing variance (anti-pattern detection)
  networkTiming: {
    sendJitterMs: [50, 300],      // Message send jitter range
    typingJitterMs: [30, 150],    // Typing indicator jitter
    retryJitterMs: [100, 500],    // Connection retry backoff jitter
  },

  // Voice note metadata randomization
  voiceNote: {
    randomizeWaveform: true,
    durationJitterMs: 200,        // Max duration variance
    sampleRatePool: [8000, 16000, 44100, 48000],
  },

  // Connection state variance
  connectionState: {
    idleTimeoutJitterMs: [25000, 35000],
    keepaliveJitterMs: [15000, 25000],
    randomizeBattery: true,
    batteryLevelPool: [20, 35, 50, 65, 80, 95, 100],
  },

  // Protocol version variance
  protocolVersion: {
    randomizeSubVersion: true,
    versionPool: ['2.24.5', '2.24.4', '2.24.3'],
  },

  // Seed for deterministic randomization (testing/debugging)
  seed: 'optional-custom-seed',
};

const fingerprint = generateSessionFingerprint(config, 'session-id');
```

## Session Lifecycle

### 1. Session Start (Generate Fingerprint)

```typescript
// On first connection
const sessionId = `user-${userId}-${Date.now()}`;
const fingerprint = generateSessionFingerprint({ enabled: true }, sessionId);

// Store fingerprint for reconnections
await saveSessionFingerprint(sessionId, fingerprint);
```

### 2. Reconnections (Reuse Fingerprint)

```typescript
// On reconnect within same session
const fingerprint = await loadSessionFingerprint(sessionId);
const sock = makeWASocket(applySessionFingerprint(config, fingerprint));
```

**Critical**: Reuse same fingerprint for all reconnections in a session. Changing fingerprint mid-session is suspicious.

### 3. New Session (New Fingerprint)

```typescript
// User logs out and back in → new session
const newSessionId = `user-${userId}-${Date.now()}`;
const newFingerprint = generateSessionFingerprint({ enabled: true }, newSessionId);
```

## Helper Functions

### Runtime Jitter Application

```typescript
import { 
  getMessageSendJitter, 
  getTypingJitter, 
  getRetryJitter 
} from 'baileys-antiban';

// In presenceChoreographer or rateLimiter
async function sendMessage(msg: string, fingerprint: SessionFingerprint) {
  const baseDelay = 1000;
  const jitter = getMessageSendJitter(fingerprint);
  
  await sleep(baseDelay + jitter); // Adds variance within session profile
  await sock.sendMessage(recipient, { text: msg });
}

// In presenceChoreographer
async function showTyping(fingerprint: SessionFingerprint) {
  const jitter = getTypingJitter(fingerprint);
  await sleep(2000 + jitter);
  await sock.sendPresenceUpdate('composing', recipient);
}

// In reconnectThrottle
async function reconnect(fingerprint: SessionFingerprint) {
  const jitter = getRetryJitter(fingerprint);
  await sleep(5000 + jitter);
  await connectToWhatsApp();
}
```

### Voice Note Encoding

```typescript
import { getVoiceNoteMetadata } from 'baileys-antiban';

async function sendVoiceNote(audioBuffer: Buffer, fingerprint: SessionFingerprint) {
  const { sampleRate, durationJitterMs, waveformSeed } = getVoiceNoteMetadata(fingerprint);
  
  // Apply sample rate from fingerprint
  const encoded = await encodeOpus(audioBuffer, { sampleRate });
  
  // Optional: add duration jitter (requires audio processing lib)
  const adjustedDuration = audioDuration + durationJitterMs;
  
  await sock.sendMessage(recipient, {
    audio: encoded,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,
    seconds: Math.floor(adjustedDuration / 1000),
  });
}
```

### Battery State Reporting

```typescript
import { getBatteryState } from 'baileys-antiban';

// If Baileys exposes battery state in clientPayload (future feature)
const { level, charging } = getBatteryState(fingerprint);
console.log(`Battery: ${level}% ${charging ? '(charging)' : ''}`);
```

## Integration with AntiBan

```typescript
import { AntiBan, generateSessionFingerprint, applySessionFingerprint } from 'baileys-antiban';

const sessionId = 'user-session-123';
const fingerprint = generateSessionFingerprint({ enabled: true }, sessionId);

const sock = makeWASocket(applySessionFingerprint({
  auth: state,
  printQRInTerminal: true,
}, fingerprint));

const antiban = new AntiBan({
  maxPerMinute: 8,
  warmupDays: 7,
});

// Access fingerprint in runtime
const storedFingerprint = sock.config?.__sessionFingerprint;
if (storedFingerprint) {
  const jitter = getMessageSendJitter(storedFingerprint);
  // Use jitter in beforeSend timing
}
```

## Feature Flag Pattern (Obscura-Style)

Enable fingerprinting only for high-risk accounts or testing:

```typescript
const ENABLE_STEALTH = process.env.STEALTH_MODE === 'true';

const fingerprint = ENABLE_STEALTH
  ? createStealthFingerprint(sessionId)
  : generateSessionFingerprint({ enabled: false }, sessionId);
```

## Testing

### Deterministic Fingerprints (Seeded)

```typescript
import { generateSessionFingerprint } from 'baileys-antiban';

// For unit tests
const fp1 = generateSessionFingerprint({ seed: 'test-seed' }, 'session-1');
const fp2 = generateSessionFingerprint({ seed: 'test-seed' }, 'session-1');

expect(fp1).toEqual(fp2); // Identical fingerprints
```

### Variance Testing

```typescript
// Verify fingerprints differ across sessions
const fp1 = generateSessionFingerprint({ seed: `seed-${Math.random()}` });
const fp2 = generateSessionFingerprint({ seed: `seed-${Math.random()}` });

expect(fp1.device.appVersion).not.toEqual(fp2.device.appVersion);
```

## Migration from v3.5

### Before (deviceFingerprint only)

```typescript
import { generateFingerprint, applyFingerprint } from 'baileys-antiban';

const fp = generateFingerprint({});
const sock = makeWASocket(applyFingerprint(config, fp));
```

### After (sessionFingerprint)

```typescript
import { generateSessionFingerprint, applySessionFingerprint } from 'baileys-antiban';

const fp = generateSessionFingerprint({ enabled: true }, sessionId);
const sock = makeWASocket(applySessionFingerprint(config, fp));
```

**Note**: `deviceFingerprint` still works and is used internally by `sessionFingerprint`. No breaking changes.

## Advanced: Custom Pools

```typescript
// Target specific device market (e.g., South African Android market)
const fingerprint = generateSessionFingerprint({
  deviceProfile: {
    deviceModelPool: [
      'Samsung Galaxy A04',     // Budget
      'Samsung Galaxy A14',
      'Xiaomi Redmi Note 12',
      'Oppo A78',
      'Tecno Spark 10',        // Popular in SA
    ],
    osVersionPool: ['11', '12', '13'], // Android versions
  },
  protocolVersion: {
    versionPool: ['2.24.5.18', '2.24.5.17'], // Recent stable versions
  },
}, sessionId);
```

## Troubleshooting

### Fingerprint Not Applied

```typescript
// Check if fingerprint was stored in config
console.log(sock.config?.__sessionFingerprint);

// If undefined, check applySessionFingerprint was called
const config = applySessionFingerprint(baseConfig, fingerprint);
console.log(config.__sessionFingerprint); // Should be defined
```

### Timing Jitter Not Working

```typescript
// Verify fingerprint has non-zero jitter
console.log(fingerprint.networkTiming.sendJitterMs); // Should be > 0

// Verify enabled flag
const fp = generateSessionFingerprint({ enabled: true });
console.log(fp.networkTiming.sendJitterMs); // Should be > 0

const fpDisabled = generateSessionFingerprint({ enabled: false });
console.log(fpDisabled.networkTiming.sendJitterMs); // Should be 0
```

### Fingerprint Changes Mid-Session

**Problem**: Generating new fingerprint on every reconnection.

**Solution**: Persist and reuse fingerprint:

```typescript
// Store on first connect
if (!sessionFingerprint) {
  sessionFingerprint = generateSessionFingerprint({ enabled: true }, sessionId);
  await saveToRedis(`fingerprint:${sessionId}`, sessionFingerprint);
}

// Reuse on reconnect
const fingerprint = await loadFromRedis(`fingerprint:${sessionId}`) || 
  generateSessionFingerprint({ enabled: true }, sessionId);
```

## Performance

- **Generation time**: ~1ms (negligible)
- **Memory overhead**: ~1KB per fingerprint object
- **Network overhead**: 0 bytes (all local randomization)
- **CPU overhead**: PRNG operations only during generation

## Security Notes

1. **Don't log full fingerprints** — contains device identifiers
2. **Persist fingerprints securely** — treat like session tokens
3. **Rotate on user logout** — new session = new fingerprint
4. **Seed with cryptographic random** — default uses `Date.now() + Math.random()`, sufficient for anti-tracking

## References

- [Obscura Browser](https://github.com/h4ckf0r0day/obscura) - Source of stealth patterns
- [deviceFingerprint.ts](../src/deviceFingerprint.ts) - Base device randomization
- [sessionFingerprint.ts](../src/sessionFingerprint.ts) - Full implementation
- [Browser Fingerprinting](https://en.wikipedia.org/wiki/Device_fingerprint) - Detection techniques
