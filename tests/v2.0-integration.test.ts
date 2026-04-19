/**
 * v2.0 Integration Test - Session Stability Module
 *
 * Tests the complete v2.0 feature set:
 * - Disconnect reason classification
 * - Session health monitoring
 * - Socket wrapper with JID canonicalization
 * - AntiBan integration
 */

import { AntiBan } from '../src/antiban.js';
import { LidResolver } from '../src/lidResolver.js';
import {
  classifyDisconnect,
  SessionHealthMonitor,
  wrapWithSessionStability,
} from '../src/sessionStability.js';

async function testDisconnectClassification() {
  console.log('\n=== Testing Disconnect Classification ===');

  // Fatal disconnects
  const loggedOut = classifyDisconnect(401);
  console.log(`401: ${loggedOut.category} - ${loggedOut.message}`);
  if (loggedOut.category !== 'fatal' || loggedOut.shouldReconnect !== false) {
    throw new Error('401 should be fatal with no reconnect');
  }

  const connectionReplaced = classifyDisconnect(428);
  console.log(`428: ${connectionReplaced.category} - ${connectionReplaced.message}`);
  if (connectionReplaced.category !== 'fatal') {
    throw new Error('428 should be fatal');
  }

  // Rate limited
  const rateLimited = classifyDisconnect(429);
  console.log(`429: ${rateLimited.category} - backoff ${rateLimited.backoffMs}ms`);
  if (rateLimited.category !== 'rate-limited' || rateLimited.backoffMs !== 300_000) {
    throw new Error('429 should be rate-limited with 5min backoff');
  }

  // Recoverable
  const timeout = classifyDisconnect(408);
  console.log(`408: ${timeout.category} - backoff ${timeout.backoffMs}ms`);
  if (timeout.category !== 'recoverable' || !timeout.shouldReconnect) {
    throw new Error('408 should be recoverable');
  }

  console.log('✅ Disconnect classification tests passed');
}

async function testSessionHealthMonitor() {
  console.log('\n=== Testing Session Health Monitor ===');

  let degradedCalled = false;
  let recoveredCalled = false;

  const monitor = new SessionHealthMonitor({
    badMacThreshold: 2,
    badMacWindowMs: 100,
    onDegraded: () => { degradedCalled = true; },
    onRecovered: () => { recoveredCalled = true; },
  });

  // Record successes
  monitor.recordDecryptSuccess();
  const stats1 = monitor.getStats();
  console.log(`After 1 success: ${stats1.decryptSuccess} successes, degraded=${stats1.isDegraded}`);

  // Trigger degraded
  monitor.recordDecryptFail(true);
  monitor.recordDecryptFail(true);
  const stats2 = monitor.getStats();
  console.log(`After 2 Bad MACs: degraded=${stats2.isDegraded}, callback=${degradedCalled}`);

  if (!stats2.isDegraded || !degradedCalled) {
    throw new Error('Should be degraded after 2 Bad MACs');
  }

  // Wait for window to expire
  await new Promise(resolve => setTimeout(resolve, 150));

  // Trigger recovery
  monitor.recordDecryptSuccess();
  const stats3 = monitor.getStats();
  console.log(`After recovery: degraded=${stats3.isDegraded}, callback=${recoveredCalled}`);

  if (stats3.isDegraded || !recoveredCalled) {
    throw new Error('Should have recovered');
  }

  console.log('✅ Session health monitor tests passed');
}

async function testSocketWrapper() {
  console.log('\n=== Testing Socket Wrapper ===');

  const resolver = new LidResolver({ canonical: 'pn' });
  resolver.learn({ lid: '999@lid', pn: '1234567890@s.whatsapp.net' });

  let actualJid: string | null = null;
  const mockSock = {
    sendMessage: async (jid: string, content: any) => {
      actualJid = jid;
      return { status: 'ok' };
    },
    user: { id: 'test-user' },
    logout: async () => {},
  };

  const wrapped = wrapWithSessionStability(mockSock, {
    canonicalJidNormalization: true,
    healthMonitoring: true,
    lidResolver: resolver,
  });

  // Test JID canonicalization
  await wrapped.sendMessage('999@lid', { text: 'hello' });
  console.log(`Sent to LID, canonicalized to: ${actualJid}`);

  if (actualJid !== '1234567890@s.whatsapp.net') {
    throw new Error(`Expected PN form, got ${actualJid}`);
  }

  // Test property passthrough
  console.log(`User passthrough: ${(wrapped as any).user.id === 'test-user' ? 'yes' : 'no'}`);

  // Test health stats accessible
  const healthStats = (wrapped as any).sessionHealthStats;
  console.log(`Health stats accessible: ${healthStats ? 'yes' : 'no'}`);

  if (!healthStats) {
    throw new Error('Health stats should be accessible');
  }

  console.log('✅ Socket wrapper tests passed');
}

async function testAntibanIntegration() {
  console.log('\n=== Testing AntiBan Integration ===');

  const antiban = new AntiBan({
    sessionStability: {
      enabled: true,
      canonicalJidNormalization: true,
      healthMonitoring: true,
      badMacThreshold: 5,
      badMacWindowMs: 60_000,
    },
    warmUp: {
      warmUpDays: 1,
      day1Limit: 100,
    },
    logging: false,
  });

  // Verify session stability module is initialized
  const healthMonitor = antiban.sessionStability;
  console.log(`Health monitor initialized: ${healthMonitor ? 'yes' : 'no'}`);

  if (!healthMonitor) {
    throw new Error('Session stability monitor should be initialized');
  }

  // Test stats include session stability
  const stats = antiban.getStats();
  console.log(`Stats include sessionStability: ${stats.sessionStability ? 'yes' : 'no'}`);

  if (!stats.sessionStability) {
    throw new Error('Stats should include sessionStability when enabled');
  }

  console.log(`Bad MAC threshold: ${stats.sessionStability.badMacCount}/${5}`);

  // Test destroy cleans up
  antiban.destroy();
  console.log('Destroyed successfully');

  console.log('✅ AntiBan integration tests passed');
}

async function testBackwardCompatibility() {
  console.log('\n=== Testing Backward Compatibility ===');

  // v1.x config should work without sessionStability
  const antibanV1 = new AntiBan({
    warmUp: { warmUpDays: 7 },
    rateLimiter: { maxPerMinute: 10 },
    logging: false,
  });

  const stats = antibanV1.getStats();
  console.log(`v1.x config works: ${stats ? 'yes' : 'no'}`);
  console.log(`sessionStability in stats: ${stats.sessionStability ? 'yes' : 'no (expected)'}`);

  if (stats.sessionStability !== null && stats.sessionStability !== undefined) {
    throw new Error('sessionStability should not be in stats when disabled');
  }

  antibanV1.destroy();
  console.log('✅ Backward compatibility tests passed');
}

async function runAllTests() {
  console.log('Starting v2.0 Integration Tests...\n');

  try {
    await testDisconnectClassification();
    await testSessionHealthMonitor();
    await testSocketWrapper();
    await testAntibanIntegration();
    await testBackwardCompatibility();

    console.log('\n✅ ALL v2.0 INTEGRATION TESTS PASSED');
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

runAllTests();
