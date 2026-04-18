/**
 * Socket Wrapper — Drop-in replacement that wraps sendMessage with anti-ban protection
 *
 * Works with both baileys and @oxidezap/baileyrs transports.
 *
 * Usage with baileys:
 *   import makeWASocket from 'baileys';
 *   import { wrapSocket } from 'baileys-antiban';
 *
 *   const sock = makeWASocket({ ... });
 *   const safeSock = wrapSocket(sock);
 *
 * Usage with baileyrs:
 *   import { makeWASocket } from '@oxidezap/baileyrs';
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
 *
 * Note: reachoutTimeLock timelock module silently noops on baileyrs until upstream
 * emits reachoutTimeLock events — confirmed NOT present in baileyrs v0.0.8.
 * Timelock guard will operate in detection-only mode (relies on 463 errors only).
 */

import { AntiBan, type AntiBanConfig } from './antiban.js';
import type { WarmUpState } from './warmup.js';

export type WASocket = {
  sendMessage: (jid: string, content: any, options?: any) => Promise<any>;
  ev: any;
  [key: string]: any;
};

/**
 * A Baileys socket wrapped with anti-ban protection.
 *
 * Generic over the input socket type `T` so the full Baileys typings
 * (including strong return types on `sendMessage`) are preserved.
 * `safeSock.antiban.getStats()` is now correctly typed as `AntiBanStats`.
 */
export interface WrapSocketOptions {
  /** Auto-respond to incoming messages when reply ratio suggests it (default: false) */
  autoRespondToIncoming?: boolean;
}

export type WrappedSocket<T extends WASocket = WASocket> = T & {
  antiban: AntiBan;
};

/**
 * Wrap a Baileys socket with anti-ban protection.
 * The returned socket has the same API but sendMessage() is protected.
 */
