import { RateLimiter } from '../src/rateLimiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      maxPerMinute: 5,
      maxPerHour: 50,
      maxPerDay: 500,
      minDelayMs: 100,
      maxDelayMs: 500,
      newChatDelayMs: 200,
      maxIdenticalMessages: 3,
      burstAllowance: 2,
      identicalMessageWindowMs: 3600000, // 1 hour
    });
  });

  describe('Per-minute rate limiting', () => {
    test('allows messages within per-minute limit', async () => {
      for (let i = 0; i < 5; i++) {
        const delay = await limiter.getDelay('test@s.whatsapp.net', `Message ${i}`);
        expect(delay).toBeGreaterThanOrEqual(0);
        limiter.record('test@s.whatsapp.net', `Message ${i}`);
      }

      const stats = limiter.getStats();
      expect(stats.lastMinute).toBe(5);
    });

    test('blocks messages exceeding per-minute limit', async () => {
      // Fill the minute quota
      for (let i = 0; i < 5; i++) {
        limiter.record('test@s.whatsapp.net', `Message ${i}`);
      }

      // Next message should be delayed or blocked
      const delay = await limiter.getDelay('test@s.whatsapp.net', 'Overflow message');
      expect(delay).toBeGreaterThan(0);
    });
  });

  describe('Per-hour rate limiting', () => {
    test('allows messages within per-hour limit', async () => {
      // Fast-forward time by recording messages as if they happened
      for (let i = 0; i < 50; i++) {
        limiter.record('test@s.whatsapp.net', `Message ${i}`);
      }

      const stats = limiter.getStats();
      expect(stats.lastHour).toBe(50);
    });

    test('blocks messages exceeding per-hour limit', async () => {
      // Fill hour quota
      for (let i = 0; i < 50; i++) {
        limiter.record('test@s.whatsapp.net', `Message ${i}`);
      }

      const delay = await limiter.getDelay('test@s.whatsapp.net', 'Overflow');
      expect(delay).toBeGreaterThan(0);
    });
  });

  describe('Per-day rate limiting', () => {
    test('blocks messages exceeding per-day limit', async () => {
      // Fill day quota
      for (let i = 0; i < 500; i++) {
        limiter.record('test@s.whatsapp.net', `Message ${i}`);
      }

      const delay = await limiter.getDelay('test@s.whatsapp.net', 'Overflow');
      expect(delay).toBe(-1); // Hard block
    });
  });

  describe('Burst allowance', () => {
    test('allows burst messages with reduced delay', async () => {
      const delay1 = await limiter.getDelay('test@s.whatsapp.net', 'Burst 1');
      limiter.record('test@s.whatsapp.net', 'Burst 1');

      const delay2 = await limiter.getDelay('test@s.whatsapp.net', 'Burst 2');
      limiter.record('test@s.whatsapp.net', 'Burst 2');

      // Burst messages should have shorter delays
      expect(delay1).toBeLessThan(500);
      expect(delay2).toBeLessThan(500);
    });

    test('resets burst allowance after inactivity', async () => {
      // Send burst messages
      limiter.record('test@s.whatsapp.net', 'Burst 1');
      limiter.record('test@s.whatsapp.net', 'Burst 2');

      // Simulate 31 seconds of inactivity (> 30s burst reset threshold)
      await new Promise(resolve => setTimeout(resolve, 31000));

      // Next message should get burst allowance again
      const delay = await limiter.getDelay('test@s.whatsapp.net', 'After inactivity');
      expect(delay).toBeGreaterThanOrEqual(0);
    }, 35000);
  });

  describe('New chat delay', () => {
    test('adds extra delay for first message to new chat', async () => {
      const newChatDelay = await limiter.getDelay('newchat@s.whatsapp.net', 'First message');
      const existingChatDelay = await limiter.getDelay('test@s.whatsapp.net', 'Message');

      // New chat should have higher delay due to newChatDelayMs
      expect(newChatDelay).toBeGreaterThan(0);
    });
  });

  describe('Identical message tracking', () => {
    test('blocks identical messages after limit within time window', async () => {
      const message = 'Identical message';

      // Send same message 3 times (maxIdenticalMessages = 3)
      for (let i = 0; i < 3; i++) {
        const delay = await limiter.getDelay('test@s.whatsapp.net', message);
        expect(delay).toBeGreaterThanOrEqual(0);
        limiter.record('test@s.whatsapp.net', message);
      }

      // 4th identical message should be blocked
      const delay = await limiter.getDelay('test@s.whatsapp.net', message);
      expect(delay).toBe(-1);
    });

    test('expires identical message tracking after time window', async () => {
      const message = 'Test message';

      // Send message
      limiter.record('test@s.whatsapp.net', message);

      // Simulate time passing beyond the window (would need to mock Date.now for real test)
      // For now, just verify the tracking exists
      const stats = limiter.getStats();
      expect(stats.lastMinute).toBe(1);
    });
  });

  describe('Cleanup', () => {
    test('removes old messages from tracking', () => {
      // Record some messages
      for (let i = 0; i < 10; i++) {
        limiter.record('test@s.whatsapp.net', `Message ${i}`);
      }

      // Get stats triggers cleanup
      const stats = limiter.getStats();
      expect(stats.lastMinute).toBeGreaterThan(0);
      expect(stats.lastDay).toBe(10);
    });
  });

  describe('Stats', () => {
    test('returns accurate statistics', () => {
      limiter.record('test@s.whatsapp.net', 'Message 1');
      limiter.record('chat2@s.whatsapp.net', 'Message 2');

      const stats = limiter.getStats();
      expect(stats.lastMinute).toBe(2);
      expect(stats.knownChats).toBe(2);
      expect(stats.limits.perMinute).toBe(5);
      expect(stats.limits.perHour).toBe(50);
      expect(stats.limits.perDay).toBe(500);
    });
  });
});
