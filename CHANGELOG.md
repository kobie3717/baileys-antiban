# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
