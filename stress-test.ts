/**
 * Stress Test — Send 1000 messages as fast as safely possible
 * 
 * This pushes the anti-ban to its limits while keeping your number alive.
 * Run: AUTH_DIR=<path> npx tsx stress-test.ts <group-jid>
 */

import makeWASocket, { useMultiFileAuthState, DisconnectReason } from 'baileys';
import pino from 'pino';
import { AntiBan } from './src/antiban.js';
import { ContentVariator } from './src/contentVariator.js';

const AUTH_DIR = process.env.AUTH_DIR || './test-auth';
const GROUP_JID = process.argv[2];
const TARGET = parseInt(process.argv[3] || '1000');

if (!GROUP_JID) {
  console.log('Usage: AUTH_DIR=<path> npx tsx stress-test.ts <group-jid> [count]');
  process.exit(1);
}

// Aggressive but safe config
const antiban = new AntiBan({
  rateLimiter: {
    maxPerMinute: 12,        // Push it — 12/min
    maxPerHour: 500,          // 500/hr
    maxPerDay: 2000,          // 2000/day
    minDelayMs: 800,          // Fast but not instant
    maxDelayMs: 3000,         // Cap delay at 3s
    burstAllowance: 5,        // Allow 5 fast messages
    maxIdenticalMessages: 50, // High — we use variator
    newChatDelayMs: 500,      // Low — same group every time
  },
  warmUp: { warmUpDays: 0 },  // Skip warm-up for stress test
  health: {
    autoPauseAt: 'high',
    onRiskChange: (status) => {
      console.log(`\n⚠️  RISK: ${status.risk.toUpperCase()} (score: ${status.score}) — ${status.recommendation}\n`);
    },
  },
  logging: false,
});

const variator = new ContentVariator({
  zeroWidthChars: true,
  punctuationVariation: true,
  emojiPadding: false,
  synonyms: false,
});

// Message templates
const templates = [
  '🛡️ Stress test #{n}/1000 — anti-ban holding strong',
  '⚡ Message #{n} — speed run in progress',
  '🧪 #{n} — pushing the limits safely',
  '📊 #{n}/1000 — rate limiter active',
  '🔥 #{n} — no ban, no problem',
  '✅ #{n} sent — number still alive',
  '🏎️ Fast message #{n} — jitter applied',
  '💪 #{n}/1000 — endurance test',
  '🎯 #{n} — precision timing',
  '🌊 Wave #{n} — steady flow',
  '⏱️ #{n} — clock is ticking',
  '🚀 #{n}/1000 — full throttle safe mode',
  '📈 #{n} — stats looking good',
  '🔒 #{n} — protected by baileys-antiban',
  '🏁 #{n} — race to 1000',
];

console.log('🏎️  baileys-antiban STRESS TEST');
console.log('='.repeat(60));
console.log(`Target: ${GROUP_JID}`);
console.log(`Messages: ${TARGET}`);
console.log(`Config: 12/min, 500/hr, 800-3000ms delay`);
console.log(`Estimated time: ${Math.round(TARGET * 2 / 60)} - ${Math.round(TARGET * 4 / 60)} minutes`);
console.log('='.repeat(60));

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  });
  
  sock.ev.on('creds.update', saveCreds);

  // Monitor disconnects
  sock.ev.on('connection.update', async (update) => {
    if (update.connection === 'close') {
      const reason = (update.lastDisconnect?.error as any)?.output?.statusCode;
      antiban.onDisconnect(reason || 'unknown');
      console.log(`\n❌ DISCONNECTED: ${DisconnectReason[reason] || reason}`);
      
      if (reason === 403) {
        console.log('🔴 FORBIDDEN — WhatsApp is blocking us. Test stopped.');
        process.exit(1);
      }
      if (reason === 401) {
        console.log('🔴 LOGGED OUT — Possible ban. Test stopped.');
        process.exit(1);
      }
    }
  });

  return new Promise<void>((resolve) => {
    sock.ev.on('connection.update', async (update) => {
      if (update.connection !== 'open') return;
      
      console.log('\n✅ Connected! Starting stress test...\n');
      antiban.onReconnect();

      let sent = 0;
      let blocked = 0;
      let errors = 0;
      const startTime = Date.now();
      const milestones = new Set([10, 50, 100, 250, 500, 750, 1000]);

      for (let i = 1; i <= TARGET; i++) {
        const template = templates[(i - 1) % templates.length];
        const baseMsg = template.replace(/#{n}/g, String(i));
        const message = variator.vary(baseMsg);

        const decision = await antiban.beforeSend(GROUP_JID, message);

        if (!decision.allowed) {
          blocked++;
          // Wait a bit and retry once
          await new Promise(r => setTimeout(r, 5000));
          const retry = await antiban.beforeSend(GROUP_JID, message);
          if (!retry.allowed) {
            if (i % 50 === 0) console.log(`⛔ ${i}: Still blocked — ${retry.reason}`);
            continue;
          }
          await new Promise(r => setTimeout(r, retry.delayMs));
        } else {
          await new Promise(r => setTimeout(r, decision.delayMs));
        }

        try {
          await sock.sendMessage(GROUP_JID, { text: message });
          antiban.afterSend(GROUP_JID, message);
          sent++;

          // Progress indicator
          if (sent % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const rate = (sent / (parseInt(elapsed) || 1) * 60).toFixed(1);
            const eta = Math.round((TARGET - sent) / (parseFloat(rate) / 60));
            process.stdout.write(`\r📊 ${sent}/${TARGET} sent | ${blocked} blocked | ${rate}/min | ${elapsed}s elapsed | ETA: ${eta}s   `);
          }

          if (milestones.has(sent)) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const stats = antiban.getStats();
            console.log(`\n\n🏆 MILESTONE: ${sent} messages sent!`);
            console.log(`   Time: ${elapsed}s | Health: ${stats.health.risk} (score: ${stats.health.score})`);
            console.log(`   Rate: ${stats.rateLimiter.lastMinute}/min, ${stats.rateLimiter.lastHour}/hr`);
            console.log(`   Avg delay: ${(stats.totalDelayMs / sent / 1000).toFixed(1)}s per message\n`);
          }
        } catch (err: any) {
          errors++;
          antiban.afterSendFailed(err.message);
          if (errors > 10) {
            console.log(`\n\n🔴 Too many errors (${errors}). Stopping.`);
            break;
          }
        }
      }

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const finalStats = antiban.getStats();

      console.log(`\n\n${'='.repeat(60)}`);
      console.log(`🏁 STRESS TEST COMPLETE`);
      console.log(`${'='.repeat(60)}`);
      console.log(`✅ Sent: ${sent}/${TARGET}`);
      console.log(`⛔ Blocked: ${blocked}`);
      console.log(`❌ Errors: ${errors}`);
      console.log(`⏱️  Total time: ${totalTime}s (${(parseFloat(totalTime) / 60).toFixed(1)} min)`);
      console.log(`📈 Average rate: ${(sent / parseFloat(totalTime) * 60).toFixed(1)} msgs/min`);
      console.log(`⏳ Average delay: ${(finalStats.totalDelayMs / sent / 1000).toFixed(1)}s per message`);
      console.log(`🏥 Final health: ${finalStats.health.risk} (score: ${finalStats.health.score})`);
      console.log(`${sent === TARGET ? '🎉 ALL MESSAGES DELIVERED — NUMBER IS SAFE!' : '⚠️ Did not complete all messages'}`);
      console.log(`${'='.repeat(60)}\n`);

      setTimeout(() => {
        sock.end(undefined);
        resolve();
      }, 2000);
    });
  });
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
