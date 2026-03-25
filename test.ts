/**
 * Quick smoke test — run with: npx tsx test.ts
 */

import { AntiBan } from './src/antiban.js';
import { RateLimiter } from './src/rateLimiter.js';
import { WarmUp } from './src/warmup.js';
import { HealthMonitor } from './src/health.js';
import { TimelockGuard } from './src/timelockGuard.js';

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

async function testTimelockGuard() {
  console.log('\n🔒 Timelock Guard');

  // Test 1: Initial state — not timelocked
  const tg = new TimelockGuard();
  assert(!tg.isTimelocked(), 'Initial state: not timelocked');

  // Test 2: record463Error() activates timelock with 60s default expiry
  tg.record463Error();
  assert(tg.isTimelocked(), '463 error activates timelock');
  const state1 = tg.getState();
  assert(state1.isActive, 'State shows active');
  assert(state1.errorCount === 1, `Error count is 1 (got ${state1.errorCount})`);
  assert(state1.expiresAt !== undefined, 'Expiry date is set');

  // Test 3: canSend() blocks new contacts when timelocked
  const result1 = tg.canSend('new-contact@s.whatsapp.net');
  assert(!result1.allowed, 'New contact blocked when timelocked');
  assert(result1.reason?.includes('timelocked'), `Reason mentions timelock: ${result1.reason}`);

  // Test 4: canSend() allows known chats when timelocked
  tg.registerKnownChat('known-user@s.whatsapp.net');
  const result2 = tg.canSend('known-user@s.whatsapp.net');
  assert(result2.allowed, 'Known chat allowed when timelocked');

  // Test 5: canSend() allows group JIDs (@g.us) when timelocked
  const result3 = tg.canSend('123456789@g.us');
  assert(result3.allowed, 'Group chat allowed when timelocked');

  // Test 6: canSend() allows newsletter JIDs (@newsletter) when timelocked
  const result4 = tg.canSend('newsletter123@newsletter');
  assert(result4.allowed, 'Newsletter allowed when timelocked');

  // Test 7: registerKnownChat() then canSend() allows that JID
  tg.registerKnownChat('another-known@s.whatsapp.net');
  const result5 = tg.canSend('another-known@s.whatsapp.net');
  assert(result5.allowed, 'Newly registered chat allowed');

  // Test 8: lift() deactivates timelock
  tg.lift();
  assert(!tg.isTimelocked(), 'Timelock lifted manually');
  const result6 = tg.canSend('new-contact-2@s.whatsapp.net');
  assert(result6.allowed, 'New contact allowed after lift');

  // Test 9: onTimelockUpdate() with isActive=true activates
  const tg2 = new TimelockGuard();
  tg2.onTimelockUpdate({
    isActive: true,
    enforcementType: 'reachout',
    timeEnforcementEnds: new Date(Date.now() + 120000),
  });
  assert(tg2.isTimelocked(), 'onTimelockUpdate activates timelock');

  // Test 10: onTimelockUpdate() with isActive=false deactivates
  tg2.onTimelockUpdate({ isActive: false });
  assert(!tg2.isTimelocked(), 'onTimelockUpdate deactivates timelock');

  // Test 11: onTimelockDetected callback fires
  let detectedCalled = false;
  const tg3 = new TimelockGuard({
    onTimelockDetected: (state) => {
      detectedCalled = true;
      assert(state.isActive, 'Callback receives active state');
    },
  });
  tg3.record463Error();
  assert(detectedCalled, 'onTimelockDetected callback fired');

  // Test 12: onTimelockLifted callback fires
  let liftedCalled = false;
  const tg4 = new TimelockGuard({
    onTimelockLifted: (state) => {
      liftedCalled = true;
      assert(!state.isActive, 'Callback receives inactive state');
    },
  });
  tg4.record463Error();
  tg4.lift();
  assert(liftedCalled, 'onTimelockLifted callback fired');

  // Test 13: reset() clears everything
  const tg5 = new TimelockGuard();
  tg5.record463Error();
  tg5.registerKnownChat('user@s.whatsapp.net');
  tg5.reset();
  assert(!tg5.isTimelocked(), 'Reset clears timelock');
  assert(tg5.getKnownChats().size === 0, 'Reset clears known chats');

  // Test 14: Expired timelock auto-lifts on canSend() check
  const tg6 = new TimelockGuard({ resumeBufferMs: 0 });
  tg6.onTimelockUpdate({
    isActive: true,
    timeEnforcementEnds: new Date(Date.now() - 1000), // Expired 1s ago
  });
  const result7 = tg6.canSend('new-contact@s.whatsapp.net');
  assert(result7.allowed, 'Expired timelock auto-lifts on canSend check');
  assert(!tg6.isTimelocked(), 'Timelock state updated after auto-lift');
}

