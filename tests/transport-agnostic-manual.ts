/**
 * Transport-agnostic smoke test (manual version using tsx)
 *
 * Ensures wrapSocket works with duck-typed sockets from both baileys and baileyrs.
 * Does NOT install actual transports — just mocks the minimal required shape.
 */

import { wrapSocket } from '../src/wrapper.js';

console.log('\n=== Testing Transport-Agnostic Wrapper ===\n');

// Test 1: Minimal duck-typed socket
console.log('Test 1: Wrap minimal duck-typed socket');
const mockSocket1 = {
  sendMessage: async (jid: string, content: any) => ({ messageId: 'test-123' }),
  ev: {
    on: () => {},
    off: () => {},
    emit: () => {},
    process: () => {},
  },
  user: { id: 'mock@s.whatsapp.net' },
};

const wrapped1 = wrapSocket(mockSocket1 as any);

if (!wrapped1.antiban) {
  throw new Error('❌ antiban property missing');
}
if (typeof wrapped1.antiban.getStats !== 'function') {
  throw new Error('❌ getStats method missing');
}
if (typeof wrapped1.sendMessage !== 'function') {
  throw new Error('❌ sendMessage not callable');
}
if (wrapped1.user.id !== 'mock@s.whatsapp.net') {
  throw new Error('❌ Original properties not preserved');
}
console.log('✅ Minimal socket wrapping works');

// Test 2: sendMessage interception
console.log('\nTest 2: sendMessage interception');
let sendMessageCalled = false;
const mockSocket2 = {
  sendMessage: async (jid: string, content: any) => {
    sendMessageCalled = true;
    return { messageId: '456' };
  },
  ev: {
    on: () => {},
    off: () => {},
    emit: () => {},
    process: () => {},
  },
};

const wrapped2 = wrapSocket(mockSocket2 as any);
const result = await wrapped2.sendMessage('1234567890@s.whatsapp.net', {
  text: 'Test message',
});

if (!sendMessageCalled) {
  throw new Error('❌ Original sendMessage not called');
}
if (result.messageId !== '456') {
  throw new Error('❌ Wrong result returned');
}
console.log('✅ sendMessage interception works');

// Test 3: ev.process() registration (modern baileys/baileyrs)
console.log('\nTest 3: ev.process() registration');
let processRegistered = false;
const mockSocket3 = {
  sendMessage: async () => ({}),
  ev: {
    on: () => {},
    off: () => {},
    emit: () => {},
    process: (handler: any) => {
      processRegistered = true;
      if (typeof handler !== 'function') {
        throw new Error('❌ process handler not a function');
      }
    },
  },
};

wrapSocket(mockSocket3 as any);
if (!processRegistered) {
  throw new Error('❌ process() not called');
}
console.log('✅ ev.process() handler registered');

// Test 4: ev.on() fallback (older baileys)
console.log('\nTest 4: ev.on() fallback');
const eventHandlers: string[] = [];
const mockSocket4 = {
  sendMessage: async () => ({}),
  ev: {
    on: (event: string, handler: any) => {
      eventHandlers.push(event);
      if (typeof handler !== 'function') {
        throw new Error(`❌ on('${event}') handler not a function`);
      }
    },
    off: () => {},
    emit: () => {},
    // No process() — old baileys
  },
};

wrapSocket(mockSocket4 as any);
const expectedEvents = ['connection.update', 'messages.update', 'messages.upsert'];
for (const event of expectedEvents) {
  if (!eventHandlers.includes(event)) {
    throw new Error(`❌ Missing event handler: ${event}`);
  }
}
console.log('✅ ev.on() fallback works');

// Test 5: TypeScript generic preservation (type-level test)
console.log('\nTest 5: Custom properties preservation');
interface CustomSocket {
  sendMessage: (jid: string, content: any) => Promise<{ id: string }>;
  ev: any;
  customProp: string;
}

const mockSocket5: CustomSocket = {
  sendMessage: async () => ({ id: 'msg1' }),
  ev: { on: () => {}, emit: () => {}, process: () => {} },
  customProp: 'custom value',
};

const wrapped5 = wrapSocket(mockSocket5);
if ((wrapped5 as any).customProp !== 'custom value') {
  throw new Error('❌ Custom properties not preserved');
}
if (!wrapped5.antiban) {
  throw new Error('❌ antiban property missing from wrapped custom socket');
}
console.log('✅ Custom properties preserved');

console.log('\n✅ ALL TRANSPORT-AGNOSTIC TESTS PASSED\n');
