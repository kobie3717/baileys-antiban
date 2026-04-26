/**
 * Atomic Credentials Snapshot
 *
 * Pre-reconnect backup to kill code-500 corruption loop.
 * Take snapshots before risky operations, restore on corruption.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
export interface CredsSnapshotConfig {
    /** Path to creds file (e.g. './auth/creds.json') */
    credsPath: string;
    /** Snapshot dir (default: same dir, .snapshots/ subfolder) */
    snapshotDir?: string;
    /** How many snapshots to keep (rotation) */
    keep?: number;
    /** Logger */
    logger?: {
        info?: Function;
        warn?: Function;
        error?: Function;
    };
}
export interface CredsSnapshot {
    /** Take an atomic snapshot of creds.json. Returns snapshot path or null on failure. */
    take(): Promise<string | null>;
    /** Restore from most recent snapshot */
    restoreLatest(): Promise<boolean>;
    /** Restore from specific snapshot path */
    restore(snapshotPath: string): Promise<boolean>;
    /** List available snapshots, newest first */
    list(): Promise<{
        path: string;
        takenAt: Date;
        size: number;
    }[]>;
}
export declare function credsSnapshot(config: CredsSnapshotConfig): CredsSnapshot;
