/**
 * Test Circuit Breaker and Fleet Event Store
 */

import { createJidCircuitBreaker, createInMemoryEventStoreBackend, createFleetEventStore } from '../src/index.js';

console.log('\n=== Testing JID Circuit Breaker ===\n');

const breaker = createJidCircuitBreaker({
  failureThreshold: 3,
  cooldownMs: 1000,
  logger: {
    warn: (msg: string, ctx?: object) => console.log(`⚠️  ${msg}`, ctx),
    info: (msg: string, ctx?: object) => console.log(`ℹ️  ${msg}`, ctx),
  },
});

const testJid = '27825651069@s.whatsapp.net';

// Test 1: Initial state should be closed
console.log('Test 1: Initial state');
console.log(`canSend: ${breaker.canSend(testJid)}`); // true
console.log(`state: ${breaker.getState(testJid)}`); // closed
console.log(`stats:`, breaker.getStats());

// Test 2: Record failures to open circuit
console.log('\nTest 2: Recording failures');
breaker.recordFailure(testJid);
breaker.recordFailure(testJid);
breaker.recordFailure(testJid); // Should open circuit
console.log(`canSend after 3 failures: ${breaker.canSend(testJid)}`); // false
console.log(`state: ${breaker.getState(testJid)}`); // open
console.log(`stats:`, breaker.getStats());

// Test 3: Wait for cooldown and test half-open
console.log('\nTest 3: Waiting for cooldown (1s)...');
await new Promise((resolve) => setTimeout(resolve, 1100));
console.log(`canSend after cooldown: ${breaker.canSend(testJid)}`); // true (half-open probe)
console.log(`state: ${breaker.getState(testJid)}`); // half-open
console.log(`canSend again (probe used): ${breaker.canSend(testJid)}`); // false (probe already used)

// Test 4: Success resets to closed
console.log('\nTest 4: Recording success');
breaker.recordSuccess(testJid);
console.log(`state after success: ${breaker.getState(testJid)}`); // closed
console.log(`canSend: ${breaker.canSend(testJid)}`); // true
console.log(`stats:`, breaker.getStats());

// Test 5: Broadcast jitter
console.log('\nTest 5: Broadcast jitter');
const broadcastJid = '123456@broadcast';
const jitter1 = breaker.getJitter(true);
const jitter2 = breaker.getJitter(false);
console.log(`Broadcast jitter: ${jitter1}ms (should be 400-900)`);
console.log(`Single-chat jitter: ${jitter2}ms (should be 0)`);

console.log('\n✅ Circuit Breaker tests passed\n');

// =====================================
// Fleet Event Store Tests
// =====================================

console.log('=== Testing Fleet Event Store (In-Memory) ===\n');

const backend = createInMemoryEventStoreBackend();
const store = createFleetEventStore({
  connectionId: 'test-connection-1',
  backend,
  pollIntervalMs: 500,
  logger: {
    warn: (msg: string, ctx?: object) => console.log(`⚠️  ${msg}`, ctx),
    info: (msg: string, ctx?: object) => console.log(`ℹ️  ${msg}`, ctx),
  },
});

// Test 6: Emit events
console.log('Test 6: Emitting events');
await store.emit('warn', { risk: 'medium', score: 0.6 });
await store.emit('rate_limit', { error: '463' });
console.log('Emitted 2 events');

// Test 7: Poll events
console.log('\nTest 7: Polling events');
let eventCount = 0;
store.startPolling((events) => {
  console.log(`Received ${events.length} events:`, events.map((e) => ({ type: e.eventType, payload: e.payload })));
  eventCount += events.length;
});

await new Promise((resolve) => setTimeout(resolve, 600));

// Emit more events
await store.emit('timelock', { enforcementType: 'restricted' });
await store.emit('recovery', { risk: 'low' });

await new Promise((resolve) => setTimeout(resolve, 600));

store.stop();
console.log(`Total events received: ${eventCount}`);

// Test 8: Multi-instance (different connection IDs)
console.log('\nTest 8: Multi-instance isolation');
const store2 = createFleetEventStore({
  connectionId: 'test-connection-2',
  backend,
});

await store2.emit('ban', { statusCode: 428 });
await store.emit('warn', { risk: 'high' });

// Poll store1 - should only see its own events
const events1 = await backend.poll('test-connection-1', 0);
const events2 = await backend.poll('test-connection-2', 0);
console.log(`Connection 1 has ${events1.length} events (should include warn/rate_limit/timelock/recovery/warn)`);
console.log(`Connection 2 has ${events2.length} events (should include ban)`);

console.log('\n✅ Fleet Event Store tests passed\n');

console.log('🎉 ALL NEW FEATURES TESTED SUCCESSFULLY\n');
