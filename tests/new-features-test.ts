/**
 * Test for new v4.3 features:
 * 1. Per-contact risk delay multiplier
 * 2. Delivery success rate tracker
 */

import { AntiBan } from '../src/antiban.js';
import { DeliveryTracker } from '../src/deliveryTracker.js';

async function testDeliveryTracker() {
  console.log('\n=== Testing DeliveryTracker ===');

  let lowRateAlerts = 0;
  const tracker = new DeliveryTracker({
    windowMs: 60000, // 1 minute for testing
    minSampleSize: 5,
    lowRateThreshold: 0.6,
    onLowDeliveryRate: (rate) => {
      lowRateAlerts++;
      console.log(`⚠️  Low delivery rate: ${Math.round(rate * 100)}%`);
    },
  });

  // Send 10 messages
  for (let i = 0; i < 10; i++) {
    tracker.onMessageSent(`msg-${i}`);
  }

  // Mark only 3 as delivered (30% delivery rate, below 60% threshold)
  tracker.onDeliveryReceipt('msg-0');
  tracker.onDeliveryReceipt('msg-1');
  tracker.onDeliveryReceipt('msg-2');

  const stats = tracker.getStats();
  console.log(`Sent: ${stats.sentInWindow}, Delivered: ${stats.deliveredInWindow}`);
  console.log(`Delivery rate: ${stats.deliveryRate !== null ? Math.round(stats.deliveryRate * 100) + '%' : 'null (too few samples)'}`);
  console.log(`Low rate alerts triggered: ${lowRateAlerts}`);

  if (stats.sentInWindow !== 10) throw new Error('Expected 10 sent messages');
  if (stats.deliveredInWindow !== 3) throw new Error('Expected 3 delivered messages');
  if (stats.deliveryRate !== 0.3) throw new Error('Expected 30% delivery rate');
  if (lowRateAlerts !== 1) throw new Error('Expected 1 low rate alert');

  console.log('✅ DeliveryTracker tests passed');
}

async function testPerContactRiskMultiplier() {
  console.log('\n=== Testing Per-Contact Risk Multiplier ===');

  const antiban = new AntiBan({
    maxPerMinute: 10,
    maxPerHour: 100,
    maxPerDay: 500,
    minDelayMs: 1000,
    maxDelayMs: 2000,
    logging: false,
  });

  // Enable contact graph so the multiplier activates
  antiban.contactGraph['config'].enabled = true;

  // Test 1: Known contact should have no multiplier (1.0x)
  antiban.contactGraph.registerKnownContact('known@s.whatsapp.net');
  const knownDecision = await antiban.beforeSend('known@s.whatsapp.net', 'Hello');
  console.log(`Known contact delay: ${knownDecision.delayMs}ms`);

  // Test 2: Stranger should have 2.5x multiplier
  const strangerDecision = await antiban.beforeSend('stranger@s.whatsapp.net', 'Hello');
  console.log(`Stranger contact delay: ${strangerDecision.delayMs}ms`);

  // Test 3: Handshake sent should have 1.8x multiplier
  antiban.contactGraph.markHandshakeSent('handshake@s.whatsapp.net');
  // Fast forward time to avoid handshake delay check
  await new Promise(r => setTimeout(r, 100));
  const handshakeDecision = await antiban.beforeSend('handshake@s.whatsapp.net', 'Hello');
  console.log(`Handshake-sent contact delay: ${handshakeDecision.delayMs}ms`);

  // Verify stranger has longer delay than known contact
  if (strangerDecision.delayMs <= knownDecision.delayMs) {
    throw new Error(`Expected stranger delay (${strangerDecision.delayMs}ms) > known delay (${knownDecision.delayMs}ms)`);
  }

  console.log('✅ Per-contact risk multiplier tests passed');
}

async function testIntegration() {
  console.log('\n=== Testing Integration (DeliveryTracker in AntiBan) ===');

  const antiban = new AntiBan({
    maxPerMinute: 10,
    maxPerHour: 100,
    maxPerDay: 500,
    minDelayMs: 100,
    maxDelayMs: 200,
    logging: false,
  });

  // Send messages with msgIds
  const decision1 = await antiban.beforeSend('test@s.whatsapp.net', 'Message 1');
  if (decision1.allowed) {
    antiban.afterSend('test@s.whatsapp.net', 'Message 1', 'msg-1');
  }

  const decision2 = await antiban.beforeSend('test@s.whatsapp.net', 'Message 2');
  if (decision2.allowed) {
    antiban.afterSend('test@s.whatsapp.net', 'Message 2', 'msg-2');
  }

  // Simulate delivery receipts
  antiban.onDeliveryReceipt('msg-1');
  antiban.onDeliveryReceipt('msg-2');

  // Check stats
  const stats = antiban.getStats();
  console.log(`Delivery tracker stats:`, stats.deliveryTracker);

  if (stats.deliveryTracker.sentInWindow !== 2) {
    throw new Error('Expected 2 sent messages in delivery tracker');
  }
  if (stats.deliveryTracker.deliveredInWindow !== 2) {
    throw new Error('Expected 2 delivered messages in delivery tracker');
  }

  console.log('✅ Integration tests passed');
}

async function main() {
  console.log('Starting v4.3 feature tests...');

  try {
    await testDeliveryTracker();
    await testPerContactRiskMultiplier();
    await testIntegration();

    console.log('\n✅ ALL v4.3 TESTS PASSED');
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

main();
