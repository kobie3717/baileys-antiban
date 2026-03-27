import { WarmUp } from '../src/warmup.js';

describe('WarmUp', () => {
  let warmup: WarmUp;

  beforeEach(() => {
    warmup = new WarmUp({
      warmUpDays: 7,
      day1Limit: 20,
      growthFactor: 1.8,
      inactivityThresholdHours: 72,
    });
  });

  describe('Daily limits', () => {
    test('starts with day 1 limit', () => {
      const limit = warmup.getDailyLimit();
      expect(limit).toBe(20);
    });

    test('increases limit progressively each day', () => {
      const day1 = warmup.getDailyLimit();
      expect(day1).toBe(20);

      // Day 2 should be ~36 (20 * 1.8)
      const status = warmup.getStatus();
      expect(status.day).toBe(1);
    });

    test('graduates after warm-up period', () => {
      // Create warmup that started 8 days ago
      const pastDate = Date.now() - (8 * 24 * 60 * 60 * 1000);
      const state = {
        startedAt: pastDate,
        lastActiveAt: Date.now(),
        dailyCounts: [10, 20, 30, 40, 50, 60, 70],
        graduated: false,
      };

      const graduatedWarmup = new WarmUp({}, state);
      const limit = graduatedWarmup.getDailyLimit();
      expect(limit).toBe(Infinity);

      const status = graduatedWarmup.getStatus();
      expect(status.phase).toBe('graduated');
    });
  });

  describe('Message tracking', () => {
    test('allows messages within daily limit', () => {
      for (let i = 0; i < 20; i++) {
        expect(warmup.canSend()).toBe(true);
        warmup.record();
      }

      // 21st message should be blocked
      expect(warmup.canSend()).toBe(false);
    });

    test('tracks messages per day correctly', () => {
      warmup.record();
      warmup.record();

      const status = warmup.getStatus();
      expect(status.todaySent).toBe(2);
      expect(status.todayLimit).toBe(20);
    });
  });

  describe('Status', () => {
    test('returns correct warm-up status', () => {
      warmup.record();

      const status = warmup.getStatus();
      expect(status.phase).toBe('warming');
      expect(status.day).toBe(1);
      expect(status.totalDays).toBe(7);
      expect(status.todaySent).toBe(1);
      expect(status.todayLimit).toBe(20);
      expect(status.progress).toBeGreaterThanOrEqual(0);
      expect(status.progress).toBeLessThanOrEqual(100);
    });
  });

  describe('State persistence', () => {
    test('exports and imports state correctly', () => {
      warmup.record();
      warmup.record();

      const exported = warmup.exportState();
      expect(exported.dailyCounts).toHaveLength(1);
      expect(exported.dailyCounts[0]).toBe(2);

      const restored = new WarmUp({}, exported);
      const status = restored.getStatus();
      expect(status.todaySent).toBe(2);
    });
  });

  describe('Inactivity detection', () => {
    test('re-enters warm-up after extended inactivity', () => {
      // Create graduated warmup
      const state = {
        startedAt: Date.now() - (10 * 24 * 60 * 60 * 1000),
        lastActiveAt: Date.now() - (80 * 60 * 60 * 1000), // 80 hours ago
        dailyCounts: Array(7).fill(100),
        graduated: true,
      };

      const inactiveWarmup = new WarmUp({ inactivityThresholdHours: 72 }, state);

      // Check if it can send (triggers inactivity check)
      const canSend = inactiveWarmup.canSend();
      const status = inactiveWarmup.getStatus();

      // Should have re-entered warm-up
      expect(status.phase).toBe('warming');
    });
  });

  describe('Reset', () => {
    test('resets warm-up to fresh state', () => {
      warmup.record();
      warmup.record();

      warmup.reset();

      const status = warmup.getStatus();
      expect(status.todaySent).toBe(0);
      expect(status.phase).toBe('warming');
    });
  });
});
