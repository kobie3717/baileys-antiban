/**
 * Integration test: AntiBan with InstanceCoordinator
 */

import { AntiBan } from '../src/antiban.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

console.log('\n=== Testing AntiBan with InstanceCoordinator ===\n');

const testFile = path.join(os.tmpdir(), `antiban-coord-integration-${Date.now()}.json`);

// Create two AntiBan instances sharing the same coordination file
console.log('Creating two AntiBan instances with shared coordination file...');
const antiban1 = new AntiBan({
  preset: 'moderate',
  maxPerMinute: 10,
  instanceCoordinator: testFile,
  instancePoolMaxPerMinute: 3,  // Very low limit for testing
  instancePoolMaxPerHour: 10,
  logging: false,
});

const antiban2 = new AntiBan({
  preset: 'moderate',
  maxPerMinute: 10,
  instanceCoordinator: testFile,
  instancePoolMaxPerMinute: 3,  // Same shared limit
  instancePoolMaxPerHour: 10,
  logging: false,
});

console.log('✅ Both instances created');

// Test: Instance 1 sends 2 messages (should succeed)
console.log('\nTest 1: Instance 1 sends 2 messages');
for (let i = 0; i < 2; i++) {
  const result = await antiban1.beforeSend('user1@s.whatsapp.net', `Test message ${i + 1}`);
  console.log(`  Message ${i + 1}: allowed=${result.allowed}`);
  if (!result.allowed) {
    console.error(`❌ FAILED: Message ${i + 1} should have been allowed`);
    process.exit(1);
  }
  antiban1.afterSend('user1@s.whatsapp.net', `Test message ${i + 1}`);
}
console.log('✅ Instance 1 sent 2 messages');

// Test: Instance 2 sends 1 message (should succeed, reaches pool limit of 3)
console.log('\nTest 2: Instance 2 sends 1 message (pool now at 3/3)');
const result3 = await antiban2.beforeSend('user2@s.whatsapp.net', 'Test message 3');
console.log(`  Message 3: allowed=${result3.allowed}`);
if (!result3.allowed) {
  console.error('❌ FAILED: Message 3 should have been allowed');
  process.exit(1);
}
antiban2.afterSend('user2@s.whatsapp.net', 'Test message 3');
console.log('✅ Instance 2 sent 1 message (pool now full)');

// Test: Instance 1 tries to send 4th message (should be blocked by pool)
console.log('\nTest 3: Instance 1 tries to send 4th message (should be blocked)');
const result4 = await antiban1.beforeSend('user1@s.whatsapp.net', 'Test message 4');
console.log(`  Message 4: allowed=${result4.allowed}, reason=${result4.reason}`);
if (result4.allowed) {
  console.error('❌ FAILED: Message 4 should have been blocked by instance pool');
  process.exit(1);
}
if (!result4.reason?.includes('Cross-instance')) {
  console.error(`❌ FAILED: Expected 'Cross-instance' reason, got: ${result4.reason}`);
  process.exit(1);
}
console.log('✅ Message correctly blocked by instance pool');

// Test: Instance 2 also blocked
console.log('\nTest 4: Instance 2 also blocked by same pool');
const result5 = await antiban2.beforeSend('user2@s.whatsapp.net', 'Test message 5');
console.log(`  Message 5: allowed=${result5.allowed}`);
if (result5.allowed) {
  console.error('❌ FAILED: Message 5 should have been blocked by instance pool');
  process.exit(1);
}
console.log('✅ Instance 2 also correctly blocked');

// Test: Check stats
console.log('\nTest 5: Checking instance coordinator stats');
const stats1 = antiban1.getStats();
const stats2 = antiban2.getStats();

console.log('  Instance 1 stats:', {
  messagesBlocked: stats1.messagesBlocked,
  poolUtilization: stats1.instanceCoordinator?.poolUtilization,
  poolSendsLastMinute: stats1.instanceCoordinator?.poolSendsLastMinute,
});

console.log('  Instance 2 stats:', {
  messagesBlocked: stats2.messagesBlocked,
  poolUtilization: stats2.instanceCoordinator?.poolUtilization,
  poolSendsLastMinute: stats2.instanceCoordinator?.poolSendsLastMinute,
});

// Both instances should see the same pool state
if (!stats1.instanceCoordinator || !stats2.instanceCoordinator) {
  console.error('❌ FAILED: Instance coordinator stats missing');
  process.exit(1);
}

if (stats1.instanceCoordinator.poolSendsLastMinute !== 3) {
  console.error(`❌ FAILED: Instance 1 should see 3 sends, got ${stats1.instanceCoordinator.poolSendsLastMinute}`);
  process.exit(1);
}

if (stats2.instanceCoordinator.poolSendsLastMinute !== 3) {
  console.error(`❌ FAILED: Instance 2 should see 3 sends, got ${stats2.instanceCoordinator.poolSendsLastMinute}`);
  process.exit(1);
}

if (Math.abs(stats1.instanceCoordinator.poolUtilization - 1.0) > 0.01) {
  console.error(`❌ FAILED: Pool should be at 100% utilization, got ${stats1.instanceCoordinator.poolUtilization}`);
  process.exit(1);
}

console.log('✅ Both instances see consistent pool state');

// Test: Verify file was created
console.log('\nTest 6: Verifying coordination file');
if (!fs.existsSync(testFile)) {
  console.error('❌ FAILED: Coordination file not created');
  process.exit(1);
}
const fileContent = fs.readFileSync(testFile, 'utf-8');
const parsed = JSON.parse(fileContent);
console.log(`  File contains ${parsed.sends.length} timestamps`);
if (parsed.sends.length !== 3) {
  console.error(`❌ FAILED: Expected 3 timestamps in file, got ${parsed.sends.length}`);
  process.exit(1);
}
console.log('✅ Coordination file is correct');

// Cleanup
antiban1.destroy();
antiban2.destroy();
try {
  fs.unlinkSync(testFile);
  console.log('\n✅ Test file cleaned up');
} catch (err) {
  console.warn('Warning: Could not delete test file:', err);
}

console.log('\n✅ ALL INTEGRATION TESTS PASSED\n');
