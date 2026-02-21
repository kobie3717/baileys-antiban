/**
 * Quick smoke test — run with: npx tsx test.ts
 */

import { AntiBan } from './src/antiban.js';
import { RateLimiter } from './src/rateLimiter.js';
import { WarmUp } from './src/warmup.js';
import { HealthMonitor } from './src/health.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

async function testRateLimiter() {
  console.log('\n🔧 Rate Limiter');
  
  const rl = new RateLimiter({ maxPerMinute: 3, minDelayMs: 100, maxDelayMs: 200 });
  
  // First message should have a delay > 0
  const d1 = await rl.getDelay('user1', 'hello');
  assert(d1 >= 0, `First message gets delay (${d1}ms)`);
  rl.record('user1', 'hello');
  
  const d2 = await rl.getDelay('user1', 'world');
  assert(d2 >= 0, `Second message gets delay (${d2}ms)`);
  rl.record('user1', 'world');
  
  const d3 = await rl.getDelay('user1', 'test');
  rl.record('user1', 'test');
  
  // 4th message should be rate limited (maxPerMinute: 3)
  const d4 = await rl.getDelay('user1', 'blocked?');
  assert(d4 > 200, `4th message rate limited with longer delay (${d4}ms)`);
  
  // Identical message spam
  const rl2 = new RateLimiter({ maxIdenticalMessages: 2, minDelayMs: 10, maxDelayMs: 20 });
  rl2.record('user1', 'spam');
  rl2.record('user1', 'spam');
  const spamDelay = await rl2.getDelay('user1', 'spam');
  assert(spamDelay === -1, `Identical spam blocked after limit`);
  
  // New chat gets extra delay
  const rl3 = new RateLimiter({ minDelayMs: 100, maxDelayMs: 200, newChatDelayMs: 500 });
  const newChatDelay = await rl3.getDelay('new-person', 'hi');
  assert(newChatDelay > 200, `New chat gets extra delay (${newChatDelay}ms)`);
  
  // Stats
  const stats = rl.getStats();
  assert(stats.lastMinute === 3, `Stats tracked: ${stats.lastMinute} messages`);
}

function testWarmUp() {
  console.log('\n🌱 Warm-Up');
  
  const wu = new WarmUp({ warmUpDays: 3, day1Limit: 5, growthFactor: 2 });
  
  assert(wu.canSend(), 'Can send on day 1');
  assert(wu.getDailyLimit() === 5, `Day 1 limit is 5 (got ${wu.getDailyLimit()})`);
  
  // Send 5 messages
  for (let i = 0; i < 5; i++) wu.record();
  assert(!wu.canSend(), 'Blocked after hitting day 1 limit');
  
  const status = wu.getStatus();
  assert(status.phase === 'warming', `Phase is warming`);
  assert(status.todaySent === 5, `Today sent: ${status.todaySent}`);
  assert(status.progress >= 0, `Progress: ${status.progress}%`);
  
  // Export/restore state
  const exported = wu.exportState();
  const restored = new WarmUp({ warmUpDays: 3, day1Limit: 5, growthFactor: 2 }, exported);
  assert(!restored.canSend(), 'Restored state preserves limit');
  
  // Graduated
  const graduated = new WarmUp({ warmUpDays: 0 });
  assert(graduated.getDailyLimit() === Infinity, 'Graduates when warmUpDays is 0');
}

function testHealthMonitor() {
  console.log('\n🏥 Health Monitor');
  
  const hm = new HealthMonitor({ disconnectWarningThreshold: 2, disconnectCriticalThreshold: 4 });
  
  let status = hm.getStatus();
  assert(status.risk === 'low', `Initial risk is low`);
  assert(status.score === 0, `Initial score is 0`);
  
  // Add disconnects
  hm.recordDisconnect('408');
  hm.recordDisconnect('408');
  status = hm.getStatus();
  assert(status.risk === 'medium' || status.score > 0, `Risk increases after disconnects (${status.risk}, score: ${status.score})`);
  
  // Forbidden error
  hm.recordDisconnect('403');
  status = hm.getStatus();
  assert(status.score >= 40, `403 forbidden jumps score (${status.score})`);
  assert(status.reasons.some(r => r.includes('forbidden')), 'Reasons include forbidden');
  
  // Logged out
  const hm2 = new HealthMonitor();
  hm2.recordDisconnect('401');
  status = hm2.getStatus();
  assert(status.score >= 60, `401 logged out is high risk (${status.score})`);
  
  // Auto-pause
  const hm3 = new HealthMonitor({ autoPauseAt: 'high' });
  assert(!hm3.isPaused(), 'Not paused initially');
  hm3.recordDisconnect('403');
  hm3.recordDisconnect('403');
  assert(hm3.isPaused(), 'Auto-paused at high risk');
}

async function testAntiBan() {
  console.log('\n🛡️ AntiBan (Integration)');
  
  const ab = new AntiBan({
    rateLimiter: { maxPerMinute: 5, minDelayMs: 10, maxDelayMs: 50 },
    warmUp: { warmUpDays: 0 }, // Skip warm-up for testing
    health: { autoPauseAt: 'critical' },
    logging: false,
  });
  
  // Should allow sending
  const d1 = await ab.beforeSend('user1', 'hello');
  assert(d1.allowed, 'First message allowed');
  assert(d1.delayMs >= 0, `Delay: ${d1.delayMs}ms`);
  ab.afterSend('user1', 'hello');
  
  // Health should be low
  assert(d1.health.risk === 'low', `Health risk: ${d1.health.risk}`);
  
  // Stats
  const stats = ab.getStats();
  assert(stats.messagesAllowed === 1, `Allowed: ${stats.messagesAllowed}`);
  assert(stats.messagesBlocked === 0, `Blocked: ${stats.messagesBlocked}`);
  
  // Pause/resume
  ab.pause();
  const d2 = await ab.beforeSend('user1', 'blocked');
  assert(!d2.allowed, 'Blocked when paused');
  ab.resume();
  const d3 = await ab.beforeSend('user1', 'allowed again');
  assert(d3.allowed, 'Allowed after resume');
  
  // Export warm-up state
  const state = ab.exportWarmUpState();
  assert(state !== null, 'Can export warm-up state');
}

// Run all tests
console.log('🧪 baileys-antiban test suite\n');

await testRateLimiter();
testWarmUp();
testHealthMonitor();
await testAntiBan();

console.log(`\n${'='.repeat(40)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) process.exit(1);
