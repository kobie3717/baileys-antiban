# baileys-antiban

[![npm version](https://img.shields.io/npm/v/baileys-antiban.svg)](https://www.npmjs.com/package/baileys-antiban)
[![Node.js Version](https://img.shields.io/node/v/baileys-antiban.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Anti-ban middleware for [Baileys](https://github.com/WhiskeySockets/Baileys) — protect your WhatsApp number with human-like messaging patterns.

## v1.3 New Features

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

## Installation

```bash
npm install baileys-antiban
```

Requires Node.js ≥16 and Baileys ≥6.0.0.

## Quick Start

### Option 1: Wrap Your Socket (Easiest)

```typescript
import makeWASocket from 'baileys';
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
