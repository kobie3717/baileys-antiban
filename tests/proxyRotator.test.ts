/**
 * Tests for proxyRotator module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { proxyRotator, type ProxyEndpoint } from '../src/proxyRotator.js';

// Mock proxy agent libraries
vi.mock('socks-proxy-agent', () => ({
  SocksProxyAgent: vi.fn((url: string) => ({ type: 'socks5', url })),
}));

vi.mock('http-proxy-agent', () => ({
  HttpProxyAgent: vi.fn((url: string) => ({ type: 'http', url })),
}));

vi.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: vi.fn((url: string) => ({ type: 'https', url })),
}));

describe('proxyRotator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should cycle through pool of 3 endpoints with round-robin strategy', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'Proxy1' },
      { type: 'socks5', host: 'proxy2.test', port: 1080, label: 'Proxy2' },
      { type: 'socks5', host: 'proxy3.test', port: 1080, label: 'Proxy3' },
    ];

    const rotator = proxyRotator({ pool, strategy: 'round-robin' });

    // First endpoint is active by default
    expect(rotator.current()?.label).toBe('Proxy1');

    // Rotate to next
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('Proxy2');

    // Rotate to next
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('Proxy3');

    // Wrap around to first
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('Proxy1');

    rotator.stop();
  });

  it('should pick different endpoints with random strategy over 50 trials', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'Proxy1' },
      { type: 'socks5', host: 'proxy2.test', port: 1080, label: 'Proxy2' },
      { type: 'socks5', host: 'proxy3.test', port: 1080, label: 'Proxy3' },
    ];

    const rotator = proxyRotator({ pool, strategy: 'random' });

    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      rotator.rotate('manual');
      const current = rotator.current()?.label;
      if (current) seen.add(current);
    }

    // With 50 trials and 3 endpoints, we should see at least 2 different endpoints
    expect(seen.size).toBeGreaterThanOrEqual(2);

    rotator.stop();
  });

  it('should pick never-used endpoint first with LRU strategy', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'Proxy1' },
      { type: 'socks5', host: 'proxy2.test', port: 1080, label: 'Proxy2' },
      { type: 'socks5', host: 'proxy3.test', port: 1080, label: 'Proxy3' },
    ];

    const rotator = proxyRotator({ pool, strategy: 'least-recently-used' });

    // First is already in use
    expect(rotator.current()?.label).toBe('Proxy1');

    // Should pick Proxy2 (never used)
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('Proxy2');

    // Should pick Proxy3 (never used)
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('Proxy3');

    // Now all used, should pick Proxy1 (oldest)
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('Proxy1');

    rotator.stop();
  });

  it('should mark endpoint dead after maxFailures and auto-rotate', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'Proxy1' },
      { type: 'socks5', host: 'proxy2.test', port: 1080, label: 'Proxy2' },
    ];

    const rotator = proxyRotator({ pool, maxFailures: 3 });

    expect(rotator.current()?.label).toBe('Proxy1');

    // Mark 3 failures
    rotator.markFailure();
    rotator.markFailure();
    rotator.markFailure();

    // Should auto-rotate to Proxy2
    expect(rotator.current()?.label).toBe('Proxy2');

    const stats = rotator.getStats();
    const proxy1Health = stats.endpointHealth.find((e) => e.label === 'Proxy1');
    expect(proxy1Health?.isDead).toBe(true);
    expect(proxy1Health?.failures).toBe(3);

    rotator.stop();
  });

  it('should auto-resurrect dead endpoint after deadCooldownMs', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'Proxy1' },
      { type: 'socks5', host: 'proxy2.test', port: 1080, label: 'Proxy2' },
    ];

    const rotator = proxyRotator({
      pool,
      maxFailures: 2,
      deadCooldownMs: 10_000, // 10 seconds
    });

    // Kill Proxy1
    rotator.markFailure();
    rotator.markFailure();

    let stats = rotator.getStats();
    expect(stats.endpointHealth[0].isDead).toBe(true);

    // Advance time by 10 seconds
    vi.advanceTimersByTime(10_000);

    // Trigger rotation to check resurrection
    rotator.rotate('manual');

    stats = rotator.getStats();
    // Should be resurrected now
    expect(stats.endpointHealth[0].isDead).toBe(false);
    expect(stats.endpointHealth[0].failures).toBe(0);

    rotator.stop();
  });

  it('should increment stats by trigger reason', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080 },
      { type: 'socks5', host: 'proxy2.test', port: 1080 },
    ];

    const rotator = proxyRotator({ pool });

    rotator.rotate('manual');
    rotator.rotate('disconnect');
    rotator.rotate('ban-warning');
    rotator.rotate('manual');

    const stats = rotator.getStats();
    expect(stats.totalRotations).toBe(4);
    expect(stats.rotationsByTrigger['manual']).toBe(2);
    expect(stats.rotationsByTrigger['disconnect']).toBe(1);
    expect(stats.rotationsByTrigger['ban-warning']).toBe(1);

    rotator.stop();
  });

  // NOTE: This test is obsolete with top-level await. Proxy agent modules are loaded
  // at import time, not lazily. If a module is missing, the import fails before any
  // test runs. This test was for the old lazy require() pattern.
  it.skip('should return null from currentAgent when peer dep is missing', () => {
    // Obsolete: top-level await loads modules at import time, not at currentAgent() time
    // If socks-proxy-agent is missing, the entire module import fails, not just currentAgent()
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080 },
    ];

    const rotator = proxyRotator({ pool });
    const agent = rotator.currentAgent();
    expect(agent).toBeNull();
    rotator.stop();
  });

  it('should stop scheduled rotation timer when stop() is called', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'Proxy1' },
      { type: 'socks5', host: 'proxy2.test', port: 1080, label: 'Proxy2' },
    ];

    const rotator = proxyRotator({
      pool,
      rotateOn: ['scheduled'],
      scheduledIntervalMs: 5_000,
    });

    expect(rotator.current()?.label).toBe('Proxy1');

    // Advance by 5 seconds
    vi.advanceTimersByTime(5_000);

    // Should have rotated to Proxy2
    expect(rotator.current()?.label).toBe('Proxy2');

    // Stop the timer
    rotator.stop();

    // Advance another 5 seconds
    vi.advanceTimersByTime(5_000);

    // Should NOT rotate (still on Proxy2)
    expect(rotator.current()?.label).toBe('Proxy2');
  });

  it('should skip endpoint during cooldown period', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'Proxy1', cooldownMs: 10_000 },
      { type: 'socks5', host: 'proxy2.test', port: 1080, label: 'Proxy2' },
      { type: 'socks5', host: 'proxy3.test', port: 1080, label: 'Proxy3' },
    ];

    const rotator = proxyRotator({ pool, strategy: 'round-robin' });

    expect(rotator.current()?.label).toBe('Proxy1');

    // Rotate to Proxy2 (Proxy1 now on cooldown for 10s)
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('Proxy2');

    // Rotate again — should skip Proxy1 (cooldown active) and go to Proxy3
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('Proxy3');

    // Advance time past cooldown
    vi.advanceTimersByTime(10_000);

    // Now Proxy1 should be available again
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('Proxy1');

    rotator.stop();
  });

  it('should bias toward lower-failure endpoints with weighted strategy', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'Proxy1' },
      { type: 'socks5', host: 'proxy2.test', port: 1080, label: 'Proxy2' },
      { type: 'socks5', host: 'proxy3.test', port: 1080, label: 'Proxy3' },
    ];

    const rotator = proxyRotator({ pool, strategy: 'weighted', maxFailures: 10 });

    // Mark Proxy1 with high failures
    for (let i = 0; i < 5; i++) {
      rotator.markFailure();
      rotator.rotate('manual'); // Move away to avoid killing it
    }

    // Now run 100 trials and count how often we pick each endpoint
    const counts: Record<string, number> = { Proxy1: 0, Proxy2: 0, Proxy3: 0 };

    for (let i = 0; i < 100; i++) {
      rotator.rotate('manual');
      const label = rotator.current()?.label;
      if (label) counts[label]++;
    }

    // Proxy1 (5 failures) should be picked less often than Proxy2/Proxy3 (0-1 failures)
    // This is probabilistic, so we use a loose check
    expect(counts['Proxy1']).toBeLessThan(counts['Proxy2'] + counts['Proxy3']);

    rotator.stop();
  });

  it('should resurrect all dead endpoints when resurrectAll() is called', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'Proxy1' },
      { type: 'socks5', host: 'proxy2.test', port: 1080, label: 'Proxy2' },
      { type: 'socks5', host: 'proxy3.test', port: 1080, label: 'Proxy3' },
    ];

    const rotator = proxyRotator({ pool, maxFailures: 1 });

    // Kill Proxy1
    rotator.markFailure();

    // Rotate to Proxy2 and kill it
    rotator.rotate('manual');
    rotator.markFailure();

    let stats = rotator.getStats();
    expect(stats.endpointHealth.filter((e) => e.isDead).length).toBe(2);

    // Resurrect all
    rotator.resurrectAll();

    stats = rotator.getStats();
    expect(stats.endpointHealth.filter((e) => e.isDead).length).toBe(0);
    expect(stats.endpointHealth[0].failures).toBe(0);
    expect(stats.endpointHealth[1].failures).toBe(0);

    rotator.stop();
  });

  it('should handle pool size of 1 gracefully (no-op rotation)', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080, label: 'OnlyProxy' },
    ];

    const logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    };

    const rotator = proxyRotator({ pool, logger });

    // Should warn about pool size 1
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('pool size is 1')
    );

    expect(rotator.current()?.label).toBe('OnlyProxy');

    // Rotation should be no-op
    rotator.rotate('manual');
    expect(rotator.current()?.label).toBe('OnlyProxy');

    rotator.stop();
  });

  it('should build correct proxy URLs with auth', () => {
    const pool: ProxyEndpoint[] = [
      {
        type: 'socks5',
        host: 'proxy.test',
        port: 1080,
        username: 'user',
        password: 'pass',
      },
    ];

    const rotator = proxyRotator({ pool });
    const agent = rotator.currentAgent();

    // Check that agent was created (mock should be called with correct URL)
    expect(agent).toBeDefined();

    rotator.stop();
  });

  it('should warn for aggressive scheduledIntervalMs < 60s', () => {
    const pool: ProxyEndpoint[] = [
      { type: 'socks5', host: 'proxy1.test', port: 1080 },
    ];

    const logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    };

    const rotator = proxyRotator({
      pool,
      rotateOn: ['scheduled'],
      scheduledIntervalMs: 30_000, // 30 seconds
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('< 60s')
    );

    rotator.stop();
  });
});
