/**
 * Session Fingerprint Demo (Obscura-inspired)
 *
 * Demonstrates per-session fingerprint randomization patterns
 * scavenged from Obscura headless browser's stealth mode.
 *
 * Run: npx tsx examples/session-fingerprint-demo.ts
 */

import {
  generateSessionFingerprint,
  applySessionFingerprint,
  createStealthFingerprint,
  getMessageSendJitter,
  getTypingJitter,
  getRetryJitter,
  getVoiceNoteMetadata,
  getBatteryState,
} from '../src/index.js';

console.log('=== Session Fingerprint Demo (Obscura-inspired) ===\n');

// 1. Basic session fingerprint
console.log('1. Basic Session Fingerprint:');
const sessionId = 'user-12345-session';
const fingerprint = generateSessionFingerprint({ enabled: true }, sessionId);

console.log('  Device Profile:');
console.log(`    Model: ${fingerprint.device.deviceModel}`);
console.log(`    OS: Android ${fingerprint.device.osVersion}`);
console.log(`    App Version: ${fingerprint.device.appVersion.join('.')}`);
console.log('  Network Timing:');
console.log(`    Send Jitter: ${fingerprint.networkTiming.sendJitterMs}ms`);
console.log(`    Typing Jitter: ${fingerprint.networkTiming.typingJitterMs}ms`);
console.log(`    Retry Jitter: ${fingerprint.networkTiming.retryJitterMs}ms`);
console.log('  Voice Note Profile:');
console.log(`    Sample Rate: ${fingerprint.voiceNote.sampleRate}Hz`);
console.log(`    Duration Jitter: ${fingerprint.voiceNote.durationJitterMs}ms`);
console.log(`    Waveform Seed: ${fingerprint.voiceNote.waveformSeed}`);
console.log('  Connection State:');
console.log(`    Battery: ${fingerprint.connectionState.batteryLevel}%`);
console.log(`    Charging: ${fingerprint.connectionState.batteryCharging}`);
console.log(`    Idle Timeout: ${fingerprint.connectionState.idleTimeoutMs}ms`);
console.log(`    Keepalive: ${fingerprint.connectionState.keepaliveMs}ms`);
console.log('  Protocol:');
console.log(`    Version: ${fingerprint.protocolVersion}`);
console.log(`    Session ID: ${fingerprint.sessionId}\n`);

// 2. Deterministic fingerprints (same seed = same result)
console.log('2. Deterministic Fingerprints (Obscura pattern: consistent per session):');
const fp1 = generateSessionFingerprint({ seed: 'test-seed' }, 'session-1');
const fp2 = generateSessionFingerprint({ seed: 'test-seed' }, 'session-1');
const identical =
  fp1.device.deviceModel === fp2.device.deviceModel &&
  fp1.networkTiming.sendJitterMs === fp2.networkTiming.sendJitterMs &&
  fp1.connectionState.batteryLevel === fp2.connectionState.batteryLevel;
console.log(`  Same seed produces identical fingerprints: ${identical ? '✓' : '✗'}\n`);

// 3. Different fingerprints across sessions
console.log('3. Different Fingerprints Across Sessions:');
const session1 = generateSessionFingerprint({}, 'session-1');
const session2 = generateSessionFingerprint({}, 'session-2');
const different =
  session1.device.deviceModel !== session2.device.deviceModel ||
  session1.networkTiming.sendJitterMs !== session2.networkTiming.sendJitterMs;
console.log(`  Different sessions produce different fingerprints: ${different ? '✓' : '✗'}`);
console.log(`    Session 1 device: ${session1.device.deviceModel}`);
console.log(`    Session 2 device: ${session2.device.deviceModel}\n`);

// 4. Stealth preset (Obscura --stealth flag pattern)
console.log('4. Stealth Preset (Obscura --stealth mode):');
const stealthFp = createStealthFingerprint('stealth-session');
console.log(`  Device: ${stealthFp.device.deviceModel}`);
console.log(`  Send Jitter: ${stealthFp.networkTiming.sendJitterMs}ms (100-500ms range)`);
console.log(`  Battery: ${stealthFp.connectionState.batteryLevel}%`);
console.log(`  Protocol: ${stealthFp.protocolVersion}\n`);

