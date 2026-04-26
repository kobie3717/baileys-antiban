# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.5.0] — 2026-04-26

### Added
- **proxyRotator** — Native proxy injection with multi-strategy rotation and health tracking
  - Closes the datacenter IP ban vector — WhatsApp's ML flags VPS IPs, residential/4G proxies stay alive
  - Supports SOCKS5, SOCKS5H, HTTP, HTTPS proxies with auth
  - 4 rotation strategies: round-robin, random, least-recently-used, weighted (by health)
  - Auto-failover on endpoint failure with configurable dead thresholds (default: 3 failures)
  - Health tracking: failure counters, dead-marking, auto-resurrection after cooldown (default: 10min)
  - Per-endpoint cooldown periods to avoid hammering proxy providers
  - Scheduled rotation for proactive IP rotation (configurable interval)
  - Rotation triggers: manual, disconnect, ban-warning, scheduled (user-wired)
  - Lazy-loaded proxy agent dependencies (optional peerDeps: socks-proxy-agent, http-proxy-agent, https-proxy-agent)
  - Agent caching for performance (avoids re-creating agents on every request)
  - Comprehensive stats: total rotations, per-trigger breakdowns, endpoint health dashboard
  - Production-ready error handling: graceful fallback when peer deps missing

### Fixed
- **proxyRotator**: Fixed ESM `require()` regression by using `createRequire()` from `node:module` for ESM-compatible synchronous module loading (caught by live SOCKS5 smoke test before publish)

### Why v3.5
Per GapHunter analysis, WhatsApp's ban detection includes IP reputation scoring. Datacenter IPs (VPS) are flagged. Residential/4G proxies stay alive. Every Baileys implementation uses DIY proxy hacks — no library handles native proxy injection. `proxyRotator` closes that gap with production-grade rotation strategies, health tracking, and auto-failover.

### Usage
```ts
import { proxyRotator } from 'baileys-antiban';
import { makeWASocket } from 'baileys';

const rotator = proxyRotator({
  pool: [
    { type: 'socks5', host: 'proxy1.example.com', port: 1080, username: 'user', password: 'pass', label: 'Proxy1' },
    { type: 'socks5', host: 'proxy2.example.com', port: 1080, username: 'user', password: 'pass', label: 'Proxy2', cooldownMs: 300_000 },
  ],
  strategy: 'weighted', // Prefer healthier endpoints
  rotateOn: ['disconnect', 'ban-warning'],
  maxFailures: 3,
  deadCooldownMs: 600_000, // 10 minutes
});

const sock = makeWASocket({
  auth: state,
  fetchAgent: rotator.currentAgent(), // Inject proxy into Baileys fetch
});

// Wire disconnect rotation
sock.ev.on('connection.update', ({ connection }) => {
  if (connection === 'close') {
    rotator.rotate('disconnect');
  }
});

// Wire ban-warning rotation (from sessionStability)
monitor.onDegraded = () => {
  rotator.rotate('ban-warning');
};

// Check stats
console.log(rotator.getStats());
```

### Technical Details
- Agent caching: agents are created once per endpoint and reused until rotation
- Cooldown logic: endpoints are skipped if `Date.now() - lastUsedAt < cooldownMs`
- Dead resurrection: auto-checks on rotation if `Date.now() - lastUsedAt >= deadCooldownMs`
- Weighted strategy: `weight = 1 / (failures + 1)` for probabilistic health-biased selection
- LRU strategy: prioritizes never-used endpoints, then oldest `lastUsedAt`
- Peer dep handling: uses `require()` with try/catch, logs clear error on missing deps
- Pool size 1: logs warning once, rotation becomes no-op
- All endpoints dead: `currentAgent()` returns `null`, user code must handle

## [3.4.0] — 2026-04-26

