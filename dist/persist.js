import * as fs from 'fs';
const KNOWN_CHATS_MAX = 1000;
const DEBOUNCE_MS = 5000;
/**
 * Manages persisted state for a single baileys-antiban instance.
 *
 * **Single-writer assumption:** No file lock is used. Two processes sharing
 * the same state file will race on concurrent writes. Use separate state
 * files per process to avoid data corruption.
 */
export class StateManager {
    path;
    debounceTimer = null;
    constructor(filePath) {
        this.path = filePath;
    }
    load() {
        try {
            const raw = fs.readFileSync(this.path, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed.version !== 3) {
                console.warn('[baileys-antiban] WARN: corrupt state file or version mismatch, starting fresh');
                return null;
            }
            return parsed;
        }
        catch {
            // Missing file = silent null. Corrupt JSON = warn.
            if (fs.existsSync(this.path)) {
                console.warn('[baileys-antiban] WARN: corrupt state file, starting fresh');
            }
            return null;
        }
    }
    /** Debounced save — called after every send (5s delay) */
    saveDebounced(state) {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.writeFile(state);
            this.debounceTimer = null;
        }, DEBOUNCE_MS);
    }
    /** Immediate save — called after health events (ban/restriction) */
    saveImmediate(state) {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.writeFile(state);
    }
    /** Flush/cancel pending debounced write (for tests and process exit) */
    flush() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
    destroy() {
        this.flush();
    }
    writeFile(state) {
        const toSave = {
            ...state,
            savedAt: Date.now(),
            // LRU eviction: keep last KNOWN_CHATS_MAX entries
            knownChats: state.knownChats.length > KNOWN_CHATS_MAX
                ? state.knownChats.slice(-KNOWN_CHATS_MAX)
                : state.knownChats,
        };
        try {
            fs.writeFileSync(this.path, JSON.stringify(toSave, null, 2), 'utf-8');
        }
        catch (err) {
            console.warn(`[baileys-antiban] WARN: failed to write state to ${this.path}:`, err);
        }
    }
}
