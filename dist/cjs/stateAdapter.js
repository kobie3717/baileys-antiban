"use strict";
/**
 * State Adapter — Interface for persisting anti-ban state to disk/DB
 *
 * Implement this interface to save/load state between restarts.
 * Without persistence, warm-up progress is lost on every restart.
 *
 * Example implementations:
 * - File-based: JSON files in a directory
 * - Database: SQLite, PostgreSQL, MongoDB
 * - Redis: For distributed systems
 *
 * Usage:
 *   const adapter = new FileStateAdapter('./state');
 *   const antiban = new AntiBan({ stateAdapter: adapter });
 *   await antiban.loadState(); // On startup
 *   await antiban.saveState(); // Periodically or on shutdown
 */
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
exports.FileStateAdapter = void 0;
/**
 * Example file-based adapter using JSON files
 */
class FileStateAdapter {
    basePath;
    constructor(basePath) {
        this.basePath = basePath;
    }
    async save(key, state) {
        const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const filePath = path.join(this.basePath, `${key}.json`);
        await fs.mkdir(this.basePath, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
    }
    async load(key) {
        const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const filePath = path.join(this.basePath, `${key}.json`);
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return null;
            throw err;
        }
    }
    async delete(key) {
        const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const filePath = path.join(this.basePath, `${key}.json`);
        try {
            await fs.unlink(filePath);
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
        }
    }
    async list() {
        const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        try {
            const files = await fs.readdir(this.basePath);
            return files
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace(/\.json$/, ''));
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return [];
            throw err;
        }
    }
}
exports.FileStateAdapter = FileStateAdapter;
