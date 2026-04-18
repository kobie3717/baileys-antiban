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
export declare function wrapSocket<T extends WASocket>(sock: T, config?: AntiBanConfig, warmUpState?: WarmUpState, wrapOptions?: WrapSocketOptions): WrappedSocket<T>;
