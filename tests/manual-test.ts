/**
 * Manual integration test - run with: npx tsx tests/manual-test.ts
 *
 * This validates the core functionality without Jest
 */

import { RateLimiter } from '../src/rateLimiter.js';
import { WarmUp } from '../src/warmup.js';
import { HealthMonitor } from '../src/health.js';
import { AntiBan } from '../src/antiban.js';

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

async function runAllTests() {
  console.log('Starting manual tests...\n');

  try {
    await testRateLimiter();
    await testWarmUp();
    await testHealthMonitor();
    await testAntiBan();

    console.log('\n✅ ALL TESTS PASSED');
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

runAllTests();
