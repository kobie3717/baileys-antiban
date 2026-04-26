# Surviving the LID Migration (Baileys v7+)

> **TL;DR**: Baileys v7 made `@lid` the default JID format. Without normalization, your bot sees the same conversation as two separate threads, can't reliably look up phone numbers, and routes calls to the wrong place. baileys-antiban's `jidCanonicalizer` fixes all three.

## The bugs LID causes

### Issue [#1832](https://github.com/WhiskeySockets/Baileys/issues/1832) — Split-thread bug

**Symptom**: You send a message to `+27821234567@s.whatsapp.net`. The recipient replies, but their message arrives with `remoteJid: "123456789@lid"`. Your app stores these as two different conversations. User sees duplicates in their chat list.

**Root cause**: WhatsApp migrated to Linked Identity (LID) in 2024. Each contact now has two JIDs:
- Phone number form: `27821234567@s.whatsapp.net`
- LID form: `123456789@lid`

Incoming messages can use either form. Baileys v7 defaults to LID, but your outbound sends might still target PN. If your DB uses `remoteJid` as the thread key, same conversation = two rows.

**Impact**: DB bloat, broken conversation history, confused users asking "why do I see this person twice?".

---

### Issue [#1718](https://github.com/WhiskeySockets/Baileys/issues/1718) — Phone lookup unreliable

**Symptom**: You receive `123456789@lid` in a group message. You call `getContact()` or check `store.contacts` to find the phone number. You get nothing, or stale data, or a different user's number.

**Root cause**: The LID↔PN mapping isn't always exposed in message events. Some events carry both (`participant: "123@lid"` + `participantPn: "27...@s.whatsapp.net"`), but many don't. If you only receive LID, there's no built-in API to resolve it to a phone number.

**Impact**: Can't display phone numbers in UIs, can't export contact info, can't integrate with CRMs that require E.164 format.

---

### Issue [#2030](https://github.com/WhiskeySockets/Baileys/issues/2030) — Call routing broken

**Symptom**: Your bot receives a `call` event. The `from` field is a LID. You try to send a "call declined" notification back to the user. Baileys throws "Bad MAC / No Session" because your encryption session was established with the PN form, not the LID.

**Root cause**: Call events send LID instead of PN. If your session state only knows the PN, you can't decrypt or send back to the LID.

**Impact**: Silent call failures, user confusion ("why didn't I get the auto-reject message?").

---

## How baileys-antiban solves it

### `jidCanonicalizer.onIncomingEvent` — passive learning

Hook into your `messages.upsert` handler. Canonicalizer extracts LID↔PN mappings from every incoming message:

```typescript
import { JidCanonicalizer } from 'baileys-antiban';

const canonicalizer = new JidCanonicalizer({ enabled: true });

sock.ev.on('messages.upsert', async ({ messages, type }) => {
  // Learn LID↔PN mappings from incoming events
  canonicalizer.onIncomingEvent({ messages, type });

  // Your normal message handling
  for (const msg of messages) {
    // ...
  }
});
```

**What it learns from**:
- Group messages: `participant` (LID) + `participantPn` (PN)
- 1:1 messages: `remoteJid` (LID) + `senderPn` (PN)
- Edge cases: inverse mappings where participant is PN and remoteJid is LID

**Zero config needed** — works with default Baileys message structure.

---

### `jidCanonicalizer.canonicalizeTarget` — outbound normalization

Wrap your `sendMessage` calls. Canonicalizer converts LIDs to PNs (or vice versa, configurable) before send:

```typescript
// Before: might send to the wrong form
await sock.sendMessage('123456789@lid', { text: 'Hello' });

// After: always sends to the learned canonical form (PN by default)
const canonicalJid = canonicalizer.canonicalizeTarget('123456789@lid');
await sock.sendMessage(canonicalJid, { text: 'Hello' });
// → Sends to '27821234567@s.whatsapp.net' if mapping was learned
```

**Config options**:
```typescript
const canonicalizer = new JidCanonicalizer({
  enabled: true,
  canonicalizeOutbound: true,  // Transform sends (default: true)
  learnFromEvents: true,       // Extract mappings from incoming (default: true)
  resolverConfig: {
    canonical: 'pn',  // Prefer phone-number form (default)
    // canonical: 'lid',  // Or prefer LID form
  },
});
```

**Stats tracking**:
```typescript
const stats = canonicalizer.getStats();
console.log(`Canonicalized ${stats.outboundCanonicalized} sends`);
console.log(`Learned ${stats.inboundLearned} mappings`);
console.log(`Resolver has ${stats.resolver.totalMappings} known contacts`);
```

---

### `jidCanonicalizer.canonicalKey` — DB storage key (NEW in v3.3)

The missing piece: a stable thread identifier for your database. Use this as your `conversationId` / `threadId` / primary key:

