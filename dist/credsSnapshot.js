/**
 * Atomic Credentials Snapshot
 *
 * Pre-reconnect backup to kill code-500 corruption loop.
 * Take snapshots before risky operations, restore on corruption.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
import { promises as fs } from 'fs';
import * as path from 'path';
const noop = () => { };
export function credsSnapshot(config) {
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
                await fs.access(credsPath);
            }
            catch {
                log.warn(`[credsSnapshot] Creds file not found: ${credsPath}`);
                return null;
            }
            // Ensure snapshot dir exists
            await fs.mkdir(snapshotDir, { recursive: true });
            // Generate snapshot path
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const snapshotPath = path.join(snapshotDir, `creds-${timestamp}.json`);
            const tmpPath = `${snapshotPath}.tmp`;
            // Atomic copy: write to .tmp, then rename
            await fs.copyFile(credsPath, tmpPath);
            await fs.rename(tmpPath, snapshotPath);
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
                await fs.unlink(snap.path);
                log.info(`[credsSnapshot] Rotated out: ${snap.path}`);
            }
        }
        catch (err) {
            log.error(`[credsSnapshot] Rotation failed: ${err}`);
        }
    }
    async function list() {
        try {
            await fs.access(snapshotDir);
        }
        catch {
            return [];
        }
        try {
            const files = await fs.readdir(snapshotDir);
            const snapshots = await Promise.all(files
                .filter((f) => f.startsWith('creds-') && f.endsWith('.json'))
                .map(async (f) => {
                const fullPath = path.join(snapshotDir, f);
                const stat = await fs.stat(fullPath);
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
            await fs.access(snapshotPath);
            // Atomic restore: copy to .tmp, then rename
            const tmpPath = `${credsPath}.tmp`;
            await fs.copyFile(snapshotPath, tmpPath);
            await fs.rename(tmpPath, credsPath);
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
