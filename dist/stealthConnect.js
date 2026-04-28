/**
 * Stealth Connect — Reduce ban signal on socket connect + presence ramp
 *
 * Inspired by GOWA's --presence-on-connect=unavailable flag. Bots that
 * snap online immediately and start blasting messages look suspicious to
 * WhatsApp's anti-spam classifier. This module ships two helpers:
 *
 *   - `getStealthSocketConfig()` returns a partial Baileys socket config
 *     that disables `markOnlineOnConnect` and provides a non-default
 *     browser fingerprint (random pick from a small pool unless overridden).
 *
 *   - `rampPresenceAfterConnect()` waits a randomized delay, then issues
 *     `sendPresenceUpdate('available')`. Supports `AbortSignal` so the
 *     caller can cancel if the socket dies before the timer fires.
 *
 * Usage:
 *   const config = getStealthSocketConfig({ os: 'MyApp' });
 *   const sock = makeWASocket({ ...config, auth: state });
 *
 *   const ac = new AbortController();
 *   sock.ev.on('connection.update', u => {
 *     if (u.connection === 'close') ac.abort();
 *   });
 *   await rampPresenceAfterConnect(sock, { signal: ac.signal });
 */
/**
 * Pool of realistic browser fingerprints.
 *
 * Values match formats actually emitted by WhatsApp Web clients in the wild.
 * `getStealthSocketConfig()` picks one at random when caller does not supply
 * an explicit `browser` or `os` option, so multiple consumers of the library
 * do not all advertise an identical fingerprint (which would be trivially
 * cluster-able by WhatsApp).
 *
 * Exported so callers can extend or override the pool if desired.
 */
export const STEALTH_BROWSER_POOL = Object.freeze([
    ['Mac OS', 'Chrome', '120.0.6099.109'],
    ['Mac OS', 'Safari', '17.2.1'],
    ['Windows', 'Chrome', '121.0.6167.85'],
    ['Windows', 'Firefox', '122.0'],
    ['Windows', 'Edge', '120.0.2210.144'],
    ['Linux', 'Chrome', '120.0.6099.109'],
    ['Linux', 'Firefox', '122.0'],
    ['Ubuntu', 'Chrome', '121.0.6167.85'],
]);
/**
 * Returns a partial Baileys socket config tuned for stealth connect.
 *
 * - `markOnlineOnConnect` set to `false` so the socket joins without
 *   broadcasting `available` (matches GOWA's `presence-on-connect=unavailable`).
 * - `browser` is a randomized realistic tuple from `STEALTH_BROWSER_POOL`
 *   unless overridden via `opts.browser` or `opts.os`.
 *
 * Merge the result into your `makeWASocket` options:
 *
 *   const sock = makeWASocket({ ...getStealthSocketConfig(), auth: state });
 */
export function getStealthSocketConfig(opts) {
    const random = opts?.random ?? Math.random;
    let browser;
    if (opts?.browser) {
        browser = opts.browser;
    }
    else {
        const pick = STEALTH_BROWSER_POOL[Math.floor(random() * STEALTH_BROWSER_POOL.length)];
        // pick is guaranteed defined — pool is non-empty and frozen.
        const tuple = pick;
        if (opts?.os) {
            browser = [opts.os, tuple[1], tuple[2]];
        }
        else {
            browser = [tuple[0], tuple[1], tuple[2]];
        }
    }
    return {
        markOnlineOnConnect: false,
        browser,
    };
}
/**
 * Custom error thrown when `rampPresenceAfterConnect` is aborted via signal.
 * Mirrors DOM `AbortError` semantics so consumers can `instanceof` check.
 */
export class AbortError extends Error {
    name = 'AbortError';
    constructor(message = 'rampPresenceAfterConnect aborted') {
        super(message);
    }
}
/**
 * Waits a randomized delay then calls `sock.sendPresenceUpdate(targetState)`.
 *
 * Supports `AbortSignal` — abort during the delay window cancels the timer
 * and rejects the returned promise with `AbortError`. Aborting after the
 * presence update has already been sent is a no-op.
 *
 * Caller is responsible for invoking abort when the socket disconnects;
 * otherwise the post-delay `sendPresenceUpdate` may run against a dead
 * socket.
 */
export async function rampPresenceAfterConnect(sock, opts) {
    const minDelayMs = opts?.minDelayMs ?? 30000;
    const maxDelayMs = opts?.maxDelayMs ?? 90000;
    const targetState = opts?.targetState ?? 'available';
    const random = opts?.random ?? Math.random;
    const signal = opts?.signal;
    if (signal?.aborted) {
        throw new AbortError();
    }
    const range = Math.max(0, maxDelayMs - minDelayMs);
    const delayMs = Math.floor(random() * (range + 1)) + minDelayMs;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            resolve();
        }, delayMs);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new AbortError());
        };
        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
    // jid undefined => broadcast presence to all conversations
    await sock.sendPresenceUpdate(targetState, undefined);
}