// 5. Apply to socket config
console.log('5. Apply to Baileys Socket Config:');
const socketConfig = {
  auth: { creds: {}, keys: {} },
  printQRInTerminal: true,
};
const configWithFingerprint = applySessionFingerprint(socketConfig, fingerprint);
console.log(`  version: ${JSON.stringify(configWithFingerprint.version)}`);
console.log(`  browser: ${JSON.stringify(configWithFingerprint.browser)}`);
console.log(`  Fingerprint stored in config: ${configWithFingerprint.__sessionFingerprint ? '✓' : '✗'}\n`);

// 6. Helper functions for runtime usage
console.log('6. Helper Functions (Runtime Jitter):');
console.log(`  Message Send Jitter: ${getMessageSendJitter(fingerprint)}ms`);
console.log(`  Typing Jitter: ${getTypingJitter(fingerprint)}ms`);
console.log(`  Retry Jitter: ${getRetryJitter(fingerprint)}ms`);

const voiceMeta = getVoiceNoteMetadata(fingerprint);
console.log(`  Voice Note Sample Rate: ${voiceMeta.sampleRate}Hz`);

const battery = getBatteryState(fingerprint);
console.log(`  Battery State: ${battery.level}% (${battery.charging ? 'charging' : 'not charging'})\n`);

// 7. Custom device pools (target specific market)
console.log('7. Custom Device Pools (South African market example):');
const saFingerprint = generateSessionFingerprint({
  enabled: true,
  deviceProfile: {
    deviceModelPool: [
      'Samsung Galaxy A04',
      'Xiaomi Redmi Note 12',
      'Oppo A78',
      'Tecno Spark 10',
    ],
    osVersionPool: ['11', '12', '13'],
  },
  protocolVersion: {
    versionPool: ['2.24.5.18', '2.24.5.17'],
  },
}, 'sa-session');
console.log(`  Device: ${saFingerprint.device.deviceModel}`);
console.log(`  OS: Android ${saFingerprint.device.osVersion}`);
console.log(`  Protocol: ${saFingerprint.protocolVersion}\n`);

// 8. Disabled mode (baseline, no randomization)
console.log('8. Disabled Mode (No Randomization):');
const disabledFp = generateSessionFingerprint({ enabled: false });
console.log(`  Send Jitter: ${disabledFp.networkTiming.sendJitterMs}ms (should be 0)`);
console.log(`  Typing Jitter: ${disabledFp.networkTiming.typingJitterMs}ms (should be 0)`);
console.log(`  Waveform Seed: ${disabledFp.voiceNote.waveformSeed} (should be 0)\n`);

// 9. Comparison table
console.log('9. Browser Fingerprint → WhatsApp Signal Mapping:');
console.log('  ┌────────────────────────────┬──────────────────────────────┐');
console.log('  │ Obscura Browser Pattern    │ baileys-antiban Signal       │');
console.log('  ├────────────────────────────┼──────────────────────────────┤');
console.log('  │ TLS fingerprint (Chrome145)│ Protocol version variance    │');
console.log('  │ Canvas noise injection     │ Message timing jitter        │');
console.log('  │ Audio fingerprint          │ Voice note metadata          │');
console.log('  │ GPU info randomization     │ Device model randomization   │');
console.log('  │ Battery API variance       │ Battery level/charging state │');
console.log('  │ Per-session user agent     │ Per-session device profile   │');
console.log('  │ Feature flag (--stealth)   │ enabled config option        │');
console.log('  └────────────────────────────┴──────────────────────────────┘\n');

console.log('✅ Demo complete. All patterns scavenged from Obscura stealth mode.');
console.log('   See docs/session-fingerprinting.md for full integration guide.\n');