export function wrapSocket<T extends WASocket>(
  sock: T,
  config?: AntiBanConfig,
  warmUpState?: WarmUpState,
  wrapOptions?: WrapSocketOptions
): WrappedSocket<T> {
  const antiban = new AntiBan(config, warmUpState);
  const options: Required<WrapSocketOptions> = {
    autoRespondToIncoming: false,
    ...wrapOptions,
  };

  // Hook into Baileys events for health monitoring
  // Prefer ev.process() (Baileys ≥ late 2022) for batched event handling
  // Fall back to ev.on() for older versions
  if (typeof sock.ev.process === 'function') {
    sock.ev.process(async (events: any) => {
      // Handle connection updates
      if (events['connection.update']) {
        const update = events['connection.update'];
        if (update.connection === 'close') {
          const reason = update.lastDisconnect?.error?.output?.statusCode || 'unknown';
          antiban.onDisconnect(reason);
          antiban.destroy(); // Clean up all timers
        }
        if (update.connection === 'open') {
          antiban.onReconnect();
        }
        // Reachout timelock detection
        if (update.reachoutTimeLock) {
          antiban.timelock.onTimelockUpdate({
            isActive: update.reachoutTimeLock.isActive,
            timeEnforcementEnds: update.reachoutTimeLock.timeEnforcementEnds,
            enforcementType: update.reachoutTimeLock.enforcementType,
          });
        }
      }

      // Catch 463 errors from message updates + track retries
      if (events['messages.update']) {
        const updates = events['messages.update'];
        for (const update of updates) {
          // 463 error detection
          if (update?.update?.messageStubParameters) {
            const params = update.update.messageStubParameters;
            if (params.includes(463) || params.includes('463')) {
              antiban.timelock.record463Error();
            }
          }
          // Retry tracking
          antiban.retryTracker.onMessageUpdate(update);
        }
      }

      // Register known chats from incoming messages + handle reply suggestions
      if (events['messages.upsert']) {
        const { messages } = events['messages.upsert'];
        for (const msg of messages || []) {
          const jid = msg.key?.remoteJid;
          if (!jid) continue;

          // Register known chat
          antiban.timelock.registerKnownChat(jid);

          // Skip self messages
          const isSelf = msg.key?.fromMe || false;
          if (isSelf) continue;

          // Extract message text
          const msgText =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

          // Handle incoming message (updates reply ratio + contact graph)
          const replySuggestion = antiban.onIncomingMessage(jid, msgText);

          // Auto-respond if enabled and suggested
          if (options.autoRespondToIncoming && replySuggestion.shouldReply && replySuggestion.suggestedText) {
            // Random delay 3-15s
            const replyDelay = Math.floor(Math.random() * 12000) + 3000;
            setTimeout(async () => {
              try {
                await sock.sendMessage(jid, { text: replySuggestion.suggestedText });
              } catch (error) {
                // Silently fail — auto-reply is best-effort
              }
            }, replyDelay);
          }
        }
      }
    });
  } else {
    // Fallback to ev.on() for older Baileys versions
    sock.ev.on('connection.update', (update: any) => {
      if (update.connection === 'close') {
        const reason = update.lastDisconnect?.error?.output?.statusCode || 'unknown';
        antiban.onDisconnect(reason);
        antiban.destroy(); // Clean up all timers
      }
      if (update.connection === 'open') {
        antiban.onReconnect();
      }
      // Reachout timelock detection
      if (update.reachoutTimeLock) {
        antiban.timelock.onTimelockUpdate({
          isActive: update.reachoutTimeLock.isActive,
          timeEnforcementEnds: update.reachoutTimeLock.timeEnforcementEnds,
          enforcementType: update.reachoutTimeLock.enforcementType,
        });
      }
    });

    // Catch 463 errors from message updates + track retries
    sock.ev.on('messages.update', (updates: any[]) => {
      for (const update of updates) {
        // 463 error detection
        if (update?.update?.messageStubParameters) {
          const params = update.update.messageStubParameters;
          if (params.includes(463) || params.includes('463')) {
            antiban.timelock.record463Error();
          }
        }
        // Retry tracking
        antiban.retryTracker.onMessageUpdate(update);
      }
    });

    // Register known chats from incoming messages + handle reply suggestions
    sock.ev.on('messages.upsert', ({ messages }: any) => {
      for (const msg of messages || []) {
        const jid = msg.key?.remoteJid;
        if (!jid) continue;

        // Register known chat
        antiban.timelock.registerKnownChat(jid);

        // Skip self messages
        const isSelf = msg.key?.fromMe || false;
        if (isSelf) continue;

        // Extract message text
        const msgText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          '';

        // Handle incoming message (updates reply ratio + contact graph)
        const replySuggestion = antiban.onIncomingMessage(jid, msgText);

        // Auto-respond if enabled and suggested
        if (options.autoRespondToIncoming && replySuggestion.shouldReply && replySuggestion.suggestedText) {
          // Random delay 3-15s
          const replyDelay = Math.floor(Math.random() * 12000) + 3000;
          setTimeout(async () => {
            try {
              await sock.sendMessage(jid, { text: replySuggestion.suggestedText });
            } catch (error) {
              // Silently fail — auto-reply is best-effort
            }
          }, replyDelay);
        }
      }
    });
  }

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
      antiban.timelock.registerKnownChat(jid);
      // Clear retry tracking on successful send
      if (result?.key?.id) {
        antiban.retryTracker.clear(result.key.id);
      }
      return result;
    } catch (error) {
      antiban.afterSendFailed(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  // Return enhanced socket
  const wrapped = Object.create(sock) as WrappedSocket<T>;
  wrapped.sendMessage = wrappedSendMessage as T['sendMessage'];
  wrapped.antiban = antiban;

  // Expose destroy method directly so consumers can call it manually if needed
  (wrapped.antiban as any).destroy = antiban.destroy.bind(antiban);

  return wrapped;
}
