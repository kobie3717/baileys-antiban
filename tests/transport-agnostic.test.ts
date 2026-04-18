/**
 * Transport-agnostic smoke test
 *
 * Ensures wrapSocket works with duck-typed sockets from both baileys and baileyrs.
 * Does NOT install actual transports — just mocks the minimal required shape.
 */

import { wrapSocket } from '../src/wrapper.js';

describe('Transport-agnostic wrapper', () => {
  it('should wrap a minimal duck-typed socket', () => {
    // Mock minimal socket that matches both baileys and baileyrs
    const mockSocket = {
      sendMessage: jest.fn().mockResolvedValue({}),
      ev: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        process: jest.fn(),
      },
      user: { id: 'mock@s.whatsapp.net' },
    };

    const wrapped = wrapSocket(mockSocket);

    // Should have antiban property
    expect(wrapped.antiban).toBeDefined();
    expect(typeof wrapped.antiban.getStats).toBe('function');

    // sendMessage should still be callable
    expect(typeof wrapped.sendMessage).toBe('function');

    // Original socket properties should be preserved
    expect(wrapped.user).toEqual({ id: 'mock@s.whatsapp.net' });
    expect(wrapped.ev).toBeDefined();
  });

  it('should intercept sendMessage calls', async () => {
    const mockSocket = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: '123' }),
      ev: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        process: jest.fn(),
      },
    };

    const wrapped = wrapSocket(mockSocket);

    // Call sendMessage
    const result = await wrapped.sendMessage('1234567890@s.whatsapp.net', {
      text: 'Test message',
    });

    // Should have called original sendMessage
    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      '1234567890@s.whatsapp.net',
      { text: 'Test message' },
      undefined
    );

    // Should return original result
    expect(result).toEqual({ messageId: '123' });
  });

  it('should work with ev.process() (modern baileys/baileyrs)', () => {
    const mockSocket = {
      sendMessage: jest.fn().mockResolvedValue({}),
      ev: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        process: jest.fn(),
      },
    };

    wrapSocket(mockSocket);

    // Should have registered process handler
    expect(mockSocket.ev.process).toHaveBeenCalledTimes(1);
    expect(mockSocket.ev.process).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should fallback to ev.on() for older baileys', () => {
    const mockSocket = {
      sendMessage: jest.fn().mockResolvedValue({}),
      ev: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        // No process() — old baileys
      },
    };

    wrapSocket(mockSocket);

    // Should have registered on() handlers
    expect(mockSocket.ev.on).toHaveBeenCalledWith(
      'connection.update',
      expect.any(Function)
    );
    expect(mockSocket.ev.on).toHaveBeenCalledWith(
      'messages.update',
      expect.any(Function)
    );
    expect(mockSocket.ev.on).toHaveBeenCalledWith(
      'messages.upsert',
      expect.any(Function)
    );
  });

  it('should preserve TypeScript generics (type-level test)', () => {
    interface CustomSocket {
      sendMessage: (jid: string, content: any) => Promise<{ id: string }>;
      ev: any;
      customProp: string;
    }

    const mockSocket: CustomSocket = {
      sendMessage: jest.fn().mockResolvedValue({ id: 'msg1' }),
      ev: { on: jest.fn(), emit: jest.fn(), process: jest.fn() },
      customProp: 'custom value',
    };

    const wrapped = wrapSocket(mockSocket);

    // TypeScript should preserve custom properties
    expect(wrapped.customProp).toBe('custom value');

    // antiban should be available
    expect(wrapped.antiban).toBeDefined();
  });
});