### Added
- **WPM-based typing duration model** — Realistic typing indicator patterns based on human typing speed
  - `PresenceChoreographer.computeTypingPlan(messageLength)` — Generates realistic typing plan with Gaussian WPM variance
  - `PresenceChoreographer.executeTypingPlan(sock, jid, plan)` — Executes multi-step typing/pause cycle
  - Gaussian sampling (Box-Muller) for WPM variance (default: 45 WPM ± 15 stdDev, clamped 10-120)
  - Think-pause injection: 8% probability per 10 chars, 0.8-3.5s pauses (humans pause mid-thought)
  - Intermittent `paused` state (40% probability) before send for realism
  - Configurable min/max typing duration caps (default: 0.6s - 90s)
  - AbortSignal support for mid-plan cancellation
  - New stats: `typingPlansComputed`, `typingPlansExecuted`, `totalTypingTimeMs`
  - Zero new dependencies — pure TypeScript with Box-Muller transform

### Why v3.4
WhatsApp's ML models flag accounts that fire `composing` then immediately send, or never fire typing indicators at all. Real humans typing a 200-character message take 30-60 seconds with multiple typing/paused cycles. This is the missing signal layer that completes PresenceChoreographer's anti-detection coverage. The WPM model is the final piece of the presence choreography puzzle — realistic read receipts (v1.3), distraction pauses (v1.3), circadian rhythm (v1.3), and now typing duration.

### Usage
```ts
import { PresenceChoreographer } from 'baileys-antiban';

const choreo = new PresenceChoreographer({
  enabled: true,
  enableTypingModel: true,
  typingWPM: 45,             // Average human typing speed
  typingWPMStdDev: 15,       // Variance (slow/fast days)
  thinkPauseProbability: 0.08,
  thinkPauseMinMs: 800,
  thinkPauseMaxMs: 3500,
});

// Before sending a message
const messageText = "Hello, how are you doing today?";
const plan = choreo.computeTypingPlan(messageText.length);

// Execute typing plan
await choreo.executeTypingPlan(sock, jid, plan);

// Send actual message
await sock.sendMessage(jid, { text: messageText });
```

### Technical Details
- Plan structure: `Array<{ state: 'composing' | 'paused', durationMs: number }>`
- WPM → chars/sec conversion: `(WPM × 5) / 60` (industry standard: 5 chars/word)
- Think pauses are extras, not subtracted from base typing time (20% budget slack)
- Composing chunks coalesced when no pause injected between them
- AbortSignal cleanup: sets presence to `paused` before throwing
- All existing PresenceChoreographer features remain unchanged and backward compatible

## [3.3.0] — 2026-04-26

