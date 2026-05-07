/**
 * sendMessage Concurrency Tests — rc10 Mutex Compatibility
 *
 * Baileys v7.0.0-rc10 redesigned the mutex for connection concurrency.
 * Verifies wrapSocket sendMessage interceptor behaves correctly under
 * concurrent load and handles mutex-style errors gracefully.
 *
 * Run: npx tsx tests/sendMessageConcurrency.test.ts
 */

import { wrapSocket, type WASocket } from '../src/wrapper.js';

// Permissive config — disables warmup and delays so tests run fast
// without tripping anti-ban guards that are irrelevant to concurrency testing
const TEST_CONFIG = {
  warmupDays: 0,     // graduate immediately
  minDelayMs: 0,
  maxDelayMs: 0,
  newChatDelayMs: 0,
  maxPerMinute: 1000,
  maxPerHour: 10000,
  maxPerDay: 100000,
  logging: false,
};

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function createMockSocket(opts: {
  sendDelay?: number;
  throwOnConcurrent?: boolean;
  throwError?: string;
} = {}): WASocket & { calls: number; maxConcurrent: number } {
  let inFlight = 0;
  let callCount = 0;
  let maxConcurrent = 0;

  const sock: any = {
    get calls() { return callCount; },
    get maxConcurrent() { return maxConcurrent; },
    ev: {
      process: (_handler: any) => {},
      on: (_event: string, _handler: any) => {},
      off: (_event: string, _handler: any) => {},
    },
    sendMessage: async (jid: string, _content: any, _options?: any) => {
      inFlight++;
      callCount++;
      if (inFlight > maxConcurrent) maxConcurrent = inFlight;

      if (opts.throwOnConcurrent && inFlight > 1) {
        inFlight--;
        throw new Error(opts.throwError ?? 'Mutex locked: request already pending');
      }

      if (opts.sendDelay) {
        await new Promise(resolve => setTimeout(resolve, opts.sendDelay));
      }

      inFlight--;
      return { key: { id: `msg-${callCount}`, remoteJid: jid } };
    },
  };
  return sock;
}

console.log('\n=== sendMessage Concurrency — rc10 Mutex Compatibility ===\n');

await test('all concurrent sends complete when originalSendMessage allows concurrency', async () => {
  const mock = createMockSocket({ sendDelay: 10 });
  const wrapped = wrapSocket(mock, TEST_CONFIG);

  const N = 5;
  const jid = 'test@s.whatsapp.net';
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      wrapped.sendMessage(jid, { text: `msg-${i}` })
    )
  );

  assert(results.length === N, `Expected ${N} results, got ${results.length}`);
  assert(results.every((r: any) => r?.key?.id), 'All results should have key.id');
  assert(mock.calls === N, `Expected ${N} calls to originalSendMessage, got ${mock.calls}`);
});

await test('messagesAllowed increments for each sequential successful send', async () => {
  const mock = createMockSocket();
  const wrapped = wrapSocket(mock, TEST_CONFIG);

  const before = wrapped.antiban.getStats().messagesAllowed;

  await wrapped.sendMessage('a@s.whatsapp.net', { text: 'one' });
  await wrapped.sendMessage('b@s.whatsapp.net', { text: 'two' });
  await wrapped.sendMessage('c@s.whatsapp.net', { text: 'three' });

  const after = wrapped.antiban.getStats().messagesAllowed;
  assert(after - before === 3, `Expected 3 messagesAllowed increments, got ${after - before}`);
});

