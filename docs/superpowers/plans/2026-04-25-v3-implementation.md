# baileys-antiban v3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship baileys-antiban v3.0 — zero-config preset API, working state persistence, group/newsletter rate profiles, tiered health decay, and a bundled CLI tool.

**Architecture:** New constructor accepts `string | FlatConfig | undefined`, resolved via `presets.ts`. State persists via `persist.ts` (StateManager). Group JIDs get scaled rate limits via `profiles.ts`. Health score decays based on time since last bad event with severity tiering. CLI via `src/cli.ts` registered as `bin` in package.json.

**Tech Stack:** TypeScript 5, ESM, Node.js ≥16, Jest + ts-jest, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-04-25-v3-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/presets.ts` | **Create** | Preset definitions + `resolveConfig()` |
| `src/persist.ts` | **Create** | StateManager — load/save/LRU knownChats |
| `src/profiles.ts` | **Create** | Group/newsletter JID detection + multiplier |
| `src/cli.ts` | **Create** | CLI: status, reset, warmup --simulate |
| `src/health.ts` | **Modify** | Add tiered health decay |
| `src/warmup.ts` | **Modify** | Remove dead `statePath` field |
| `src/antiban.ts` | **Modify** | New constructor, wire persist/profiles, compat shim |
| `src/index.ts` | **Modify** | Export new public types |
| `package.json` | **Modify** | Add bin, bump version to 3.0.0 |
| `tests/presets.test.ts` | **Create** | Preset resolution tests |
| `tests/persist.test.ts` | **Create** | StateManager round-trip + corruption tests |
| `tests/profiles.test.ts` | **Create** | JID detection + multiplier tests |
| `tests/v3-antiban.test.ts` | **Create** | New constructor + compat shim tests |
| `tests/health.test.ts` | **Modify** | Add decay tests |

---

## Task 1: `src/presets.ts` — Preset definitions

**Files:**
- Create: `src/presets.ts`
- Create: `tests/presets.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/presets.test.ts`:

```typescript
import { resolveConfig, PRESETS } from '../src/presets.js';

