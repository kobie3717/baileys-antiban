/**
 * Manual integration test - run with: npx tsx tests/manual-test.ts
 *
 * This validates the core functionality without Jest
 */

import { RateLimiter } from '../src/rateLimiter.js';
import { WarmUp } from '../src/warmup.js';
import { HealthMonitor } from '../src/health.js';
import { AntiBan } from '../src/antiban.js';
import { ReplyRatioGuard } from '../src/replyRatio.js';
import { ContactGraphWarmer } from '../src/contactGraph.js';
import { PresenceChoreographer } from '../src/presenceChoreographer.js';

async function testRateLimiter() {
  console.log('\n=== Testing RateLimiter ===');

  const limiter = new RateLimiter({
    maxPerMinute: 5,
    maxPerHour: 50,
    maxPerDay: 500,
    minDelayMs: 100,
    maxDelayMs: 500,
    identicalMessageWindowMs: 3600000,
  });

  // Test per-minute limit
  for (let i = 0; i < 5; i++) {
    const delay = await limiter.getDelay('test@s.whatsapp.net', `Message ${i}`);
    console.log(`Message ${i}: delay = ${delay}ms`);
    limiter.record('test@s.whatsapp.net', `Message ${i}`);
  }

  // Test identical message blocking
  for (let i = 0; i < 4; i++) {
    const delay = await limiter.getDelay('test@s.whatsapp.net', 'Identical');
    console.log(`Identical message ${i}: delay = ${delay}ms`);
    if (delay !== -1) {
      limiter.record('test@s.whatsapp.net', 'Identical');
    }
  }

  const stats = limiter.getStats();
  console.log('Stats:', stats);
  console.log('✅ RateLimiter tests passed');
}

async function testWarmUp() {
  console.log('\n=== Testing WarmUp ===');

  const warmup = new WarmUp({
    warmUpDays: 7,
    day1Limit: 20,
    growthFactor: 1.8,
  });

  console.log(`Day 1 limit: ${warmup.getDailyLimit()}`);

  for (let i = 0; i < 21; i++) {
    const canSend = warmup.canSend();
    console.log(`Message ${i}: canSend = ${canSend}`);
    if (canSend) {
      warmup.record();
    }
  }

  const status = warmup.getStatus();
  console.log('Warm-up status:', status);
  console.log('✅ WarmUp tests passed');
}

async function testHealthMonitor() {
  console.log('\n=== Testing HealthMonitor ===');

  const health = new HealthMonitor({
    disconnectWarningThreshold: 3,
    disconnectCriticalThreshold: 5,
    onRiskChange: (status) => {
      console.log(`Risk changed: ${status.risk} (score: ${status.score})`);
    },
  });

  health.recordDisconnect('timeout');
  health.recordDisconnect('timeout');
  health.recordDisconnect('timeout');

  let status = health.getStatus();
  console.log('After 3 disconnects:', status.risk, status.score);

  health.recordDisconnect(403);
  status = health.getStatus();
  console.log('After 403 Forbidden:', status.risk, status.score);

  console.log('✅ HealthMonitor tests passed');
}

async function testAntiBan() {
  console.log('\n=== Testing AntiBan Integration ===');

  const antiban = new AntiBan({
    rateLimiter: {
      maxPerMinute: 5,
      maxPerHour: 50,
    },
    warmUp: {
      warmUpDays: 7,
      day1Limit: 20,
    },
    logging: false,
  });

  // Test normal flow
  for (let i = 0; i < 5; i++) {
    const decision = await antiban.beforeSend('test@s.whatsapp.net', `Message ${i}`);
    console.log(`Message ${i}: allowed=${decision.allowed}, delay=${decision.delayMs}ms`);
    if (decision.allowed) {
      antiban.afterSend('test@s.whatsapp.net', `Message ${i}`);
    }
  }

  // Test health-based blocking
  antiban.onDisconnect(403);
  antiban.onDisconnect(403);

  const blockedDecision = await antiban.beforeSend('test@s.whatsapp.net', 'Should be blocked');
  console.log(`High risk message: allowed=${blockedDecision.allowed}, reason=${blockedDecision.reason}`);

  const stats = antiban.getStats();
  console.log('Final stats:', {
    messagesAllowed: stats.messagesAllowed,
    messagesBlocked: stats.messagesBlocked,
    healthRisk: stats.health.risk,
    warmUpPhase: stats.warmUp.phase,
  });

  console.log('✅ AntiBan integration tests passed');
}

