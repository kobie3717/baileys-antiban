/**
 * Smoke test — verify v1.3 features work in a realistic scenario
 * Run with: npx tsx tests/smoke-test.ts
 */

import { AntiBan } from '../src/antiban.js';

async function smokeTest() {
  console.log('=== v1.3 Smoke Test ===\n');

  // Create AntiBan instance with all v1.3 features enabled
  const antiban = new AntiBan({
    rateLimiter: {
      maxPerMinute: 10,
      maxPerHour: 100,
      minDelayMs: 1000,
      maxDelayMs: 3000,
    },
    warmUp: {
      warmUpDays: 7,
      day1Limit: 50,
    },
    replyRatio: {
      enabled: true,
      minRatio: 0.15,
      minMessagesBeforeEnforce: 5,
      cooldownHoursOnViolation: 1,
    },
    contactGraph: {
      enabled: true,
      requireHandshakeBeforeGroupSend: true,
      handshakeMinDelayMs: 3600000, // 1h
      maxStrangerMessagesPerDay: 5,
    },
    presence: {
      enabled: true,
      enableCircadianRhythm: true,
      timezone: 'UTC',
      activityCurve: 'office',
      distractionPauseProbability: 0.05,
    },
    logging: true,
  });

  const contact1 = '1111111111@s.whatsapp.net';
  const contact2 = '2222222222@s.whatsapp.net';

  console.log('Step 1: Send messages to contact1\n');
  for (let i = 0; i < 3; i++) {
    const decision = await antiban.beforeSend(contact1, `Message ${i + 1}`);
    console.log(`  Message ${i + 1}: ${decision.allowed ? `✓ allowed (${decision.delayMs}ms delay)` : `✗ blocked (${decision.reason})`}`);
    if (decision.allowed) {
      antiban.afterSend(contact1, `Message ${i + 1}`);
    }
  }

  console.log('\nStep 2: Simulate incoming message from contact1\n');
  const replySuggestion = antiban.onIncomingMessage(contact1, 'Hey, thanks!');
  console.log(`  Reply suggestion: ${replySuggestion.shouldReply ? `"${replySuggestion.suggestedText}"` : 'none'}`);

  console.log('\nStep 3: Send to contact2 (stranger)\n');
  const strangerDecision = await antiban.beforeSend(contact2, 'Hello stranger');
  console.log(`  Stranger send: ${strangerDecision.allowed ? '✓ allowed' : `✗ blocked (${strangerDecision.reason})`}`);
  if (strangerDecision.allowed) {
    antiban.afterSend(contact2, 'Hello stranger');
  }

  console.log('\nStep 4: Check comprehensive stats\n');
  const stats = antiban.getStats();

  console.log('  Core stats:');
  console.log(`    Messages allowed: ${stats.messagesAllowed}`);
  console.log(`    Messages blocked: ${stats.messagesBlocked}`);
  console.log(`    Health risk: ${stats.health.risk}`);
  console.log(`    Warm-up phase: ${stats.warmUp.phase} (day ${stats.warmUp.day}/${stats.warmUp.totalDays})`);

  if (stats.replyRatio) {
    console.log('\n  Reply ratio:');
    console.log(`    Global sent: ${stats.replyRatio.globalSent}`);
    console.log(`    Global received: ${stats.replyRatio.globalReceived}`);
    console.log(`    Global ratio: ${(stats.replyRatio.globalRatio * 100).toFixed(1)}%`);
    console.log(`    Contacts tracked: ${stats.replyRatio.perContact.length}`);
  }

  if (stats.contactGraph) {
    console.log('\n  Contact graph:');
    console.log(`    Known contacts: ${stats.contactGraph.knownContacts}`);
    console.log(`    Pending handshakes: ${stats.contactGraph.pendingHandshakes}`);
    console.log(`    Strangers messaged today: ${stats.contactGraph.strangersToday}`);
  }

  if (stats.presence) {
    console.log('\n  Presence:');
    console.log(`    Activity factor: ${(stats.presence.currentActivityFactor * 100).toFixed(0)}%`);
    console.log(`    Current hour: ${stats.presence.currentHourLocal}`);
    console.log(`    Distraction pauses injected: ${stats.presence.distractionPausesInjected}`);
  }

  console.log('\nStep 5: Test direct module access\n');
  console.log(`  antiban.replyRatio exists: ${!!antiban.replyRatio}`);
  console.log(`  antiban.contactGraph exists: ${!!antiban.contactGraph}`);
  console.log(`  antiban.presence exists: ${!!antiban.presence}`);

  // Test manual contact graph operations
  antiban.contactGraph.markHandshakeSent(contact2);
  const handshakeState = antiban.contactGraph.getContactState(contact2);
  console.log(`  Contact2 state: ${handshakeState}`);

  console.log('\n✅ Smoke test completed successfully');
}

smokeTest().catch((error) => {
  console.error('\n❌ Smoke test failed:', error);
  process.exit(1);
});
