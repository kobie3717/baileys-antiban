import * as fs from 'fs';
import type { WarmUpState } from './warmup.js';

export interface PersistedState {
  warmup: WarmUpState;
  knownChats: string[];
  savedAt: number;
  version: number;
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

  /** Flush/cancel pending debounced write (for tests and process exit) */
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
