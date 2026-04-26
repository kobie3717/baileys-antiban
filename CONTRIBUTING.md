# Contributing to baileys-antiban

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Test: `npm test`

## Code Style

- TypeScript strict mode enabled
- ESM-only (no CommonJS)
- Prefer functional patterns where appropriate
- Add JSDoc comments for exported functions and types

## Testing

Run the test suite before submitting:

```bash
npm test
```

Tests are in `tests/manual-test.ts` and cover all core modules (RateLimiter, WarmUp, HealthMonitor, ContactGraphWarmer, etc.).

## Pull Requests

1. Open an issue first to discuss the proposed change
2. Fork the repo and create a feature branch
3. Make your changes with tests
4. Ensure `npm run build && npm test` passes
5. Submit a PR with a clear description

## Releasing

Releases are automated via GitHub Actions on `v*` tags. Process:

1. Bump version in `package.json`
2. Update `CHANGELOG.md`
3. `git commit -am "release: vX.Y.Z"`
4. `git tag vX.Y.Z`
5. `git push && git push --tags`

The `Release` workflow runs tests, builds, and publishes to npm with SLSA provenance.

**Required setup (one-time):** Repo admin adds `NPM_AUTOMATION_TOKEN` secret with an [npm automation token](https://docs.npmjs.com/creating-and-viewing-access-tokens). Token must have publish scope.

## Code of Conduct

Be respectful, constructive, and professional. We're building tools for the community.

## Questions?

Open a discussion or issue on GitHub. For security vulnerabilities, email jiwentzel@icloud.com privately.
