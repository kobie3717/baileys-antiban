/**
 * GroupOperationGuard — Rate limiting for WhatsApp group operations
 *
 * Prevents account_reachout_restricted and rate-overlimit errors
 * by enforcing per-operation windows on group adds, removes, and creates.
 *
 * WA unofficial limits (observed):
 *   - groupParticipantsUpdate (add): ~3 new contacts per 10 min
 *   - groupCreate: ~2 per 10 min
 *   - Rapid retries after 403: triggers account_reachout_restricted
 */
export type GroupOperation = 'add' | 'remove' | 'create' | 'invite';
export interface GroupOpLimit {
    /** Max attempts in the window */
    max: number;
    /** Window duration in ms */
    windowMs: number;
}
export interface GroupOperationGuardConfig {
    limits?: Partial<Record<GroupOperation, GroupOpLimit>>;
}
export interface GroupOpResult {
    /** Whether the operation is allowed */
    allowed: boolean;
    /** Human-readable reason if not allowed */
    reason?: string;
    /** Seconds until the window resets */
    retryAfterSec?: number;
}
export interface GroupOperationGuardStats {
    [key: string]: {
        count: number;
        resetAt: number;
    };
}
/**
 * Known WA error patterns for group operations.
 * Use with classifyGroupOpError() to classify errors before retrying.
 */
export declare const GROUP_OP_ERRORS: {
    readonly REACHOUT_RESTRICTED: "account_reachout_restricted";
    readonly RATE_OVERLIMIT: "rate-overlimit";
    readonly PRIVACY_BLOCK: "403";
    readonly INVITE_EXPIRED: "gone";
    readonly GROUP_LOCKED: "locked";
};
export type GroupOpErrorCode = typeof GROUP_OP_ERRORS[keyof typeof GROUP_OP_ERRORS];
/**
 * Classify a caught error from a group operation.
 */
export declare function classifyGroupOpError(err: unknown): GroupOpErrorCode | null;
/**
 * Check whether a groupParticipantsUpdate result contains a privacy-block 403
 * with an invite code that should be used instead of direct add.
 */
export interface PrivacyBlockResult {
    blocked: boolean;
    inviteCode?: string;
    inviteLink?: string;
}
export declare function extractPrivacyBlock(result: unknown[]): PrivacyBlockResult;
export declare class GroupOperationGuard {
    private readonly limits;
    private readonly windows;
    constructor(config?: GroupOperationGuardConfig);
    /**
     * Check whether an operation is allowed under the current rate limits.
     * @param op   Operation type
     * @param key  Unique key scoping the limit (e.g. groupJid, clientId, or composite)
     */
    check(op: GroupOperation, key: string): GroupOpResult;
    /**
     * Reset the counter for a specific operation + key.
     * Call this if you want to allow immediate retry after a successful operation.
     */
    reset(op: GroupOperation, key: string): void;
    /** Snapshot of all active windows (for observability). */
    getStats(): GroupOperationGuardStats;
}
