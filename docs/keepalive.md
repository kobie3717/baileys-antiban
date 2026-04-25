# Keeping Baileys Sessions Alive

> **TCP keepalive ≠ WhatsApp session keepalive.** Most "keepalive" advice for Baileys solves the easy half and breaks your bot on the hard half. This doc explains the difference, the bugs that come from getting it wrong, and how `baileys-antiban` solves them.

## TL;DR

Naive keepalive (presence ping + auto-reconnect on close) **causes** the very security logouts it tries to prevent. WhatsApp doesn't just want a live socket — it wants a coherent session. Reconnecting with stale session state is what triggers `connectionReplaced`, status 499 loops, and `creds.json` corruption.

`baileys-antiban` ships two modules that fix this at the right layer:

- **`reconnectThrottle`** — debounce + cool-down on reconnect attempts; refuses to reconnect a session known to be in a bad state.
- **`sessionStability`** — health monitor that catches HKDF-chain drift, missing pre-keys, and identity-key mismatches **before** they become Bad MAC errors.

For TCP-level lifecycle (presence pings, exponential backoff on close, QR-stale alerts), pair with [`baileys-keep-alive`](https://github.com/kobie3717/baileys-keep-alive). The two libraries are complementary — antiban guards the session, keep-alive guards the connection.

---

## The bugs naive keepalive causes

### Issue [#2110](https://github.com/WhiskeySockets/Baileys/issues/2110) — Reconnect → forced logout

Symptom: socket reconnects fine, then 5–30 seconds later you get a `loggedOut` disconnect from the server.

Root cause: WA mobile detects that the resuming session has stale or mismatched key material relative to what mobile last saw. Mobile decides "this isn't really my session anymore" and revokes auth on the linked device. Your `creds.json` is now toast.

Naive keepalive **causes** this. Reconnect-on-close logic with no session pre-check happily fires off a Noise IK handshake using whatever local keys exist. If those keys disagree with mobile's ratcheted view of the chain, you're logged out.

### Issue [#2337](https://github.com/WhiskeySockets/Baileys/issues/2337) — 12-24h silent timeout

Symptom: bot stays "connected" for ~12-24 hours, then stops receiving messages. Socket reports healthy. No `connection.update` event fires.

Root cause: WhatsApp's transport layer disconnects without sending a graceful close frame in some network conditions (NAT rebind, ISP idle timeout, DTLS migration on cellular). Baileys' built-in `keepAliveIntervalMs: 25000` ping-pong doesn't always detect it because the OS reports the socket as alive until the next write attempt fails.

What's needed: **proactive** session health checks (not just reactive ping-pong). If the bot hasn't observed a server-initiated event in N minutes, **probe** before assuming.

### Status 499 loop + `creds.json` corruption

Symptom: bot enters a fast reconnect loop. Each cycle: socket opens → status 499 received → close → re-init → status 499 again. After N cycles, `creds.json` corrupts and the device pairing is gone.

Root cause: status 499 means "your session state is rejected". Naive reconnect logic interprets "close" as "retry the same way". Each retry re-applies the bad state, re-corrupts the chain, and eventually serializes invalid data to disk.

The fix: **detect 499, snapshot creds before retry, refuse to reconnect until session is verified healthy.**

---

## How `baileys-antiban` solves it

### `reconnectThrottle.ts`

Wraps your reconnect logic with three guards:

1. **Cool-down** — refuses repeated reconnect attempts within a window. Breaks the 499 loop.
2. **Pre-snapshot** — takes a copy of `creds.json` before each retry. If post-retry state is corrupted, restore is one call away.
3. **Health gate** — calls `sessionStability.check()` before allowing reconnect. If session is unhealthy, fires `onSessionDamaged` instead of attempting connect.

```ts
import { reconnectThrottle } from 'baileys-antiban';

const throttle = reconnectThrottle({
  cooldownMs: 5_000,
  maxConsecutive: 5,
  snapshotPath: './creds.snapshot.json',
  onSessionDamaged: async () => {
    // session is in a known-bad state. surface to ops.
    // restoring from snapshot is safer than retrying.
  },
});

// in your connection.update handler:
if (update.connection === 'close') {
  await throttle.attemptReconnect(async () => {
    return makeWASocket({ /* ... */ });
  });
}
```

### `sessionStability.ts`

Health monitor that catches drift signals before they become Bad MAC:

- **HKDF chain depth** — flags if local ratchet has advanced abnormally fast vs what mobile would have ratcheted
- **Pre-key inventory** — alerts if pre-keys are running low (mobile won't be able to start new sessions)
- **Identity key mismatch** — detects when a device-list update implies our identity is no longer trusted
- **Last-seen-server-event** — proactive 12-24h timeout detection (Issue #2337)

```ts
import { sessionStability } from 'baileys-antiban';

const monitor = sessionStability(sock, {
  intervalMs: 60_000,
  onDrift: (signal) => {
    // 'hkdf-fast-ratchet' | 'prekey-low' | 'identity-mismatch' | 'no-server-event'
    log.warn('session drift detected:', signal);
  },
  onUnhealthy: async () => {
    // refuse to reconnect through reconnectThrottle until this clears
    await throttle.markUnhealthy();
  },
});
```

---

## Recommended stack

For a production WhatsApp bot:

```ts
import { makeWASocket } from '@whiskeysockets/baileys';
import { antiban, reconnectThrottle, sessionStability } from 'baileys-antiban';
import { keepAlive } from 'baileys-keep-alive';

const throttle = reconnectThrottle({ /* ... */ });

let sock = makeWASocket({ /* ... */ });
const aban = antiban(sock, { /* ... */ });
const stab = sessionStability(sock, { /* ... */ });

// connection lifecycle (TCP layer)
const ka = keepAlive(sock, {
  reconnectFactory: async () => {
    return throttle.attemptReconnect(async () => makeWASocket({ /* ... */ }));
  },
  onLoggedOut: () => stab.markTerminal(),
  onQRStale: (ms) => log.warn('QR not scanned in', ms, 'ms'),
});
```

Three libraries, three responsibilities:

| Library              | Owns                                                      |
| -------------------- | --------------------------------------------------------- |
| `baileys-antiban`    | Rate limits, session health, reconnect safety, ban prevention |
| `baileys-keep-alive` | Socket lifecycle, presence pings, backoff, QR-stale alerts |
| `@whiskeysockets/baileys` | Protocol, Noise handshake, ratchet, raw events       |

---

## What about Baileys' built-in `keepAliveIntervalMs`?

It's a TCP ping-pong: ~25s presence update to keep the WebSocket from being idle-killed by NATs. **It does not check session validity.** It also doesn't recover from a soft-disconnect where the socket is alive but the session is mute (Issue #2337).

Use it. It's free. Just don't think it's the whole story.

---

## Further reading

- [sigalor/whatsapp-web-reveng](https://github.com/sigalor/whatsapp-web-reveng) — original reverse-engineering. HKDF chain documentation.
- [tgalal/consonance](https://github.com/tgalal/consonance) — Noise XX/IK/XXfallback handshake patterns.
- [Formal Analysis of Multi-Device WA Group Messaging (2025)](https://eprint.iacr.org/2025/794.pdf) — HKDF+HMAC as PRF, group key ratcheting edge cases.

---

_Last updated: 2026-04-25_
