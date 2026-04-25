/**
 * Message Recovery Smoke Tests
 *
 * Standalone test suite to verify messageRecovery module behavior
 * under realistic disconnect/reconnect scenarios with mocked Baileys events.
 *
 * Run: npx vitest run tests/messageRecovery.smoke.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { messageRecovery } from '../src/messageRecovery';
import type { MessageRecoveryConfig, MessageRecoveryHandle } from '../src/messageRecovery';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

// Mock socket helper
interface MockSocket {
  ev: {
    on: (event: string, handler: Function) => void;
    off: (event: string, handler: Function) => void;
    process?: (handler: Function) => void;
  };
  fetchMessageHistory?: (jid: string, count: number, cursor?: any) => Promise<any[]>;
}

function createMockSocket(opts?: { withFetchHistory?: boolean }): MockSocket {
  const listeners = new Map<string, Set<Function>>();

  const ev = {
    on(event: string, handler: Function) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
    },
    off(event: string, handler: Function) {
      listeners.get(event)?.delete(handler);
    },
    // Fire an event manually for testing
    emit(event: string, data: any) {
      listeners.get(event)?.forEach(fn => fn(data));
    }
  };

  const sock: any = { ev };

  if (opts?.withFetchHistory) {
    sock.fetchMessageHistory = vi.fn().mockResolvedValue([]);
  }

  return sock as MockSocket & { ev: { emit: Function } };
}

describe('messageRecovery smoke tests', () => {
  let mockSock: MockSocket & { ev: { emit: Function } };
  let handle: MessageRecoveryHandle;
  let onGapFilled: any;
  let onGapTooLarge: any;
  let onRecoveryComplete: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSock = createMockSocket({ withFetchHistory: true });
    onGapFilled = vi.fn();
    onGapTooLarge = vi.fn();
    onRecoveryComplete = vi.fn();
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
    }
    vi.useRealTimers();

    // Cleanup temp files
    try {
      await fs.unlink('/tmp/recovery-test.json').catch(() => {});
      await fs.unlink('/tmp/recovery-test-2.json').catch(() => {});
    } catch {}
  });

  it('1. Tracks lastSeen on messages.upsert (type: notify)', () => {
    handle = messageRecovery(mockSock, { onGapFilled });

    // Fire messages.upsert with type: notify
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm1' },
        messageTimestamp: 1000
      }]
    });

    const stats = handle.getStats();
    expect(stats.trackedChats).toBe(1);
  });

  it('2. Ignores type: append', () => {
    handle = messageRecovery(mockSock, { onGapFilled });

    // Fire messages.upsert with type: append
    mockSock.ev.emit('messages.upsert', {
      type: 'append',
      messages: [{
        key: { remoteJid: 'chatY@s.whatsapp.net', id: 'm2' },
        messageTimestamp: 2000
      }]
    });

    const stats = handle.getStats();
    expect(stats.trackedChats).toBe(0);
  });

  it('3. Disconnect → reconnect triggers recovery', async () => {
    handle = messageRecovery(mockSock, {
      onGapFilled,
      onRecoveryComplete
    });

    // Track message m1 at timestamp 1000
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm1' },
        messageTimestamp: 1000
      }]
    });

    // Mock fetchMessageHistory to return m2 (newer message)
    (mockSock.fetchMessageHistory as any).mockResolvedValue([
      {
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm2' },
        messageTimestamp: 1500
      }
    ]);

    // Fire disconnect
    mockSock.ev.emit('connection.update', { connection: 'close' });

    // Advance time slightly (simulate network delay)
    await vi.advanceTimersByTimeAsync(100);

    // Fire reconnect
    mockSock.ev.emit('connection.update', { connection: 'open' });

    // Wait for async recovery to complete
    await vi.runAllTimersAsync();

    // Assert onGapFilled called with m2
    expect(onGapFilled).toHaveBeenCalledTimes(1);
    expect(onGapFilled).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({ id: 'm2' }),
        messageTimestamp: 1500
      }),
      'chatX@s.whatsapp.net'
    );

    // Assert onRecoveryComplete called
    expect(onRecoveryComplete).toHaveBeenCalledTimes(1);
    expect(onRecoveryComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        chats: 1,
        recovered: 1,
        durationMs: expect.any(Number)
      })
    );

    // Verify lastSeen advanced
    const stats = handle.getStats();
    expect(stats.totalRecovered).toBe(1);
  });

  it('4. Gap-too-large fires when disconnect > maxGapMs', async () => {
    handle = messageRecovery(mockSock, {
      onGapFilled,
      onGapTooLarge,
      onRecoveryComplete,
      maxGapMs: 100
    });

    // Track a message
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm1' },
        messageTimestamp: 1000
      }]
    });

    // Fire disconnect
    mockSock.ev.emit('connection.update', { connection: 'close' });

    // Advance time past maxGapMs
    await vi.advanceTimersByTimeAsync(200);

    // Fire reconnect
    mockSock.ev.emit('connection.update', { connection: 'open' });
    await vi.runAllTimersAsync();

    // Assert onGapTooLarge called
    expect(onGapTooLarge).toHaveBeenCalledTimes(1);
    expect(onGapTooLarge).toHaveBeenCalledWith(expect.any(Number));
    const gapMs = onGapTooLarge.mock.calls[0][0];
    expect(gapMs).toBeGreaterThanOrEqual(100);

    // Assert onGapFilled NOT called
    expect(onGapFilled).not.toHaveBeenCalled();
  });

  it('5. No fetchMessageHistory → graceful degradation', async () => {
    // Create socket WITHOUT fetchMessageHistory
    mockSock = createMockSocket({ withFetchHistory: false });

    const logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    };

    handle = messageRecovery(mockSock, {
      onGapFilled,
      onRecoveryComplete,
      logger
    });

    // Track message
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm1' },
        messageTimestamp: 1000
      }]
    });

    // Disconnect/reconnect cycle 1
    mockSock.ev.emit('connection.update', { connection: 'close' });
    await vi.advanceTimersByTimeAsync(100);
    mockSock.ev.emit('connection.update', { connection: 'open' });
    await vi.runAllTimersAsync();

    // Assert no throw
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('fetchMessageHistory not available')
    );
    expect(onRecoveryComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        chats: 0,
        recovered: 0
      })
    );

    // Second cycle — warning should NOT appear again
    logger.warn.mockClear();
    mockSock.ev.emit('connection.update', { connection: 'close' });
    await vi.advanceTimersByTimeAsync(100);
    mockSock.ev.emit('connection.update', { connection: 'open' });
    await vi.runAllTimersAsync();

    // Verify warning was NOT logged again (loggedFetchWarning flag)
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('6. LRU eviction at maxTrackedChats', () => {
    handle = messageRecovery(mockSock, {
      onGapFilled,
      maxTrackedChats: 3
    });

    // Fire 5 different chats
    for (const chat of ['A', 'B', 'C', 'D', 'E']) {
      mockSock.ev.emit('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: `chat${chat}@s.whatsapp.net`, id: 'm1' },
          messageTimestamp: 1000
        }]
      });
    }

    const stats = handle.getStats();
    expect(stats.trackedChats).toBe(3);
    // Oldest entries (A, B) should be evicted, keeping C, D, E
  });

  it('7. stop() cleans up', async () => {
    handle = messageRecovery(mockSock, {
      onGapFilled,
      onRecoveryComplete
    });

    // Track message
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm1' },
        messageTimestamp: 1000
      }]
    });

    // Mock fetchMessageHistory
    (mockSock.fetchMessageHistory as any).mockResolvedValue([
      {
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm2' },
        messageTimestamp: 1500
      }
    ]);

    // Stop the handle
    await handle.stop();

    // Fire disconnect/reconnect cycle
    mockSock.ev.emit('connection.update', { connection: 'close' });
    await vi.advanceTimersByTimeAsync(100);
    mockSock.ev.emit('connection.update', { connection: 'open' });
    await vi.runAllTimersAsync();

    // Assert recovery NOT triggered
    expect(onGapFilled).not.toHaveBeenCalled();
    expect(onRecoveryComplete).not.toHaveBeenCalled();
  });

  it('8. Persistence load on init', async () => {
    // Write seed file
    const seedData = {
      "chatA@s.whatsapp.net": {
        "id": "seed1",
        "timestamp": 999
      }
    };
    await fs.writeFile('/tmp/recovery-test.json', JSON.stringify(seedData), 'utf-8');

    // Init recovery with persistPath
    handle = messageRecovery(mockSock, {
      onGapFilled,
      persistPath: '/tmp/recovery-test.json'
    });

    const stats = handle.getStats();
    expect(stats.trackedChats).toBe(1);
  });

  it('9. Persistence save on disconnect', async () => {
    handle = messageRecovery(mockSock, {
      onGapFilled,
      persistPath: '/tmp/recovery-test-2.json',
      persistDebounceMs: 50
    });

    // Track message
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm1' },
        messageTimestamp: 1000
      }]
    });

    // Advance past debounce time
    await vi.advanceTimersByTimeAsync(60);

    // Read file back
    const raw = await fs.readFile('/tmp/recovery-test-2.json', 'utf-8');
    const data = JSON.parse(raw);

    expect(data).toHaveProperty('chatX@s.whatsapp.net');
    expect(data['chatX@s.whatsapp.net']).toEqual({
      id: 'm1',
      timestamp: 1000
    });
  });

  it('10. Timestamp as string handled', async () => {
    handle = messageRecovery(mockSock, {
      onGapFilled,
      onRecoveryComplete
    });

    // Track message with string timestamp (some Baileys versions)
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm1' },
        messageTimestamp: '1000' // String instead of number
      }]
    });

    const stats = handle.getStats();
    expect(stats.trackedChats).toBe(1);

    // Mock fetchMessageHistory with newer string timestamp
    (mockSock.fetchMessageHistory as any).mockResolvedValue([
      {
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm2' },
        messageTimestamp: '1500' // String
      }
    ]);

    // Disconnect/reconnect
    mockSock.ev.emit('connection.update', { connection: 'close' });
    await vi.advanceTimersByTimeAsync(100);
    mockSock.ev.emit('connection.update', { connection: 'open' });
    await vi.runAllTimersAsync();

    // Assert recovery triggered correctly
    expect(onGapFilled).toHaveBeenCalledTimes(1);
    expect(onRecoveryComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        recovered: 1
      })
    );
  });

  it('11. fromMe messages are skipped', () => {
    handle = messageRecovery(mockSock, { onGapFilled });

    // Fire message from self
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: {
          remoteJid: 'chatX@s.whatsapp.net',
          id: 'm1',
          fromMe: true // Self-message
        },
        messageTimestamp: 1000
      }]
    });

    const stats = handle.getStats();
    expect(stats.trackedChats).toBe(0); // Should be ignored
  });

  it('12. Multiple chats recovered in parallel', async () => {
    handle = messageRecovery(mockSock, {
      onGapFilled,
      onRecoveryComplete
    });

    // Track messages from 3 chats
    for (const chat of ['A', 'B', 'C']) {
      mockSock.ev.emit('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: `chat${chat}@s.whatsapp.net`, id: 'm1' },
          messageTimestamp: 1000
        }]
      });
    }

    // Mock fetchMessageHistory to return 1 new message per chat
    (mockSock.fetchMessageHistory as any).mockImplementation((jid: string) => {
      return Promise.resolve([{
        key: { remoteJid: jid, id: 'm2' },
        messageTimestamp: 1500
      }]);
    });

    // Disconnect/reconnect
    mockSock.ev.emit('connection.update', { connection: 'close' });
    await vi.advanceTimersByTimeAsync(100);
    mockSock.ev.emit('connection.update', { connection: 'open' });
    await vi.runAllTimersAsync();

    // Assert 3 messages recovered
    expect(onGapFilled).toHaveBeenCalledTimes(3);
    expect(onRecoveryComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        chats: 3,
        recovered: 3
      })
    );
  });

  it('13. markSeen API updates tracking', () => {
    handle = messageRecovery(mockSock, { onGapFilled });

    // Manually mark a message as seen
    handle.markSeen('chatManual@s.whatsapp.net', 'manual1', 5000);

    const stats = handle.getStats();
    expect(stats.trackedChats).toBe(1);
  });

  it('14. Messages sorted chronologically during recovery', async () => {
    handle = messageRecovery(mockSock, {
      onGapFilled,
      onRecoveryComplete
    });

    // Track oldest message
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: 'chatX@s.whatsapp.net', id: 'm1' },
        messageTimestamp: 1000
      }]
    });

    // Mock fetchMessageHistory to return messages OUT OF ORDER
    (mockSock.fetchMessageHistory as any).mockResolvedValue([
      { key: { id: 'm4' }, messageTimestamp: 4000 },
      { key: { id: 'm2' }, messageTimestamp: 2000 },
      { key: { id: 'm3' }, messageTimestamp: 3000 }
    ]);

    // Disconnect/reconnect
    mockSock.ev.emit('connection.update', { connection: 'close' });
    await vi.advanceTimersByTimeAsync(100);
    mockSock.ev.emit('connection.update', { connection: 'open' });
    await vi.runAllTimersAsync();

    // Assert messages delivered in chronological order
    expect(onGapFilled).toHaveBeenCalledTimes(3);
    expect(onGapFilled.mock.calls[0][0].key.id).toBe('m2');
    expect(onGapFilled.mock.calls[1][0].key.id).toBe('m3');
    expect(onGapFilled.mock.calls[2][0].key.id).toBe('m4');
  });

  it('15. Recovery error per-chat logged but does not stop other chats', async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    };

    handle = messageRecovery(mockSock, {
      onGapFilled,
      onRecoveryComplete,
      logger
    });

    // Track 2 chats
    mockSock.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [
        { key: { remoteJid: 'chatA@s.whatsapp.net', id: 'm1' }, messageTimestamp: 1000 },
        { key: { remoteJid: 'chatB@s.whatsapp.net', id: 'm1' }, messageTimestamp: 1000 }
      ]
    });

    // Mock fetchMessageHistory to fail for chatA, succeed for chatB
    (mockSock.fetchMessageHistory as any).mockImplementation((jid: string) => {
      if (jid === 'chatA@s.whatsapp.net') {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve([
        { key: { remoteJid: jid, id: 'm2' }, messageTimestamp: 1500 }
      ]);
    });

    // Disconnect/reconnect
    mockSock.ev.emit('connection.update', { connection: 'close' });
    await vi.advanceTimersByTimeAsync(100);
    mockSock.ev.emit('connection.update', { connection: 'open' });
    await vi.runAllTimersAsync();

    // Assert error logged for chatA
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('chatA@s.whatsapp.net')
    );

    // Assert chatB still recovered
    expect(onGapFilled).toHaveBeenCalledTimes(1);
    expect(onGapFilled).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({
          remoteJid: 'chatB@s.whatsapp.net'
        })
      }),
      'chatB@s.whatsapp.net'
    );
  });
});
