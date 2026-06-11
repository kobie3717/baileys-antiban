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
import { type DeafSessionConfig } from './sessionStability.js';
import type { WarmUpState } from './warmup.js';
import { type GroupOperationGuardConfig } from './groupOperationGuard.js';
import { type LegitimacySignalInjectorConfig } from './legitimacySignalInjector.js';
import { JidCircuitBreaker } from './jidCircuitBreaker.js';
import type { FleetEventStoreHandle } from './fleetEventStore.js';
export type WASocket = {
    sendMessage: (jid: string, content: any, options?: any) => Promise<any>;
    groupParticipantsUpdate?: (jid: string, participants: string[], action: string) => Promise<any>;
    groupCreate?: (subject: string, participants: string[]) => Promise<any>;
    ev: any;
    [key: string]: any;
};
export type SocketConfig = Record<string, any>;
export type AnyMessageContent = Record<string, any>;
export type MiscMessageGenerationOptions = Record<string, any>;
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
    /**
     * Deaf session detection — monitors for WS connections that stop delivering
     * messages while keepAlive pings still succeed (Baileys issue #2491).
     * Pass a config object to enable; omit to disable.
     */
    deafSession?: DeafSessionConfig;
    /**
     * Group operation rate limiting (adds, removes, creates).
     * Pass false to disable, or pass a config object to customize limits.
     * Default: enabled with conservative limits.
     */
    groupOpGuard?: GroupOperationGuardConfig | false;
    /**
     * Legitimacy signal injection (typos, read gaps, typing pauses).
     * Pass false to disable, or pass a config object to customize.
     * Default: enabled with recommended settings.
     */
    legitimacySignals?: LegitimacySignalInjectorConfig | false;
    /**
     * Per-JID circuit breaker for send protection.
     * Blocks sends to problematic recipients after threshold failures.
     */
    circuitBreaker?: JidCircuitBreaker;
    /**
     * Fleet event store for multi-instance coordination.
     * Emit/poll ban/warn/recovery events across instances.
     */
    fleetEventStore?: FleetEventStoreHandle;
}
export type WrappedSocket<T extends WASocket = WASocket> = T & {
    antiban: AntiBan;
};
/**
 * Wrap a Baileys socket with anti-ban protection.
 * The returned socket has the same API but sendMessage() is protected.
 */
export declare function wrapSocket<T extends WASocket>(sock: T, config?: AntiBanConfig, warmUpState?: WarmUpState, wrapOptions?: WrapSocketOptions): WrappedSocket<T>;
/**
 * Helper function to create a wrapped socket with device fingerprint applied.
 *
 * This combines device fingerprint generation, socket creation, and wrapping
 * into a single call.
 *
 * Usage:
 *   import makeWASocket from 'baileys';
 *   import { wrapSocketWithFingerprint } from 'baileys-antiban';
 *
 *   const wrapped = wrapSocketWithFingerprint(makeWASocket, socketConfig, {
 *     fingerprintSeed: 'stable-seed-123',
 *     groupOpGuard: {},
 *     legitimacySignals: {}
 *   });
 *
 * @param makeWASocket - Baileys makeWASocket factory function
 * @param socketConfig - Base socket configuration
 * @param wrapOptions - Combined wrapper options + fingerprintSeed
 */
export declare function wrapSocketWithFingerprint<T extends SocketConfig>(makeWASocket: (config: T) => WASocket, socketConfig: T, wrapOptions?: WrapSocketOptions & {
    fingerprintSeed?: string;
}): WrappedSocket;
