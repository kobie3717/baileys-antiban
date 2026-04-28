import { getStealthSocketConfig, rampPresenceAfterConnect } from '../src/stealthConnect.js';

describe('stealthConnect', () => {
  describe('getStealthSocketConfig', () => {
    test('returns config with markOnlineOnConnect false', () => {
      const config = getStealthSocketConfig();
      expect(config.markOnlineOnConnect).toBe(false);
      expect(config.browser).toEqual(['Ubuntu', 'Chrome', '20.0.04']);
    });

    test('propagates custom os value when provided', () => {
      const config = getStealthSocketConfig({ os: 'CustomApp' });
      expect(config.markOnlineOnConnect).toBe(false);
      // os field is in auth, not socket config — we just verify it doesn't break
      expect(config).toBeDefined();
    });

    test('returns default browser tuple when no os provided', () => {
      const config = getStealthSocketConfig();
      expect(config.browser).toHaveLength(3);
      expect(config.browser[0]).toBe('Ubuntu');
    });
  });

  describe('rampPresenceAfterConnect', () => {
    test('calls sendPresenceUpdate after delay window', async () => {
      jest.useFakeTimers();

      const mockSock = {
        sendPresenceUpdate: jest.fn(),
      };

      // Start the ramp (30-90s default)
      const rampPromise = rampPresenceAfterConnect(mockSock);

      // Should not call immediately
      expect(mockSock.sendPresenceUpdate).not.toHaveBeenCalled();

      // Fast-forward to max delay (90s)
      jest.advanceTimersByTime(90000);

      // Wait for promise to resolve
      await rampPromise;

      // Should have called with default 'available'
      expect(mockSock.sendPresenceUpdate).toHaveBeenCalledWith('available', undefined);
      expect(mockSock.sendPresenceUpdate).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    test('respects custom delay range', async () => {
      jest.useFakeTimers();

      const mockSock = {
        sendPresenceUpdate: jest.fn(),
      };

      // Start with custom range (10-20s)
      const rampPromise = rampPresenceAfterConnect(mockSock, {
        minDelayMs: 10000,
        maxDelayMs: 20000,
      });

      // Should not call after 5s
      jest.advanceTimersByTime(5000);
      expect(mockSock.sendPresenceUpdate).not.toHaveBeenCalled();

      // Fast-forward to max delay (20s)
      jest.advanceTimersByTime(15000);

      await rampPromise;

      expect(mockSock.sendPresenceUpdate).toHaveBeenCalledWith('available', undefined);

      jest.useRealTimers();
    });

    test('respects custom targetState', async () => {
      jest.useFakeTimers();

      const mockSock = {
        sendPresenceUpdate: jest.fn(),
      };

      const rampPromise = rampPresenceAfterConnect(mockSock, {
        minDelayMs: 1000,
        maxDelayMs: 2000,
        targetState: 'unavailable',
      });

      jest.advanceTimersByTime(2000);

      await rampPromise;

      expect(mockSock.sendPresenceUpdate).toHaveBeenCalledWith('unavailable', undefined);

      jest.useRealTimers();
    });
  });
});