### Added
- **`JidCanonicalizer.canonicalKey(jid)`** — Returns stable thread key for DB storage/indexing
  - Solves the split-thread bug from Baileys v7 LID migration ([#1832](https://github.com/WhiskeySockets/Baileys/issues/1832))
  - Always returns same key regardless of whether message arrives as `@lid` or `@s.whatsapp.net`
  - Format: `thread:<digits>` for known contacts, `thread:lid:<digits>` for unknown, `thread:group:<id>` for groups
  - Uses learned LID↔PN mappings when available, falls back to LID form when not
  - Handles edge cases: groups, broadcasts, newsletters, empty/null inputs
  - Tracks stats: `canonicalKeyHits` (PN known) vs `canonicalKeyMisses` (LID only)
- **`docs/lid-migration.md`** — Comprehensive guide for surviving Baileys v7's LID migration
  - Explains the three major bugs LID causes (#1832 split-thread, #1718 phone lookup, #2030 call routing)
  - Full integration examples: learning from events, canonicalizing sends, stable DB keys
  - Production setup with persistence, stats logging, cleanup
  - Limitations and best practices

### Why v3.3
Baileys v7 made `@lid` the default JID format, but many apps still use `remoteJid` as their database thread key. This causes the same conversation to appear as two separate threads when messages arrive under different forms. `canonicalKey()` provides a stable, form-independent identifier that prevents this split-thread bug. The LID migration doc owns the narrative for the v7 transition.

## [3.2.0] — 2026-04-26

### New Features
- **deviceFingerprint** — Randomizes appVersion, osVersion, and deviceModel to prevent Meta's clientPayload fingerprinting (the #1 gap in anti-ban coverage per GapHunter analysis)
  - Randomizes appVersion patch number within safe range (e.g. 2.24.5.18 → 2.24.5.[15-22])
  - Randomizes osVersion (Android versions 10-14)
  - Randomizes deviceModel from pool of 12 real-world devices (Pixel, Galaxy, Xiaomi, OnePlus, etc.)
  - Deterministic PRNG seeded from sessionId for stable fingerprints per session
  - `generateFingerprint()` creates unique fingerprint per session
  - `applyFingerprint()` applies to Baileys SocketConfig before makeWASocket()
  - User-configurable pools for custom device/OS combinations
  - Master switch: `enabled: false` to disable all randomization
- **credsSnapshot** — Atomic credentials backup to prevent code-500 corruption loop
  - `take()` creates atomic snapshot of creds.json before risky operations
  - `restoreLatest()` recovers from most recent snapshot
  - Automatic rotation keeps only N newest snapshots (default: 3)
  - Atomic file operations (write to .tmp, rename) prevent partial writes
  - Graceful handling of missing creds file (no crashes)
- **readReceiptVariance** — Randomizes read receipt timing to avoid instant-read bot signals
  - Gaussian-jittered delay before sending read receipts (mean: 1500ms, stdDev: 800ms)
  - Configurable min/max clamps (default: 200-8000ms)
  - Skips variance for backlog messages (older than 60s by default)
  - `wrap()` proxies sock.readMessages with transparent delay injection
  - `delayMs()` for manual delay computation in custom receipt logic
  - Box-Muller transform for realistic human timing variance
  - `stop()` cancels all pending timers on disconnect

### Why v3.2
Per GapHunter analysis, device fingerprint randomization is the single highest-ROI ban-prevention upgrade. Baileys ships identical clientPayload for every instance — Meta literally fingerprints it. This release closes that gap plus two critical operational gaps (creds corruption, instant-read bot detection).

### Usage
```ts
import { generateFingerprint, applyFingerprint, credsSnapshot, readReceiptVariance } from 'baileys-antiban';

// 1. Device fingerprint randomization
const fp = generateFingerprint({ seed: 'my-session-123' });
const sock = makeWASocket(applyFingerprint(socketConfig, fp));

// 2. Atomic creds snapshot
const snapshot = credsSnapshot({ credsPath: './auth/creds.json', keep: 5 });
await snapshot.take(); // Before risky reconnect
// ... on code-500 corruption:
await snapshot.restoreLatest();

// 3. Read receipt variance
const variance = readReceiptVariance({ meanMs: 2000, stdDevMs: 1000 });
const wrappedSock = variance.wrap(sock);
// Now all readMessages() calls have human-like delays
```

### Technical Details
- Zero runtime dependencies (Box-Muller in pure JS, fs from Node stdlib)
- TypeScript strict mode compliant
- Deterministic PRNG (mulberry32) for reproducible testing
- Atomic file operations prevent corruption on crash
- All modules are standalone and can be used independently

---

## [3.1.0] — 2026-04-25

### New Features
- **messageRecovery** — Solves Baileys' silent message loss on 408 reconnect (47+ 👍 issue)
  - Tracks last seen message per chat while connected
  - Detects disconnect/reconnect cycles automatically
  - On reconnect, queries Baileys message store for gap messages
  - Re-emits missing messages through user callback (wire to existing messages.upsert handler)
  - Fires `onGapTooLarge` callback if disconnect > 30min (configurable) instead of partial recovery
  - Optional persistence across process restarts (`persistPath` config)
  - LRU eviction when tracked chats exceed `maxTrackedChats` (default 1000)
  - Gracefully handles Baileys versions without `fetchMessageHistory` (logs warning, skips recovery)

### Usage
```ts
import { messageRecovery } from 'baileys-antiban';

const recovery = messageRecovery(sock, {
  onGapFilled: async (msg, chatJid) => {
    // Wire to your existing messages.upsert handler
    await handleMessage(msg, chatJid);
  },
  onGapTooLarge: async (gapMs) => {
    console.warn(`Disconnect too long (${gapMs}ms) — manual reconciliation needed`);
  },
  persistPath: './recovery-state.json', // Optional
  maxGapMs: 30 * 60_000, // 30 minutes (default)
  maxTrackedChats: 1000, // LRU cap (default)
});

// Later: recovery.stop() to cleanup listeners + flush persistence
```

---

## [3.0.0] — 2026-04-25

### Breaking Changes
- Constructor now accepts `string | FlatConfig | undefined` — nested v2 config still works but logs deprecation warning
- `WarmUpConfig.statePath` removed (use `persist` in AntiBanConfig instead)

### New Features
- **Zero-config:** `new AntiBan()` works with conservative defaults
- **Presets:** `conservative` / `moderate` / `aggressive`
- **State persistence:** `persist: './state.json'` — warmup + knownChats survive restarts
- **Group profiles:** `groupProfiles: true` — stricter rate limits for @g.us and @newsletter JIDs
- **Health decay:** Score recovers automatically (2pts/min severe, 5pts/min normal)
- **CLI:** `npx baileys-antiban status|reset|warmup`

### Bug Fixes
- `statePath` in WarmUpConfig was declared but never implemented — replaced with working `persist` option
- Health score never recovered after ban signals — fixed with time-based decay

---

## [2.1.0] - 2026-04-19

### Added
- **Extended disconnect code coverage** — Added 405, 409, 412 to `classifyDisconnect()`
  - **405** (Method Not Allowed) → `fatal`, no reconnect
  - **409** (Conflict / Connection Replaced) → `fatal`, no reconnect (merged with 428 behavior)
  - **412** (Precondition Failed) → `recoverable`, 30s backoff (auth state mismatch, retry after delay)
- **LidFirstResolver** — Standalone drop-in utility for LID↔phone mapping
  - Loads mappings from Baileys auth state directory (`lid-mapping-*_reverse.json`)
  - `resolveToLID(phoneOrJid)` — phone → LID lookup
  - `resolveToPhone(lid)` — LID → phone lookup
  - `loadFromAuthDir(dir)` — bulk load from auth state
  - `learnFromEvent(event)` — learn from Baileys events (future-proof)
  - `getMapping(jid)` — full mapping with metadata
  - Factory function `createLidFirstResolver()` for singleton pattern
  - Works independently of full AntiBan system
- **MessageRetryReason enum** — Typed retry reason codes for message encryption failures
  - 8 retry reason codes: UnknownError, GenericError, SignalErrorInvalidKeyId, SignalErrorInvalidMessage, SignalErrorNoSession, SignalErrorBadMac, MessageExpired, DecryptionError
  - `MAC_ERROR_CODES` set for quick MAC error detection
  - `parseRetryReason(code)` — parse from string/number to enum
  - `isMacError(reason)` — check if reason is a MAC error
  - `getRetryReasonDescription(reason)` — human-readable descriptions
  - Based on whatsapp-rust and Baileys protocol research
  - Named `MessageRetryReason` to avoid conflict with existing `RetryReason` type from `retryTracker.ts`

### Changed
- `index.ts` now exports `LidFirstResolver`, `createLidFirstResolver`, `LidPhoneMapping`, `MessageRetryReason`, `MAC_ERROR_CODES`, `parseRetryReason`, `isMacError`, `getRetryReasonDescription`

### Tests
- 30 new tests for `LidFirstResolver` (auth dir loading, phone↔LID resolution, malformed input handling, factory function)
- 21 new tests for `RetryReason` (enum values, MAC error detection, parsing, descriptions, integration scenarios)
- 3 new tests for disconnect codes 405, 409, 412 in `sessionStability.test.ts`
- Total new test coverage: 54 tests

### Technical Details
- `LidFirstResolver` uses in-memory maps for O(1) lookup performance
- Handles device suffix normalization (`:N` in JIDs)
- Gracefully handles malformed auth dirs and JSON files (no crashes)
- `RetryReason` enum matches Signal protocol + WhatsApp extensions
- Backward compatible — all new features are opt-in, no breaking changes

## [2.0.0] - 2026-04-19

### Added
- **Session Stability Module** — New middleware layer for Baileys socket stability (opt-in, backward compatible)
  - `wrapWithSessionStability()` — Proxy wrapper for Baileys socket with stability features
  - `SessionHealthMonitor` — Track decrypt success/fail ratio, emit degradation alerts when Bad MAC rate exceeds threshold
  - `classifyDisconnect()` — Typed disconnect reason classification with recovery recommendations
  - Canonical JID normalization before `sendMessage()` — Auto-resolves PN↔LID using `LidResolver` to reduce mutex race triggers
  - Comprehensive disconnect code coverage: 401, 408, 428, 429, 440, 500, 503, 515, 1000, unknown
  - Degradation detection: triggers `onDegraded` callback when Bad MAC count exceeds threshold in time window (default: 3 in 60s)
  - Recovery detection: triggers `onRecovered` callback when Bad MAC rate drops below threshold
  - 19 new tests with 100% coverage of disconnect classification and health monitoring

### Changed
- `AntiBan` class extended with optional `sessionStability` config (default: disabled)
- `AntiBanConfig` interface includes `sessionStability` options (enabled, canonicalJidNormalization, healthMonitoring, badMacThreshold, badMacWindowMs)
- `AntiBanStats` includes `sessionStability` stats when enabled
- `destroy()` now cleans up session stability monitor
- Exposed `sessionStability` getter for direct access to health monitor

### Technical Details
- Pure middleware layer — no Baileys internals modification required
- Works alongside existing v1.x LID resolver and canonicalizer modules
- Default configuration: disabled for backward compatibility, opt-in via `sessionStability: { enabled: true }`
- Health monitor uses sliding window for Bad MAC detection (default: 3 errors in 60 seconds)
- Socket wrapper uses ES6 Proxy for transparent method interception
- TypeScript strict mode compliant, no `any` types except socket wrapper generic

### Breaking Changes
None — all v2.0 features are opt-in and backward compatible with v1.x

## [1.6.0] - 2026-04-18

### Added
- **LID/PN Race Condition Mitigation** — New modules to address the #1 reported Baileys bug: "Bad MAC / No Session / Invalid PreKey" errors caused by WhatsApp's Linked Identity (LID) migration
  - `LidResolver` — Standalone utility for maintaining bidirectional LID↔PN mappings learned from message events
  - `JidCanonicalizer` — Opt-in middleware that auto-learns from incoming events and canonicalizes outbound send targets to a single form (phone number by default)
  - Both modules default to **disabled** — backward compatible, zero behavior change for existing users
  - Middleware-layer mitigation only — root fix still requires [PR #2372](https://github.com/WhiskeySockets/Baileys/pull/2372) merged upstream
  - Comprehensive test coverage: 56 new tests (29 LidResolver + 18 JidCanonicalizer + 9 integration)

### Changed
- `AntiBan` class now exposes `lidResolver` and `jidCanonicalizer` getters for direct access
- `AntiBanConfig` extended with `lidResolver` and `jidCanonicalizer` config options
- `AntiBanStats` includes `lidResolver` and `jidCanonicalizer` stats when enabled
- Wrapper's `sendMessage` now canonicalizes JID before all rate-limit/timelock/graph checks
- `messages.upsert` and `messages.update` handlers now auto-learn LID mappings when canonicalizer enabled

### Technical Details
- LRU eviction at configurable `maxEntries` (default 10,000)
- Optional persistence hooks for cross-restart state survival
- Device suffix stripping (`:N` in JIDs) for robust matching
- Supports both `canonical: 'pn'` (phone number) and `canonical: 'lid'` modes
- Shared resolver mode allows multiple canonicalizers to reference same mapping state

## [1.5.0] - 2026-04-18

### Added
- **RetryReasonTracker** module: Track message retry reasons and detect retry spirals
  - Classifies 10 retry reason types (no_session, invalid_key, bad_mac, decryption_failure, server_error_463, server_error_429, timeout, no_route, node_malformed, unknown)
  - Detects retry spirals when same message retries exceed threshold (default: 3)
  - Provides stats on total retries, retries by reason, spirals detected, and active retries
  - Auto-integrates with messages.update events in wrapper
  - Inspired by whatsapp-rust's protocol/retry.rs module
- **PostReconnectThrottle** module: Throttle outbound messages after reconnection
  - Prevents burst-floods on reconnect that trigger WhatsApp rate limits
  - Configurable ramp-up from initial rate multiplier (default: 10%) to full rate over ramp duration (default: 60s)
  - Linear ramp with configurable steps (default: 6 steps)
  - Auto-integrates with connection.update events
  - Inspired by whatsapp-rust's client/sessions.rs semaphore swap pattern
- Both modules are opt-in (enabled: false by default) for backward compatibility

### Changed
- `AntiBan.beforeSend()` now also consults reconnect throttle
- `AntiBan.onReconnect()` triggers reconnect throttle window
- `AntiBan.getStats()` includes retry tracker and reconnect throttle stats when enabled
- Wrapper now tracks message updates for retry classification and clears on successful send

## [1.4.0] - 2026-04-18

### Added
- **Transport-agnostic support** — works with both `baileys` and `@oxidezap/baileyrs` (Rust/WASM WhatsApp library)
- Both transports now listed as optional peer dependencies
- GitHub Actions CI workflow with dual-transport matrix testing (Node 18.x + 20.x × baileys + baileyrs)
- New test suite: `tests/transport-agnostic.test.ts` for duck-typed socket validation
- Updated JSDoc examples showing usage with both transports

### Changed
- `peerDependencies` now includes both `baileys` and `@oxidezap/baileyrs` as optional
- Package description updated to mention transport-agnostic support
- Wrapper comments clarify baileyrs timelock behavior (no `reachoutTimeLock` events in v0.0.8 — operates in detection-only mode)

### Why
Positions baileys-antiban as "Switzerland" of WhatsApp anti-ban — works with any Baileys-compatible transport layer. No breaking changes for existing baileys users.

## [1.3.1] - 2026-04-16

### Changed
- Refactor wrapper to use Baileys' `ev.process()` API — single batched event handler reduces listener leaks and cleans up the integration surface
- Graceful fallback to `ev.on()` for older Baileys versions

### Why
Scattered `ev.on()` registrations are a known leak vector. Consolidating into `process()` shrinks the attack surface for listener-lifecycle bugs and future-proofs for backend-agnostic support.

## [1.3.0] - 2026-04-16

### Added
- **ReplyRatioGuard** — tracks outbound:inbound ratio per contact, blocks sends to non-responsive contacts, suggests auto-replies to incoming messages
- **ContactGraphWarmer** — requires 1:1 handshake before bulk/group send, enforces group lurk period, daily stranger quota
- **PresenceChoreographer** — circadian rhythm enforcement, distraction pauses, realistic read-receipt timing
- All three features are **opt-in** via config and backward compatible
- New wrapSocket option: `autoRespondToIncoming` for hands-off reply-ratio maintenance
- New config fields: `replyRatio`, `contactGraph`, `presence` in `AntiBanConfig`
- New public methods: `onIncomingMessage()`, getters for new modules
- Enhanced `AntiBanStats` with optional `replyRatio`, `contactGraph`, `presence` stats

### Why
Based on 2025-2026 ban detection research: WhatsApp's ML models weight reply-ratio, contact-graph distance, and temporal patterns more heavily than raw volume. These modules address the three largest gaps in existing anti-ban libraries.

## [1.2.0] - 2026-04-13

### Added
- **`destroy()` method** in `AntiBan` class to clean up all timers and resources
- **`destroy()` method** in `MessageQueue` class to clean up interval timer
- **Explicit stat interfaces** exported from library:
  - `WarmUpStatus` interface (replaces opaque `ReturnType<WarmUp['getStatus']>`)
  - `RateLimiterStats` interface (replaces opaque `ReturnType<RateLimiter['getStats']>`)
- Automatic cleanup on socket close in wrapper

### Fixed
- **Timer leak**: `AntiBan` now properly cleans up `TimelockGuard.resumeTimer` on connection close
- **Type visibility**: Consumers can now see stat object shapes without inspecting implementation

### Changed
- `wrapSocket()` now automatically calls `antiban.destroy()` when `connection.close` event fires
- `AntiBanStats` interface now uses explicit `WarmUpStatus` and `RateLimiterStats` types

## [1.1.0] - 2026-03-27

### Added
- **StateAdapter interface** for persistent state management
- `FileStateAdapter` class for JSON file-based state persistence
- Comprehensive TypeScript type exports for all configuration interfaces
- `SendDecision` type export from main index
- `HealthMonitorConfig` type export
- Full JSDoc documentation across all modules
- Named constants for time values (MS_PER_MINUTE, MS_PER_HOUR, etc.)
- `identicalMessageWindowMs` config option for time-windowed duplicate tracking
- `resumeBufferMs` config for TimelockGuard safety margin
- Comprehensive test suite for TimelockGuard

### Changed
- **README.md** completely rewritten with practical examples and better structure
- Simplified package.json exports (ESM-only, removed CJS)
- Added `sideEffects: false` to package.json for better tree-shaking
- Updated tsconfig.json with strict mode enabled

### Fixed
- **Burst reset bug** in RateLimiter: `timeSinceLast` check now happens BEFORE `lastMessageTime` update
- **Identical message tracking** now properly expires after time window (1 hour default) instead of persisting indefinitely
- **Cleanup logic** in RateLimiter now removes expired identical message trackers based on `lastSeen` timestamp
- **Hourly/daily limit delays** now properly sort messages by timestamp to find the oldest message
- **Timer race condition** in TimelockGuard: generation counter prevents stale timer callbacks from firing

### Improved
- More accurate ban risk scoring in HealthMonitor
- Better handling of 463 reachout timelock errors
- Clearer error messages and logging
- More robust state management across all components
- Better TypeScript strict mode compliance

## [1.0.0] - 2026-03-24

### Added
- Initial npm release
- Core anti-ban features:
  - Rate limiting with human-like timing patterns
  - Warm-up system for new numbers (7-day gradual ramp)
  - Health monitoring with auto-pause
  - Socket wrapper for drop-in protection
  - TimelockGuard for 463 reachout error handling
- Advanced features:
  - Message queue with auto-retry
  - Content variator to avoid identical messages
  - Smart scheduler for time-of-day optimization
  - Webhook alerts (Telegram, Discord, custom)
- Comprehensive test suite
- Live test bot for real WhatsApp testing
- Stress test bot for performance validation

### Technical
- TypeScript codebase with full type definitions
- Peer dependency: Baileys >=6.0.0
- Gaussian jitter for realistic delays
- Typing simulation based on message length
- Burst allowance for natural conversation flow
- Persistent warm-up state support

## [Pre-1.0.0] - Development

### 2026-03-23
- Added comprehensive smoke test suite
- Implemented live test bot for real-world validation

### 2026-03-22
- Version 2.0 feature set: MessageQueue, ContentVariator, Scheduler, WebhookAlerts
- Added .gitignore and cleaned up repository

### 2026-03-20
- Initial implementation: RateLimiter, WarmUp, HealthMonitor
- Socket wrapper with automatic protection
- Core anti-ban logic and safety mechanisms

---

## Upgrade Notes

### 1.0.0
This is the first stable release. API is considered stable and follows semantic versioning from this point forward.

## Links
- [GitHub Repository](https://github.com/kobie3717/baileys-antiban)
- [npm Package](https://www.npmjs.com/package/baileys-antiban)
- [Issues](https://github.com/kobie3717/baileys-antiban/issues)
