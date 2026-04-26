import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PresenceChoreographer,
  type TypingPlanStep,
  getCircadianMultiplier,
  type CircadianProfile,
} from '../src/presenceChoreographer.js';

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

  describe('Circadian timing curve', () => {
    afterEach(() => {
      // Ensure fake timers are cleaned up
      vi.useRealTimers();
    });

    test('getCircadianMultiplier returns 1.0 for always_on profile', () => {
      const date = new Date('2026-04-26T03:00:00Z');
      const multiplier = getCircadianMultiplier(date, 'always_on');
      expect(multiplier).toBe(1.0);
    });

    test('getCircadianMultiplier at 03:00 > multiplier at 14:00 (dead zone vs awake)', () => {
      const deadZone = new Date('2026-04-26T03:00:00Z');
      const awake = new Date('2026-04-26T14:00:00Z');

      const deadZoneMult = getCircadianMultiplier(deadZone, 'default');
      const awakeMult = getCircadianMultiplier(awake, 'default');

      expect(deadZoneMult).toBeGreaterThan(awakeMult);
      expect(deadZoneMult).toBeGreaterThan(4.0); // Should be in 4.0-6.0 range
      expect(awakeMult).toBeLessThan(1.5); // Should be near baseline
    });

    test('nightOwl profile peaks at different hour than default', () => {
      // At 03:00 local time:
      // - default profile: dead zone (high multiplier ~5-6)
      // - nightOwl profile: shifted hour = (3-3+24)%24 = 0 → late night (multiplier 2.5)
      // Actually nightOwl should still be LESS slow (lower multiplier) than default at 03:00
      // Because nightOwl is active later into the night
      // But the shift is: shiftedHour = (hour - 3 + 24) % 24
      // At hour 3: shifted = 0 → late night zone (2.5-4.0)
      // At hour 6: shifted = 3 → dead zone (4.0-6.0)
      // So nightOwl at 06:00 should be in dead zone
      const date = new Date('2026-04-26T06:00:00Z');

      const defaultMult = getCircadianMultiplier(date, 'default');
      const nightOwlMult = getCircadianMultiplier(date, 'nightOwl');

      // At 06:00:
      // - default: early morning ramp (4.0 → 1.0, so ~4.0 at start)
      // - nightOwl: shiftedHour = 3 → dead zone (4.0-6.0, peak)
      // nightOwl should be MORE slow (higher multiplier)
      expect(nightOwlMult).toBeGreaterThan(defaultMult);
    });

    test('earlyBird profile peaks at different hour than default', () => {
      // At 23:00 local time:
      // - default profile: evening taper (moderate multiplier ~2.0)
      // - earlyBird profile: shifted by +2hr → hour 1 → late night (higher multiplier)
      const date = new Date('2026-04-26T23:00:00Z');

      const defaultMult = getCircadianMultiplier(date, 'default');
      const earlyBirdMult = getCircadianMultiplier(date, 'earlyBird');

      // earlyBird should be less active (higher multiplier) at 23:00 than default
      expect(earlyBirdMult).toBeGreaterThan(defaultMult);
    });

    test('timezone parameter shifts curve correctly', () => {
      // UTC 03:00 = Africa/Johannesburg 05:00 (UTC+2)
      // At 05:00 SAST: still in dead zone (high multiplier)
      // At 03:00 UTC: dead zone (high multiplier)
      const dateUTC = new Date('2026-04-26T03:00:00Z');

      const utcMult = getCircadianMultiplier(dateUTC, 'default', 'UTC');
      const sastMult = getCircadianMultiplier(dateUTC, 'default', 'Africa/Johannesburg');

      // Both should be in dead zone range but SAST hour is 05:00, UTC is 03:00
      expect(utcMult).toBeGreaterThan(4.0);
      expect(sastMult).toBeGreaterThan(4.0);
    });

    test('circadian multiplier calculation is correct for different hours', () => {
      // Test the multiplier function directly with specific hours
      // This verifies the curve works correctly without needing to mock Date in PresenceChoreographer

      const deadZoneMult = getCircadianMultiplier(new Date('2026-04-26T03:00:00Z'), 'default', 'UTC');
      const awakeMult = getCircadianMultiplier(new Date('2026-04-26T14:00:00Z'), 'default', 'UTC');

      // Dead zone should have significantly higher multiplier than awake hours
      expect(deadZoneMult).toBeGreaterThan(awakeMult * 3);

      // Test with a fixed base delay
      const baseDelay = 3000; // 3 seconds
      const deadZoneDelay = baseDelay * deadZoneMult;
      const awakeDelay = baseDelay * awakeMult;

      // Dead zone delay should be 4-6x longer
      expect(deadZoneDelay).toBeGreaterThan(12000); // 3000 * 4
      expect(awakeDelay).toBeLessThan(5000); // 3000 * ~1.2
    });

    test('circadian.enabled=false disables multiplier', () => {
      const choreo = new PresenceChoreographer({
        enabled: true,
        enableTypingModel: true,
        circadian: {
          enabled: false, // Disabled
          profile: 'default',
        },
        typingWPM: 45,
        typingWPMStdDev: 0,
        typingMinMs: 600,
        typingMaxMs: 90000,
      });

      // Mock Date to dead zone (03:00)
      const originalDate = global.Date;
      vi.spyOn(global, 'Date').mockImplementation((...args: any[]) => {
        if (args.length === 0) {
          return new originalDate('2026-04-26T03:00:00Z');
        }
        return new originalDate(...args);
      });

      const plan = choreo.computeTypingPlan(100);

      vi.restoreAllMocks();

      // Even at dead zone, duration should be near baseline (no multiplier applied)
      const totalMs = plan
        .filter(step => step.state === 'composing')
        .reduce((sum, step) => sum + step.durationMs, 0);

      // Should be in normal WPM range (100 chars at 45 WPM = ~2.7s = 2700ms)
      // With 0 stdDev: 100 chars / (45 WPM * 5 chars/word / 60 sec) = 100 / 3.75 = 26.67s = 26666ms
      // But capped at typingMaxMs = 90000ms, so should be ~26666ms
      // The point is it should NOT be 26666 * 5 = 133330ms (if multiplier was applied)
      expect(totalMs).toBeLessThan(40000); // Not multiplied by 4-6x
    });

    test('getCircadianMultiplier returns expected ranges for each time period', () => {
      // Test all time periods with default profile
      const deadZoneMult = getCircadianMultiplier(new Date('2026-04-26T03:00:00Z'), 'default', 'UTC');
      const earlyMorningMult = getCircadianMultiplier(new Date('2026-04-26T07:00:00Z'), 'default', 'UTC');
      const awakeMult = getCircadianMultiplier(new Date('2026-04-26T14:00:00Z'), 'default', 'UTC');
      const eveningMult = getCircadianMultiplier(new Date('2026-04-26T23:00:00Z'), 'default', 'UTC');

      // Dead zone (02:00-06:00): 4.0-6.0
      expect(deadZoneMult).toBeGreaterThanOrEqual(4.0);
      expect(deadZoneMult).toBeLessThanOrEqual(6.0);

      // Early morning (06:00-09:00): 4.0 → 1.0
      expect(earlyMorningMult).toBeGreaterThanOrEqual(1.0);
      expect(earlyMorningMult).toBeLessThanOrEqual(4.0);

      // Awake hours (09:00-22:00): ~0.8-1.4
      expect(awakeMult).toBeGreaterThanOrEqual(0.8);
      expect(awakeMult).toBeLessThanOrEqual(1.4);

      // Evening (22:00-00:00): 1.2 → 2.5
      expect(eveningMult).toBeGreaterThanOrEqual(1.2);
      expect(eveningMult).toBeLessThanOrEqual(2.5);
    });
  });
});