```typescript
// Example: SQLite chat storage
async function saveMessage(msg: any) {
  const jid = msg.key.remoteJid;
  
  // Old way (WRONG — causes split threads):
  // const threadKey = jid;  // "123@lid" and "27...@s.whatsapp.net" = 2 threads
  
  // New way (CORRECT — stable key):
  const threadKey = canonicalizer.canonicalKey(jid);
  // Always returns same key regardless of LID/PN form
  
  await db.run(
    'INSERT INTO messages (thread_key, message_id, content, timestamp) VALUES (?, ?, ?, ?)',
    [threadKey, msg.key.id, msg.message?.conversation, Date.now()]
  );
}
```

**How it works**:
- `canonicalKey('27821234567@s.whatsapp.net')` → `'thread:27821234567'`
- `canonicalKey('123456789@lid')` (no PN known) → `'thread:lid:123456789'`
- `canonicalKey('123456789@lid')` (PN learned) → `'thread:27821234567'`
- `canonicalKey('120363...@g.us')` → `'thread:group:120363...'`
- `canonicalKey('status@broadcast')` → `'thread:broadcast:status'`

**Key properties**:
- Always lowercase, no `@` suffix, prefixed with `thread:`
- If LID has known PN → uses PN digits (stable across app restarts if persisted)
- If LID unknown → uses `thread:lid:<digits>` (will normalize to PN once learned)
- Groups, broadcasts, newsletters → separate prefixes to avoid collisions

**Edge cases handled**:
- Empty/null → `'thread:invalid'`
- Unknown domains → `'thread:<domain>:<user>'`
- Whitespace → trimmed and normalized

---

## Recommended setup

Full integration example combining all three methods:

```typescript
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from 'baileys';
import { JidCanonicalizer } from 'baileys-antiban';

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  
  const canonicalizer = new JidCanonicalizer({
    enabled: true,
    resolverConfig: {
      canonical: 'pn',  // Prefer phone number form
      persistence: {
        // Optional: persist mappings across restarts
        load: async () => {
          const json = await fs.readFile('./lid-mappings.json', 'utf-8');
          return JSON.parse(json);
        },
        save: async (map) => {
          await fs.writeFile('./lid-mappings.json', JSON.stringify(map, null, 2));
        },
      },
    },
  });
  
  const sock = makeWASocket({
    auth: state,
    // ... other config
  });
  
  // 1. Learn from incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    canonicalizer.onIncomingEvent({ messages, type });
    
    for (const msg of messages) {
      // Use canonical key for DB storage
      const threadKey = canonicalizer.canonicalKey(msg.key.remoteJid!);
      await saveMessage(threadKey, msg);
    }
  });
  
  // 2. Canonicalize outbound sends
  async function sendToUser(jid: string, content: any) {
    const canonicalJid = canonicalizer.canonicalizeTarget(jid);
    await sock.sendMessage(canonicalJid, content);
  }
  
  // 3. Handle calls with canonical routing
  sock.ev.on('call', async ([call]) => {
    const canonicalJid = canonicalizer.canonicalizeTarget(call.from);
    await sock.rejectCall(call.id, canonicalJid);
  });
  
  // 4. Periodic stats logging
  setInterval(() => {
    const stats = canonicalizer.getStats();
    console.log(`[LID] ${stats.resolver.totalMappings} mappings, ${stats.outboundCanonicalized} canonicalized`);
  }, 60_000);
  
  // 5. Cleanup on shutdown
  process.on('SIGINT', () => {
    canonicalizer.destroy();
    process.exit(0);
  });
}

startBot();
```

---

## Limitations

1. **LID→PN mapping is best-effort**
   - Not all message events expose both LID and PN
   - Some contacts may only be known by LID until they send a message
   - `canonicalKey` returns `thread:lid:<digits>` for unknown mappings

2. **Requires active learning**
   - Canonicalizer only knows what it's seen
   - If a contact hasn't messaged yet, their LID won't resolve to PN
   - Consider seeding mappings from contact sync events if available

3. **Not a root fix**
   - This is middleware-layer mitigation
   - Ideally Baileys core would expose stable contact IDs
   - See [PR #2372](https://github.com/WhiskeySockets/Baileys/pull/2372) for crypto-layer approach

4. **Persistence recommended for production**
   - Without persistence, mappings reset on every restart
   - Provide `persistence.load` + `persistence.save` to LidResolver config
   - Otherwise users will see split threads between restarts

---

## Further reading

- [Baileys #1832](https://github.com/WhiskeySockets/Baileys/issues/1832) — Split-thread bug
- [Baileys #1718](https://github.com/WhiskeySockets/Baileys/issues/1718) — Phone lookup unreliable
- [Baileys #2030](https://github.com/WhiskeySockets/Baileys/issues/2030) — Call routing broken
- [Baileys #1769](https://github.com/WhiskeySockets/Baileys/issues/1769) — Bad MAC errors from LID/PN mismatch
- [WaSP Protocol](https://github.com/kobie3717/wasp-protocol) — Multi-account session state management (compatible with baileys-antiban)
- [Baileys v7 Migration Guide](https://github.com/WhiskeySockets/Baileys/wiki/Migration-to-v7) — Official migration docs
