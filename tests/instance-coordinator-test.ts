/**
 * Manual test for InstanceCoordinator
 */

import { InstanceCoordinator } from '../src/instanceCoordinator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

console.log('\n=== Testing InstanceCoordinator ===\n');

// Use temp directory for test file
const testFile = path.join(os.tmpdir(), `antiban-coord-test-${Date.now()}.json`);

// Create coordinator with low limits for testing
const coordinator = new InstanceCoordinator({
  sharedFilePath: testFile,
  poolMaxPerMinute: 5,
  poolMaxPerHour: 20,
  poolExhaustedDelayMs: 1000,
});

console.log('✅ Coordinator created');

// Test 1: First 5 sends should succeed
console.log('\nTest 1: Acquiring slots within per-minute limit');
for (let i = 0; i < 5; i++) {
  const result = coordinator.tryAcquireSlot();
  console.log(`  Slot ${i + 1}: allowed=${result.allowed}`);
  if (!result.allowed) {
    console.error('❌ FAILED: Should have been allowed');
    process.exit(1);
  }
}

// Test 2: 6th send should fail (per-minute exceeded)
console.log('\nTest 2: Exceeding per-minute limit');
const blocked = coordinator.tryAcquireSlot();
console.log(`  Slot 6: allowed=${blocked.allowed}, retryAfterMs=${blocked.retryAfterMs}`);
if (blocked.allowed) {
  console.error('❌ FAILED: Should have been blocked');
  process.exit(1);
}
console.log('✅ Correctly blocked when per-minute limit exceeded');

// Test 3: Check stats
console.log('\nTest 3: Checking stats');
const stats = coordinator.getStats();
console.log('  Stats:', JSON.stringify(stats, null, 2));
if (stats.poolSendsLastMinute !== 5) {
  console.error(`❌ FAILED: Expected 5 sends in last minute, got ${stats.poolSendsLastMinute}`);
  process.exit(1);
}
if (stats.poolUtilization < 0.99 || stats.poolUtilization > 1.01) {
  console.error(`❌ FAILED: Expected utilization ~1.0, got ${stats.poolUtilization}`);
  process.exit(1);
}
console.log('✅ Stats are correct');

// Test 4: Multi-instance simulation
console.log('\nTest 4: Simulating multiple instances');
const coordinator2 = new InstanceCoordinator({
  sharedFilePath: testFile,
  poolMaxPerMinute: 5,
  poolMaxPerHour: 20,
});

const stats2 = coordinator2.getStats();
console.log(`  Instance 2 sees ${stats2.poolSendsLastMinute} sends in last minute`);
if (stats2.poolSendsLastMinute !== 5) {
  console.error(`❌ FAILED: Instance 2 should see same pool state (5 sends), got ${stats2.poolSendsLastMinute}`);
  process.exit(1);
}

const blocked2 = coordinator2.tryAcquireSlot();
console.log(`  Instance 2 slot attempt: allowed=${blocked2.allowed}`);
if (blocked2.allowed) {
  console.error('❌ FAILED: Instance 2 should be blocked by shared pool');
  process.exit(1);
}
console.log('✅ Multi-instance coordination works');

// Test 5: File format validation
console.log('\nTest 5: Validating file format');
if (fs.existsSync(testFile)) {
  const content = fs.readFileSync(testFile, 'utf-8');
  const parsed = JSON.parse(content);
  console.log(`  File contains ${parsed.sends.length} timestamps`);
  if (!Array.isArray(parsed.sends) || typeof parsed.updatedAt !== 'number') {
    console.error('❌ FAILED: Invalid file format');
    process.exit(1);
  }
  console.log('✅ File format is valid');
} else {
  console.error('❌ FAILED: Coordination file not created');
  process.exit(1);
}

// Test 6: Cleanup old timestamps
console.log('\nTest 6: Testing timestamp pruning');
// Manually inject old timestamps
const oldState = {
  sends: [
    Date.now() - 8000000, // 2+ hours old
    Date.now() - 4000000, // 1+ hours old
    Date.now() - 70000,   // > 1 minute old
    Date.now() - 30000,   // < 1 minute old
    Date.now() - 10000,   // < 1 minute old
  ],
  updatedAt: Date.now(),
};
fs.writeFileSync(testFile, JSON.stringify(oldState), 'utf-8');

const coordinator3 = new InstanceCoordinator({
  sharedFilePath: testFile,
  poolMaxPerMinute: 5,
  poolMaxPerHour: 20,
});

const stats3 = coordinator3.getStats();
console.log(`  Coordinator sees ${stats3.poolSendsLastMinute} sends in last minute (should filter old ones)`);
// Should only see the 2 timestamps < 1 minute old
if (stats3.poolSendsLastMinute !== 2) {
  console.error(`❌ FAILED: Expected 2 recent sends, got ${stats3.poolSendsLastMinute}`);
  process.exit(1);
}
console.log('✅ Old timestamps correctly filtered');

// Cleanup
try {
  fs.unlinkSync(testFile);
  console.log('\n✅ Test file cleaned up');
} catch (err) {
  console.warn('Warning: Could not delete test file:', err);
}

console.log('\n✅ ALL INSTANCE COORDINATOR TESTS PASSED\n');
