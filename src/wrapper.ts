/**
 * Socket Wrapper — Drop-in replacement that wraps sendMessage with anti-ban protection
 * 
 * Usage:
 *   import makeWASocket from 'baileys';
 *   import { wrapSocket } from 'baileys-antiban';
 * 
 *   const sock = makeWASocket({ ... });
 *   const safeSock = wrapSocket(sock);
 * 
 *   // Use safeSock.sendMessage() — automatically rate-limited and monitored
 *   await safeSock.sendMessage(jid, { text: 'Hello!' });
 *   
 *   // Check health anytime
 *   console.log(safeSock.antiban.getStats());
 */

import { AntiBan, type AntiBanConfig } from './antiban.js';
import type { WarmUpState } from './warmup.js';

type WASocket = {
  sendMessage: (jid: string, content: any, options?: any) => Promise<any>;
  ev: any;
  [key: string]: any;
};

export interface WrappedSocket extends WASocket {
  antiban: AntiBan;
}

/**
 * Wrap a Baileys socket with anti-ban protection.
 * The returned socket has the same API but sendMessage() is protected.
 */
export function wrapSocket(
  sock: WASocket,
  config?: AntiBanConfig,
  warmUpState?: WarmUpState
): WrappedSocket {
  const antiban = new AntiBan(config, warmUpState);

  // Hook into connection events for health monitoring
  sock.ev.on('connection.update', (update: any) => {
    if (update.connection === 'close') {
      const reason = update.lastDisconnect?.error?.output?.statusCode || 'unknown';
      antiban.onDisconnect(reason);
    }
    if (update.connection === 'open') {
      antiban.onReconnect();
    }
  });

  // Create proxy that intercepts sendMessage
  const originalSendMessage = sock.sendMessage.bind(sock);
  
  const wrappedSendMessage = async (jid: string, content: any, options?: any) => {
    // Extract text content for rate limiter analysis
    const text = content?.text || content?.caption || content?.image?.caption || '';

    const decision = await antiban.beforeSend(jid, text);

    if (!decision.allowed) {
      throw new Error(`[baileys-antiban] Message blocked: ${decision.reason}`);
    }

    // Apply delay
    if (decision.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, decision.delayMs));
    }

    // Send message
    try {
      const result = await originalSendMessage(jid, content, options);
      antiban.afterSend(jid, text);
      return result;
    } catch (error) {
      antiban.afterSendFailed(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  // Return enhanced socket
  const wrapped = Object.create(sock) as WrappedSocket;
  wrapped.sendMessage = wrappedSendMessage;
  wrapped.antiban = antiban;

  return wrapped;
}
