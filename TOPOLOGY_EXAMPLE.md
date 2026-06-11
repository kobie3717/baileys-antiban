# TopologyThrottler Usage Example

The TopologyThrottler enforces WhatsApp's network topology ban signals, not just message timing.

## Quick Start

```typescript
import { AntiBan } from 'baileys-antiban';

const antiban = new AntiBan({
  // Enable topology throttler with custom config
  topologyThrottler: {
    maxNewContactsPerHour: 5,        // Max 5 cold contacts per hour
    maxNewContactsPerDay: 20,        // Max 20 cold contacts per day
    minReplyRatioForNewContacts: 0.3, // Need 30% reply rate to unlock more
    maxSameGroupContacts: 10,        // Don't mass-DM entire group
    blockOnLimitReached: true,       // Block sends when limit hit
    cooldownMs: 3600000,             // 1 hour cooldown after hitting limit
    
    // Risk scoring config
    riskConfig: {
      firstContactPenalty: 40,
      noReplyPenalty: 20,
      noMutualGroupsPenalty: 15,
      recentContactBonus: -20,
      repliedBeforeBonus: -30,
      delayThreshold: 40,  // score >= 40 → delay
      abortThreshold: 75,  // score >= 75 → abort
    }
  }
});

// Before sending to a new contact
const decision = await antiban.beforeSend('1234567890@s.whatsapp.net', 'Hello!');

if (decision.allowed) {
  await new Promise(r => setTimeout(r, decision.delayMs));
  await sock.sendMessage('1234567890@s.whatsapp.net', { text: 'Hello!' });
  antiban.afterSend('1234567890@s.whatsapp.net', 'Hello!');
} else {
  console.log('Blocked:', decision.reason);
}

// Get topology stats
const stats = antiban.getStats();
console.log('Topology:', stats.topologyThrottler);
// Output:
// {
//   newContactsThisHour: 3,
//   newContactsToday: 15,
//   replyRatio: 0.35,
//   blockedRatio: 0.02,
//   hotspots: [
//     { sourceGroup: 'group1@g.us', count: 5 },
//     { sourceGroup: 'group2@g.us', count: 3 }
//   ]
// }
```

## How It Works

### 1. Graph Expansion Limits
- Tracks new contacts per hour/day
- Blocks when limits reached
- Requires minimum reply ratio (30%) to unlock more cold sends

### 2. Contact Risk Scoring
Each contact gets a risk score (0-100) based on:
- **First contact** (+40): Never messaged before
- **No reply history** (+20): Sent messages but never replied
- **No mutual groups** (+15): No shared groups
- **Recent contact** (-20): Messaged in last 24h
- **Has replied** (-30): They've replied before

### 3. Risk-Based Recommendations
- **Score < 40**: Send immediately (LOW/MEDIUM risk)
- **Score 40-74**: Delay recommended (MEDIUM/HIGH risk)
- **Score >= 75**: Abort (CRITICAL risk)

## Integration with AntiBan

The TopologyThrottler is automatically called in `beforeSend()`:

1. Check if new contact (not in knownChats)
2. If new, check topology limits
3. Assess contact risk
4. If abort recommended → block send
5. If delay recommended → add to total delay
6. After send → record in topology tracker

## State Persistence

State is automatically exported/imported via `exportState()` / `importState()`:

```typescript
// Export
const snapshot = antiban.exportState();
// snapshot.topologyThrottler contains:
// - contacts: per-JID send/reply history
// - limits: hourly/daily counters
// - sourceGroupCounts: group hotspot tracking

// Import (on restart)
antiban.importState(snapshot);
```

## Direct Access

Access the throttler directly for advanced use:

```typescript
// Get the module
const topology = antiban.topologyThrottler;

// Manual assessment
const assessment = topology.assessContact('jid@s.whatsapp.net', {
  messageType: 'dm',
  sourceGroup: 'mygroup@g.us',
  knownGroups: ['group1@g.us', 'group2@g.us'],
  hasReplied: false,
});

console.log(assessment);
// {
//   jid: 'jid@s.whatsapp.net',
//   risk: 'MEDIUM',
//   score: 55,
//   reasons: ['first_contact', 'recommend_delay'],
//   recommendation: 'delay',
//   suggestedDelayMs: 60000
// }

// Manual recording
topology.recordSent('jid@s.whatsapp.net', 'sourceGroup@g.us');
topology.recordReplied('jid@s.whatsapp.net');
topology.recordBlocked('jid@s.whatsapp.net');

// Check limits
const canSend = topology.canSendToNewContact();
if (!canSend.allowed) {
  console.log(canSend.reason);
  console.log('Retry after:', canSend.retryAfterMs, 'ms');
}
```

## Best Practices

1. **Start conservative**: Use default limits (5/hr, 20/day)
2. **Monitor reply ratio**: If < 30%, pause cold outreach
3. **Watch hotspots**: Don't mine entire groups
4. **Respect cooldowns**: Don't bypass limit hit cooldowns
5. **Track blocks**: If someone blocks you, stop sending

## Why This Matters

WhatsApp's ML models detect:
- **Fast graph expansion**: Adding many new contacts quickly
- **Low reciprocity**: One-way messaging without replies
- **Group mining**: Mass-DMing group members
- **Cold spam patterns**: No prior relationship

The TopologyThrottler enforces limits that match WhatsApp's ban signals, not just arbitrary rate limits.
