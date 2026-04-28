/**
 * Tests for sessionFingerprint module (Obscura-inspired)
 */

import { describe, it, expect } from 'vitest';
import {
  generateSessionFingerprint,
  applySessionFingerprint,
  getMessageSendJitter,
  getTypingJitter,
  getRetryJitter,
  getVoiceNoteMetadata,
  getBatteryState,
  createStealthFingerprint,
  type SessionFingerprint,
} from '../src/sessionFingerprint.js';

describe('sessionFingerprint', () => {
  describe('generateSessionFingerprint', () => {
    it('should generate deterministic fingerprint with same seed', () => {
      const fp1 = generateSessionFingerprint({ seed: 'test-seed-123' }, 'session-1');
      const fp2 = generateSessionFingerprint({ seed: 'test-seed-123' }, 'session-1');

      expect(fp1.device.appVersion).toEqual(fp2.device.appVersion);
      expect(fp1.device.osVersion).toBe(fp2.device.osVersion);
      expect(fp1.device.deviceModel).toBe(fp2.device.deviceModel);
      expect(fp1.networkTiming.sendJitterMs).toBe(fp2.networkTiming.sendJitterMs);
      expect(fp1.voiceNote.sampleRate).toBe(fp2.voiceNote.sampleRate);
      expect(fp1.connectionState.batteryLevel).toBe(fp2.connectionState.batteryLevel);
    });

    it('should generate different fingerprints with different seeds', () => {
      const fp1 = generateSessionFingerprint({ seed: 'seed-1' });
      const fp2 = generateSessionFingerprint({ seed: 'seed-2' });

      // At least device profile should differ
      const deviceDifferent =
        JSON.stringify(fp1.device.appVersion) !== JSON.stringify(fp2.device.appVersion) ||
        fp1.device.osVersion !== fp2.device.osVersion ||
        fp1.device.deviceModel !== fp2.device.deviceModel;

      expect(deviceDifferent).toBe(true);
    });

    it('should respect disabled flag', () => {
      const fp = generateSessionFingerprint({ enabled: false });

      expect(fp.networkTiming.sendJitterMs).toBe(0);
      expect(fp.networkTiming.typingJitterMs).toBe(0);
      expect(fp.networkTiming.retryJitterMs).toBe(0);
      expect(fp.voiceNote.waveformSeed).toBe(0);
      expect(fp.voiceNote.durationJitterMs).toBe(0);
    });

    it('should use custom network timing ranges', () => {
      const fp = generateSessionFingerprint({
        enabled: true,
        seed: 'test',
        networkTiming: {
          sendJitterMs: [100, 100], // Fixed range
          typingJitterMs: [50, 50],
          retryJitterMs: [200, 200],
        },
      });

      expect(fp.networkTiming.sendJitterMs).toBe(100);
      expect(fp.networkTiming.typingJitterMs).toBe(50);
      expect(fp.networkTiming.retryJitterMs).toBe(200);
    });

    it('should use custom voice note config', () => {
      const fp = generateSessionFingerprint({
        enabled: true,
        seed: 'test',
        voiceNote: {
          sampleRatePool: [12345],
          durationJitterMs: 999,
        },
      });

      expect(fp.voiceNote.sampleRate).toBe(12345);
      expect(fp.voiceNote.durationJitterMs).toBeGreaterThanOrEqual(0);
      expect(fp.voiceNote.durationJitterMs).toBeLessThanOrEqual(999);
    });

    it('should use custom battery config', () => {
      const fp = generateSessionFingerprint({
        enabled: true,
        seed: 'test',
        connectionState: {
          batteryLevelPool: [42],
        },
      });

      expect(fp.connectionState.batteryLevel).toBe(42);
      expect(typeof fp.connectionState.batteryCharging).toBe('boolean');
    });

    it('should generate valid protocol version', () => {
      const fp = generateSessionFingerprint({
        enabled: true,
        protocolVersion: {
          versionPool: ['1.0.0', '1.0.1', '1.0.2'],
        },
      });

      expect(['1.0.0', '1.0.1', '1.0.2']).toContain(fp.protocolVersion);
    });

    it('should include sessionId and createdAt', () => {
      const fp = generateSessionFingerprint({}, 'custom-session-id');

      expect(fp.sessionId).toBe('custom-session-id');
      expect(fp.createdAt).toBeGreaterThan(0);
      expect(Date.now() - fp.createdAt).toBeLessThan(1000); // Created within last second
    });

    it('should generate auto sessionId if not provided', () => {
      const fp = generateSessionFingerprint({});

      expect(fp.sessionId).toBeTruthy();
      expect(fp.sessionId).toContain('session-');
    });
  });

  describe('applySessionFingerprint', () => {
    it('should apply device profile to socketConfig', () => {
      const fp = generateSessionFingerprint({ seed: 'test' });
      const config = applySessionFingerprint({}, fp);

      expect(config.version).toEqual(fp.device.appVersion);
      expect(config.browser).toBeDefined();
      expect(config.browser[0]).toBe(fp.device.deviceModel);
      expect(config.browser[1]).toBe(fp.device.osVersion);
      expect(config.browser[2]).toContain(fp.device.appVersion.join('.'));
    });

    it('should apply connection timeouts', () => {
      const fp = generateSessionFingerprint({ seed: 'test' });
      const config = applySessionFingerprint(
        { connectTimeoutMs: 30000, keepAliveIntervalMs: 20000 },
        fp
      );

      expect(config.connectTimeoutMs).toBe(fp.connectionState.idleTimeoutMs);
      expect(config.keepAliveIntervalMs).toBe(fp.connectionState.keepaliveMs);
    });

    it('should store fingerprint in config for runtime access', () => {
      const fp = generateSessionFingerprint({ seed: 'test' });
      const config = applySessionFingerprint({}, fp);

      expect(config.__sessionFingerprint).toBe(fp);
    });

    it('should not mutate original config', () => {
      const fp = generateSessionFingerprint({ seed: 'test' });
      const original = { version: [1, 2, 3, 4] };
      const result = applySessionFingerprint(original, fp);

      expect(result).not.toBe(original);
      expect(original.version).toEqual([1, 2, 3, 4]);
    });
  });

  describe('helper functions', () => {
    let fingerprint: SessionFingerprint;

    beforeEach(() => {
      fingerprint = generateSessionFingerprint({
        seed: 'test-helpers',
        networkTiming: {
          sendJitterMs: [100, 100],
          typingJitterMs: [50, 50],
          retryJitterMs: [200, 200],
        },
      });
    });

    it('getMessageSendJitter should return value within session profile', () => {
      const jitter = getMessageSendJitter(fingerprint);

      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThanOrEqual(fingerprint.networkTiming.sendJitterMs * 1.5);
    });

    it('getTypingJitter should return value within session profile', () => {
      const jitter = getTypingJitter(fingerprint);

      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThanOrEqual(fingerprint.networkTiming.typingJitterMs * 1.5);
    });

    it('getRetryJitter should return value within session profile', () => {
      const jitter = getRetryJitter(fingerprint);

      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThanOrEqual(fingerprint.networkTiming.retryJitterMs * 1.5);
    });

    it('getVoiceNoteMetadata should return session voice profile', () => {
      const metadata = getVoiceNoteMetadata(fingerprint);

      expect(metadata.sampleRate).toBe(fingerprint.voiceNote.sampleRate);
      expect(metadata.durationJitterMs).toBe(fingerprint.voiceNote.durationJitterMs);
      expect(metadata.waveformSeed).toBe(fingerprint.voiceNote.waveformSeed);
    });

    it('getBatteryState should return session battery profile', () => {
      const battery = getBatteryState(fingerprint);

      expect(battery.level).toBe(fingerprint.connectionState.batteryLevel);
      expect(battery.charging).toBe(fingerprint.connectionState.batteryCharging);
    });
  });

  describe('createStealthFingerprint', () => {
    it('should create fingerprint with stealth defaults', () => {
      const fp = createStealthFingerprint('stealth-session');

      expect(fp.sessionId).toBe('stealth-session');
      expect(fp.device).toBeDefined();
      expect(fp.networkTiming.sendJitterMs).toBeGreaterThan(0);
      expect(fp.voiceNote.sampleRate).toBeGreaterThan(0);
      expect(fp.connectionState.batteryLevel).toBeGreaterThan(0);
    });

    it('should have enhanced jitter values for stealth', () => {
      const fp = createStealthFingerprint();

      // Stealth mode should have wider jitter ranges
      expect(fp.networkTiming.sendJitterMs).toBeGreaterThanOrEqual(100);
      expect(fp.networkTiming.sendJitterMs).toBeLessThanOrEqual(500);
    });
  });

  describe('per-session consistency', () => {
    it('should maintain same fingerprint throughout session lifecycle', () => {
      const sessionId = 'persistent-session';
      const seed = 'persistent-seed';

      // Simulate multiple socket reconnections in same session
      const fp1 = generateSessionFingerprint({ seed }, sessionId);
      const fp2 = generateSessionFingerprint({ seed }, sessionId);
      const fp3 = generateSessionFingerprint({ seed }, sessionId);

      // All should be identical (Obscura pattern: consistent per session)
      expect(fp1.device.appVersion).toEqual(fp2.device.appVersion);
      expect(fp2.device.appVersion).toEqual(fp3.device.appVersion);
      expect(fp1.networkTiming.sendJitterMs).toBe(fp2.networkTiming.sendJitterMs);
      expect(fp2.networkTiming.sendJitterMs).toBe(fp3.networkTiming.sendJitterMs);
    });

    it('should differ across different sessions', () => {
      const seed1 = `seed-${Math.random()}`;
      const seed2 = `seed-${Math.random()}`;

      const fp1 = generateSessionFingerprint({ seed: seed1 });
      const fp2 = generateSessionFingerprint({ seed: seed2 });

      // Should differ (Obscura pattern: different per session)
      const differs =
        JSON.stringify(fp1.device) !== JSON.stringify(fp2.device) ||
        fp1.networkTiming.sendJitterMs !== fp2.networkTiming.sendJitterMs ||
        fp1.voiceNote.sampleRate !== fp2.voiceNote.sampleRate;

      expect(differs).toBe(true);
    });
  });

  describe('realistic value ranges', () => {
    it('should generate realistic battery levels', () => {
      const fp = generateSessionFingerprint({ enabled: true });

      expect(fp.connectionState.batteryLevel).toBeGreaterThanOrEqual(0);
      expect(fp.connectionState.batteryLevel).toBeLessThanOrEqual(100);
    });

    it('should generate realistic timing values', () => {
      const fp = generateSessionFingerprint({ enabled: true });

      expect(fp.networkTiming.sendJitterMs).toBeGreaterThanOrEqual(0);
      expect(fp.networkTiming.sendJitterMs).toBeLessThan(10000); // Less than 10 seconds
      expect(fp.connectionState.idleTimeoutMs).toBeGreaterThan(10000); // More than 10 seconds
      expect(fp.connectionState.keepaliveMs).toBeGreaterThan(5000); // More than 5 seconds
    });

    it('should generate realistic voice note sample rates', () => {
      const fp = generateSessionFingerprint({ enabled: true });

      // Common audio sample rates
      const validRates = [8000, 16000, 22050, 44100, 48000];
      expect(validRates).toContain(fp.voiceNote.sampleRate);
    });
  });
});
