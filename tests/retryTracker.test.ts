import { RetryReasonTracker } from '../src/retryTracker.js';

describe('RetryReasonTracker', () => {
  let tracker: RetryReasonTracker;

  beforeEach(() => {
    tracker = new RetryReasonTracker({
      enabled: true,
      maxRetries: 5,
      spiralThreshold: 3,
    });
  });

  afterEach(() => {
    tracker.destroy();
  });

  describe('Retry reason classification', () => {
    test('classifies server_error_463', () => {
      const err = { output: { statusCode: 463 } };
      expect(tracker.classify(err)).toBe('server_error_463');
    });

    test('classifies server_error_429', () => {
      const err = { statusCode: 429 };
      expect(tracker.classify(err)).toBe('server_error_429');
    });

    test('classifies bad_mac from error message', () => {
      const err = { message: 'Error: bad mac verification failed' };
      expect(tracker.classify(err)).toBe('bad_mac');
    });

    test('classifies no_session from error message', () => {
      const err = { message: 'no session found for peer' };
      expect(tracker.classify(err)).toBe('no_session');
    });

    test('classifies invalid_key from error message', () => {
      const err = { message: 'invalid key provided' };
      expect(tracker.classify(err)).toBe('invalid_key');
    });

    test('classifies decryption_failure', () => {
      const err = { message: 'decryption failed for message' };
      expect(tracker.classify(err)).toBe('decryption_failure');
    });

    test('classifies timeout', () => {
      const err = { message: 'request timed out' };
      expect(tracker.classify(err)).toBe('timeout');
    });

    test('classifies no_route', () => {
      const err = { message: 'peer unreachable' };
      expect(tracker.classify(err)).toBe('no_route');
    });

    test('classifies node_malformed', () => {
      const err = { message: 'malformed node received' };
      expect(tracker.classify(err)).toBe('node_malformed');
    });

    test('classifies unknown for unrecognized errors', () => {
      const err = { message: 'some random error' };
      expect(tracker.classify(err)).toBe('unknown');
    });
  });

  describe('onMessageUpdate', () => {
    test('tracks retries from message updates', () => {
      const update = {
        key: { id: 'msg123' },
        status: 0,
        error: { output: { statusCode: 463 } },
      };

      tracker.onMessageUpdate(update);
      const stats = tracker.getStats();

      expect(stats.totalRetries).toBe(1);
      expect(stats.byReason.server_error_463).toBe(1);
      expect(stats.activeRetries).toBe(1);
    });

    test('ignores updates without message ID', () => {
      const update = {
        key: {},
        status: 0,
        error: { message: 'some error' },
      };

      tracker.onMessageUpdate(update);
      const stats = tracker.getStats();

      expect(stats.totalRetries).toBe(0);
    });

    test('ignores non-error updates', () => {
      const update = {
        key: { id: 'msg123' },
        status: 1, // success
      };

      tracker.onMessageUpdate(update);
      const stats = tracker.getStats();

      expect(stats.totalRetries).toBe(0);
    });
  });

  describe('Spiral detection', () => {
    test('detects retry spirals when threshold exceeded', () => {
      const onSpiral = jest.fn();
      tracker = new RetryReasonTracker({
        enabled: true,
        spiralThreshold: 3,
        onSpiral,
      });

      const update = {
        key: { id: 'msg123' },
        status: 0,
        error: { message: 'timeout' },
      };

      // Send 3 retries
      tracker.onMessageUpdate(update);
      tracker.onMessageUpdate(update);
      tracker.onMessageUpdate(update);

      expect(tracker.isSpiraling('msg123')).toBe(true);
      expect(onSpiral).toHaveBeenCalledWith('msg123', 'timeout');

      const stats = tracker.getStats();
      expect(stats.spiralsDetected).toBe(1);
    });

    test('returns false for non-spiraling messages', () => {
      expect(tracker.isSpiraling('msg999')).toBe(false);
    });
  });

  describe('clear', () => {
    test('removes message from tracking on successful send', () => {
      const update = {
        key: { id: 'msg123' },
        status: 0,
        error: { message: 'timeout' },
      };

      tracker.onMessageUpdate(update);
      expect(tracker.getStats().activeRetries).toBe(1);

      tracker.clear('msg123');
      expect(tracker.getStats().activeRetries).toBe(0);
      expect(tracker.isSpiraling('msg123')).toBe(false);
    });
  });

  describe('Stats', () => {
    test('returns accurate retry statistics', () => {
      tracker.onMessageUpdate({
        key: { id: 'msg1' },
        status: 0,
        error: { message: 'timeout' },
      });

      tracker.onMessageUpdate({
        key: { id: 'msg2' },
        status: 0,
        error: { output: { statusCode: 463 } },
      });

      tracker.onMessageUpdate({
        key: { id: 'msg1' },
        status: 0,
        error: { message: 'timeout' },
      });

      const stats = tracker.getStats();
      expect(stats.totalRetries).toBe(3);
      expect(stats.byReason.timeout).toBe(2);
      expect(stats.byReason.server_error_463).toBe(1);
      expect(stats.activeRetries).toBe(2);
      expect(stats.spiralsDetected).toBe(0);
    });

    test('counts multiple reasons for same message', () => {
      tracker.onMessageUpdate({
        key: { id: 'msg1' },
        status: 0,
        error: { message: 'timeout' },
      });

      tracker.onMessageUpdate({
        key: { id: 'msg1' },
        status: 0,
        error: { message: 'bad mac' },
      });

      const stats = tracker.getStats();
      expect(stats.totalRetries).toBe(2);
      expect(stats.byReason.timeout).toBe(1);
      expect(stats.byReason.bad_mac).toBe(1);
      expect(stats.activeRetries).toBe(1);
    });
  });

  describe('Disabled tracker', () => {
    test('does nothing when disabled', () => {
      tracker = new RetryReasonTracker({ enabled: false });

      tracker.onMessageUpdate({
        key: { id: 'msg1' },
        status: 0,
        error: { message: 'timeout' },
      });

      const stats = tracker.getStats();
      expect(stats.totalRetries).toBe(0);
      expect(stats.activeRetries).toBe(0);
    });
  });
});
