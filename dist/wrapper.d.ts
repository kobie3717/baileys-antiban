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
export declare function wrapSocket(sock: WASocket, config?: AntiBanConfig, warmUpState?: WarmUpState): WrappedSocket;
export {};
