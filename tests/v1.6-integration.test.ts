import { wrapSocket } from '../src/wrapper.js';
import { AntiBan } from '../src/antiban.js';

describe('v1.6 Integration — LID/PN Canonicalization', () => {
  test('wrapper canonicalizes outbound JID when enabled', async () => {
    // Create mock socket
    const mockSocket: any = {
      sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg123' } }),
      ev: {
        process: jest.fn(),
        on: jest.fn(),
      },
    };

    // Wrap with jidCanonicalizer enabled
    const safeSock = wrapSocket(mockSocket, {
      jidCanonicalizer: {
        enabled: true,
        resolverConfig: { canonical: 'pn' },
      },
    });

    // Simulate incoming message with LID + PN info
    const upsert = {
      messages: [
        {
          key: {
            remoteJid: 'group@g.us',
            participant: '123456789@lid',
            participantPn: '27825651069@s.whatsapp.net',
            fromMe: false,
          },
          message: { conversation: 'Hello' },
        },
      ],
    };

    // Trigger learning via ev.process
    const processCallback = mockSocket.ev.process.mock.calls[0]?.[0];
    if (processCallback) {
      await processCallback({ 'messages.upsert': upsert });
    }

    // Send message to LID form — should be canonicalized to PN
    await safeSock.sendMessage('123456789@lid', { text: 'Reply' });

    // Verify underlying socket received PN form
    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      '27825651069@s.whatsapp.net',
      { text: 'Reply' },
      undefined
    );

    // Verify stats
    const stats = safeSock.antiban.getStats();
    expect(stats.jidCanonicalizer?.inboundLearned).toBe(1);
    expect(stats.jidCanonicalizer?.outboundCanonicalized).toBe(1);

    safeSock.antiban.destroy();
  });

  test('wrapper does nothing when jidCanonicalizer disabled', async () => {
    const mockSocket: any = {
      sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg123' } }),
      ev: {
        process: jest.fn(),
        on: jest.fn(),
      },
    };

    const safeSock = wrapSocket(mockSocket, {
      jidCanonicalizer: {
        enabled: false, // Disabled
      },
    });

    // Send message with LID form
    await safeSock.sendMessage('123456789@lid', { text: 'Reply' });

    // Should pass through unchanged
    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      '123456789@lid',
      { text: 'Reply' },
      undefined
    );

    safeSock.antiban.destroy();
  });

  test('wrapper handles ev.on fallback path', async () => {
    const mockSocket: any = {
      sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg123' } }),
      ev: {
        on: jest.fn(), // No process method — use ev.on fallback
      },
    };

    const safeSock = wrapSocket(mockSocket, {
      jidCanonicalizer: {
        enabled: true,
        resolverConfig: { canonical: 'pn' },
      },
    });

    // Find the messages.upsert handler
    const upsertHandlerCall = mockSocket.ev.on.mock.calls.find(
      (call: any[]) => call[0] === 'messages.upsert'
    );
    expect(upsertHandlerCall).toBeTruthy();

    const upsertHandler = upsertHandlerCall[1];

    // Simulate event
    const upsert = {
      messages: [
        {
          key: {
            participant: '123456789@lid',
            participantPn: '27825651069@s.whatsapp.net',
            fromMe: false,
          },
          message: { conversation: 'Hello' },
        },
      ],
    };

    upsertHandler(upsert);

    // Send to LID form
    await safeSock.sendMessage('123456789@lid', { text: 'Reply' });

    // Should canonicalize to PN
    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      '27825651069@s.whatsapp.net',
      { text: 'Reply' },
      undefined
    );

    safeSock.antiban.destroy();
  });

  test('AntiBan exposes lidResolver and jidCanonicalizer getters', () => {
    const antiban = new AntiBan({
      jidCanonicalizer: { enabled: true },
    });

    expect(antiban.lidResolver).toBeTruthy();
    expect(antiban.jidCanonicalizer).toBeTruthy();

    antiban.destroy();
  });

  test('AntiBan with standalone lidResolver (no canonicalizer)', () => {
    const antiban = new AntiBan({
      lidResolver: { canonical: 'pn' },
    });

    expect(antiban.lidResolver).toBeTruthy();
    expect(antiban.jidCanonicalizer).toBeNull();

    // Should be usable directly
    antiban.lidResolver?.learn({
      lid: '123@lid',
      pn: '123@s.whatsapp.net',
    });

    expect(antiban.lidResolver?.getStats().totalMappings).toBe(1);

    antiban.destroy();
  });

  test('AntiBan shares resolver between canonicalizer and standalone', () => {
    const antiban = new AntiBan({
      lidResolver: { canonical: 'pn' },
      jidCanonicalizer: { enabled: true },
    });

    // Both should reference same resolver
    expect(antiban.lidResolver).toBe(antiban.jidCanonicalizer?.resolver);

    antiban.lidResolver?.learn({
      lid: '123@lid',
      pn: '123@s.whatsapp.net',
    });

    // Learning via resolver should be visible in canonicalizer
    const canonical = antiban.jidCanonicalizer?.canonicalizeTarget('123@lid');
    expect(canonical).toBe('123@s.whatsapp.net');

    antiban.destroy();
  });

  test('wrapper canonicalizes target before beforeSend checks', async () => {
    const mockSocket: any = {
      sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg123' } }),
      ev: { process: jest.fn(), on: jest.fn() },
    };

    const safeSock = wrapSocket(mockSocket, {
      jidCanonicalizer: { enabled: true },
    });

    // Pre-seed mapping
    safeSock.antiban.lidResolver?.learn({
      lid: '123@lid',
      pn: '123@s.whatsapp.net',
    });

    // Register as known chat (using PN form)
    safeSock.antiban.timelock.registerKnownChat('123@s.whatsapp.net');

    // Send to LID form — should canonicalize before timelock check
    await safeSock.sendMessage('123@lid', { text: 'Hello' });

    // Should succeed (known chat via canonical form)
    expect(mockSocket.sendMessage).toHaveBeenCalled();

    safeSock.antiban.destroy();
  });

  test('stats include jidCanonicalizer when enabled', () => {
    const antiban = new AntiBan({
      jidCanonicalizer: { enabled: true },
    });

    const stats = antiban.getStats();
    expect(stats.jidCanonicalizer).toBeTruthy();
    expect(stats.lidResolver).toBeTruthy();

    antiban.destroy();
  });

  test('stats exclude jidCanonicalizer when disabled', () => {
    const antiban = new AntiBan({
      jidCanonicalizer: { enabled: false },
    });

    const stats = antiban.getStats();
    expect(stats.jidCanonicalizer).toBeUndefined();
    expect(stats.lidResolver).toBeUndefined();

    antiban.destroy();
  });
});
