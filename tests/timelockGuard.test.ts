import { TimelockGuard } from '../src/timelockGuard.js';

describe('TimelockGuard', () => {
  let guard: TimelockGuard;

  beforeEach(() => {
    guard = new TimelockGuard({
      resumeBufferMs: 1000, // 1 second buffer for testing
    });
  });

  describe('Initial state', () => {
    test('is not timelocked initially', () => {
      expect(guard.isTimelocked()).toBe(false);
    });

    test('allows new contacts initially', () => {
      const result = guard.canSend('new-contact@s.whatsapp.net');
      expect(result.allowed).toBe(true);
    });

    test('returns inactive state', () => {
      const state = guard.getState();
      expect(state.isActive).toBe(false);
      expect(state.errorCount).toBe(0);
    });
  });

  describe('463 error detection', () => {
    test('activates timelock on 463 error', () => {
      guard.record463Error();
      expect(guard.isTimelocked()).toBe(true);
    });

    test('increments error count', () => {
      guard.record463Error();
      guard.record463Error();
      const state = guard.getState();
      expect(state.errorCount).toBe(2);
    });

    test('sets default 60s expiry when no MEX data available', () => {
      guard.record463Error();
      const state = guard.getState();
      expect(state.expiresAt).toBeDefined();
      expect(state.expiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(state.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 61000);
    });

    test('fires onTimelockDetected callback', () => {
      const onDetected = jest.fn();
      const customGuard = new TimelockGuard({
        onTimelockDetected: onDetected,
      });

      customGuard.record463Error();
      expect(onDetected).toHaveBeenCalledTimes(1);
      expect(onDetected).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
          errorCount: expect.any(Number),
        })
      );
    });
  });

  describe('MEX update handling', () => {
    test('activates timelock from MEX data', () => {
      guard.onTimelockUpdate({
        isActive: true,
        enforcementType: 'reachout',
        timeEnforcementEnds: new Date(Date.now() + 120000),
      });

      expect(guard.isTimelocked()).toBe(true);
      const state = guard.getState();
      expect(state.enforcementType).toBe('reachout');
      expect(state.expiresAt).toBeDefined();
    });

    test('deactivates timelock from MEX data', () => {
      guard.record463Error();
      expect(guard.isTimelocked()).toBe(true);

      guard.onTimelockUpdate({ isActive: false });
      expect(guard.isTimelocked()).toBe(false);
    });

    test('fires callbacks on state changes', () => {
      const onDetected = jest.fn();
      const onLifted = jest.fn();
      const customGuard = new TimelockGuard({
        onTimelockDetected: onDetected,
        onTimelockLifted: onLifted,
      });

      customGuard.onTimelockUpdate({
        isActive: true,
        timeEnforcementEnds: new Date(Date.now() + 60000),
      });
      expect(onDetected).toHaveBeenCalledTimes(1);

      customGuard.onTimelockUpdate({ isActive: false });
      expect(onLifted).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message routing when timelocked', () => {
    beforeEach(() => {
      guard.record463Error(); // Activate timelock
    });

    test('blocks new contacts', () => {
      const result = guard.canSend('new-contact@s.whatsapp.net');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('timelocked');
    });

    test('allows known chats', () => {
      guard.registerKnownChat('known-user@s.whatsapp.net');
      const result = guard.canSend('known-user@s.whatsapp.net');
      expect(result.allowed).toBe(true);
    });

    test('allows group chats', () => {
      const result = guard.canSend('123456789@g.us');
      expect(result.allowed).toBe(true);
    });

    test('allows newsletter chats', () => {
      const result = guard.canSend('newsletter123@newsletter');
      expect(result.allowed).toBe(true);
    });

    test('bulk register known chats', () => {
      guard.registerKnownChats([
        'user1@s.whatsapp.net',
        'user2@s.whatsapp.net',
        'user3@s.whatsapp.net',
      ]);

      expect(guard.canSend('user1@s.whatsapp.net').allowed).toBe(true);
      expect(guard.canSend('user2@s.whatsapp.net').allowed).toBe(true);
      expect(guard.canSend('user3@s.whatsapp.net').allowed).toBe(true);
    });
  });

  describe('Auto-expiry', () => {
    test('auto-lifts when expiry time passes', async () => {
      // Set timelock that expires in 100ms
      guard.onTimelockUpdate({
        isActive: true,
        timeEnforcementEnds: new Date(Date.now() + 100),
      });

      expect(guard.isTimelocked()).toBe(true);

      // Wait for expiry + buffer (100ms + 1000ms buffer)
      await new Promise(resolve => setTimeout(resolve, 1200));

      // Should auto-lift when checked
      const result = guard.canSend('new-contact@s.whatsapp.net');
      expect(result.allowed).toBe(true);
      expect(guard.isTimelocked()).toBe(false);
    });

    test('respects resume buffer', async () => {
      const customGuard = new TimelockGuard({
        resumeBufferMs: 500,
      });

      customGuard.onTimelockUpdate({
        isActive: true,
        timeEnforcementEnds: new Date(Date.now() + 100),
      });

      // After 200ms (past expiry but before buffer)
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(customGuard.isTimelocked()).toBe(true);

      // After 700ms (past expiry + buffer)
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(customGuard.isTimelocked()).toBe(false);
    });
  });

  describe('Manual control', () => {
    test('lift() manually deactivates timelock', () => {
      guard.record463Error();
      expect(guard.isTimelocked()).toBe(true);

      guard.lift();
      expect(guard.isTimelocked()).toBe(false);
    });

    test('lift() fires onTimelockLifted callback', () => {
      const onLifted = jest.fn();
      const customGuard = new TimelockGuard({
        onTimelockLifted: onLifted,
      });

      customGuard.record463Error();
      customGuard.lift();

      expect(onLifted).toHaveBeenCalledTimes(1);
    });

    test('reset() clears all state', () => {
      guard.record463Error();
      guard.registerKnownChat('user@s.whatsapp.net');

      expect(guard.isTimelocked()).toBe(true);
      expect(guard.getKnownChats().size).toBe(1);

      guard.reset();

      expect(guard.isTimelocked()).toBe(false);
      expect(guard.getKnownChats().size).toBe(0);
      expect(guard.getState().errorCount).toBe(0);
    });
  });

  describe('Timer race condition prevention', () => {
    test('prevents stale timer callbacks', async () => {
      const onLifted = jest.fn();
      const customGuard = new TimelockGuard({
        resumeBufferMs: 0,
        onTimelockLifted: onLifted,
      });

      // Set first timelock with 100ms expiry
      customGuard.onTimelockUpdate({
        isActive: true,
        timeEnforcementEnds: new Date(Date.now() + 100),
      });

      // Immediately set second timelock with 200ms expiry
      customGuard.onTimelockUpdate({
        isActive: true,
        timeEnforcementEnds: new Date(Date.now() + 200),
      });

      // Wait past first timer (should be invalidated)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should still be locked (second timer hasn't fired)
      expect(customGuard.isTimelocked()).toBe(true);

      // Wait for second timer
      await new Promise(resolve => setTimeout(resolve, 100));

      // Now should be unlocked
      expect(customGuard.isTimelocked()).toBe(false);

      // Callback should only fire once (for the valid timer)
      expect(onLifted).toHaveBeenCalledTimes(1);
    }, 10000);

    test('clearResumeTimer prevents callback after lift()', async () => {
      const onLifted = jest.fn();
      const customGuard = new TimelockGuard({
        resumeBufferMs: 0,
        onTimelockLifted: onLifted,
      });

      customGuard.onTimelockUpdate({
        isActive: true,
        timeEnforcementEnds: new Date(Date.now() + 100),
      });

      // Manually lift before timer fires
      customGuard.lift();
      expect(onLifted).toHaveBeenCalledTimes(1);

      // Wait past the original timer
      await new Promise(resolve => setTimeout(resolve, 150));

      // Callback should not fire again
      expect(onLifted).toHaveBeenCalledTimes(1);
    });
  });

  describe('Known chats management', () => {
    test('getKnownChats returns copy of set', () => {
      guard.registerKnownChat('user1@s.whatsapp.net');
      const chats1 = guard.getKnownChats();
      const chats2 = guard.getKnownChats();

      // Should be different Set instances
      expect(chats1).not.toBe(chats2);
      // But with same contents
      expect(chats1.size).toBe(chats2.size);
      expect(chats1.has('user1@s.whatsapp.net')).toBe(true);
    });

    test('tracks multiple known chats', () => {
      guard.registerKnownChat('user1@s.whatsapp.net');
      guard.registerKnownChat('user2@s.whatsapp.net');
      guard.registerKnownChat('group@g.us');

      const chats = guard.getKnownChats();
      expect(chats.size).toBe(3);
      expect(chats.has('user1@s.whatsapp.net')).toBe(true);
      expect(chats.has('user2@s.whatsapp.net')).toBe(true);
      expect(chats.has('group@g.us')).toBe(true);
    });
  });

  describe('State inspection', () => {
    test('getState returns complete state snapshot', () => {
      guard.onTimelockUpdate({
        isActive: true,
        enforcementType: 'reachout',
        timeEnforcementEnds: new Date(Date.now() + 60000),
      });

      const state = guard.getState();
      expect(state.isActive).toBe(true);
      expect(state.enforcementType).toBe('reachout');
      expect(state.expiresAt).toBeInstanceOf(Date);
      expect(state.detectedAt).toBeInstanceOf(Date);
      expect(state.errorCount).toBe(0);
    });

    test('getState returns copy not reference', () => {
      const state1 = guard.getState();
      const state2 = guard.getState();
      expect(state1).not.toBe(state2);
    });
  });
});
