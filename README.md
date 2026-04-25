# baileys-antiban — Anti-Ban Middleware for Baileys & WhatsApp Bots

[![npm version](https://img.shields.io/npm/v/baileys-antiban.svg)](https://www.npmjs.com/package/baileys-antiban)
[![Node.js Version](https://img.shields.io/node/v/baileys-antiban.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Drop-in anti-ban middleware for Baileys WhatsApp bots. Free, self-hosted, TypeScript-first. Whapi.Cloud alternative — zero monthly fees.**

> Rate limiting with Gaussian jitter, 7-day warmup, session health monitoring, LID resolver, disconnect classification, contact graph enforcement — all in one `npm install`. Works with [Baileys](https://github.com/WhiskeySockets/Baileys) and [@oxidezap/baileyrs](https://github.com/oxidezap/baileyrs) (Rust/WASM).

## v2.0 New Features — Session Stability Module

### What's New in v2.0

Three powerful new features to improve session stability and reduce "Bad MAC" errors:

1. **Typed Disconnect Reason Classification** — Know exactly why you disconnected and how to recover
2. **Session Health Monitor** — Detect session degradation before it causes bans
3. **Socket Wrapper with JID Canonicalization** — Middleware-layer fix for LID/PN race conditions

All v2.0 features are **opt-in** and **100% backward compatible** with v1.x.

### 1. Typed Disconnect Reason Classification

```typescript
import { classifyDisconnect } from 'baileys-antiban';

sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
  if (connection === 'close' && lastDisconnect?.error) {
    const statusCode = lastDisconnect.error.output?.statusCode;
    const classification = classifyDisconnect(statusCode);

    console.log(`Disconnected: ${classification.message}`);
    console.log(`Category: ${classification.category}`);  // fatal | recoverable | rate-limited | unknown
    console.log(`Should reconnect: ${classification.shouldReconnect}`);
    
    if (classification.shouldReconnect && classification.backoffMs) {
      console.log(`Recommended backoff: ${classification.backoffMs}ms`);
      setTimeout(() => connectToWhatsApp(), classification.backoffMs);
    }
  }
});
```

**Supported disconnect codes**: 401 (logged out), 408 (timeout), 428 (connection replaced), 429 (rate limited), 440 (logged out), 500 (internal error), 503 (unavailable), 515 (restart required), 1000 (graceful close), and unknown codes.

### 2. Session Health Monitor

Track decrypt success/failure ratio to detect session degradation **before** it causes a ban:

```typescript
import { SessionHealthMonitor } from 'baileys-antiban';

const healthMonitor = new SessionHealthMonitor({
  badMacThreshold: 3,          // Alert after 3 Bad MACs
  badMacWindowMs: 60_000,      // ...in 60 seconds
  onDegraded: (stats) => {
    console.error(`🔴 SESSION DEGRADED: ${stats.badMacCount} Bad MACs in last minute`);
    console.error('Action required: Restart session or switch to LID-based canonical form');
  },
  onRecovered: (stats) => {
    console.log('🟢 Session recovered — decrypt success rate improved');
  },
});

// Wire to Baileys events
sock.ev.on('messages.update', (updates) => {
  for (const { key, update } of updates) {
    if (update.messageStubType === Types.WAMessageStubType.CIPHERTEXT) {
      healthMonitor.recordDecryptFail(true); // Bad MAC detected
    }
  }
});

// Check status anytime
const stats = healthMonitor.getStats();
console.log(`Decrypt success: ${stats.decryptSuccess}`);
console.log(`Bad MAC count: ${stats.badMacCount}`);
console.log(`Is degraded: ${stats.isDegraded}`);
```

### 3. Socket Wrapper with JID Canonicalization

The easiest way to use v2.0: wrap your socket for automatic JID canonicalization and health monitoring:

```typescript
import { wrapWithSessionStability, LidResolver } from 'baileys-antiban';

const resolver = new LidResolver({ canonical: 'pn' });
const sock = makeWASocket({ ... });

const safeSock = wrapWithSessionStability(sock, {
  canonicalJidNormalization: true,  // Auto-canonicalize JIDs before sendMessage
  healthMonitoring: true,           // Auto-track decrypt health
  lidResolver: resolver,
  health: {
    badMacThreshold: 3,
    badMacWindowMs: 60_000,
    onDegraded: (stats) => console.error('Session degraded!'),
  },
});

// Use safeSock exactly like normal sock
await safeSock.sendMessage('123456@lid', { text: 'hello' });
// ^ Automatically canonicalized to '27825651069@s.whatsapp.net' if mapping exists

// Access health stats
const healthStats = safeSock.sessionHealthStats;
console.log(`Bad MAC count: ${healthStats.badMacCount}`);
```

### Integration with AntiBan Class

You can also enable session stability via the main `AntiBan` config:

```typescript
import { AntiBan } from 'baileys-antiban';

const antiban = new AntiBan({
  sessionStability: {
    enabled: true,
    canonicalJidNormalization: true,  // Auto-canonicalize JIDs
    healthMonitoring: true,           // Track Bad MAC rate
    badMacThreshold: 3,
    badMacWindowMs: 60_000,
  },
  jidCanonicalizer: {
    enabled: true,
    canonical: 'pn',
  },
});

// Access health monitor directly
const healthMonitor = antiban.sessionStability;
if (healthMonitor) {
  console.log(healthMonitor.getStats());
}

// Stats include session stability
const stats = antiban.getStats();
console.log(stats.sessionStability);  // Health stats when enabled
```

**Why v2.0?** Bad MAC errors are the #1 reported Baileys issue. Session stability features give you early warning and automated mitigation, reducing bans caused by session degradation.

---

## v1.5 Features

### RetryReasonTracker
Tracks message retry reasons and detects retry spirals (when the same message keeps failing). Inspired by whatsapp-rust's protocol/retry.rs module.

```typescript
import { AntiBan } from 'baileys-antiban';

const antiban = new AntiBan({
  retryTracker: {
    enabled: true,
    maxRetries: 5,           // Max retries before considering a message failed
    spiralThreshold: 3,      // Retries before warning about retry spiral
    onSpiral: (msgId, reason) => {
      console.warn(`Message ${msgId} stuck in retry spiral: ${reason}`);
    },
  },
});

// Stats show retry patterns
const stats = antiban.getStats().retryTracker;
console.log(stats.totalRetries);         // Total retries across all messages
console.log(stats.byReason.timeout);     // Retries due to timeout
console.log(stats.spiralsDetected);      // Messages stuck in retry loops
console.log(stats.activeRetries);        // Messages currently retrying
```

**Retry reasons tracked**: no_session, invalid_key, bad_mac, decryption_failure, server_error_463, server_error_429, timeout, no_route, node_malformed, unknown

### PostReconnectThrottle
Throttles outbound messages after reconnection to prevent burst-floods that trigger rate limits. Inspired by whatsapp-rust's client/sessions.rs semaphore swap pattern.

```typescript
const antiban = new AntiBan({
  reconnectThrottle: {
    enabled: true,
    rampDurationMs: 60_000,       // 60s ramp-up to full rate
    initialRateMultiplier: 0.1,   // Start at 10% of normal rate
    rampSteps: 6,                 // 10% → 25% → 50% → 75% → 90% → 100%
  },
});

// After reconnect, sends are automatically throttled for 60 seconds
// Ramps from 10% rate to 100% rate linearly over 6 steps

// Stats show throttle state
const stats = antiban.getStats().reconnectThrottle;
console.log(stats.isThrottled);          // Currently throttled?
console.log(stats.currentMultiplier);    // 0.1 to 1.0
console.log(stats.remainingMs);          // Time until full rate
console.log(stats.throttledSendCount);   // Sends gated since reconnect
```

**Why?** When WhatsApp reconnects after a disconnection, sending messages at full rate immediately can trigger rate limit alarms. The reconnect throttle gradually ramps up sending rate over 60 seconds, mimicking how a human would resume messaging after their internet came back.

## LID / Phone Number Canonicalization

WhatsApp migrated to **Linked Identity (LID)** in 2024. A contact now has two JID forms:
- Phone number: `27825651069@s.whatsapp.net`
- LID: `123456789@lid`

Messages can arrive under either form. If an encryption session was established under one form and a message arrives under the other, decryption fails → **"Bad MAC / No Session / Invalid PreKey"** errors (the #1 reported Baileys bug).

baileys-antiban v1.6+ provides **middleware-layer mitigation** via two new modules:

```typescript
import { wrapSocket } from 'baileys-antiban';

const sock = makeWASocket({ ... });
const safeSock = wrapSocket(sock, {
  jidCanonicalizer: {
    enabled: true,  // Enable LID/PN canonicalization
    canonical: 'pn', // Normalize to phone-number form (default)
  },
});

// That's it! Incoming events auto-learn LID↔PN mappings.
// Outbound sends are auto-canonicalized to phone-number form.
```

**Advanced: Standalone Resolver**

```typescript
import { LidResolver } from 'baileys-antiban';

const resolver = new LidResolver({
  canonical: 'pn',
  maxEntries: 10_000, // LRU cache size
  persistence: {
    load: async () => JSON.parse(await fs.readFile('lid-map.json', 'utf8')),
    save: async (map) => fs.writeFile('lid-map.json', JSON.stringify(map)),
  },
});

// Learn from message events
resolver.learn({
  lid: '123456789@lid',
  pn: '27825651069@s.whatsapp.net',
});

// Resolve canonical form
const canonical = resolver.resolveCanonical('123456789@lid');
// → '27825651069@s.whatsapp.net'
```

**Note:** This is a middleware-layer workaround. The root fix lives inside Baileys' crypto pipeline ([PR #2372](https://github.com/WhiskeySockets/Baileys/pull/2372)).

## v1.3 Features

### ReplyRatioGuard
Tracks outbound:inbound message ratio per contact. Blocks sends to non-responsive contacts to avoid "spray-and-pray" ban patterns. Optionally suggests auto-replies to maintain healthy engagement.

```typescript
import { AntiBan } from 'baileys-antiban';

const antiban = new AntiBan({
  replyRatio: {
    enabled: true,
    minRatio: 0.10,              // Block sends to contacts with <10% reply rate
    minMessagesBeforeEnforce: 5,  // Enforce after 5 outbound messages
    cooldownHoursOnViolation: 24, // 24h cooldown on ratio violation
  },
});

// Handle incoming messages to track replies
sock.ev.on('messages.upsert', ({ messages }) => {
  for (const msg of messages) {
    if (!msg.key.fromMe) {
      const suggestion = antiban.onIncomingMessage(msg.key.remoteJid);
      if (suggestion.shouldReply) {
        // Optionally auto-reply with suggestion.suggestedText
      }
    }
  }
});
```

### ContactGraphWarmer
Requires 1:1 handshake before bulk/group sends. Enforces group lurk period (don't spam immediately after joining). Caps daily new-contact messaging.

```typescript
const antiban = new AntiBan({
  contactGraph: {
    enabled: true,
    requireHandshakeBeforeGroupSend: true,
    handshakeMinDelayMs: 3600000,  // 1h between handshake and first real message
    groupLurkPeriodMs: 43200000,   // 12h lurk before first group send
    maxStrangerMessagesPerDay: 5,  // Max 5 new contacts per day
  },
});

// Mark handshake sent/complete manually
antiban.contactGraph.markHandshakeSent(jid);
antiban.contactGraph.markHandshakeComplete(jid);

// Or auto-register known contacts on incoming messages
// (enabled by default with autoRegisterOnIncoming: true)
```

### PresenceChoreographer
Adds circadian rhythm to sending patterns (slower at night, faster during business hours). Injects realistic distraction pauses, offline gaps, and read-receipt timing variations.

```typescript
const antiban = new AntiBan({
  presence: {
    enabled: true,
    enableCircadianRhythm: true,
    timezone: 'Africa/Johannesburg',
    activityCurve: 'office',        // 'office' | 'social' | 'global'
    distractionPauseProbability: 0.05, // 5% chance per send to pause 5-20min
    offlineGapProbability: 0.03,    // 3% chance to go offline 5-15min
  },
});

// Delays are automatically adjusted based on local time-of-day
// No manual intervention needed
```

**Why these features?** 2025-2026 ban research showed WhatsApp's ML models heavily weight reply-ratio (<10% = high risk), contact-graph distance (strangers = high risk), and temporal patterns (robotic timing = high risk). These modules address the three largest gaps in existing anti-ban libraries.

## baileys-antiban vs Whapi.Cloud vs DIY rate limiting

| Feature | baileys-antiban | Whapi.Cloud | DIY snippets |
|---|---|---|---|
| Price | **Free, MIT** | $49–$99/mo | Free |
| WhatsApp API | Unofficial (Baileys) | Unofficial underneath | Unofficial (Baileys) |
| Rate limiting | ✅ Gaussian jitter | ✅ Black box | ⚠️ Basic only |
| Warmup schedule | ✅ 7-day ramp | ✅ Managed | ❌ None |
| Session health monitor | ✅ Built-in | ✅ Managed | ❌ None |
| LID/PN resolver | ✅ v2.0 | ❌ Unknown | ❌ None |
| Disconnect classifier | ✅ Typed reasons | ❌ None | ❌ None |
| Contact graph enforcement | ✅ v1.3 | ❌ None | ❌ None |
| Self-hosted | ✅ Yes | ❌ No | ✅ Yes |
| TypeScript | ✅ Full types | N/A | ❌ Rarely |
| Customisable | ✅ Full control | ❌ None | ⚠️ Copy-paste |
| Drop-in (existing bot) | ✅ One-line wrapper | ❌ Full migration | ❌ Rewrite |

**Bottom line:** Whapi.Cloud charges $99/mo for managed Baileys under the hood — same unofficial API, same ban risk, zero customisation. baileys-antiban gives you more protection, free, with full source access.

## Why?

WhatsApp bans numbers that behave like bots. This library makes your Baileys bot behave like a human:

- **Rate limiting** with human-like timing (Gaussian jitter, typing simulation)
- **Warm-up** for new numbers (gradual activity increase over 7 days)
- **Health monitoring** that detects ban warning signs before it's too late
- **Timelock handling** for 463 reachout errors
- **Auto-pause** when risk gets too high
- **Drop-in wrapper** — one line to protect your existing bot
- **Reply ratio tracking** (v1.3) — blocks sends to non-responsive contacts
- **Contact graph enforcement** (v1.3) — requires handshakes before bulk/group sends
- **Circadian rhythm** (v1.3) — realistic time-of-day activity patterns
- **Retry tracking** (v1.5) — detect retry spirals and classify retry reasons
- **Reconnect throttle** (v1.5) — prevent burst-floods after reconnection

## Supported Transports

**v1.4+** is transport-agnostic and works with any Baileys-compatible WhatsApp library:

- **[Baileys](https://github.com/WhiskeySockets/Baileys)** (Node.js, JavaScript/TypeScript)
- **[@oxidezap/baileyrs](https://github.com/oxidezap/baileyrs)** (Rust/WASM, Baileys-compatible API)

Both use the same `wrapSocket()` integration. Zero code changes needed.

## Installation

### With Baileys (Node.js)

```bash
npm install baileys baileys-antiban
```

### With baileyrs (Rust/WASM)

```bash
npm install @oxidezap/baileyrs baileys-antiban
```

Requires Node.js ≥16.

## Quick Start (v3)

```bash
npm install baileys-antiban
```

```typescript
import { AntiBan } from 'baileys-antiban';

// Zero config — works immediately
const ab = new AntiBan();

// Or pick a preset
const ab = new AntiBan('moderate');

// Full control
const ab = new AntiBan({
  preset: 'moderate',
  persist: './antiban-state.json',  // survives restarts
  groupProfiles: true,               // stricter limits for groups
  maxPerMinute: 15,                  // override any value
});

// Usage unchanged
const result = await ab.beforeSend(jid, text);
if (result.allowed) {
  await new Promise(r => setTimeout(r, result.delayMs));
  await sock.sendMessage(jid, { text });
  ab.afterSend(jid, text);
}
```

### CLI

```bash
npx baileys-antiban status --state ./antiban-state.json
npx baileys-antiban warmup --simulate 7 --preset moderate
npx baileys-antiban reset --state ./antiban-state.json
```

## Quick Start (Legacy)

### Option 1: Wrap Your Socket (Easiest)

Works with both baileys and baileyrs — same code:

```typescript
// With baileys:
import makeWASocket from 'baileys';
// OR with baileyrs:
// import { makeWASocket } from '@oxidezap/baileyrs';

import { wrapSocket } from 'baileys-antiban';

const sock = makeWASocket({ /* your config */ });
const safeSock = wrapSocket(sock);

// Use safeSock instead of sock — sendMessage is now protected
await safeSock.sendMessage(jid, { text: 'Hello!' });

// Check health anytime
console.log(safeSock.antiban.getStats());
```

### Option 2: Manual Control

```typescript
import { AntiBan } from 'baileys-antiban';

const antiban = new AntiBan();

// Before every message
const decision = await antiban.beforeSend(recipient, content);

if (decision.allowed) {
  // Wait the recommended delay
  await new Promise(r => setTimeout(r, decision.delayMs));

  try {
    await sock.sendMessage(recipient, { text: content });
    antiban.afterSend(recipient, content);
  } catch (err) {
    antiban.afterSendFailed(err.message);
  }
} else {
  console.log('Blocked:', decision.reason);
}

// In your connection.update handler
sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
  if (connection === 'close') {
    antiban.onDisconnect(lastDisconnect?.error?.output?.statusCode);
  }
  if (connection === 'open') {
    antiban.onReconnect();
  }
});
```

## Configuration

All options are optional — defaults are conservative and safe.

```typescript
import { AntiBan } from 'baileys-antiban';

const antiban = new AntiBan({
  rateLimiter: {
    maxPerMinute: 8,              // Max messages per minute (default: 8)
    maxPerHour: 200,               // Max messages per hour (default: 200)
    maxPerDay: 1500,               // Max messages per day (default: 1500)
    minDelayMs: 1500,              // Min delay between messages (default: 1500ms)
    maxDelayMs: 5000,              // Max delay between messages (default: 5000ms)
    newChatDelayMs: 3000,          // Extra delay for first message to new chat
    maxIdenticalMessages: 3,       // Block after 3 identical messages
    burstAllowance: 3,             // Fast messages before rate limiting kicks in
    identicalMessageWindowMs: 3600000, // 1 hour window for identical tracking
  },
  warmUp: {
    warmUpDays: 7,                 // Days to full capacity (default: 7)
    day1Limit: 20,                 // Messages allowed on day 1 (default: 20)
    growthFactor: 1.8,             // Daily limit multiplier (~doubles each day)
    inactivityThresholdHours: 72,  // Re-enter warm-up after 3 days inactive
  },
  health: {
    disconnectWarningThreshold: 3,   // Disconnects/hour before warning
    disconnectCriticalThreshold: 5,  // Disconnects/hour before critical
    failedMessageThreshold: 5,       // Failed messages/hour before warning
    autoPauseAt: 'high',             // Auto-pause at this risk level
    onRiskChange: (status) => {
      // Custom handler — send alert, log, etc.
      console.log(`Risk: ${status.risk}`, status.recommendation);
    },
  },
  timelock: {
    resumeBufferMs: 10000,           // Extra 10s safety buffer after expiry
    onTimelockDetected: (state) => {
      // Called when 463 reachout timelock is detected
      console.log(`TIMELOCKED until ${state.expiresAt}`);
    },
    onTimelockLifted: (state) => {
      // Called when timelock expires or is manually lifted
      console.log('Timelock lifted — resuming normal operation');
    },
  },
  retryTracker: {
    enabled: false,                  // Opt-in (default: false)
    maxRetries: 5,
    spiralThreshold: 3,
  },
  reconnectThrottle: {
    enabled: false,                  // Opt-in (default: false)
    rampDurationMs: 60_000,
    initialRateMultiplier: 0.1,
    rampSteps: 6,
  },
  logging: true, // Console logging (default: true)
});
```

## Health Monitor

The health monitor tracks ban warning signs:

| Signal | Risk Score | What It Means |
|--------|-----------|---------------|
| Frequent disconnects | +15 to +30 | WhatsApp dropping your connection |
| 403 Forbidden | +40 per event | WhatsApp actively blocking you |
| 401 Logged Out | +60 | Possible temporary ban |
| 463 Reachout Timelock | +25 | Messaging new contacts temporarily blocked |
| Failed messages | +20 | Messages not going through |

Risk levels:
- 🟢 **Low** (0-29): Operating normally
- 🟡 **Medium** (30-59): Reduce messaging rate by 50%
- 🟠 **High** (60-84): Reduce by 80%, consider pausing
- 🔴 **Critical** (85-100): **STOP IMMEDIATELY**

```typescript
const status = antiban.getStats().health;
console.log(status.risk);           // 'low' | 'medium' | 'high' | 'critical'
console.log(status.score);          // 0-100
console.log(status.recommendation); // Human-readable advice
```

## Warm-Up Schedule

New numbers ramp up gradually over 7 days:

| Day | Message Limit |
|-----|--------------|
| 1   | 20           |
| 2   | 36           |
| 3   | 65           |
| 4   | 117          |
| 5   | 210          |
| 6   | 378          |
| 7   | 680          |
| 8+  | Unlimited    |

### Persisting Warm-Up State

Warm-up progress is lost on restart unless you persist it:

```typescript
import fs from 'fs/promises';

// On shutdown (or periodically)
const state = antiban.exportWarmUpState();
await fs.writeFile('warmup.json', JSON.stringify(state));

// On startup
const saved = JSON.parse(await fs.readFile('warmup.json', 'utf-8'));
const antiban = new AntiBan(config, saved);
```

**Better: Use StateAdapter**

```typescript
import { AntiBan, FileStateAdapter } from 'baileys-antiban';

const adapter = new FileStateAdapter('./bot-state');
const antiban = new AntiBan({ /* config */ });

// Load state on startup
const warmupState = await adapter.load('warmup');
if (warmupState) {
  antiban = new AntiBan({ /* config */ }, warmupState);
}

// Save state periodically (every 5 minutes)
setInterval(async () => {
  await adapter.save('warmup', antiban.exportWarmUpState());
}, 300000);

// Save on clean shutdown
process.on('SIGTERM', async () => {
  await adapter.save('warmup', antiban.exportWarmUpState());
  process.exit(0);
});
```

## Timelock Handling (463 Errors)

WhatsApp sometimes blocks messaging **new contacts** temporarily (reachout timelock). This library automatically:

- Detects 463 errors
- Blocks new contact messages during the timelock
- Allows existing contacts and groups to continue
- Auto-resumes when the timelock expires

```typescript
// Timelock state is automatically managed
const decision = await antiban.beforeSend('new-contact@s.whatsapp.net', 'Hello');

if (!decision.allowed && decision.reason?.includes('timelock')) {
  console.log('Timelocked — cannot message new contacts right now');
  console.log('Existing chats still work');
}

// Manual control if needed
antiban.timelock.lift();  // Manually lift
antiban.timelock.reset(); // Clear all state
```

## Rate Limiter Details

The rate limiter mimics human behavior:

- **Gaussian jitter**: Delays clustered around the middle of the range, not uniform random
- **Typing simulation**: Longer messages get longer delays (~30ms per character)
- **New chat penalty**: First message to an unknown recipient gets extra delay
- **Burst allowance**: First 3 messages are faster (humans do this too)
- **Identical message detection**: Blocks sending the same text repeatedly within 1 hour
- **Per-minute/hour/day limits**: Multiple layers of protection

## Optional Features

### Message Queue

Queue messages for safe, paced delivery with auto-retry:

```typescript
import { MessageQueue } from 'baileys-antiban';

const queue = new MessageQueue({ maxAttempts: 3 });
queue.setSendFunction(async (jid, content) => {
  await safeSock.sendMessage(jid, content);
});

// Queue messages
queue.add('group@g.us', { text: 'Hello!' });
queue.add('group@g.us', { text: 'Important!' }, { priority: 'high' });
queue.addBulk(['user1@s.whatsapp.net', 'user2@s.whatsapp.net'], { text: 'Broadcast' });

// Start processing
queue.start();

// Events
queue.on('sent', (msg) => console.log('Sent:', msg.id));
queue.on('failed', (msg, err) => console.log('Failed:', msg.id, err));
```

### Content Variator

Auto-vary messages to avoid identical message detection:

```typescript
import { ContentVariator } from 'baileys-antiban';

const variator = new ContentVariator({
  zeroWidthChars: true,      // Invisible character variations
  punctuationVariation: true, // Subtle punctuation changes
  synonyms: true,             // Replace common words with synonyms
});

// Each call returns a unique variation
const msg1 = variator.vary('Check out our auction today!');
const msg2 = variator.vary('Check out our auction today!');
// msg1 !== msg2 (technically different, looks the same to humans)
```

### Smart Scheduler

Send during safe hours with realistic daily patterns:

```typescript
import { Scheduler } from 'baileys-antiban';

const scheduler = new Scheduler({
  timezone: 'Africa/Johannesburg',
  activeHours: [8, 21],       // 8 AM to 9 PM
  weekendFactor: 0.5,         // Half speed on weekends
  peakHours: [10, 14],        // Faster during business hours
  lunchBreak: [12, 13],       // Slow down at lunch
});

if (scheduler.isActiveTime()) {
  const adjustedDelay = scheduler.adjustDelay(baseDelay);
  // Send with adjusted timing
} else {
  console.log(`Next active in ${scheduler.msUntilActive()}ms`);
}
```

### Webhook Alerts

Get notified when risk level changes:

```typescript
import { WebhookAlerts } from 'baileys-antiban';

const alerts = new WebhookAlerts({
  telegram: { botToken: 'BOT_TOKEN', chatId: 'CHAT_ID' },
  discord: { webhookUrl: 'https://discord.com/api/webhooks/...' },
  urls: ['https://your-server.com/webhook'],
  minRiskLevel: 'medium',
});

const antiban = new AntiBan({
  health: {
    onRiskChange: (status) => alerts.alert(status),
  },
});
```

## Emergency Controls

```typescript
// Manually pause all sending
antiban.pause();

// Resume
antiban.resume();

// Nuclear reset (use after serving a ban period)
antiban.reset();
```

## Disclaimer

**⚠️ This library reduces the risk of WhatsApp bans through rate limiting and human-like behavior patterns, but cannot guarantee prevention of bans.**

WhatsApp's anti-bot detection systems are constantly evolving. This library implements best practices based on observed behaviors, but:

- No anti-ban solution is 100% effective
- WhatsApp may update their detection algorithms at any time
- Violating WhatsApp's Terms of Service may result in permanent bans
- **Always comply with WhatsApp's official policies and usage limits**

Use responsibly and at your own risk.

## Best Practices

1. **Always warm up new numbers** — Don't send 1000 messages on day 1
2. **Use a real phone number** — Virtual/VOIP numbers get banned faster
3. **Don't send identical messages** — Vary your content even slightly
4. **Respect the health monitor** — When it says stop, STOP
5. **Persist warm-up state** — Don't lose progress on restart
6. **Monitor your stats** — Check `getStats()` regularly
7. **Have a backup number** — Bans happen despite best efforts
8. **Stay within WhatsApp's ToS** — Don't spam, don't violate privacy

## Troubleshooting

### Messages being blocked unexpectedly

Check the health monitor status:
```typescript
const stats = antiban.getStats();
console.log(stats.health.risk);    // Check risk level
console.log(stats.health.reasons); // See what triggered it
```

### "Reachout timelocked" messages

This is a 463 error from WhatsApp. The library automatically handles it:

- Existing chats continue to work
- New contacts are blocked temporarily
- Auto-resumes when the timelock expires

### Warm-up limits too restrictive

Adjust the warm-up configuration:
```typescript
const antiban = new AntiBan({
  warmUp: {
    warmUpDays: 5,    // Faster warm-up
    day1Limit: 30,    // Higher initial limit
    growthFactor: 2.0, // Faster growth
  },
});
```

### Rate limiter too aggressive

Increase the limits:
```typescript
const antiban = new AntiBan({
  rateLimiter: {
    maxPerMinute: 10,  // More messages per minute
    maxPerHour: 300,
    minDelayMs: 1000,  // Shorter delays
  },
});
```

### State not persisting across restarts

Use the FileStateAdapter:
```typescript
import { FileStateAdapter } from 'baileys-antiban';

const adapter = new FileStateAdapter('./state');

// Save periodically
setInterval(async () => {
  await adapter.save('warmup', antiban.exportWarmUpState());
}, 300000);
```

## API Reference

### AntiBan

```typescript
class AntiBan {
  constructor(config?: AntiBanConfig, warmUpState?: WarmUpState);

  // Message control
  beforeSend(recipient: string, content: string): Promise<SendDecision>;
  afterSend(recipient: string, content: string): void;
  afterSendFailed(error?: string): void;

  // Connection events
  onDisconnect(reason: string | number): void;
  onReconnect(): void;

  // State
  getStats(): AntiBanStats;
  exportWarmUpState(): WarmUpState;

  // Control
  pause(): void;
  resume(): void;
  reset(): void;

  // Access to components
  timelock: TimelockGuard;
}
```

### RateLimiter

```typescript
class RateLimiter {
  constructor(config?: Partial<RateLimiterConfig>);

  getDelay(recipient: string, content: string): Promise<number>;
  record(recipient: string, content: string): void;
  getStats(): { lastMinute, lastHour, lastDay, limits, knownChats };
}
```

### WarmUp

```typescript
class WarmUp {
  constructor(config?: Partial<WarmUpConfig>, state?: WarmUpState);

  canSend(): boolean;
  getDailyLimit(): number;
  record(): void;
  getStatus(): { phase, day, totalDays, todayLimit, todaySent, progress };
  exportState(): WarmUpState;
  reset(): void;
}
```

### HealthMonitor

```typescript
class HealthMonitor {
  constructor(config?: Partial<HealthMonitorConfig>);

  recordDisconnect(reason: string | number): void;
  recordReconnect(): void;
  recordMessageFailed(error?: string): void;
  recordReachoutTimelock(detail?: string): void;

  getStatus(): HealthStatus;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  reset(): void;
}
```

### TimelockGuard

```typescript
class TimelockGuard {
  constructor(config?: Partial<TimelockGuardConfig>);

  record463Error(): void;
  onTimelockUpdate(data: { isActive?, timeEnforcementEnds?, enforcementType? }): void;

  canSend(jid: string): { allowed: boolean; reason?: string };
  isTimelocked(): boolean;

  registerKnownChat(jid: string): void;
  registerKnownChats(jids: string[]): void;
  getKnownChats(): Set<string>;

  getState(): TimelockState;
  lift(): void;
  reset(): void;
}
```

### StateAdapter

```typescript
interface StateAdapter {
  save(key: string, state: any): Promise<void>;
  load(key: string): Promise<any | null>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

class FileStateAdapter implements StateAdapter {
  constructor(basePath: string);
  // Implements all StateAdapter methods
}
```

## TypeScript Support

This package is written in TypeScript and includes full type definitions.

```typescript
import type {
  AntiBanConfig,
  AntiBanStats,
  SendDecision,
  RateLimiterConfig,
  WarmUpConfig,
  WarmUpState,
  HealthMonitorConfig,
  HealthStatus,
  BanRiskLevel,
  TimelockGuardConfig,
  TimelockState,
  StateAdapter,
} from 'baileys-antiban';
```

## Contributing

Contributions are welcome! Please open an issue before submitting a PR.

## Related Projects

- **[WaSP (WhatsApp Session Protocol)](https://github.com/kobie3717/wasp)** — Full-featured WhatsApp session management with built-in anti-ban (includes this library)

## License

MIT — Built for [WhatsAuction](https://whatsauction.co.za) 🇿🇦
