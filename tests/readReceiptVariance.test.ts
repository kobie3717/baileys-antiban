/**
 * Tests for readReceiptVariance module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readReceiptVariance } from '../src/readReceiptVariance.js';

describe('readReceiptVariance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should generate delays within min/max bounds', () => {
    const variance = readReceiptVariance({
      meanMs: 1000,
      stdDevMs: 200,
      minMs: 500,
      maxMs: 2000,
    });

    // Generate 100 samples and verify all are in bounds
    const samples = Array.from({ length: 100 }, () => variance.delayMs());

    expect(samples.every((s) => s >= 500 && s <= 2000)).toBe(true);
  });

  it('should call underlying readMessages after delay', async () => {
    const variance = readReceiptVariance({
      meanMs: 1000,
      stdDevMs: 100,
      minMs: 900,
      maxMs: 1100,
    });

    let called = false;
    const mockSock = {
      readMessages: vi.fn(async (keys: any[]) => {
        called = true;
        return { success: true };
      }),
    };

    const wrapped = variance.wrap(mockSock);

    const promise = wrapped.readMessages([{ id: '1' }]);

    // Should not be called immediately
    expect(called).toBe(false);

    // Fast-forward time and run pending promises
    await vi.advanceTimersByTimeAsync(1100);
    await vi.runAllTimersAsync();

    const result = await promise;

    // Should be called after delay
    expect(called).toBe(true);
    expect(mockSock.readMessages).toHaveBeenCalledWith([{ id: '1' }]);
    expect(result).toEqual({ success: true });
  });

  it('should skip delay for old messages (backlog)', async () => {
    const variance = readReceiptVariance({
      meanMs: 1000,
      skipIfOlderThanMs: 60_000,
    });

    let called = false;
    const mockSock = {
      readMessages: vi.fn(async (keys: any[]) => {
        called = true;
        return { success: true };
      }),
    };

    const wrapped = variance.wrap(mockSock);

    // Message from 2 minutes ago (older than 60s threshold)
    const oldTimestamp = Math.floor((Date.now() - 120_000) / 1000);

    const promise = wrapped.readMessages([{ id: '1', messageTimestamp: oldTimestamp }]);

    // Should be called immediately (no delay for old messages)
    await promise;

    expect(called).toBe(true);
    expect(mockSock.readMessages).toHaveBeenCalledWith([{ id: '1', messageTimestamp: oldTimestamp }]);
  });

  it('should cancel pending timers on stop', async () => {
    const variance = readReceiptVariance({ meanMs: 1000 });

    let callCount = 0;
    const mockSock = {
      readMessages: vi.fn(async () => {
        callCount++;
        return { success: true };
      }),
    };

    const wrapped = variance.wrap(mockSock);

    // Start 3 delayed reads
    const p1 = wrapped.readMessages([{ id: '1' }]);
    const p2 = wrapped.readMessages([{ id: '2' }]);
    const p3 = wrapped.readMessages([{ id: '3' }]);

    // Stop before timers fire
    variance.stop();

    // Fast-forward time
    await vi.advanceTimersByTimeAsync(2000);

    // None should have been called
    expect(callCount).toBe(0);
  });

  it('should handle multiple concurrent delayed reads', async () => {
    const variance = readReceiptVariance({
      meanMs: 500,
      stdDevMs: 50,
      minMs: 400,
      maxMs: 600,
    });

    const callOrder: number[] = [];
    const mockSock = {
      readMessages: vi.fn(async (keys: any[]) => {
        callOrder.push(parseInt(keys[0].id));
        return { success: true };
      }),
    };

    const wrapped = variance.wrap(mockSock);

    // Start 3 reads
    const p1 = wrapped.readMessages([{ id: '1' }]);
    const p2 = wrapped.readMessages([{ id: '2' }]);
    const p3 = wrapped.readMessages([{ id: '3' }]);

    // Advance time to trigger all timers
    await vi.advanceTimersByTimeAsync(1000);

    await Promise.all([p1, p2, p3]);

    // All 3 should have been called
    expect(callOrder.length).toBe(3);
    expect(callOrder).toContain(1);
    expect(callOrder).toContain(2);
    expect(callOrder).toContain(3);
  });

  it('should preserve original socket properties', () => {
    const variance = readReceiptVariance();

    const mockSock = {
      readMessages: vi.fn(),
      sendMessage: vi.fn(),
      otherProp: 'test',
    };

    const wrapped = variance.wrap(mockSock);

    expect(wrapped.sendMessage).toBe(mockSock.sendMessage);
    expect((wrapped as any).otherProp).toBe('test');
  });
});
