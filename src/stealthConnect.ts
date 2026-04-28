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
 * Browser tuple expected by Baileys: [appName, browserName, browserVersion].
 */
export type BrowserTuple = [string, string, string];

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
export const STEALTH_BROWSER_POOL: readonly BrowserTuple[] = Object.freeze([
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
 * Minimum structural shape a stealth socket config consumer needs.
 * Avoids a hard dependency on Baileys' internal type names while still
 * giving consumers TypeScript autocomplete on the keys we actually set.
 */
export interface StealthSocketConfig {
  /** Whether Baileys broadcasts `available` presence on initial connect. */
  markOnlineOnConnect: boolean;
  /** Browser tuple sent during the WhatsApp Web pairing handshake. */
  browser: BrowserTuple;
}

/**
 * Options for `getStealthSocketConfig()`.
 *
 * Precedence: `browser` > `os` > random pick from `STEALTH_BROWSER_POOL`.
 */
export interface GetStealthSocketConfigOptions {
  /**
   * Override the OS / app name slot of the browser tuple. If supplied
   * without `browser`, the OS replaces the first element of a randomly
   * picked tuple — `[os, browser, version]`.
   */
  os?: string;
  /**
   * Provide an explicit browser tuple. When set, takes precedence over
   * `os` and the pool. Use this if you have a fingerprint you trust.
   */
  browser?: BrowserTuple;
  /**
   * Custom RNG. Defaults to `Math.random`. Useful for tests.
   */
  random?: () => number;
}

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
export function getStealthSocketConfig(
  opts?: GetStealthSocketConfigOptions
): StealthSocketConfig {
  const random = opts?.random ?? Math.random;

  let browser: BrowserTuple;
  if (opts?.browser) {
    browser = opts.browser;
  } else {
    const pick =
      STEALTH_BROWSER_POOL[Math.floor(random() * STEALTH_BROWSER_POOL.length)];
    // pick is guaranteed defined — pool is non-empty and frozen.
    const tuple = pick as BrowserTuple;
    if (opts?.os) {
      browser = [opts.os, tuple[1], tuple[2]];
    } else {
      browser = [tuple[0], tuple[1], tuple[2]];
    }
  }

  return {
    markOnlineOnConnect: false,
    browser,
  };
}

/**
 * Minimal structural type for the socket consumed by `rampPresenceAfterConnect`.
 * Matches the shape used elsewhere in this library (e.g. `presenceChoreographer`).
 */
export interface PresenceCapableSocket {
  sendPresenceUpdate: (
    state: string,
    jid?: string
  ) => Promise<void> | void;
}

/**
 * Options for `rampPresenceAfterConnect()`.
 */
export interface RampPresenceOptions {
  /** Minimum delay before issuing the presence update, ms. Default: 30000. */
  minDelayMs?: number;
  /** Maximum delay before issuing the presence update, ms. Default: 90000. */
  maxDelayMs?: number;
  /** Presence state to set after the delay. Default: `'available'`. */
  targetState?:
    | 'available'
    | 'unavailable'
    | 'composing'
    | 'recording'
    | 'paused';
  /**
   * If set, cancels the pending timer and prevents the presence update.
   * Use this when the socket disconnects before the ramp fires.
   * Aborting causes the returned promise to reject with `AbortError`.
   */
  signal?: AbortSignal;
  /** Custom RNG. Defaults to `Math.random`. Useful for tests. */
  random?: () => number;
}

/**
 * Custom error thrown when `rampPresenceAfterConnect` is aborted via signal.
 * Mirrors DOM `AbortError` semantics so consumers can `instanceof` check.
 */
export class AbortError extends Error {
  override name = 'AbortError';
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
export async function rampPresenceAfterConnect(
  sock: PresenceCapableSocket,
  opts?: RampPresenceOptions
): Promise<void> {
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

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, delayMs);

    const onAbort = (): void => {
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
