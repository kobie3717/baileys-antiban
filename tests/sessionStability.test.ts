/**
 * Tests for Session Stability Module (v2.0)
 */

import {
  classifyDisconnect,
  SessionHealthMonitor,
  wrapWithSessionStability,
  type DisconnectCategory,
} from '../src/sessionStability.js';
import { LidResolver } from '../src/lidResolver.js';

describe('classifyDisconnect', () => {
  it('should classify 401 as fatal (logged out)', () => {
    const result = classifyDisconnect(401);
    expect(result.category).toBe('fatal');
    expect(result.shouldReconnect).toBe(false);
    expect(result.message).toContain('Logged out');
  });

  it('should classify 440 as fatal (logged out)', () => {
    const result = classifyDisconnect(440);
    expect(result.category).toBe('fatal');
    expect(result.shouldReconnect).toBe(false);
  });

  it('should classify 515 as fatal (restart required)', () => {
    const result = classifyDisconnect(515);
    expect(result.category).toBe('fatal');
    expect(result.shouldReconnect).toBe(false);
    expect(result.message).toContain('Restart required');
  });

  it('should classify 428 as fatal (connection replaced)', () => {
    const result = classifyDisconnect(428);
    expect(result.category).toBe('fatal');
    expect(result.shouldReconnect).toBe(false);
    expect(result.message).toContain('Connection replaced');
  });

  it('should classify 429 as rate-limited with 5min backoff', () => {
    const result = classifyDisconnect(429);
    expect(result.category).toBe('rate-limited');
    expect(result.shouldReconnect).toBe(true);
    expect(result.backoffMs).toBe(300_000); // 5 minutes
    expect(result.message).toContain('Rate limited');
  });

  it('should classify 503 as rate-limited with 1min backoff', () => {
    const result = classifyDisconnect(503);
    expect(result.category).toBe('rate-limited');
    expect(result.shouldReconnect).toBe(true);
    expect(result.backoffMs).toBe(60_000); // 1 minute
    expect(result.message).toContain('unavailable');
  });

  it('should classify 408 as recoverable (timeout)', () => {
    const result = classifyDisconnect(408);
    expect(result.category).toBe('recoverable');
    expect(result.shouldReconnect).toBe(true);
    expect(result.backoffMs).toBe(5_000);
    expect(result.message).toContain('timeout');
  });

  it('should classify 500 as recoverable (internal error)', () => {
    const result = classifyDisconnect(500);
    expect(result.category).toBe('recoverable');
    expect(result.shouldReconnect).toBe(true);
    expect(result.backoffMs).toBe(10_000);
  });

  it('should classify 1000 as recoverable (graceful close)', () => {
    const result = classifyDisconnect(1000);
    expect(result.category).toBe('recoverable');
    expect(result.shouldReconnect).toBe(true);
    expect(result.backoffMs).toBe(2_000);
  });

  it('should classify unknown codes as unknown with caution', () => {
    const result = classifyDisconnect(999);
    expect(result.category).toBe('unknown');
    expect(result.shouldReconnect).toBe(true);
    expect(result.backoffMs).toBe(15_000);
    expect(result.message).toContain('Unknown disconnect');
    expect(result.message).toContain('999');
  });
});