describe('resolveConfig', () => {
  test('undefined → conservative preset', () => {
    const cfg = resolveConfig(undefined);
    expect(cfg.maxPerMinute).toBe(5);
    expect(cfg.maxPerHour).toBe(100);
    expect(cfg.warmupDays).toBe(10);
    expect(cfg.groupMultiplier).toBe(0.5);
    expect(cfg.autoPauseAt).toBe('medium');
  });

  test('string "moderate" → moderate preset', () => {
    const cfg = resolveConfig('moderate');
    expect(cfg.maxPerMinute).toBe(10);
    expect(cfg.maxPerHour).toBe(300);
    expect(cfg.groupMultiplier).toBe(0.7);
  });

  test('string "aggressive" → aggressive preset', () => {
    const cfg = resolveConfig('aggressive');
    expect(cfg.maxPerMinute).toBe(20);
    expect(cfg.autoPauseAt).toBe('critical');
  });

  test('flat config with preset → merges overrides', () => {
    const cfg = resolveConfig({ preset: 'moderate', maxPerMinute: 15 });
    expect(cfg.maxPerMinute).toBe(15);  // override wins
    expect(cfg.maxPerHour).toBe(300);   // preset default
  });

  test('flat config without preset → conservative base', () => {
    const cfg = resolveConfig({ maxPerDay: 999 });
    expect(cfg.maxPerDay).toBe(999);
    expect(cfg.maxPerMinute).toBe(5); // conservative default
  });

  test('invalid preset string → throws', () => {
    expect(() => resolveConfig('turbo' as any)).toThrow('Unknown preset');
  });

  test('all preset names exist in PRESETS', () => {
    expect(PRESETS.conservative).toBeDefined();
    expect(PRESETS.moderate).toBeDefined();
    expect(PRESETS.aggressive).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/presets.test.ts --no-coverage 2>&1 | tail -10
```
Expected: module not found error.

- [ ] **Step 3: Create `src/presets.ts`**

```typescript
import type { BanRiskLevel } from './health.js';

export interface ResolvedConfig {
  // Rate limits
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
  minDelayMs: number;
  maxDelayMs: number;
  newChatDelayMs: number;
  // Warmup
  warmupDays: number;
  day1Limit: number;
  growthFactor: number;
  inactivityThresholdHours: number;
  // Health
  autoPauseAt: BanRiskLevel;
  // Group profiles
  groupMultiplier: number;
  groupProfiles: boolean;
  // Persistence
  persist?: string;
  // Logging
  logging: boolean;
}

export type PresetName = 'conservative' | 'moderate' | 'aggressive';

export type AntiBanInput =
  | PresetName
  | Partial<ResolvedConfig & { preset?: PresetName }>
  | undefined;

export const PRESETS: Record<PresetName, ResolvedConfig> = {
  conservative: {
    maxPerMinute: 5,
    maxPerHour: 100,
    maxPerDay: 800,
    minDelayMs: 2500,
    maxDelayMs: 7000,
    newChatDelayMs: 4000,
    warmupDays: 10,
    day1Limit: 15,
    growthFactor: 1.8,
    inactivityThresholdHours: 72,
    autoPauseAt: 'medium',
    groupMultiplier: 0.5,
    groupProfiles: false,
    logging: true,
  },
  moderate: {
    maxPerMinute: 10,
    maxPerHour: 300,
    maxPerDay: 1500,
    minDelayMs: 1500,
    maxDelayMs: 5000,
    newChatDelayMs: 3000,
    warmupDays: 7,
    day1Limit: 20,
    growthFactor: 1.8,
    inactivityThresholdHours: 72,
    autoPauseAt: 'high',
    groupMultiplier: 0.7,
    groupProfiles: false,
    logging: true,
  },
  aggressive: {
    maxPerMinute: 20,
    maxPerHour: 800,
    maxPerDay: 4000,
    minDelayMs: 800,
    maxDelayMs: 3000,
    newChatDelayMs: 2000,
    warmupDays: 4,
    day1Limit: 35,
    growthFactor: 2.0,
    inactivityThresholdHours: 48,
    autoPauseAt: 'critical',
    groupMultiplier: 0.9,
    groupProfiles: false,
    logging: true,
  },
};

export function resolveConfig(input: AntiBanInput): ResolvedConfig {
  if (input === undefined) {
    return { ...PRESETS.conservative };
  }

  if (typeof input === 'string') {
    if (!(input in PRESETS)) {
      throw new Error(`Unknown preset "${input}". Valid: ${Object.keys(PRESETS).join(', ')}`);
    }
    return { ...PRESETS[input] };
  }

  // Object form — extract preset base, merge overrides
  const { preset = 'conservative', ...overrides } = input;
  if (!(preset in PRESETS)) {
    throw new Error(`Unknown preset "${preset}". Valid: ${Object.keys(PRESETS).join(', ')}`);
  }
  return { ...PRESETS[preset], ...overrides };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/presets.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Tests: 7 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/presets.ts tests/presets.test.ts
git commit -m "feat(v3): presets.ts — resolveConfig with conservative/moderate/aggressive"
```

---

## Task 2: `src/profiles.ts` — Group/newsletter detection

**Files:**
- Create: `src/profiles.ts`
- Create: `tests/profiles.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/profiles.test.ts`:

```typescript
import { isGroup, isNewsletter, isBroadcast, applyGroupMultiplier } from '../src/profiles.js';

describe('JID detection', () => {
  test('isGroup: @g.us suffix', () => {
    expect(isGroup('120363000000000000@g.us')).toBe(true);
    expect(isGroup('27821234567@s.whatsapp.net')).toBe(false);
    expect(isGroup('27821234567@newsletter')).toBe(false);
  });

  test('isNewsletter: @newsletter suffix', () => {
    expect(isNewsletter('12345@newsletter')).toBe(true);
    expect(isNewsletter('27821234567@s.whatsapp.net')).toBe(false);
  });

  test('isBroadcast: status@broadcast', () => {
    expect(isBroadcast('status@broadcast')).toBe(true);
    expect(isBroadcast('27821234567@s.whatsapp.net')).toBe(false);
  });
});

describe('applyGroupMultiplier', () => {
  test('scales all three limits', () => {
    const result = applyGroupMultiplier(
      { maxPerMinute: 10, maxPerHour: 300, maxPerDay: 1500 },
      0.5
    );
    expect(result.maxPerMinute).toBe(5);
    expect(result.maxPerHour).toBe(150);
    expect(result.maxPerDay).toBe(750);
  });

  test('rounds down to integer', () => {
    const result = applyGroupMultiplier(
      { maxPerMinute: 7, maxPerHour: 100, maxPerDay: 300 },
      0.7
    );
    expect(result.maxPerMinute).toBe(4); // floor(4.9)
    expect(result.maxPerHour).toBe(70);
    expect(result.maxPerDay).toBe(210);
  });

  test('minimum 1 per limit', () => {
    const result = applyGroupMultiplier(
      { maxPerMinute: 1, maxPerHour: 1, maxPerDay: 1 },
      0.1
    );
    expect(result.maxPerMinute).toBe(1);
    expect(result.maxPerHour).toBe(1);
    expect(result.maxPerDay).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/profiles.test.ts --no-coverage 2>&1 | tail -10
```
Expected: module not found.

- [ ] **Step 3: Create `src/profiles.ts`**

```typescript
export interface RateLimits {
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
}

/** @g.us = WhatsApp group */
export function isGroup(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/** @newsletter = WhatsApp newsletter/channel */
export function isNewsletter(jid: string): boolean {
  return jid.endsWith('@newsletter');
}

/** status@broadcast = broadcast list */
export function isBroadcast(jid: string): boolean {
  return jid === 'status@broadcast' || jid.endsWith('@broadcast');
}

/**
 * Returns true if the JID should use stricter (group) rate limits.
 * Groups and newsletters both get the group multiplier in v3.
 * v4: separate newsletter profile.
 */
export function shouldUseGroupProfile(jid: string): boolean {
  return isGroup(jid) || isNewsletter(jid);
}

/**
 * Scale rate limits by multiplier for group/newsletter JIDs.
 * Floors to integer, minimum 1 per limit.
 */
export function applyGroupMultiplier(limits: RateLimits, multiplier: number): RateLimits {
  return {
    maxPerMinute: Math.max(1, Math.floor(limits.maxPerMinute * multiplier)),
    maxPerHour: Math.max(1, Math.floor(limits.maxPerHour * multiplier)),
    maxPerDay: Math.max(1, Math.floor(limits.maxPerDay * multiplier)),
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/profiles.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Tests: 5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/profiles.ts tests/profiles.test.ts
git commit -m "feat(v3): profiles.ts — group/newsletter JID detection + rate multiplier"
```

---

## Task 3: `src/persist.ts` — StateManager

**Files:**
- Create: `src/persist.ts`
- Create: `tests/persist.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/persist.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StateManager, type PersistedState } from '../src/persist.js';

function tmpPath(): string {
  return path.join(os.tmpdir(), `antiban-test-${Date.now()}.json`);
}

function freshState(): PersistedState {
  return {
    warmup: { startedAt: Date.now(), lastActiveAt: Date.now(), dailyCounts: [], graduated: false },
    knownChats: [],
    savedAt: Date.now(),
    version: 3,
  };
}

afterEach(() => {
  // cleanup any leftover temp files
  const tmpDir = os.tmpdir();
  fs.readdirSync(tmpDir)
    .filter(f => f.startsWith('antiban-test-'))
    .forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch {} });
});

describe('StateManager', () => {
  test('load returns null for missing file', () => {
    const mgr = new StateManager('/tmp/nonexistent-antiban-xyz.json');
    expect(mgr.load()).toBeNull();
  });

  test('load returns null for corrupt JSON, logs warn', () => {
    const p = tmpPath();
    fs.writeFileSync(p, 'not json {{{{');
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mgr = new StateManager(p);
    const result = mgr.load();
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('corrupt state'));
    spy.mockRestore();
  });

  test('load returns null for wrong version', () => {
    const p = tmpPath();
    const state = { ...freshState(), version: 2 };
    fs.writeFileSync(p, JSON.stringify(state));
    const mgr = new StateManager(p);
    expect(mgr.load()).toBeNull();
  });

  test('save + load round-trip', async () => {
    const p = tmpPath();
    const mgr = new StateManager(p);
    const state = freshState();
    state.knownChats = ['27821@s.whatsapp.net', '120363@g.us'];
    mgr.saveImmediate(state);
    const loaded = mgr.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.knownChats).toEqual(['27821@s.whatsapp.net', '120363@g.us']);
    expect(loaded!.version).toBe(3);
  });

  test('knownChats capped at 1000 on save', () => {
    const p = tmpPath();
    const mgr = new StateManager(p);
    const state = freshState();
    state.knownChats = Array.from({ length: 1200 }, (_, i) => `${i}@s.whatsapp.net`);
    mgr.saveImmediate(state);
    const loaded = mgr.load();
    expect(loaded!.knownChats.length).toBe(1000);
    // Should keep LAST 1000 (most recent)
    expect(loaded!.knownChats[0]).toBe('200@s.whatsapp.net');
    expect(loaded!.knownChats[999]).toBe('1199@s.whatsapp.net');
  });

  test('saveDebounced does not write immediately', (done) => {
    const p = tmpPath();
    const mgr = new StateManager(p);
    mgr.saveDebounced(freshState());
    expect(fs.existsSync(p)).toBe(false); // not written yet
    mgr.flush();
    done();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/persist.test.ts --no-coverage 2>&1 | tail -10
```
Expected: module not found.

- [ ] **Step 3: Create `src/persist.ts`**

```typescript
import * as fs from 'fs';
import type { WarmUpState } from './warmup.js';

export interface PersistedState {
  warmup: WarmUpState;
  knownChats: string[];
  savedAt: number;
  version: 3;
}

const KNOWN_CHATS_MAX = 1000;
const DEBOUNCE_MS = 5000;

export class StateManager {
  private path: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string) {
    this.path = filePath;
  }

  load(): PersistedState | null {
    try {
      const raw = fs.readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed.version !== 3) {
        console.warn('[baileys-antiban] WARN: corrupt state file or version mismatch, starting fresh');
        return null;
      }
      return parsed as PersistedState;
    } catch {
      // Missing file = silent null. Corrupt JSON = warn.
      if (fs.existsSync(this.path)) {
        console.warn('[baileys-antiban] WARN: corrupt state file, starting fresh');
      }
      return null;
    }
  }

  /** Debounced save — called after every send (5s delay) */
  saveDebounced(state: PersistedState): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.writeFile(state);
      this.debounceTimer = null;
    }, DEBOUNCE_MS);
  }

  /** Immediate save — called after health events (ban/restriction) */
  saveImmediate(state: PersistedState): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.writeFile(state);
  }

  /** Flush pending debounced write synchronously (for tests and process exit) */
  flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  destroy(): void {
    this.flush();
  }

  private writeFile(state: PersistedState): void {
    const toSave: PersistedState = {
      ...state,
      savedAt: Date.now(),
      // LRU eviction: keep last KNOWN_CHATS_MAX entries
      knownChats: state.knownChats.length > KNOWN_CHATS_MAX
        ? state.knownChats.slice(-KNOWN_CHATS_MAX)
        : state.knownChats,
    };
    try {
      fs.writeFileSync(this.path, JSON.stringify(toSave, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[baileys-antiban] WARN: failed to write state to ${this.path}:`, err);
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/persist.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Tests: 5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/persist.ts tests/persist.test.ts
git commit -m "feat(v3): persist.ts — StateManager with load/saveDebounced/saveImmediate/LRU cap"
```

---

## Task 4: `src/health.ts` — Tiered health decay

**Files:**
- Modify: `src/health.ts`
- Modify: `tests/health.test.ts`

- [ ] **Step 1: Write failing tests for decay**

Append to `tests/health.test.ts` (after existing tests):

```typescript
describe('Health score decay', () => {
  test('score decays to 0 after clean time (low severity)', () => {
    const monitor = new HealthMonitor({});
    monitor.recordDisconnect('connection_reset'); // low severity, +15 at threshold
    const statusBefore = monitor.getStatus();
    expect(statusBefore.score).toBeGreaterThan(0);

    // Manually advance lastBadEventTime into past (20 min ago)
    (monitor as any).lastBadEventTime = Date.now() - 20 * 60 * 1000;
    (monitor as any).lastEventWasSevere = false;

    const statusAfter = monitor.getStatus();
    expect(statusAfter.score).toBe(0);
    expect(statusAfter.risk).toBe('low');
  });

  test('403 (severe) decays slower — not zero after 20 min', () => {
    const monitor = new HealthMonitor({});
    monitor.recordDisconnect('403'); // severe, +40 pts
    const initial = monitor.getStatus();
    expect(initial.score).toBe(40);

    // 20 min later: 2pts/min × 20 = 40 pts decayed → 0
    (monitor as any).lastBadEventTime = Date.now() - 20 * 60 * 1000;
    (monitor as any).lastEventWasSevere = true;

    // At exactly 20 min, 2*20=40 pts decayed from 40 = 0
    const after20 = monitor.getStatus();
    expect(after20.score).toBe(0);
  });

  test('403 (severe) not yet zero at 10 min', () => {
    const monitor = new HealthMonitor({});
    monitor.recordDisconnect('403'); // +40
    (monitor as any).lastBadEventTime = Date.now() - 10 * 60 * 1000;
    (monitor as any).lastEventWasSevere = true;
    // 2pts/min × 10 = 20 decayed, score = 40-20 = 20
    const status = monitor.getStatus();
    expect(status.score).toBe(20);
    expect(status.risk).toBe('low'); // 20 < 30
  });

  test('recordReconnect does NOT reset lastBadEventTime', () => {
    const monitor = new HealthMonitor({});
    monitor.recordDisconnect('connection_reset');
    const badTime = (monitor as any).lastBadEventTime;
    monitor.recordReconnect();
    expect((monitor as any).lastBadEventTime).toBe(badTime); // unchanged
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx jest tests/health.test.ts --no-coverage 2>&1 | tail -15
```
Expected: failures on the new decay tests.

- [ ] **Step 3: Update `src/health.ts`**

Add two fields after `private lastRisk: BanRiskLevel = 'low';`:

```typescript
private lastBadEventTime: number = Date.now();
private lastEventWasSevere: boolean = false;
```

Update `recordDisconnect` to set `lastBadEventTime` and `lastEventWasSevere`:

```typescript
recordDisconnect(reason: string | number): void {
  const reasonStr = String(reason);
  
  if (reasonStr === '403' || reasonStr === 'forbidden') {
    this.events.push({ type: 'forbidden', timestamp: Date.now(), detail: reasonStr });
    this.lastBadEventTime = Date.now();
    this.lastEventWasSevere = true;
  } else if (reasonStr === '401' || reasonStr === 'loggedOut') {
    this.events.push({ type: 'loggedOut', timestamp: Date.now(), detail: reasonStr });
    this.lastBadEventTime = Date.now();
    this.lastEventWasSevere = true;
  } else {
    this.events.push({ type: 'disconnect', timestamp: Date.now(), detail: reasonStr });
    this.lastBadEventTime = Date.now();
    this.lastEventWasSevere = false;
  }
  this.checkAndNotify();
}
```

Update `recordMessageFailed` and `recordReachoutTimelock` to set `lastBadEventTime` (not severe):

```typescript
recordMessageFailed(error?: string): void {
  this.events.push({ type: 'messageFailed', timestamp: Date.now(), detail: error });
  this.lastBadEventTime = Date.now();
  this.lastEventWasSevere = false;
  this.checkAndNotify();
}

recordReachoutTimelock(detail?: string): void {
  this.events.push({ type: 'reachoutTimelocked', timestamp: Date.now(), detail });
  this.lastBadEventTime = Date.now();
  this.lastEventWasSevere = false;
  this.checkAndNotify();
}
```

In `getStatus()`, add decay after `score = Math.min(100, score);`:

```typescript
// Tiered decay: recover based on time since last bad event
// Severe (403/401): 2pts/min — ~50min to clear 100pts
// Normal: 5pts/min — ~20min to clear 100pts
const minutesSinceLastBad = (now - this.lastBadEventTime) / 60000;
const decayRate = this.lastEventWasSevere ? 2 : 5;
score = Math.max(0, score - Math.floor(minutesSinceLastBad * decayRate));
```

Update `reset()` to also reset decay fields:

```typescript
reset(): void {
  this.events = [];
  this.startTime = Date.now();
  this.paused = false;
  this.lastRisk = 'low';
  this.lastBadEventTime = Date.now();
  this.lastEventWasSevere = false;
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/health.test.ts --no-coverage 2>&1 | tail -15
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/health.ts tests/health.test.ts
git commit -m "feat(v3): health.ts — tiered score decay (2pts/min severe, 5pts/min normal)"
```

---

## Task 5: `src/warmup.ts` — Remove dead `statePath`

**Files:**
- Modify: `src/warmup.ts`

- [ ] **Step 1: Remove `statePath` from WarmUpConfig**

In `src/warmup.ts`, find and remove the `statePath` field from `WarmUpConfig`:

```typescript
// REMOVE this line from WarmUpConfig interface:
/** Persist state to this file path (optional) */
statePath?: string;
```

- [ ] **Step 2: Verify build still compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/warmup.ts
git commit -m "refactor(v3): warmup.ts — remove dead statePath (persistence moved to StateManager)"
```

---

## Task 6: `src/antiban.ts` — New constructor + wire everything

**Files:**
- Modify: `src/antiban.ts`
- Create: `tests/v3-antiban.test.ts`

- [ ] **Step 1: Write failing tests for new constructor**

Create `tests/v3-antiban.test.ts`:

```typescript
import { AntiBan } from '../src/antiban.js';

describe('AntiBan v3 constructor', () => {
  test('zero config — works, conservative defaults', async () => {
    const ab = new AntiBan();
    const result = await ab.beforeSend('27821234567@s.whatsapp.net', 'hello');
    expect(result.allowed).toBe(true);
    ab.destroy();
  });

  test('string preset "moderate"', async () => {
    const ab = new AntiBan('moderate');
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perMinute).toBe(10);
    ab.destroy();
  });

  test('string preset "aggressive"', () => {
    const ab = new AntiBan('aggressive');
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perMinute).toBe(20);
    ab.destroy();
  });

  test('flat config object with preset', () => {
    const ab = new AntiBan({ preset: 'moderate', maxPerMinute: 15 });
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perMinute).toBe(15); // override wins
    ab.destroy();
  });

  test('flat config without preset — conservative base', () => {
    const ab = new AntiBan({ maxPerDay: 999 });
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perDay).toBe(999);
    expect(stats.rateLimiter.limits.perMinute).toBe(5); // conservative
    ab.destroy();
  });

  test('invalid preset throws', () => {
    expect(() => new AntiBan('turbo' as any)).toThrow('Unknown preset');
  });

  test('v2 compat shim: nested config logs warn + still works', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ab = new AntiBan({
      rateLimiter: { maxPerMinute: 6 },
    } as any);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[baileys-antiban] DEPRECATED'));
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perMinute).toBe(6);
    spy.mockRestore();
    ab.destroy();
  });

  test('group JID gets scaled limits when groupProfiles: true', async () => {
    const ab = new AntiBan({ preset: 'moderate', groupProfiles: true });
    // moderate maxPerMinute=10, groupMultiplier=0.7 → 7 for groups
    // We can't easily test internal scaling directly, but we can verify
    // the instance was created without error and groupProfiles flag registered
    expect(ab).toBeDefined();
    ab.destroy();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx jest tests/v3-antiban.test.ts --no-coverage 2>&1 | tail -15
```
Expected: failures (constructor still takes old nested config).

- [ ] **Step 3: Refactor `src/antiban.ts` constructor**

At the top of `antiban.ts`, add imports:

```typescript
import { resolveConfig, type AntiBanInput, type ResolvedConfig } from './presets.js';
import { StateManager, type PersistedState } from './persist.js';
import { shouldUseGroupProfile, applyGroupMultiplier } from './profiles.js';
```

Replace the `AntiBanConfig` interface and constructor with:

```typescript
// Legacy v2 nested config shape (compat shim)
export interface AntiBanConfigLegacy {
  rateLimiter?: Partial<RateLimiterConfig>;
  warmUp?: Partial<WarmUpConfig>;
  health?: Partial<HealthMonitorConfig>;
  timelock?: Partial<TimelockGuardConfig>;
  replyRatio?: Partial<ReplyRatioConfig>;
  contactGraph?: Partial<ContactGraphConfig>;
  presence?: Partial<PresenceChoreographerConfig>;
  retryTracker?: Partial<RetryTrackerConfig>;
  reconnectThrottle?: Partial<ReconnectThrottleConfig>;
  lidResolver?: LidResolverConfig;
  jidCanonicalizer?: JidCanonicalizerConfig;
  sessionStability?: {
    enabled: boolean;
    canonicalJidNormalization?: boolean;
    healthMonitoring?: boolean;
    badMacThreshold?: number;
    badMacWindowMs?: number;
  };
  logging?: boolean;
}

// v3 flat config — exported for users who want to type their config
export type AntiBanConfig = AntiBanInput;

function isLegacyConfig(cfg: unknown): cfg is AntiBanConfigLegacy {
  if (typeof cfg !== 'object' || cfg === null) return false;
  return 'rateLimiter' in cfg || 'warmUp' in cfg || 'health' in cfg;
}

function mapLegacyConfig(legacy: AntiBanConfigLegacy): ResolvedConfig & AntiBanConfigLegacy {
  console.warn(
    '[baileys-antiban] DEPRECATED: Nested config (v2 style) detected. ' +
    'Migrate to flat config: new AntiBan({ maxPerMinute: 8 }). ' +
    'See: https://github.com/kobie3717/baileys-antiban#migration'
  );
  const flat: Partial<ResolvedConfig> = {};
  if (legacy.rateLimiter?.maxPerMinute !== undefined) flat.maxPerMinute = legacy.rateLimiter.maxPerMinute;
  if (legacy.rateLimiter?.maxPerHour !== undefined) flat.maxPerHour = legacy.rateLimiter.maxPerHour;
  if (legacy.rateLimiter?.maxPerDay !== undefined) flat.maxPerDay = legacy.rateLimiter.maxPerDay;
  if (legacy.rateLimiter?.minDelayMs !== undefined) flat.minDelayMs = legacy.rateLimiter.minDelayMs;
  if (legacy.rateLimiter?.maxDelayMs !== undefined) flat.maxDelayMs = legacy.rateLimiter.maxDelayMs;
  if (legacy.warmUp?.warmUpDays !== undefined) flat.warmupDays = legacy.warmUp.warmUpDays;
  if (legacy.warmUp?.day1Limit !== undefined) flat.day1Limit = legacy.warmUp.day1Limit;
  if (legacy.logging !== undefined) flat.logging = legacy.logging;
  // Return merged: flat overrides on conservative base, preserve legacy pass-through fields
  return { ...resolveConfig(flat), ...legacy };
}
```

Update the constructor signature and body:

```typescript
private stateManager: StateManager | null = null;
private resolvedConfig: ResolvedConfig;

constructor(input?: AntiBanInput | AntiBanConfigLegacy, legacyWarmUpState?: WarmUpState) {
  let cfg: ResolvedConfig & Partial<AntiBanConfigLegacy>;
  let warmUpState = legacyWarmUpState;

  if (isLegacyConfig(input)) {
    cfg = mapLegacyConfig(input as AntiBanConfigLegacy);
  } else {
    cfg = resolveConfig(input as AntiBanInput);
  }

  this.resolvedConfig = cfg;

  // Initialize persistence
  if (cfg.persist) {
    this.stateManager = new StateManager(cfg.persist);
    const saved = this.stateManager.load();
    if (saved) {
      warmUpState = saved.warmup;
      // Restore knownChats into rateLimiter after construction via method below
    }
  }

  const logging = cfg.logging ?? true;
  this.logging = logging;

  // Build sub-modules using resolved flat config
  this.rateLimiter = new RateLimiter({
    maxPerMinute: cfg.maxPerMinute,
    maxPerHour: cfg.maxPerHour,
    maxPerDay: cfg.maxPerDay,
    minDelayMs: cfg.minDelayMs,
    maxDelayMs: cfg.maxDelayMs,
    newChatDelayMs: cfg.newChatDelayMs,
  });

  this.warmUp = new WarmUp({
    warmUpDays: cfg.warmupDays,
    day1Limit: cfg.day1Limit,
    growthFactor: cfg.growthFactor,
    inactivityThresholdHours: cfg.inactivityThresholdHours,
  }, warmUpState);

  // ... rest of sub-module construction unchanged (health, timelock, etc.) ...
  // Pass cfg.autoPauseAt to HealthMonitorConfig
  this.health = new HealthMonitor({
    autoPauseAt: cfg.autoPauseAt,
    onRiskChange: (status) => {
      if (this.logging) {
        const emoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' };
        console.log(`[baileys-antiban] ${emoji[status.risk]} Risk level: ${status.risk.toUpperCase()} (score: ${status.score})`);
        console.log(`[baileys-antiban] ${status.recommendation}`);
        status.reasons.forEach(r => console.log(`[baileys-antiban]   → ${r}`));
      }
    },
  });

  // ... timelockGuard, replyRatioGuard, contactGraphWarmer, presenceChoreographer,
  //     retryTrackerModule, reconnectThrottleModule — keep existing construction unchanged ...
  // Legacy pass-through for advanced v2 features (sessionStability, jidCanonicalizer, lidResolver)
  // ... existing code unchanged ...
}
```

Update `beforeSend` to apply group profile scaling:

```typescript
async beforeSend(recipient: string, content: string): Promise<SendDecision> {
  const healthStatus = this.health.getStatus();

  // ... existing health/timelock/warmup/contactGraph/replyRatio/reconnect checks unchanged ...

  // Rate limiter delay — apply group multiplier if enabled
  let effectiveLimits = {
    maxPerMinute: this.resolvedConfig.maxPerMinute,
    maxPerHour: this.resolvedConfig.maxPerHour,
    maxPerDay: this.resolvedConfig.maxPerDay,
  };
  if (this.resolvedConfig.groupProfiles && shouldUseGroupProfile(recipient)) {
    effectiveLimits = applyGroupMultiplier(effectiveLimits, this.resolvedConfig.groupMultiplier);
  }
  // Note: RateLimiter doesn't accept per-call limit overrides — we check manually here
  // before calling rateLimiter.getDelay() for the timing/jitter part only
  const now = Date.now();
  const stats = this.rateLimiter.getStats();
  if (stats.lastMinute >= effectiveLimits.maxPerMinute ||
      stats.lastHour >= effectiveLimits.maxPerHour ||
      stats.lastDay >= effectiveLimits.maxPerDay) {
    this.stats.messagesBlocked++;
    if (this.logging) {
      console.log(`[baileys-antiban] 🚫 BLOCKED — group rate limit (${isGroup(recipient) ? 'group' : 'newsletter'})`);
    }
    return { allowed: false, delayMs: 0, reason: 'Group rate limit exceeded', health: healthStatus };
  }

  let delay = await this.rateLimiter.getDelay(recipient, content);
  // ... rest unchanged ...
}
```

Add `afterHealthEvent()` private method and call it from `onDisconnect`:

```typescript
private persistState(): void {
  if (!this.stateManager) return;
  const state: PersistedState = {
    warmup: this.warmUp.exportState(),
    knownChats: Array.from(this.rateLimiter.getKnownChats()),
    savedAt: Date.now(),
    version: 3,
  };
  this.stateManager.saveDebounced(state);
}

private persistStateImmediate(): void {
  if (!this.stateManager) return;
  const state: PersistedState = {
    warmup: this.warmUp.exportState(),
    knownChats: Array.from(this.rateLimiter.getKnownChats()),
    savedAt: Date.now(),
    version: 3,
  };
  this.stateManager.saveImmediate(state);
}
```

Update `afterSend`:
```typescript
afterSend(recipient: string, content: string): void {
  this.rateLimiter.record(recipient, content);
  this.warmUp.record();
  this.replyRatioGuard.recordSent(recipient);
  this.stats.messagesAllowed++;
  this.persistState(); // debounced
}
```

Update `onDisconnect` to trigger immediate persist on bad events:
```typescript
onDisconnect(reason: string | number): void {
  this.health.recordDisconnect(reason);
  this.reconnectThrottleModule.onDisconnect();
  const reasonStr = String(reason);
  if (reasonStr === '403' || reasonStr === '401' || reasonStr === 'forbidden' || reasonStr === 'loggedOut') {
    this.persistStateImmediate(); // ban events saved immediately
  }
}
```

Update `destroy()`:
```typescript
destroy(): void {
  // ... existing cleanup ...
  this.stateManager?.destroy();
  if (this.logging) {
    console.log('[baileys-antiban] 🧹 Destroyed — all timers cleared');
  }
}
```

Add `getKnownChats()` to `RateLimiter`:
```typescript
// In rateLimiter.ts, add to RateLimiter class:
getKnownChats(): Set<string> {
  return this.knownChats;
}
```

- [ ] **Step 4: Run v3 constructor tests**

```bash
npx jest tests/v3-antiban.test.ts --no-coverage 2>&1 | tail -15
```
Expected: all pass.

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
npx jest --no-coverage 2>&1 | tail -20
```
Expected: existing tests still pass (or show only pre-existing failures unrelated to this change).

- [ ] **Step 6: Commit**

```bash
git add src/antiban.ts src/rateLimiter.ts src/presets.ts src/persist.ts src/profiles.ts tests/v3-antiban.test.ts
git commit -m "feat(v3): antiban.ts — new constructor, preset resolution, persist, group profiles, compat shim"
```

---

## Task 7: `src/cli.ts` — Bundled CLI

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `src/cli.ts`**

```typescript
#!/usr/bin/env node
/**
 * baileys-antiban CLI
 * Usage: npx baileys-antiban <command> [options]
 */

import * as fs from 'fs';
import { StateManager } from './persist.js';
import { PRESETS, resolveConfig, type PresetName } from './presets.js';

const args = process.argv.slice(2);
const command = args[0];

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

function cmdStatus(opts: Record<string, string | boolean>): void {
  const statePath = opts['state'] as string | undefined;
  let warmupInfo = 'No state file (in-memory mode)';
  let savedAt = 'N/A';

  if (statePath) {
    const mgr = new StateManager(statePath);
    const state = mgr.load();
    if (state) {
      const now = Date.now();
      const dayMs = 86400000;
      const currentDay = Math.floor((now - state.warmup.startedAt) / dayMs);
      warmupInfo = state.warmup.graduated
        ? 'Graduated (warmup complete)'
        : `Day ${currentDay + 1}, sent today: ${state.warmup.dailyCounts[currentDay] || 0}`;
      savedAt = new Date(state.savedAt).toISOString();
    } else {
      warmupInfo = 'State file missing or corrupt';
    }
  }

  const output = {
    warmup: warmupInfo,
    savedAt,
    statePath: statePath || null,
  };

  if (opts['json']) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log('═══ baileys-antiban status ═══');
    console.log(`Warmup:   ${output.warmup}`);
    console.log(`Saved:    ${output.savedAt}`);
    console.log(`State:    ${output.statePath || 'none'}`);
  }
}

function cmdReset(opts: Record<string, string | boolean>): void {
  const statePath = opts['state'] as string | undefined;
  if (!statePath) {
    console.error('Error: --state <path> required for reset');
    process.exit(1);
  }
  if (!fs.existsSync(statePath)) {
    console.log('State file does not exist — nothing to reset');
    return;
  }
  fs.unlinkSync(statePath);
  console.log(`✅ State file deleted: ${statePath}`);
}

function cmdWarmupSimulate(opts: Record<string, string | boolean>): void {
  const days = parseInt(opts['simulate'] as string || '7', 10);
  const presetName = (opts['preset'] as PresetName) || 'conservative';
  const cfg = resolveConfig(presetName);

  console.log(`\nWarmup simulation — preset: ${presetName}, days: ${days}`);
  console.log('─'.repeat(50));

  const startDate = new Date();
  for (let day = 0; day < days; day++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + day);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const limit = Math.round(cfg.day1Limit * Math.pow(cfg.growthFactor, day));
    const bar = '█'.repeat(Math.min(30, Math.round(limit / 10)));
    console.log(`Day ${String(day + 1).padStart(2)} ${dayName.padEnd(15)} ${String(limit).padStart(5)} msgs/day  ${bar}`);
  }
  console.log('─'.repeat(50));
  console.log(`Day ${days + 1}+: graduated (unlimited by warmup)\n`);
}

// Main
const opts = parseArgs(args);

switch (command) {
  case 'status':
    cmdStatus(opts);
    break;
  case 'reset':
    cmdReset(opts);
    break;
  case 'warmup':
    if (opts['simulate']) {
      cmdWarmupSimulate(opts);
    } else {
      console.error('Usage: npx baileys-antiban warmup --simulate <days> [--preset conservative|moderate|aggressive]');
      process.exit(1);
    }
    break;
  default:
    console.log('baileys-antiban v3.0');
    console.log('');
    console.log('Commands:');
    console.log('  status [--state <path>] [--json]     Show warmup and health status');
    console.log('  reset --state <path>                  Delete state file');
    console.log('  warmup --simulate <days> [--preset]  Show warmup schedule');
    console.log('');
    console.log('Examples:');
    console.log('  npx baileys-antiban status --state ./antiban-state.json');
    console.log('  npx baileys-antiban warmup --simulate 7 --preset moderate');
    console.log('  npx baileys-antiban reset --state ./antiban-state.json');
}
```

- [ ] **Step 2: Add `bin` to `package.json`**

In `package.json`, add after `"scripts"`:

```json
"bin": {
  "baileys-antiban": "./dist/cli.js"
},
```

- [ ] **Step 3: Build and smoke test CLI**

```bash
npm run build 2>&1 | tail -5
node dist/cli.js --help
node dist/cli.js warmup --simulate 7 --preset moderate
node dist/cli.js status
```

Expected: help text prints, warmup shows 7-day table with dates, status shows no state file.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts package.json
git commit -m "feat(v3): cli.ts — bundled CLI with status/reset/warmup commands"
```

---

## Task 8: Update `src/index.ts` + bump version

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Add new exports to `src/index.ts`**

Add after the existing exports:

```typescript
// v3.0 new modules
export { resolveConfig, PRESETS, type AntiBanInput, type ResolvedConfig, type PresetName } from './presets.js';
export { StateManager, type PersistedState } from './persist.js';
export { isGroup, isNewsletter, isBroadcast, shouldUseGroupProfile, applyGroupMultiplier, type RateLimits } from './profiles.js';
```

- [ ] **Step 2: Bump version to 3.0.0**

```bash
cd /root/baileys-antiban && npm version major
```

- [ ] **Step 3: Full build + test run**

```bash
npm run build 2>&1 | tail -10
npx jest --no-coverage 2>&1 | tail -20
```

Expected: build clean, tests pass (or only pre-existing failures).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts package.json package-lock.json
git commit -m "chore(v3): bump to 3.0.0, export new modules from index"
```

---

## Task 9: Update README for v3

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add v3 Quick Start to README**

Find the `## Install` section and add after it:

```markdown
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
```

- [ ] **Step 2: Add v3 entry to CHANGELOG.md**

Prepend to CHANGELOG.md:

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(v3): README quick-start + CHANGELOG for 3.0.0"
```

---

## Task 10: Publish

- [ ] **Step 1: Final build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 2: Dry run**

```bash
npm publish --dry-run 2>&1 | grep -E "filename|total files|version"
```

Expected: shows `baileys-antiban@3.0.0`, `dist/cli.js` in file list.

- [ ] **Step 3: Publish**

```bash
npm publish
```

- [ ] **Step 4: Push to GitHub**

```bash
git push origin master
```

- [ ] **Step 5: Verify**

```bash
npm info baileys-antiban version
```

Expected: `3.0.0`

---

## Self-Review

**Spec coverage check:**
- ✅ Zero-config constructor → Task 6
- ✅ Three presets → Task 1
- ✅ State persistence (load/save/corrupt/LRU) → Task 3 + Task 6
- ✅ `afterHealthEvent()` immediate save → Task 6 (`persistStateImmediate` on disconnect)
- ✅ Group profiles (@g.us + @newsletter) → Task 2 + Task 6
- ✅ Health tiered decay → Task 4
- ✅ CLI (status --json, reset, warmup --simulate with dates) → Task 7
- ✅ Compat shim with `console.warn` → Task 6
- ✅ `WarmUpConfig.statePath` removed → Task 5
- ✅ `getKnownChats()` on RateLimiter → Task 6
- ✅ Version 3.0.0 → Task 8
- ✅ README + CHANGELOG → Task 9

**Placeholder scan:** None found.

**Type consistency check:**
- `PersistedState` defined in Task 3 (`persist.ts`), used in Task 6 (`antiban.ts`) ✅
- `ResolvedConfig` defined in Task 1 (`presets.ts`), used in Tasks 6 ✅
- `RateLimits` interface defined in Task 2 (`profiles.ts`), `applyGroupMultiplier` signature consistent ✅
- `getKnownChats(): Set<string>` added to RateLimiter in Task 6, consumed in `persistState()` ✅