function testTimelockHealth() {
  console.log('\n🏥 Timelock + Health');

  const hm = new HealthMonitor();

  // Test 1: recordReachoutTimelock() increases score by 25
  hm.recordReachoutTimelock('reachout');
  const status1 = hm.getStatus();
  assert(status1.score >= 25, `Timelock error increases score (${status1.score})`);
  assert(status1.stats.timelockErrors === 1, `timelockErrors stat is 1 (got ${status1.stats.timelockErrors})`);

  // Test 2: Multiple 463 errors are tracked (score is fixed at 25, but count increases)
  hm.recordReachoutTimelock('reachout');
  hm.recordReachoutTimelock('reachout');
  const status2 = hm.getStatus();
  assert(status2.stats.timelockErrors === 3, `Multiple timelocks tracked (${status2.stats.timelockErrors})`);
  assert(status2.score === 25, `Score is fixed at 25 for timelock (${status2.score})`);
  assert(status2.reasons.some(r => r.includes('3 reachout')), 'Reason mentions count');
}

async function testTimelockAntiBan() {
  console.log('\n🛡️ Timelock + AntiBan');

  const ab = new AntiBan({
    rateLimiter: { minDelayMs: 10, maxDelayMs: 20 },
    warmUp: { warmUpDays: 0 },
    logging: false,
  });

  // Activate timelock
  ab.timelock.record463Error();

  // Test 1: New contact blocked when timelocked
  const result1 = await ab.beforeSend('new-contact@s.whatsapp.net', 'hello');
  assert(!result1.allowed, 'AntiBan blocks new contact when timelocked');
  assert(result1.reason?.includes('timelock'), `Reason mentions timelock: ${result1.reason}`);

  // Test 2: Known chat allowed when timelocked
  ab.timelock.registerKnownChat('known-user@s.whatsapp.net');
  const result2 = await ab.beforeSend('known-user@s.whatsapp.net', 'hello');
  assert(result2.allowed, 'AntiBan allows known chat when timelocked');
  assert(result2.delayMs >= 0, `Delay applied: ${result2.delayMs}ms`);

  // Test 3: Group allowed when timelocked
  const result3 = await ab.beforeSend('123456789@g.us', 'hello group');
  assert(result3.allowed, 'AntiBan allows group when timelocked');

  // Test 4: antiban.timelock getter works
  assert(ab.timelock.isTimelocked(), 'AntiBan.timelock getter works');
  ab.timelock.lift();
  assert(!ab.timelock.isTimelocked(), 'Can lift via getter');

  // Test 5: After lift, new contacts allowed
  const result4 = await ab.beforeSend('another-new@s.whatsapp.net', 'hello');
  assert(result4.allowed, 'New contact allowed after timelock lifted');
}

// Run all tests
console.log('🧪 baileys-antiban test suite\n');

await testRateLimiter();
testWarmUp();
testHealthMonitor();
await testAntiBan();
await testTimelockGuard();
testTimelockHealth();
await testTimelockAntiBan();

console.log(`\n${'='.repeat(40)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) process.exit(1);
