/**
 * v1.5 Integration Test - RetryReasonTracker + PostReconnectThrottle
 */

import { AntiBan } from '../src/antiban.js';

describe('v1.5 Integration', () => {
  let antiban: AntiBan;

  afterEach(() => {
    antiban?.destroy();
  });

  describe('RetryReasonTracker integration', () => {
    test('is accessible via antiban.retryTracker', () => {
      antiban = new AntiBan({
        retryTracker: { enabled: true },
      });

      expect(antiban.retryTracker).toBeDefined();
      expect(typeof antiban.retryTracker.onMessageUpdate).toBe('function');
    });

    test('stats are included when enabled', () => {
      antiban = new AntiBan({
        retryTracker: { enabled: true },
      });

      const stats = antiban.getStats();
      expect(stats.retryTracker).toBeDefined();
      expect(stats.retryTracker?.totalRetries).toBe(0);
    });

    test('stats are null when disabled', () => {
      antiban = new AntiBan({
        retryTracker: { enabled: false },
      });

      const stats = antiban.getStats();
      expect(stats.retryTracker).toBeUndefined();
    });

    test('onMessageUpdate can be called directly', () => {
      antiban = new AntiBan({
        retryTracker: { enabled: true },
      });

      antiban.retryTracker.onMessageUpdate({
        key: { id: 'msg123' },
        status: 0,
        error: { message: 'timeout' },
      });

      const stats = antiban.getStats().retryTracker;
      expect(stats?.totalRetries).toBe(1);
      expect(stats?.byReason.timeout).toBe(1);
    });
  });

  describe('PostReconnectThrottle integration', () => {
    test('is accessible via antiban.reconnectThrottle', () => {
      antiban = new AntiBan({
        reconnectThrottle: { enabled: true },
      });

      expect(antiban.reconnectThrottle).toBeDefined();
      expect(typeof antiban.reconnectThrottle.onReconnect).toBe('function');
    });

    test('stats are included when enabled', () => {
      antiban = new AntiBan({
        reconnectThrottle: { enabled: true },
      });

      const stats = antiban.getStats();
      expect(stats.reconnectThrottle).toBeDefined();
      expect(stats.reconnectThrottle?.isThrottled).toBe(false);
    });

    test('stats are null when disabled', () => {
      antiban = new AntiBan({
        reconnectThrottle: { enabled: false },
      });

      const stats = antiban.getStats();
      expect(stats.reconnectThrottle).toBeUndefined();
    });

    test('onReconnect triggers throttle window', () => {
      antiban = new AntiBan({
        reconnectThrottle: {
          enabled: true,
          rampDurationMs: 6000,
          initialRateMultiplier: 0.1,
        },
      });

      antiban.onReconnect();

      const stats = antiban.getStats().reconnectThrottle;
      expect(stats?.isThrottled).toBe(true);
      expect(stats?.currentMultiplier).toBe(0.1);
      expect(stats?.lifetimeReconnects).toBe(1);
    });

    test('beforeSend is blocked during throttle window', async () => {
      antiban = new AntiBan({
        reconnectThrottle: {
          enabled: true,
          rampDurationMs: 60000,
          initialRateMultiplier: 0.1,
        },
        rateLimiter: {
          maxPerMinute: 8,
        },
      });

      antiban.onReconnect();

      // First send should succeed
      const decision1 = await antiban.beforeSend('test@s.whatsapp.net', 'Message 1');
      expect(decision1.allowed).toBe(true);

      // Subsequent sends should be blocked by throttle
      const decision2 = await antiban.beforeSend('test@s.whatsapp.net', 'Message 2');
      expect(decision2.allowed).toBe(false);
      expect(decision2.reason).toContain('Post-reconnect throttle');
    });

    test('onDisconnect is called from AntiBan.onDisconnect', () => {
      antiban = new AntiBan({
        reconnectThrottle: { enabled: true },
      });

      const spy = jest.spyOn(antiban.reconnectThrottle, 'onDisconnect');
      antiban.onDisconnect(500);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Both modules together', () => {
    test('both work simultaneously', async () => {
      antiban = new AntiBan({
        retryTracker: { enabled: true },
        reconnectThrottle: {
          enabled: true,
          rampDurationMs: 60000,
        },
      });

      // Trigger reconnect
      antiban.onReconnect();

      // Track a retry
      antiban.retryTracker.onMessageUpdate({
        key: { id: 'msg1' },
        status: 0,
        error: { message: 'timeout' },
      });

      const stats = antiban.getStats();

      // Both stats should be present
      expect(stats.retryTracker).toBeDefined();
      expect(stats.reconnectThrottle).toBeDefined();

      // Retry tracker stats
      expect(stats.retryTracker?.totalRetries).toBe(1);

      // Reconnect throttle stats
      expect(stats.reconnectThrottle?.isThrottled).toBe(true);
      expect(stats.reconnectThrottle?.lifetimeReconnects).toBe(1);
    });

    test('destroy cleans up both modules', () => {
      antiban = new AntiBan({
        retryTracker: { enabled: true },
        reconnectThrottle: { enabled: true },
      });

      const retryDestroySpy = jest.spyOn(antiban.retryTracker, 'destroy');
      const throttleDestroySpy = jest.spyOn(antiban.reconnectThrottle, 'destroy');

      antiban.destroy();

      expect(retryDestroySpy).toHaveBeenCalled();
      expect(throttleDestroySpy).toHaveBeenCalled();
    });

    test('reset cleans up both modules', () => {
      antiban = new AntiBan({
        retryTracker: { enabled: true },
        reconnectThrottle: { enabled: true },
      });

      const retryDestroySpy = jest.spyOn(antiban.retryTracker, 'destroy');
      const throttleDestroySpy = jest.spyOn(antiban.reconnectThrottle, 'destroy');

      antiban.reset();

      expect(retryDestroySpy).toHaveBeenCalled();
      expect(throttleDestroySpy).toHaveBeenCalled();
    });
  });

  describe('Backward compatibility', () => {
    test('modules default to disabled', () => {
      antiban = new AntiBan();

      const stats = antiban.getStats();
      expect(stats.retryTracker).toBeUndefined();
      expect(stats.reconnectThrottle).toBeUndefined();
    });

    test('existing AntiBan functionality unaffected', async () => {
      antiban = new AntiBan({
        rateLimiter: { maxPerMinute: 5 },
        warmUp: { warmUpDays: 7 },
      });

      const decision = await antiban.beforeSend('test@s.whatsapp.net', 'Message');
      expect(decision.allowed).toBe(true);
      expect(decision.delayMs).toBeGreaterThanOrEqual(0);
    });
  });
});