await test('mutex: concurrent sends are serialized — originalSendMessage never called concurrently', async () => {
  // throwOnConcurrent mock throws if inFlight > 1 — with mutex, this must never happen
  const mock = createMockSocket({ sendDelay: 20, throwOnConcurrent: true });
  const wrapped = wrapSocket(mock, TEST_CONFIG);

  const results = await Promise.allSettled(
    Array.from({ length: 4 }, (_, i) =>
      wrapped.sendMessage('test@s.whatsapp.net', { text: `msg-${i}` })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  assert(succeeded === 4, `All 4 concurrent sends should succeed when serialized, got ${succeeded}`);
  assert(mock.maxConcurrent === 1, `originalSendMessage maxConcurrent should be 1, got ${mock.maxConcurrent}`);
});

await test('error from originalSendMessage propagates correctly and is not counted as success', async () => {
  let callCount = 0;
  const errorSock: WASocket = {
    ev: { process: () => {}, on: () => {}, off: () => {} },
    sendMessage: async (jid: string) => {
      callCount++;
      if (callCount === 2) throw new Error('Network timeout');
      return { key: { id: `msg-${callCount}`, remoteJid: jid } };
    },
  };
  const wrapped = wrapSocket(errorSock, TEST_CONFIG);
  const before = wrapped.antiban.getStats().messagesAllowed;

  const [first, second, third] = await Promise.allSettled([
    wrapped.sendMessage('test@s.whatsapp.net', { text: 'one' }),
    wrapped.sendMessage('test@s.whatsapp.net', { text: 'two' }),
    wrapped.sendMessage('test@s.whatsapp.net', { text: 'three' }),
  ]);

  assert(first.status === 'fulfilled', 'First send should succeed');
  assert(second.status === 'rejected', 'Second send should fail (network error)');
  if (second.status === 'rejected') {
    assert(second.reason.message === 'Network timeout', `Expected network error, got: ${second.reason.message}`);
  }
  assert(third.status === 'fulfilled', 'Third send should succeed after error clears');

  const after = wrapped.antiban.getStats().messagesAllowed;
  assert(after - before === 2, `Only 2 successes should be counted (sends 1+3), got ${after - before}`);
});

await test('sequential hard-blocked sends never reach originalSendMessage', async () => {
  const mock = createMockSocket();
  // maxPerDay: 1 = hard block (-1 return) after first send — immediate rejection, no delay
  const wrapped = wrapSocket(mock, { ...TEST_CONFIG, maxPerDay: 1 });

  const jid = 'flood@s.whatsapp.net';
  const callsBefore = mock.calls;

  // Sequential — each beforeSend sees committed state from previous afterSend
  const results: PromiseSettledResult<any>[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await Promise.allSettled([wrapped.sendMessage(jid, { text: `seq-${i}` })]);
    results.push(r[0]);
  }

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const blocked = results.filter(r => r.status === 'rejected').length;
  const actualSendCalls = mock.calls - callsBefore;

  assert(succeeded === 1, `Expected exactly 1 success (maxPerDay:1), got ${succeeded}`);
  assert(blocked === 4, `Expected 4 blocked sends, got ${blocked}`);
  assert(succeeded + blocked === 5, 'All 5 attempts accounted for');
  assert(
    actualSendCalls === 1,
    `originalSendMessage should be called once, called ${actualSendCalls} — blocked sends leaked through`
  );
});

await test('concurrent sends respect rate limiter (mutex fix — sends are serialized)', async () => {
  // Mutex serializes beforeSend→afterSend so each concurrent send sees the committed
  // state of the previous one. maxPerDay:1 = hard block after first send.
  const mock = createMockSocket();
  const wrapped = wrapSocket(mock, { ...TEST_CONFIG, maxPerDay: 1 });

  const callsBefore = mock.calls;
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      wrapped.sendMessage('flood@s.whatsapp.net', { text: `concurrent-${i}` })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const blocked = results.filter(r => r.status === 'rejected').length;

  assert(succeeded === 1, `Expected exactly 1 success (maxPerDay:1 + mutex), got ${succeeded}`);
  assert(blocked === 4, `Expected 4 blocked by rate limiter, got ${blocked}`);
  assert(mock.calls - callsBefore === 1, `originalSendMessage should be called once, got ${mock.calls - callsBefore}`);
});

await test('concurrent sends to different JIDs complete independently', async () => {
  const mock = createMockSocket();
  const wrapped = wrapSocket(mock, TEST_CONFIG);

  const jids = ['alice@s.whatsapp.net', 'bob@s.whatsapp.net', 'carol@s.whatsapp.net'];
  const results = await Promise.allSettled(
    jids.map(jid => wrapped.sendMessage(jid, { text: 'hello' }))
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  assert(succeeded === 3, `Expected all 3 JID sends to succeed, got ${succeeded}`);
  assert(mock.calls === 3, `Expected 3 originalSendMessage calls, got ${mock.calls}`);
});

await test('sequential sends never exceed 1 in-flight at originalSendMessage level', async () => {
  const mock = createMockSocket({ sendDelay: 10 });
  const wrapped = wrapSocket(mock, TEST_CONFIG);

  for (let i = 0; i < 5; i++) {
    await wrapped.sendMessage('test@s.whatsapp.net', { text: `seq-${i}` });
  }

  assert(
    mock.maxConcurrent === 1,
    `Sequential sends should have maxConcurrent=1, got ${mock.maxConcurrent}`
  );
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  Concurrency issues detected — review before rc10 release.');
  process.exit(1);
} else {
  console.log('\n✅ sendMessage wrapper is rc10 mutex-compatible.');
}
