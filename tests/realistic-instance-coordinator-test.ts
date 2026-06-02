/**
 * Realistic test: Simulating 5 bot instances on same IP
 *
 * Scenario:
 * - 5 bots, each configured with maxPerMinute: 8
 * - Shared pool: instancePoolMaxPerMinute: 20
 * - Without coordination: 5 × 8 = 40 msg/min from one IP (instant flag)
 * - With coordination: max 20 msg/min from IP (safe)
 */

import { AntiBan } from '../src/antiban.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

console.log('\n=== Realistic Scenario: 5 Bot Instances on Same IP ===\n');

const testFile = path.join(os.tmpdir(), `antiban-coord-realistic-${Date.now()}.json`);

// Create 5 bot instances
const bots: AntiBan[] = [];
console.log('Creating 5 bot instances...');
for (let i = 0; i < 5; i++) {
  const bot = new AntiBan({
    preset: 'moderate',
    maxPerMinute: 8,              // Each bot can send up to 8/min locally
    instanceCoordinator: testFile,
    instancePoolMaxPerMinute: 20, // But collectively max 20/min from this IP
    instancePoolMaxPerHour: 500,
    logging: false,
  });
  bots.push(bot);
  console.log(`  Bot ${i + 1}: created`);
}

console.log('\n✅ All 5 bots created with shared coordination\n');

// Simulate concurrent sending from all bots
console.log('Simulating concurrent message sending...\n');

let totalAllowed = 0;
let totalBlocked = 0;

// Each bot tries to send 5 messages (25 total attempts)
const sendPromises: Promise<void>[] = [];

for (let botIdx = 0; botIdx < bots.length; botIdx++) {
  const bot = bots[botIdx];

  for (let msgIdx = 0; msgIdx < 5; msgIdx++) {
    const promise = (async () => {
      const recipient = `user${botIdx}_${msgIdx}@s.whatsapp.net`;
      const result = await bot.beforeSend(recipient, `Message from bot ${botIdx + 1}`);

      if (result.allowed) {
        totalAllowed++;
        bot.afterSend(recipient, `Message from bot ${botIdx + 1}`);
        console.log(`✅ Bot ${botIdx + 1}, msg ${msgIdx + 1}: ALLOWED`);
      } else {
        totalBlocked++;
        const reason = result.reason?.includes('Cross-instance') ? 'POOL EXHAUSTED' : result.reason;
        console.log(`❌ Bot ${botIdx + 1}, msg ${msgIdx + 1}: BLOCKED (${reason})`);
      }
    })();

    sendPromises.push(promise);
  }
}

// Wait for all sends to complete
await Promise.all(sendPromises);

console.log('\n=== Results ===');
console.log(`Total attempts: 25`);
console.log(`Allowed: ${totalAllowed}`);
console.log(`Blocked: ${totalBlocked}`);
console.log(`Success rate: ${((totalAllowed / 25) * 100).toFixed(1)}%`);

// Verify pool limit was enforced
if (totalAllowed > 20) {
  console.error(`\n❌ FAILED: Pool limit exceeded! ${totalAllowed} messages allowed (max: 20)`);
  process.exit(1);
}

console.log(`\n✅ Pool limit enforced: ${totalAllowed} ≤ 20`);

// Check stats from each bot
console.log('\n=== Bot Stats ===');
for (let i = 0; i < bots.length; i++) {
  const stats = bots[i].getStats();
  console.log(`Bot ${i + 1}:`);
  console.log(`  Messages allowed: ${stats.messagesAllowed}`);
  console.log(`  Messages blocked: ${stats.messagesBlocked}`);
  if (stats.instanceCoordinator) {
    console.log(`  Pool sends seen: ${stats.instanceCoordinator.poolSendsLastMinute}`);
    console.log(`  Pool utilization: ${(stats.instanceCoordinator.poolUtilization * 100).toFixed(0)}%`);
  }
}

// Verify all bots see the same pool state
const poolStates = bots
  .map(b => b.getStats().instanceCoordinator?.poolSendsLastMinute)
  .filter(s => s !== undefined);

const uniqueStates = new Set(poolStates);
if (uniqueStates.size !== 1) {
  console.error(`\n❌ FAILED: Bots see inconsistent pool states: ${Array.from(uniqueStates).join(', ')}`);
  process.exit(1);
}

console.log(`\n✅ All bots see consistent pool state: ${poolStates[0]} sends`);

// Verify coordination file
console.log('\n=== Coordination File ===');
const fileContent = fs.readFileSync(testFile, 'utf-8');
const parsed = JSON.parse(fileContent);
console.log(`Timestamps stored: ${parsed.sends.length}`);
console.log(`Last updated: ${new Date(parsed.updatedAt).toISOString()}`);

if (parsed.sends.length !== totalAllowed) {
  console.error(`❌ FAILED: File has ${parsed.sends.length} timestamps, expected ${totalAllowed}`);
  process.exit(1);
}

console.log(`✅ File correctly stores ${totalAllowed} timestamps`);

// Cleanup
for (const bot of bots) {
  bot.destroy();
}

try {
  fs.unlinkSync(testFile);
  console.log('\n✅ Test file cleaned up');
} catch (err) {
  console.warn('Warning: Could not delete test file:', err);
}

console.log('\n✅ ALL REALISTIC SCENARIO TESTS PASSED');
console.log('\n💡 Key Insight:');
console.log('   Without coordination: 5 bots × 8 msg/min = 40 msg/min (flagged)');
console.log(`   With coordination: max ${totalAllowed} msg/min (safe)`);
console.log('\n');
