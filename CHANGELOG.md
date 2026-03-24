# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-24

### Added
- Initial npm release
- Core anti-ban features:
  - Rate limiting with human-like timing patterns
  - Warm-up system for new numbers (7-day gradual ramp)
  - Health monitoring with auto-pause
  - Socket wrapper for drop-in protection
- Advanced features:
  - Message queue with auto-retry
  - Content variator to avoid identical messages
  - Smart scheduler for time-of-day optimization
  - Webhook alerts (Telegram, Discord, custom)
- Comprehensive test suite (30 tests)
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
