# baileys-antiban 🛡️

Anti-ban middleware for [Baileys](https://github.com/WhiskeySockets/Baileys) — protect your WhatsApp number with human-like messaging patterns.

## Why?

WhatsApp bans numbers that behave like bots. This library makes your Baileys bot behave like a human:

- **Rate limiting** with human-like timing (gaussian jitter, typing simulation)
- **Warm-up** for new numbers (gradual activity increase over 7 days)
- **Health monitoring** that detects ban warning signs before it's too late
- **Auto-pause** when risk gets too high
- **Drop-in wrapper** — one line to protect your existing bot

## Install

```bash
npm install baileys-antiban
```

## Quick Start

### Option 1: Wrap your socket (easiest)

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

### Option 2: Manual control

```typescript
import { AntiBan } from 'baileys-antiban';

const antiban = new AntiBan();

// Before every message:
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

// In your connection.update handler:
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

```typescript
const antiban = new AntiBan({
  rateLimiter: {
    maxPerMinute: 8,        // Max messages per minute (default: 8)
    maxPerHour: 200,         // Max messages per hour (default: 200)
    maxPerDay: 1500,         // Max messages per day (default: 1500)
    minDelayMs: 1500,        // Min delay between messages (default: 1500ms)
    maxDelayMs: 5000,        // Max delay between messages (default: 5000ms)
    newChatDelayMs: 3000,    // Extra delay for first message to new chat
    maxIdenticalMessages: 3, // Block after 3 identical messages
    burstAllowance: 3,       // Fast messages before rate limiting kicks in
  },
  warmUp: {
    warmUpDays: 7,           // Days to full capacity (default: 7)
    day1Limit: 20,           // Messages allowed on day 1 (default: 20)
    growthFactor: 1.8,       // Daily limit multiplier (~doubles each day)
    inactivityThresholdHours: 72, // Re-enter warm-up after 3 days inactive
  },
  health: {
    disconnectWarningThreshold: 3,  // Disconnects/hour before warning
    disconnectCriticalThreshold: 5, // Disconnects/hour before critical
    failedMessageThreshold: 5,      // Failed messages/hour before warning
    autoPauseAt: 'high',            // Auto-pause at this risk level
    onRiskChange: (status) => {
      // Custom handler — send alert, log, etc.
      console.log(`Risk: ${status.risk}`, status.recommendation);
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

New numbers ramp up gradually:

| Day | Message Limit |
|-----|--------------|
| 1 | 20 |
| 2 | 36 |
| 3 | 65 |
| 4 | 117 |
| 5 | 210 |
| 6 | 378 |
| 7 | 680 |
| 8+ | Unlimited |

Persist warm-up state between restarts:

```typescript
// Save state
const state = antiban.exportWarmUpState();
fs.writeFileSync('warmup.json', JSON.stringify(state));

// Restore state
const saved = JSON.parse(fs.readFileSync('warmup.json', 'utf-8'));
const antiban = new AntiBan(config, saved);
```

## Rate Limiter Details

The rate limiter mimics human behavior:

- **Gaussian jitter**: Delays clustered around the middle of the range, not uniform random
- **Typing simulation**: Longer messages get longer delays (~30ms per character)
- **New chat penalty**: First message to an unknown recipient gets extra delay
- **Burst allowance**: First 3 messages are faster (humans do this too)
- **Identical message detection**: Blocks sending the same text more than 3 times
- **Time-of-day awareness**: Built-in support for custom schedules

## Emergency Controls

```typescript
// Manually pause all sending
antiban.pause();

// Resume
antiban.resume();

// Nuclear reset (use after serving a ban period)
antiban.reset();
```

## Best Practices

1. **Always warm up new numbers** — Don't send 1000 messages on day 1
2. **Use a real phone number** — Virtual/VOIP numbers get banned faster
3. **Don't send identical messages** — Vary your content even slightly
4. **Respect the health monitor** — When it says stop, STOP
5. **Persist warm-up state** — Don't lose progress on restart
6. **Monitor your stats** — Check `getStats()` regularly
7. **Have a backup number** — Bans happen despite best efforts

## License

MIT — Built by [WhatsAuction](https://whatsauction.co.za) 🇿🇦