describe('SessionHealthMonitor', () => {
  it('should track decrypt success', () => {
    const monitor = new SessionHealthMonitor();
    monitor.recordDecryptSuccess();
    monitor.recordDecryptSuccess();

    const stats = monitor.getStats();
    expect(stats.decryptSuccess).toBe(2);
    expect(stats.decryptFail).toBe(0);
    expect(stats.isDegraded).toBe(false);
  });

  it('should track decrypt failures', () => {
    const monitor = new SessionHealthMonitor();
    monitor.recordDecryptFail(false);
    monitor.recordDecryptFail(true); // Bad MAC

    const stats = monitor.getStats();
    expect(stats.decryptFail).toBe(2);
    expect(stats.badMacCount).toBe(1);
  });

  it('should trigger degraded state after threshold Bad MACs', () => {
    const degradedCallback = jest.fn();
    const monitor = new SessionHealthMonitor({
      badMacThreshold: 3,
      badMacWindowMs: 60_000,
      onDegraded: degradedCallback,
    });

    // Trigger 3 Bad MACs (threshold)
    monitor.recordDecryptFail(true);
    monitor.recordDecryptFail(true);
    expect(monitor.getStats().isDegraded).toBe(false); // Not yet

    monitor.recordDecryptFail(true);

    const stats = monitor.getStats();
    expect(stats.isDegraded).toBe(true);
    expect(stats.degradedSince).toBeDefined();
    expect(degradedCallback).toHaveBeenCalledTimes(1);
  });

  it('should recover from degraded state after window expires', async () => {
    const recoveredCallback = jest.fn();
    const monitor = new SessionHealthMonitor({
      badMacThreshold: 2,
      badMacWindowMs: 100, // 100ms window
      onRecovered: recoveredCallback,
    });

    // Trigger degraded state
    monitor.recordDecryptFail(true);
    monitor.recordDecryptFail(true);
    expect(monitor.getStats().isDegraded).toBe(true);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    // Record success to trigger recovery check
    monitor.recordDecryptSuccess();

    const stats = monitor.getStats();
    expect(stats.isDegraded).toBe(false);
    expect(stats.degradedSince).toBeUndefined();
    expect(recoveredCallback).toHaveBeenCalledTimes(1);
  });

  it('should not trigger degraded if Bad MACs are outside window', async () => {
    const monitor = new SessionHealthMonitor({
      badMacThreshold: 2,
      badMacWindowMs: 50, // 50ms window
    });

    monitor.recordDecryptFail(true);
    await new Promise(resolve => setTimeout(resolve, 60)); // Wait for window to expire
    monitor.recordDecryptFail(true);

    const stats = monitor.getStats();
    expect(stats.isDegraded).toBe(false); // Only 1 within window
  });

  it('should reset all stats', () => {
    const monitor = new SessionHealthMonitor();
    monitor.recordDecryptSuccess();
    monitor.recordDecryptFail(true);

    monitor.reset();

    const stats = monitor.getStats();
    expect(stats.decryptSuccess).toBe(0);
    expect(stats.decryptFail).toBe(0);
    expect(stats.badMacCount).toBe(0);
    expect(stats.isDegraded).toBe(false);
  });
});

describe('wrapWithSessionStability', () => {
  it('should wrap socket and canonicalize JID before sendMessage', async () => {
    const resolver = new LidResolver({ canonical: 'pn' });
    resolver.learn({
      lid: '123456@lid',
      pn: '27825651069@s.whatsapp.net',
    });

    const mockSock = {
      sendMessage: jest.fn().mockResolvedValue({ status: 'ok' }),
    };

    const wrapped = wrapWithSessionStability(mockSock, {
      canonicalJidNormalization: true,
      lidResolver: resolver,
    });

    // Send to LID form — should canonicalize to PN
    await wrapped.sendMessage('123456@lid', { text: 'hello' });

    expect(mockSock.sendMessage).toHaveBeenCalledWith(
      '27825651069@s.whatsapp.net',
      { text: 'hello' }
    );
  });

  it('should pass through when canonicalization disabled', async () => {
    const mockSock = {
      sendMessage: jest.fn().mockResolvedValue({ status: 'ok' }),
    };

    const wrapped = wrapWithSessionStability(mockSock, {
      canonicalJidNormalization: false,
    });

    await wrapped.sendMessage('123456@lid', { text: 'hello' });

    expect(mockSock.sendMessage).toHaveBeenCalledWith(
      '123456@lid',
      { text: 'hello' }
    );
  });

  it('should pass through when no resolver provided', async () => {
    const mockSock = {
      sendMessage: jest.fn().mockResolvedValue({ status: 'ok' }),
    };

    const wrapped = wrapWithSessionStability(mockSock, {
      canonicalJidNormalization: true,
      // No resolver
    });

    await wrapped.sendMessage('123456@lid', { text: 'hello' });

    expect(mockSock.sendMessage).toHaveBeenCalledWith(
      '123456@lid',
      { text: 'hello' }
    );
  });

  it('should expose health monitor via property', () => {
    const mockSock = { sendMessage: jest.fn() };

    const wrapped = wrapWithSessionStability(mockSock, {
      healthMonitoring: true,
    });

    expect((wrapped as any).sessionHealthMonitor).toBeInstanceOf(SessionHealthMonitor);
    expect((wrapped as any).sessionHealthStats).toBeDefined();
  });

  it('should not expose health monitor when disabled', () => {
    const mockSock = { sendMessage: jest.fn() };

    const wrapped = wrapWithSessionStability(mockSock, {
      healthMonitoring: false,
    });

    expect((wrapped as any).sessionHealthMonitor).toBeUndefined();
  });

  it('should pass through all other socket properties', () => {
    const mockSock = {
      sendMessage: jest.fn(),
      user: { id: '123' },
      ev: { on: jest.fn() },
      logout: jest.fn(),
    };

    const wrapped = wrapWithSessionStability(mockSock, {
      canonicalJidNormalization: false,
    });

    expect((wrapped as any).user).toEqual({ id: '123' });
    expect((wrapped as any).ev).toBe(mockSock.ev);
    expect((wrapped as any).logout).toBe(mockSock.logout);
  });
});