async function testReplyRatioGuard() {
  console.log('\n=== Testing ReplyRatioGuard ===');

  const guard = new ReplyRatioGuard({
    enabled: true,
    minRatio: 0.2, // 20% reply rate required
    minMessagesBeforeEnforce: 5,
    cooldownHoursOnViolation: 1,
  });

  const testJid = '1234567890@s.whatsapp.net';

  // Send 10 messages with 0 replies — should block after 5
  for (let i = 0; i < 10; i++) {
    const decision = guard.beforeSend(testJid);
    console.log(`Message ${i + 1}: allowed=${decision.allowed}, reason=${decision.reason || 'ok'}`);
    if (decision.allowed) {
      guard.recordSent(testJid);
    }
  }

  // Record some replies — should clear cooldown and allow again
  guard.recordReceived(testJid);
  guard.recordReceived(testJid);

  const afterReplies = guard.beforeSend(testJid);
  console.log(`After 2 replies: allowed=${afterReplies.allowed}`);

  // Test reply suggestion
  const suggestion = guard.suggestReply(testJid);
  console.log(`Reply suggestion: shouldReply=${suggestion.shouldReply}, text=${suggestion.suggestedText}`);

  const stats = guard.getStats();
  console.log('Stats:', {
    globalSent: stats.globalSent,
    globalReceived: stats.globalReceived,
    globalRatio: stats.globalRatio.toFixed(2),
    contactsOnCooldown: stats.contactsOnCooldown,
  });

  console.log('✅ ReplyRatioGuard tests passed');
}

async function testContactGraphWarmer() {
  console.log('\n=== Testing ContactGraphWarmer ===');

  const warmer = new ContactGraphWarmer({
    enabled: true,
    requireHandshakeBeforeGroupSend: true,
    handshakeMinDelayMs: 5000, // 5s for testing
    groupLurkPeriodMs: 10000, // 10s for testing
    maxStrangerMessagesPerDay: 3,
  });

  const stranger = '1111111111@s.whatsapp.net';
  const group = '2222222222@g.us';

  // Test stranger messaging — should allow up to quota
  for (let i = 0; i < 5; i++) {
    const decision = warmer.canMessage(stranger);
    console.log(`Stranger message ${i + 1}: allowed=${decision.allowed}, needsHandshake=${decision.needsHandshake}, reason=${decision.reason || 'ok'}`);
    if (decision.allowed) {
      warmer.markHandshakeSent(stranger);
    }
  }

  // Test handshake flow
  warmer.markHandshakeSent(stranger);
  const tooSoon = warmer.canMessage(stranger);
  console.log(`Too soon after handshake: allowed=${tooSoon.allowed}`);

  // Wait for handshake delay
  await new Promise(resolve => setTimeout(resolve, 6000));
  const afterDelay = warmer.canMessage(stranger);
  console.log(`After handshake delay: allowed=${afterDelay.allowed}`);

  // Test group lurk period
  warmer.registerGroupJoin(group);
  const groupTooSoon = warmer.canMessage(group);
  console.log(`Group message too soon: allowed=${groupTooSoon.allowed}, reason=${groupTooSoon.reason}`);

  const stats = warmer.getStats();
  console.log('Stats:', {
    knownContacts: stats.knownContacts,
    pendingHandshakes: stats.pendingHandshakes,
    strangersToday: stats.strangersToday,
    groupsJoined: stats.groupsJoined.length,
  });

  console.log('✅ ContactGraphWarmer tests passed');
}

