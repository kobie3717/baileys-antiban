/**
 * baileys-antiban Test Bot
 * 
 * Connects to WhatsApp and demonstrates the anti-ban system live.
 * Run: npx tsx bot.ts <group-jid> [message-count]
 * 
 * It will:
 * 1. Connect to WhatsApp (reuses existing auth)
 * 2. Send messages to the target group
 * 3. Show rate limiting, delays, health status in real-time
 * 4. Try to trigger blocks to prove the system works
 */

import makeWASocket, { useMultiFileAuthState, DisconnectReason } from 'baileys';
import pino from 'pino';
import { wrapSocket } from './src/wrapper.js';
import { AntiBan } from './src/antiban.js';

const AUTH_DIR = process.env.AUTH_DIR || './test-auth';
const GROUP_JID = process.argv[2];
const MESSAGE_COUNT = parseInt(process.argv[3] || '20');

if (!GROUP_JID) {
  console.log('Usage: npx tsx bot.ts <group-jid> [message-count]');
  console.log('Example: npx tsx bot.ts 120363424362484044@g.us 15');
  process.exit(1);
}

console.log('🛡️  baileys-antiban Test Bot');
console.log('='.repeat(50));
console.log(`Target: ${GROUP_JID}`);
console.log(`Messages to send: ${MESSAGE_COUNT}`);
console.log(`Auth dir: ${AUTH_DIR}`);
console.log('='.repeat(50));

// Test messages with variety (to avoid identical message blocking)
const testMessages = [
  '🛡️ Anti-ban test message #{n} — checking rate limiter',
  '⏱️ Message #{n} sent at {time} — measuring delay',
  '🧪 Test #{n} — the bot is working correctly',
  '📊 Stats check #{n} — monitoring health score',
  '🔧 Calibration message #{n} — tuning parameters',
  '✅ Verification #{n} — all systems nominal',
  '🌱 Warm-up test #{n} — gradual ramp active',
  '🏥 Health check #{n} — risk level monitored',
  '⚡ Speed test #{n} — jitter applied',
  '🎯 Accuracy test #{n} — timing verified',
];

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  // Wrap with anti-ban — aggressive config to see it in action
  const safeSock = wrapSocket(sock, {
    rateLimiter: {
      maxPerMinute: 6,
      maxPerHour: 50,
      minDelayMs: 2000,
      maxDelayMs: 6000,
      maxIdenticalMessages: 2,
      burstAllowance: 2,
    },
    warmUp: {
      warmUpDays: 0, // Skip for testing
    },
    health: {
      autoPauseAt: 'high',
      onRiskChange: (status) => {
        console.log(`\n${'!'.repeat(50)}`);
        console.log(`RISK CHANGE: ${status.risk.toUpperCase()} (score: ${status.score})`);
        console.log(`Recommendation: ${status.recommendation}`);
        console.log(`${'!'.repeat(50)}\n`);
      },
    },
    logging: true,
  });

  return new Promise<void>((resolve) => {
    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        console.log('\n✅ Connected to WhatsApp!\n');

        let sent = 0;
        let blocked = 0;
        const startTime = Date.now();

        for (let i = 1; i <= MESSAGE_COUNT; i++) {
          const template = testMessages[(i - 1) % testMessages.length];
          const message = template
            .replace('{n}', String(i))
            .replace('{time}', new Date().toLocaleTimeString());

          console.log(`\n--- Message ${i}/${MESSAGE_COUNT} ---`);

          try {
            const beforeTime = Date.now();
            await safeSock.sendMessage(GROUP_JID, { text: message });
            const afterTime = Date.now();
            const totalDelay = afterTime - beforeTime;

            sent++;
            console.log(`✅ SENT in ${totalDelay}ms (includes anti-ban delay)`);
          } catch (err: any) {
            if (err.message.includes('baileys-antiban')) {
              blocked++;
              console.log(`⛔ BLOCKED: ${err.message}`);
            } else {
              console.log(`❌ ERROR: ${err.message}`);
            }
          }

          // Print stats every 5 messages
          if (i % 5 === 0 || i === MESSAGE_COUNT) {
            const stats = safeSock.antiban.getStats();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`\n📊 Stats after ${i} attempts (${elapsed}s elapsed):`);
            console.log(`   Sent: ${sent} | Blocked: ${blocked}`);
            console.log(`   Rate: ${stats.rateLimiter.lastMinute}/min, ${stats.rateLimiter.lastHour}/hr`);
            console.log(`   Health: ${stats.health.risk} (score: ${stats.health.score})`);
            console.log(`   Total delay added: ${(stats.totalDelayMs / 1000).toFixed(1)}s`);
            if (stats.warmUp.phase === 'warming') {
              console.log(`   Warm-up: day ${stats.warmUp.day}/${stats.warmUp.totalDays} (${stats.warmUp.todaySent}/${stats.warmUp.todayLimit} today)`);
            }
          }
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n${'='.repeat(50)}`);
        console.log(`🏁 DONE — ${sent} sent, ${blocked} blocked in ${totalTime}s`);
        console.log(`   Without anti-ban: ~${sent * 0.1}s`);
        console.log(`   With anti-ban: ${totalTime}s`);
        console.log(`   That's ${(parseFloat(totalTime) / (sent * 0.1)).toFixed(0)}x slower but ${sent > 0 ? 'your number is safe' : 'everything was blocked'}!`);
        console.log(`${'='.repeat(50)}\n`);

        // Clean exit
        setTimeout(() => {
          sock.end(undefined);
          resolve();
        }, 2000);
      }

      if (update.connection === 'close') {
        const reason = (update.lastDisconnect?.error as any)?.output?.statusCode;
        console.log(`\n❌ Disconnected: ${DisconnectReason[reason] || reason}`);

        if (reason === DisconnectReason.loggedOut) {
          console.log('⚠️  Logged out — scan QR code again');
        }
        resolve();
      }

      if (update.qr) {
        console.log('\n📱 Scan this QR code with WhatsApp:');
      }
    });
  });
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
