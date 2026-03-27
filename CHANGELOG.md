# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
