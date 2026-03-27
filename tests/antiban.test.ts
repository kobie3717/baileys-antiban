import { AntiBan } from '../src/antiban.js';

describe('AntiBan Integration', () => {
  let antiban: AntiBan;

  beforeEach(() => {
    antiban = new AntiBan({
      rateLimiter: {
        maxPerMinute: 5,
        maxPerHour: 50,
        maxPerDay: 500,
        minDelayMs: 100,
        maxDelayMs: 300,
      },
      warmUp: {
        warmUpDays: 7,
        day1Limit: 20,
      },
      health: {
        autoPauseAt: 'high',
      },
      logging: false,
    });
  });

  describe('beforeSend', () => {
    test('allows message when all checks pass', async () => {
      const result = await antiban.beforeSend('test@s.whatsapp.net', 'Hello');

      expect(result.allowed).toBe(true);
      expect(result.delayMs).toBeGreaterThanOrEqual(0);
      expect(result.health.risk).toBe('low');
    });

    test('blocks message when health risk is too high', async () => {
      // Trigger high risk
      antiban.onDisconnect(403);
      antiban.onDisconnect(403);

      const result = await antiban.beforeSend('test@s.whatsapp.net', 'Hello');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Health risk');
    });

    test('blocks message when warm-up limit reached', async () => {
      // Send 20 messages (day 1 limit)
      for (let i = 0; i < 20; i++) {
        const result = await antiban.beforeSend('test@s.whatsapp.net', `Message ${i}`);
        if (result.allowed) {
          antiban.afterSend('test@s.whatsapp.net', `Message ${i}`);
        }
      }

      // 21st should be blocked
      const result = await antiban.beforeSend('test@s.whatsapp.net', 'Overflow');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Warm-up limit');
    });

    test('blocks identical spam messages', async () => {
      const message = 'Spam message';

      // Send same message 3 times
      for (let i = 0; i < 3; i++) {
        const result = await antiban.beforeSend('test@s.whatsapp.net', message);
        if (result.allowed) {
          antiban.afterSend('test@s.whatsapp.net', message);
        }
      }

      // 4th should be blocked
      const result = await antiban.beforeSend('test@s.whatsapp.net', message);
      expect(result.allowed).toBe(false);
    });
  });

  describe('afterSend', () => {
    test('records successful send', async () => {
      const result = await antiban.beforeSend('test@s.whatsapp.net', 'Hello');
      antiban.afterSend('test@s.whatsapp.net', 'Hello');

      const stats = antiban.getStats();
      expect(stats.messagesAllowed).toBe(1);
    });
  });

  describe('afterSendFailed', () => {
    test('records failed send', () => {
      antiban.afterSendFailed('Network error');

      const stats = antiban.getStats();
      expect(stats.health.stats.failedMessagesLastHour).toBe(1);
    });
  });

  describe('Health monitoring', () => {
    test('tracks disconnections', () => {
      antiban.onDisconnect('timeout');

      const stats = antiban.getStats();
      expect(stats.health.stats.disconnectsLastHour).toBe(1);
    });

    test('tracks reconnections', () => {
      antiban.onDisconnect('timeout');
      antiban.onReconnect();

      const stats = antiban.getStats();
      // Should have both events tracked
      expect(stats.health.stats.uptimeMs).toBeGreaterThan(0);
    });
  });

  describe('Stats', () => {
    test('provides comprehensive statistics', async () => {
      const result = await antiban.beforeSend('test@s.whatsapp.net', 'Hello');
      if (result.allowed) {
        antiban.afterSend('test@s.whatsapp.net', 'Hello');
      }

      const stats = antiban.getStats();

      expect(stats).toHaveProperty('messagesAllowed');
      expect(stats).toHaveProperty('messagesBlocked');
      expect(stats).toHaveProperty('totalDelayMs');
      expect(stats).toHaveProperty('health');
      expect(stats).toHaveProperty('warmUp');
      expect(stats).toHaveProperty('rateLimiter');
    });
  });

  describe('State persistence', () => {
    test('exports and restores warm-up state', async () => {
      // Send a few messages
      for (let i = 0; i < 5; i++) {
        const result = await antiban.beforeSend('test@s.whatsapp.net', `Message ${i}`);
        if (result.allowed) {
          antiban.afterSend('test@s.whatsapp.net', `Message ${i}`);
        }
      }

      const state = antiban.exportWarmUpState();
      expect(state.dailyCounts[0]).toBe(5);

      // Create new instance with saved state
      const restored = new AntiBan({ logging: false }, state);
      const restoredStats = restored.getStats();
      expect(restoredStats.warmUp.todaySent).toBe(5);
    });
  });

  describe('Pause and resume', () => {
    test('pauses all sending', async () => {
      antiban.pause();

      const result = await antiban.beforeSend('test@s.whatsapp.net', 'Hello');
      expect(result.allowed).toBe(false);
    });

    test('resumes sending', async () => {
      antiban.pause();
      antiban.resume();

      const result = await antiban.beforeSend('test@s.whatsapp.net', 'Hello');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Reset', () => {
    test('resets all state', async () => {
      // Send messages and trigger events
      await antiban.beforeSend('test@s.whatsapp.net', 'Hello');
      antiban.afterSend('test@s.whatsapp.net', 'Hello');
      antiban.onDisconnect('timeout');

      antiban.reset();

      const stats = antiban.getStats();
      expect(stats.messagesAllowed).toBe(0);
      expect(stats.health.risk).toBe('low');
      expect(stats.warmUp.phase).toBe('warming');
      expect(stats.warmUp.todaySent).toBe(0);
    });
  });
});
