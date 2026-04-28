import {
  getStealthSocketConfig,
  rampPresenceAfterConnect,
  STEALTH_BROWSER_POOL,
  AbortError,
} from '../src/stealthConnect.js';

describe('stealthConnect', () => {
  describe('getStealthSocketConfig', () => {
    test('returns config with markOnlineOnConnect=false', () => {
      const config = getStealthSocketConfig();
      expect(config.markOnlineOnConnect).toBe(false);
    });

    test('default browser tuple is picked from STEALTH_BROWSER_POOL', () => {
      const config = getStealthSocketConfig();
      expect(config.browser).toHaveLength(3);
      const isFromPool = STEALTH_BROWSER_POOL.some(
        (tuple) =>
          tuple[0] === config.browser[0] &&
          tuple[1] === config.browser[1] &&
          tuple[2] === config.browser[2]
      );
      expect(isFromPool).toBe(true);
    });

    test('explicit browser opt overrides pool', () => {
      const config = getStealthSocketConfig({
        browser: ['CustomApp', 'CustomBrowser', '1.2.3'],
      });
      expect(config.browser).toEqual(['CustomApp', 'CustomBrowser', '1.2.3']);
    });

    test('os opt rewrites first slot of randomly picked tuple', () => {
      const config = getStealthSocketConfig({ os: 'MyApp' });
      expect(config.browser[0]).toBe('MyApp');
      const isBrowserVersionFromPool = STEALTH_BROWSER_POOL.some(
        (tuple) => tuple[1] === config.browser[1] && tuple[2] === config.browser[2]
      );
      expect(isBrowserVersionFromPool).toBe(true);
    });

    test('explicit browser takes precedence over os', () => {
      const config = getStealthSocketConfig({
        os: 'IgnoredOs',
        browser: ['ExplicitApp', 'ExplicitBrowser', '9.9.9'],
      });
      expect(config.browser).toEqual([
        'ExplicitApp',
        'ExplicitBrowser',
        '9.9.9',
      ]);
    });

    test('custom random function is honoured', () => {
      // Force the random pick to always select index 0.
      const config = getStealthSocketConfig({ random: () => 0 });
      expect(config.browser).toEqual(STEALTH_BROWSER_POOL[0]);
    });
  });

  describe('rampPresenceAfterConnect', () => {
    test('calls sendPresenceUpdate with default state after delay window', async () => {
      jest.useFakeTimers();
      const sock = { sendPresenceUpdate: jest.fn() };

      const promise = rampPresenceAfterConnect(sock, {
        minDelayMs: 1000,
        maxDelayMs: 2000,
        random: () => 1,
      });

      expect(sock.sendPresenceUpdate).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2000);
      await promise;

      expect(sock.sendPresenceUpdate).toHaveBeenCalledWith(
        'available',
        undefined
      );
      jest.useRealTimers();
    });

    test('respects custom targetState', async () => {
      jest.useFakeTimers();
      const sock = { sendPresenceUpdate: jest.fn() };

      const promise = rampPresenceAfterConnect(sock, {
        minDelayMs: 100,
        maxDelayMs: 200,
        targetState: 'unavailable',
        random: () => 0.5,
      });

      jest.advanceTimersByTime(200);
      await promise;

      expect(sock.sendPresenceUpdate).toHaveBeenCalledWith(
        'unavailable',
        undefined
      );
      jest.useRealTimers();
    });

    test('rejects immediately if signal already aborted', async () => {
      const sock = { sendPresenceUpdate: jest.fn() };
      const ac = new AbortController();
      ac.abort();

      await expect(rampPresenceAfterConnect(sock, { signal: ac.signal })).rejects.toBeInstanceOf(
        AbortError
      );
      expect(sock.sendPresenceUpdate).not.toHaveBeenCalled();
    });

    test('aborting during delay cancels the presence update', async () => {
      jest.useFakeTimers();
      const sock = { sendPresenceUpdate: jest.fn() };
      const ac = new AbortController();

      const promise = rampPresenceAfterConnect(sock, {
        minDelayMs: 5000,
        maxDelayMs: 5000,
        signal: ac.signal,
      });

      // Reach mid-delay then abort.
      jest.advanceTimersByTime(2500);
      ac.abort();

      await expect(promise).rejects.toBeInstanceOf(AbortError);
      // Even after the original timer would have fired, no presence update
      // should have been sent.
      jest.advanceTimersByTime(10000);
      expect(sock.sendPresenceUpdate).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });
});
