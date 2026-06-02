/**
 * Example: Using InstanceCoordinator for cross-process rate pooling
 *
 * Problem:
 * Running 5 bot instances on the same IP, each with maxPerMinute: 8
 * → Collectively sending 40 msg/min from one IP
 * → WhatsApp flags this as suspicious behavior
 *
 * Solution:
 * Enable instance coordination with a shared file-based rate pool.
 * All instances on the same IP will respect a shared per-minute/per-hour limit.
 */

import { AntiBan } from 'baileys-antiban';
import * as path from 'path';

// Path to shared coordination file (must be the same for all instances)
// Use a directory that's accessible to all bot processes:
// - Single server: /tmp/whatsapp-bots/rate-pool.json
// - NFS mount: /mnt/shared/whatsapp-bots/rate-pool.json
const SHARED_COORD_FILE = path.join('/tmp', 'whatsapp-bots', 'rate-pool.json');

// Create AntiBan instance with coordination enabled
const antiban = new AntiBan({
  preset: 'moderate',

  // Per-instance limits (these still apply to each bot individually)
  maxPerMinute: 8,
  maxPerHour: 300,

  // SHARED cross-instance limits (enforced across ALL bots on this IP)
  instanceCoordinator: SHARED_COORD_FILE,
  instancePoolMaxPerMinute: 20,  // Total budget for all instances combined
  instancePoolMaxPerHour: 500,   // Total hourly budget across all instances
});

// Usage: same as normal, but now rate limiting is coordinated across instances
async function sendMessage(recipient: string, text: string) {
  const decision = await antiban.beforeSend(recipient, text);

  if (!decision.allowed) {
    console.log(`❌ Message blocked: ${decision.reason}`);
    if (decision.reason?.includes('Cross-instance')) {
      console.log(`   Shared IP pool exhausted. Waiting ${decision.delayMs}ms`);
    }
    return;
  }

  // Wait for the calculated delay
  await new Promise(resolve => setTimeout(resolve, decision.delayMs));

  // Send the message (pseudo-code)
  // await sock.sendMessage({ id: recipient }, { text });

  // Record the send
  antiban.afterSend(recipient, text);
  console.log(`✅ Message sent to ${recipient}`);
}

// Check instance coordinator stats
const stats = antiban.getStats();
if (stats.instanceCoordinator) {
  console.log('Instance Coordinator Stats:');
  console.log(`  Pool utilization: ${(stats.instanceCoordinator.poolUtilization * 100).toFixed(0)}%`);
  console.log(`  Sends in last minute: ${stats.instanceCoordinator.poolSendsLastMinute}/${stats.instanceCoordinator.poolMaxPerMinute}`);
  console.log(`  Sends in last hour: ${stats.instanceCoordinator.poolSendsLastHour}/${stats.instanceCoordinator.poolMaxPerHour}`);
}

// When shutting down
antiban.destroy();

/**
 * Recommended limits based on your setup:
 *
 * New accounts (< 1 month):
 *   instancePoolMaxPerMinute: 15
 *   instancePoolMaxPerHour: 300
 *
 * Established accounts (1-6 months):
 *   instancePoolMaxPerMinute: 20
 *   instancePoolMaxPerHour: 500
 *
 * Mature accounts (6+ months, no ban history):
 *   instancePoolMaxPerMinute: 30
 *   instancePoolMaxPerHour: 800
 *
 * Multi-server setups:
 *   - Use NFS mount or shared Redis for coordination file
 *   - Each server's instances should share the same coordination file
 *   - Pool limits should be PER IP ADDRESS, not global
 *
 * Example for 5 instances:
 *   Each instance: maxPerMinute: 8 (local limit)
 *   Shared pool: instancePoolMaxPerMinute: 20 (IP-level limit)
 *   → Prevents collective blast from one IP
 *   → Each instance can still burst to 8/min if pool has capacity
 */
