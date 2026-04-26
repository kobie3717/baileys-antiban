import { describe, test, expect, beforeEach, vi } from 'vitest';
import { PresenceChoreographer, type TypingPlanStep } from '../src/presenceChoreographer.js';

describe('PresenceChoreographer', () => {
  let choreo: PresenceChoreographer;

  beforeEach(() => {
    choreo = new PresenceChoreographer({
      enabled: true,
      enableTypingModel: true,
      typingWPM: 45,
      typingWPMStdDev: 15,
      thinkPauseProbability: 0.08,
      thinkPauseMinMs: 800,
      thinkPauseMaxMs: 3500,
      intermittentPausedProbability: 0.4,
      typingMaxMs: 90000,
      typingMinMs: 600,
    });
  });

  describe('Existing functionality', () => {
    test('getCurrentActivityFactor returns 1.0 when circadian disabled', () => {
      const choreoNoCadence = new PresenceChoreographer({
        enabled: true,
        enableCircadianRhythm: false,
      });
      expect(choreoNoCadence.getCurrentActivityFactor()).toBe(1.0);
    });

    test('shouldPauseForDistraction probability works', () => {
      const choreoHighPause = new PresenceChoreographer({
        enabled: true,
        distractionPauseProbability: 1.0,
      });
      const result = choreoHighPause.shouldPauseForDistraction();
      expect(result.pause).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    test('shouldMarkRead can skip read receipts', () => {
      const choreoSkipAll = new PresenceChoreographer({
        enabled: true,
        readReceiptSkipProbability: 1.0,
      });
      const result = choreoSkipAll.shouldMarkRead();
      expect(result.mark).toBe(false);
    });

    test('getStats returns correct structure', () => {
      const stats = choreo.getStats();
      expect(stats).toHaveProperty('currentActivityFactor');
      expect(stats).toHaveProperty('distractionPausesInjected');
      expect(stats).toHaveProperty('typingPlansComputed');
      expect(stats).toHaveProperty('typingPlansExecuted');
      expect(stats).toHaveProperty('totalTypingTimeMs');
    });

    test('reset clears statistics', () => {
      choreo.computeTypingPlan(100);
      expect(choreo.getStats().typingPlansComputed).toBe(1);
      choreo.reset();
      expect(choreo.getStats().typingPlansComputed).toBe(0);
    });
  });

  describe('WPM typing model', () => {
    test('computeTypingPlan returns plan with at least one composing step', () => {
      const plan = choreo.computeTypingPlan(50);
      expect(plan.length).toBeGreaterThan(0);
      const hasComposing = plan.some(step => step.state === 'composing');
      expect(hasComposing).toBe(true);
    });

    test('computeTypingPlan for empty message returns minimal plan', () => {
      const plan = choreo.computeTypingPlan(0);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan[0].state).toBe('composing');
      expect(plan[0].durationMs).toBe(600); // typingMinMs
    });

    test('computeTypingPlan for very long message is capped at typingMaxMs', () => {
      const plan = choreo.computeTypingPlan(10000);
      const totalComposingMs = plan
        .filter(step => step.state === 'composing')
        .reduce((sum, step) => sum + step.durationMs, 0);
      // Should be roughly capped (within 20% tolerance due to pause budget)
      expect(totalComposingMs).toBeLessThanOrEqual(90000 * 1.2);
    });

    test('longer messages produce more think pauses than short ones (statistical)', () => {
      // Run 50 trials each
      const shortPlans: TypingPlanStep[][] = [];
      const longPlans: TypingPlanStep[][] = [];

      for (let i = 0; i < 50; i++) {
        shortPlans.push(choreo.computeTypingPlan(20));
        longPlans.push(choreo.computeTypingPlan(500));
      }

      const shortPauseCount = shortPlans.reduce(
        (sum, plan) => sum + plan.filter(step => step.state === 'paused').length,
        0
      ) / shortPlans.length;

      const longPauseCount = longPlans.reduce(
        (sum, plan) => sum + plan.filter(step => step.state === 'paused').length,
        0
      ) / longPlans.length;

      // Long messages should have more pauses on average
      expect(longPauseCount).toBeGreaterThan(shortPauseCount);
    });

    test('executeTypingPlan calls sendPresenceUpdate once per step with correct state', async () => {
      vi.useFakeTimers();

      const mockSock = {
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      };

      const plan: TypingPlanStep[] = [
        { state: 'composing', durationMs: 1000 },
        { state: 'paused', durationMs: 500 },
        { state: 'composing', durationMs: 2000 },
      ];

      const executePromise = choreo.executeTypingPlan(
        mockSock,
        'test@s.whatsapp.net',
        plan
      );

      // Run all timers to completion
      await vi.runAllTimersAsync();

      await executePromise;

      expect(mockSock.sendPresenceUpdate).toHaveBeenCalledTimes(3);
      expect(mockSock.sendPresenceUpdate).toHaveBeenNthCalledWith(
        1,
        'composing',
        'test@s.whatsapp.net'
      );
      expect(mockSock.sendPresenceUpdate).toHaveBeenNthCalledWith(
        2,
        'paused',
        'test@s.whatsapp.net'
      );
      expect(mockSock.sendPresenceUpdate).toHaveBeenNthCalledWith(
        3,
        'composing',
        'test@s.whatsapp.net'
      );

      vi.useRealTimers();
    });

    test('executeTypingPlan honors AbortSignal', async () => {
      vi.useFakeTimers();

      const mockSock = {
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      };

      const plan: TypingPlanStep[] = [
        { state: 'composing', durationMs: 1000 },
        { state: 'paused', durationMs: 500 },
        { state: 'composing', durationMs: 2000 },
      ];

      const abortController = new AbortController();

      const executePromise = choreo.executeTypingPlan(
        mockSock,
        'test@s.whatsapp.net',
        plan,
        { signal: abortController.signal }
      );

      // Let the first step start
      await vi.runOnlyPendingTimersAsync();

      // Abort before second step
      abortController.abort();

      // Advance timers to trigger next iteration
      await vi.advanceTimersByTimeAsync(1000);

      // Should throw - catch to prevent unhandled rejection warning
      try {
        await executePromise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toBe('Typing plan aborted');
      }

      // Should have called sendPresenceUpdate for paused state on abort
      expect(mockSock.sendPresenceUpdate).toHaveBeenCalledWith('paused', 'test@s.whatsapp.net');

      vi.useRealTimers();
    });

    test('stats counters increment correctly after compute and execute', async () => {
      vi.useFakeTimers();

      const initialStats = choreo.getStats();
      expect(initialStats.typingPlansComputed).toBe(0);
      expect(initialStats.typingPlansExecuted).toBe(0);

      const plan = choreo.computeTypingPlan(100);
      const statsAfterCompute = choreo.getStats();
      expect(statsAfterCompute.typingPlansComputed).toBe(1);
      expect(statsAfterCompute.typingPlansExecuted).toBe(0);

      const mockSock = {
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      };

      const executePromise = choreo.executeTypingPlan(mockSock, 'test@s.whatsapp.net', plan);

      // Advance all timers to completion
      await vi.runAllTimersAsync();

      await executePromise;

      const statsAfterExecute = choreo.getStats();
      expect(statsAfterExecute.typingPlansComputed).toBe(1);
      expect(statsAfterExecute.typingPlansExecuted).toBe(1);
      expect(statsAfterExecute.totalTypingTimeMs).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    test('disabled typing model returns minimal plan', () => {
      const choreoDisabled = new PresenceChoreographer({
        enabled: true,
        enableTypingModel: false,
      });

      const plan = choreoDisabled.computeTypingPlan(1000);
      expect(plan.length).toBe(1);
      expect(plan[0].state).toBe('composing');
      expect(plan[0].durationMs).toBe(600); // typingMinMs
    });
  });
});
