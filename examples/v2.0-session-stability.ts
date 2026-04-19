/**
 * Example: Using Session Stability Module (v2.0)
 *
 * This example demonstrates the most common v2.0 usage pattern:
 * - Wrap socket with session stability features
 * - Monitor session health
 * - Handle disconnect reasons intelligently
 * - Auto-canonicalize JIDs to prevent Bad MAC errors
 */

import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { wrapWithSessionStability, classifyDisconnect, LidResolver } from 'baileys-antiban';

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  // Create LID resolver with persistence
  const lidResolver = new LidResolver({
    canonical: 'pn',  // Prefer phone-number form to reduce Bad MAC
    maxEntries: 10_000,
    persistence: {
      load: async () => {
        try {
          return JSON.parse(await fs.readFile('lid-mappings.json', 'utf8'));
        } catch {
          return {};
        }
      },
      save: async (map) => {
        await fs.writeFile('lid-mappings.json', JSON.stringify(map, null, 2));
      },
    },
  });

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  // Wrap socket with session stability features
  const safeSock = wrapWithSessionStability(sock, {
    canonicalJidNormalization: true,  // Auto-fix JIDs before sending
    healthMonitoring: true,           // Track Bad MAC rate
    lidResolver,
    health: {
      badMacThreshold: 3,
      badMacWindowMs: 60_000,
      onDegraded: (stats) => {
        console.error('🔴 SESSION DEGRADED');
        console.error(`Bad MAC errors: ${stats.badMacCount} in last minute`);
        console.error('Recommendation: Restart session or clear auth state');
        // Consider auto-restarting here
      },
      onRecovered: () => {
        console.log('🟢 Session health recovered');
      },
    },
  });

  // Handle connection updates with typed disconnect reasons
  safeSock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const classification = classifyDisconnect(statusCode);

      console.log(`Disconnected: ${classification.message}`);
      console.log(`Category: ${classification.category}`);

      if (classification.shouldReconnect) {
        if (classification.backoffMs) {
          console.log(`Waiting ${classification.backoffMs}ms before reconnect...`);
          await new Promise(resolve => setTimeout(resolve, classification.backoffMs));
        }
        connectToWhatsApp(); // Reconnect
      } else {
        console.log('Fatal disconnect - not reconnecting automatically');
        // Handle QR re-scan or exit
      }
    } else if (connection === 'open') {
      console.log('Connected to WhatsApp');
    }
  });

  // Auto-learn LID mappings from incoming messages
  safeSock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      const participant = msg.key.participant;

      // Learn from message sender
      if (jid && jid.endsWith('@lid')) {
        lidResolver.learn({ lid: jid });
      }
      if (participant && participant.endsWith('@lid')) {
        lidResolver.learn({ lid: participant });
      }
    }
  });

  // Monitor decrypt failures (optional - health monitor does this automatically)
  safeSock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (update.messageStubType) {
        // Bad MAC or decrypt failure detected
        const healthMonitor = (safeSock as any).sessionHealthMonitor;
        if (healthMonitor) {
          healthMonitor.recordDecryptFail(true);
        }
      }
    }
  });

  safeSock.ev.on('creds.update', saveCreds);

  // Usage: send messages (JIDs auto-canonicalized)
  await safeSock.sendMessage('123456@lid', { text: 'Hello!' });
  // ^ Automatically canonicalized to phone number form if mapping exists

  // Check session health anytime
  const healthStats = (safeSock as any).sessionHealthStats;
  console.log(`Session health: ${healthStats.isDegraded ? 'DEGRADED' : 'OK'}`);
  console.log(`Bad MAC count: ${healthStats.badMacCount}`);
}

connectToWhatsApp().catch(console.error);
