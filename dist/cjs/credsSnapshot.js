"use strict";
/**
 * Atomic Credentials Snapshot
 *
 * Pre-reconnect backup to kill code-500 corruption loop.
 * Take snapshots before risky operations, restore on corruption.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
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
exports.credsSnapshot = credsSnapshot;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const noop = () => { };
function credsSnapshot(config) {
    const { credsPath, snapshotDir = path.join(path.dirname(credsPath), '.snapshots'), keep = 3, logger = {}, } = config;
    const log = {
        info: logger.info || noop,
        warn: logger.warn || noop,
        error: logger.error || noop,
    };
    async function take() {
        try {
            // Check if creds file exists
            try {
                await fs_1.promises.access(credsPath);
            }
            catch {
                log.warn(`[credsSnapshot] Creds file not found: ${credsPath}`);
                return null;
            }
            // Ensure snapshot dir exists
            await fs_1.promises.mkdir(snapshotDir, { recursive: true });
            // Generate snapshot path
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const snapshotPath = path.join(snapshotDir, `creds-${timestamp}.json`);
            const tmpPath = `${snapshotPath}.tmp`;
            // Atomic copy: write to .tmp, then rename
            await fs_1.promises.copyFile(credsPath, tmpPath);
            await fs_1.promises.rename(tmpPath, snapshotPath);
            log.info(`[credsSnapshot] Snapshot taken: ${snapshotPath}`);
            // Rotate old snapshots
            await rotate();
            return snapshotPath;
        }
        catch (err) {
            log.error(`[credsSnapshot] Failed to take snapshot: ${err}`);
            return null;
        }
    }
    async function rotate() {
        try {
            const snapshots = await list();
            const toDelete = snapshots.slice(keep);
            for (const snap of toDelete) {
                await fs_1.promises.unlink(snap.path);
                log.info(`[credsSnapshot] Rotated out: ${snap.path}`);
            }
        }
        catch (err) {
            log.error(`[credsSnapshot] Rotation failed: ${err}`);
        }
    }
    async function list() {
        try {
            await fs_1.promises.access(snapshotDir);
        }
        catch {
            return [];
        }
        try {
            const files = await fs_1.promises.readdir(snapshotDir);
            const snapshots = await Promise.all(files
                .filter((f) => f.startsWith('creds-') && f.endsWith('.json'))
                .map(async (f) => {
                const fullPath = path.join(snapshotDir, f);
                const stat = await fs_1.promises.stat(fullPath);
                // Use file mtime for timestamp (simpler than parsing filename)
                return {
                    path: fullPath,
                    takenAt: stat.mtime,
                    size: stat.size,
                };
            }));
            // Sort newest first
            return snapshots.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
        }
        catch (err) {
            log.error(`[credsSnapshot] Failed to list snapshots: ${err}`);
            return [];
        }
    }
    async function restoreLatest() {
        const snapshots = await list();
        if (snapshots.length === 0) {
            log.warn('[credsSnapshot] No snapshots available to restore');
            return false;
        }
        return restore(snapshots[0].path);
    }
    async function restore(snapshotPath) {
        try {
            // Verify snapshot exists
            await fs_1.promises.access(snapshotPath);
            // Atomic restore: copy to .tmp, then rename
            const tmpPath = `${credsPath}.tmp`;
            await fs_1.promises.copyFile(snapshotPath, tmpPath);
            await fs_1.promises.rename(tmpPath, credsPath);
            log.info(`[credsSnapshot] Restored from: ${snapshotPath}`);
            return true;
        }
        catch (err) {
            log.error(`[credsSnapshot] Failed to restore from ${snapshotPath}: ${err}`);
            return false;
        }
    }
    return {
        take,
        restoreLatest,
        restore,
        list,
    };
}
