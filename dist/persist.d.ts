import type { WarmUpState } from './warmup.js';
export interface PersistedState {
    warmup: WarmUpState;
    knownChats: string[];
    savedAt: number;
    version: 3;
}
/**
 * Manages persisted state for a single baileys-antiban instance.
 *
 * **Single-writer assumption:** No file lock is used. Two processes sharing
 * the same state file will race on concurrent writes. Use separate state
 * files per process to avoid data corruption.
 */
export declare class StateManager {
    private path;
    private debounceTimer;
    constructor(filePath: string);
    load(): PersistedState | null;
    /** Debounced save — called after every send (5s delay) */
    saveDebounced(state: PersistedState): void;
    /** Immediate save — called after health events (ban/restriction) */
    saveImmediate(state: PersistedState): void;
    /** Flush/cancel pending debounced write (for tests and process exit) */
    flush(): void;
    destroy(): void;
    private writeFile;
}
