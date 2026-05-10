"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateManager = void 0;
const fs = __importStar(require("fs"));
const KNOWN_CHATS_MAX = 1000;
const DEBOUNCE_MS = 5000;
/**
 * Manages persisted state for a single baileys-antiban instance.
 *
 * **Single-writer assumption:** No file lock is used. Two processes sharing
 * the same state file will race on concurrent writes. Use separate state
 * files per process to avoid data corruption.
 */
class StateManager {
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
exports.StateManager = StateManager;
