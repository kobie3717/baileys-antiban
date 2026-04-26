/**
 * Tests for deviceFingerprint module
 */

import { describe, it, expect } from 'vitest';
import { generateFingerprint, applyFingerprint } from '../src/deviceFingerprint.js';

describe('deviceFingerprint', () => {
  it('should generate deterministic fingerprint with same seed', () => {
    const fp1 = generateFingerprint({ seed: 'test-seed-123' }, 'session-1');
    const fp2 = generateFingerprint({ seed: 'test-seed-123' }, 'session-1');

    expect(fp1.appVersion).toEqual(fp2.appVersion);
    expect(fp1.osVersion).toBe(fp2.osVersion);
    expect(fp1.deviceModel).toBe(fp2.deviceModel);
  });

  it('should generate different fingerprints with different seeds', () => {
    const fp1 = generateFingerprint({ seed: 'seed-1' });
    const fp2 = generateFingerprint({ seed: 'seed-2' });

    // At least one field should differ (very high probability with 6+ appVersions, 5 OS, 12 devices)
    const isDifferent =
      JSON.stringify(fp1.appVersion) !== JSON.stringify(fp2.appVersion) ||
      fp1.osVersion !== fp2.osVersion ||
      fp1.deviceModel !== fp2.deviceModel;

    expect(isDifferent).toBe(true);
  });

  it('should respect custom pools', () => {
    const customAppPool = [[9, 9, 9, 9]];
    const customOsPool = ['CustomOS'];
    const customDevicePool = ['CustomDevice'];

    const fp = generateFingerprint({
      appVersionPool: customAppPool,
      osVersionPool: customOsPool,
      deviceModelPool: customDevicePool,
    });

    expect(fp.appVersion).toEqual([9, 9, 9, 9]);
    expect(fp.osVersion).toBe('CustomOS');
    expect(fp.deviceModel).toBe('CustomDevice');
  });

  it('should disable randomization when enabled=false', () => {
    const customAppPool = [[1, 1, 1, 1], [2, 2, 2, 2]];
    const customOsPool = ['OS1', 'OS2'];
    const customDevicePool = ['Device1', 'Device2'];

    const fp = generateFingerprint({
      enabled: false,
      appVersionPool: customAppPool,
      osVersionPool: customOsPool,
      deviceModelPool: customDevicePool,
    });

    // Should pick first item when disabled
    expect(fp.appVersion).toEqual([1, 1, 1, 1]);
    expect(fp.osVersion).toBe('OS1');
    expect(fp.deviceModel).toBe('Device1');
  });

  it('should apply fingerprint to socketConfig without crashing', () => {
    const fp = generateFingerprint({ seed: 'test' });
    const emptyConfig = {};

    const result = applyFingerprint(emptyConfig, fp);

    expect(result.version).toEqual(fp.appVersion);
    expect(result.browser).toBeDefined();
    expect(result.browser[0]).toBe(fp.deviceModel);
    expect(result.browser[1]).toBe(fp.osVersion);
    expect(result.browser[2]).toContain(fp.appVersion.join('.'));
  });

  it('should not mutate original fingerprint', () => {
    const fp = generateFingerprint({ seed: 'test' });
    const originalVersion = [...fp.appVersion];

    applyFingerprint({}, fp);

    expect(fp.appVersion).toEqual(originalVersion);
  });

  it('should generate valid appVersion arrays', () => {
    const fp = generateFingerprint({});

    expect(Array.isArray(fp.appVersion)).toBe(true);
    expect(fp.appVersion.length).toBe(4);
    expect(fp.appVersion.every((v) => typeof v === 'number')).toBe(true);
  });
});
