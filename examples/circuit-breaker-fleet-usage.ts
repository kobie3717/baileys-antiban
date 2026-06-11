/**
 * Example: Using Circuit Breaker + Fleet Event Store
 *
 * Demonstrates:
 * - Per-JID circuit breaker to prevent cascading failures
 * - Fleet event store for multi-instance coordination
 * - Integration with wrapSocket
 */

import makeWASocket from '@whiskeysockets/baileys';
import {
  wrapSocket,
  createJidCircuitBreaker,
  createInMemoryEventStoreBackend,
  createFleetEventStore
} from 'baileys-antiban';

// =====================================================
// Setup 1: Circuit Breaker (optional but recommended)
// =====================================================

const circuitBreaker = createJidCircuitBreaker({
  failureThreshold: 3,      // Open circuit after 3 consecutive failures
  cooldownMs: 30_000,       // Wait 30s before trying half-open probe
  logger: {
    warn: (msg, ctx) => console.warn(msg, ctx),
    info: (msg, ctx) => console.log(msg, ctx),
  },
});

// =====================================================
// Setup 2: Fleet Event Store (optional, for multi-instance)
// =====================================================

// Option A: In-memory (single instance, testing)
const backendMemory = createInMemoryEventStoreBackend();

// Option B: MySQL (production, multi-instance)
// import mysql from 'mysql2/promise';
// const pool = mysql.createPool({
//   host: 'localhost',
//   user: 'root',
//   password: 'password',
//   database: 'whatsapp_fleet',
// });
// const backendMySQL = createMySQLEventStoreBackend(pool);

const fleetEventStore = createFleetEventStore({
  connectionId: 'wa-instance-1',  // Unique per instance
  backend: backendMemory,         // or backendMySQL
  pollIntervalMs: 10_000,         // Poll every 10s
  logger: {
    warn: (msg, ctx) => console.warn(msg, ctx),
    info: (msg, ctx) => console.log(msg, ctx),
  },
});

// Start polling for events from other instances
fleetEventStore.startPolling((events) => {
  console.log(`📡 Received ${events.length} fleet events:`, events);

  for (const event of events) {
    if (event.eventType === 'ban') {
      console.error('🚨 Another instance was banned! Pausing sends...');
      // Implement your pause logic here
    } else if (event.eventType === 'timelock') {
      console.warn('⏰ Another instance hit timelock');
    } else if (event.eventType === 'recovery') {
      console.log('✅ Another instance recovered');
    }
  }
});

// =====================================================
// Setup 3: Create wrapped socket
// =====================================================

const sock = makeWASocket({
  // ... your Baileys config
});

const wrappedSock = wrapSocket(sock, {
  // Standard antiban config
  maxPerMinute: 8,
  maxPerHour: 100,
  warmupDays: 7,
}, undefined, {
  // Pass circuit breaker + fleet store
  circuitBreaker,
  fleetEventStore,

  // Other options
  groupOpGuard: {},
  legitimacySignals: {},
});

// =====================================================
// Usage: Send messages
// =====================================================

async function sendMessage(jid: string, text: string) {
  try {
    // Circuit breaker automatically checks if send is allowed
    // Fleet events are emitted on ban/warn/timelock
    await wrappedSock.sendMessage(jid, { text });
    console.log(`✅ Sent to ${jid}`);
  } catch (error: any) {
    console.error(`❌ Failed to send to ${jid}:`, error.message);

    // Circuit breaker has already recorded the failure
    // Check if circuit is open
    const state = circuitBreaker.getState(jid);
    if (state === 'open') {
      console.warn(`🔴 Circuit open for ${jid} - will retry after cooldown`);
    }
  }
}

// =====================================================
// Monitor circuit breaker stats
// =====================================================

setInterval(() => {
  const stats = circuitBreaker.getStats();
  if (stats.open > 0 || stats.halfOpen > 0) {
    console.log('⚡ Circuit breaker stats:', stats);
  }
}, 5000);

// =====================================================
// Cleanup on exit
// =====================================================

process.on('SIGINT', () => {
  console.log('Stopping fleet event polling...');
  fleetEventStore.stop();
  process.exit(0);
});

// =====================================================
// Example: Manual fleet event emission
// =====================================================

// You can manually emit events if needed
async function reportCustomEvent() {
  await fleetEventStore.emit('warn', {
    risk: 'medium',
    score: 0.65,
    reason: 'Too many failed sends',
  });
}

export { wrappedSock, sendMessage, circuitBreaker, fleetEventStore };