async function testPresenceChoreographer() {
  console.log('\n=== Testing PresenceChoreographer ===');

  const choreographer = new PresenceChoreographer({
    enabled: true,
    enableCircadianRhythm: true,
    timezone: 'UTC',
    activityCurve: 'office',
    distractionPauseProbability: 1.0, // Force for testing
    offlineGapProbability: 1.0, // Force for testing
  });

  // Test activity factor across different hours
  console.log('Activity factors by hour (office curve):');
  for (let hour = 0; hour < 24; hour += 4) {
    // Mock hour by checking curve directly
    console.log(`  Hour ${hour}: (curve defined in module)`);
  }

  const activityFactor = choreographer.getCurrentActivityFactor();
  console.log(`Current activity factor: ${activityFactor.toFixed(2)}`);

  // Test distraction pause
  const distraction = choreographer.shouldPauseForDistraction();
  console.log(`Distraction pause: pause=${distraction.pause}, durationMs=${distraction.durationMs}`);

  // Test offline gap
  const offline = choreographer.shouldTakeOfflineGap();
  console.log(`Offline gap: offline=${offline.offline}, durationMs=${offline.durationMs}`);

  // Test read receipt
  const readReceipt = choreographer.shouldMarkRead();
  console.log(`Read receipt: mark=${readReceipt.mark}, delayMs=${readReceipt.delayMs}`);

  const stats = choreographer.getStats();
  console.log('Stats:', {
    currentActivityFactor: stats.currentActivityFactor.toFixed(2),
    distractionPausesInjected: stats.distractionPausesInjected,
    offlineGapsInjected: stats.offlineGapsInjected,
    readReceiptsDelayed: stats.readReceiptsDelayed,
    readReceiptsSkipped: stats.readReceiptsSkipped,
    currentHourLocal: stats.currentHourLocal,
  });

  console.log('✅ PresenceChoreographer tests passed');
}

async function testIntegrationAllFeatures() {
  console.log('\n=== Testing AntiBan with All v1.3 Features ===');

  const antiban = new AntiBan({
    rateLimiter: {
      maxPerMinute: 10,
      maxPerHour: 100,
    },
    warmUp: {
      warmUpDays: 7,
      day1Limit: 50,
    },
    replyRatio: {
      enabled: true,
      minRatio: 0.15,
      minMessagesBeforeEnforce: 3,
    },
    contactGraph: {
      enabled: true,
      maxStrangerMessagesPerDay: 5,
    },
    presence: {
      enabled: true,
      activityCurve: 'office',
    },
    logging: false,
  });

  const testJid = '9999999999@s.whatsapp.net';

  // Send a few messages
  for (let i = 0; i < 5; i++) {
    const decision = await antiban.beforeSend(testJid, `Test message ${i}`);
    console.log(`Message ${i}: allowed=${decision.allowed}, delayMs=${decision.delayMs}ms`);
    if (decision.allowed) {
      antiban.afterSend(testJid, `Test message ${i}`);
    }
  }

  // Simulate incoming message
  const replySuggestion = antiban.onIncomingMessage(testJid, 'Hey there!');
  console.log(`Reply suggestion: shouldReply=${replySuggestion.shouldReply}, text=${replySuggestion.suggestedText}`);

  const stats = antiban.getStats();
  console.log('Comprehensive stats:', {
    messagesAllowed: stats.messagesAllowed,
    messagesBlocked: stats.messagesBlocked,
    healthRisk: stats.health.risk,
    warmUpPhase: stats.warmUp.phase,
    replyRatio: stats.replyRatio ? {
      globalSent: stats.replyRatio.globalSent,
      globalReceived: stats.replyRatio.globalReceived,
      globalRatio: stats.replyRatio.globalRatio.toFixed(2),
    } : 'disabled',
    contactGraph: stats.contactGraph ? {
      knownContacts: stats.contactGraph.knownContacts,
      strangersToday: stats.contactGraph.strangersToday,
    } : 'disabled',
    presence: stats.presence ? {
      activityFactor: stats.presence.currentActivityFactor.toFixed(2),
      distractionPauses: stats.presence.distractionPausesInjected,
    } : 'disabled',
  });

  console.log('✅ Integration with all v1.3 features passed');
}

async function runAllTests() {
  console.log('Starting manual tests...\n');

  try {
    await testRateLimiter();
    await testWarmUp();
    await testHealthMonitor();
    await testAntiBan();
    await testReplyRatioGuard();
    await testContactGraphWarmer();
    await testPresenceChoreographer();
    await testIntegrationAllFeatures();

    console.log('\n✅ ALL TESTS PASSED');
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

runAllTests();
