/**
 * baileys-antiban patch command
 *
 * Patches an installed Baileys package to wrap makeWASocket with antiban middleware.
 * Designed for frameworks (OpenClaw, etc.) that create the socket internally and
 * don't expose a socket:ready hook.
 *
 * Idempotent: safe to re-run after plugin updates. Keeps a .antiban-backup file.
 *
 * Usage:
 *   npx baileys-antiban patch [--path <baileys-dir>] [--dry-run] [--preset conservative|moderate|aggressive]
 */
export interface PatchOptions {
    baileysPaths?: string[];
    preset?: string;
    minDelay?: number;
    maxDelay?: number;
    typingIndicator?: boolean;
    dryRun?: boolean;
}
export interface PatchResult {
    success: boolean;
    baileyDir: string;
    targetFile: string;
    alreadyPatched: boolean;
    format: 'esm' | 'cjs';
    backupPath?: string;
    message: string;
}
export declare function applyPatch(opts: PatchOptions): PatchResult;
export declare function unpatchFile(targetFile: string): {
    success: boolean;
    message: string;
};
