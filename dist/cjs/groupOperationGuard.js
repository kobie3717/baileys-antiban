"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupOperationGuard = exports.GROUP_OP_ERRORS = void 0;
exports.classifyGroupOpError = classifyGroupOpError;
exports.extractPrivacyBlock = extractPrivacyBlock;
const DEFAULT_LIMITS = {
    add: { max: 3, windowMs: 10 * 60 * 1000 }, // 3 adds / 10 min
    remove: { max: 5, windowMs: 10 * 60 * 1000 }, // 5 removes / 10 min
    create: { max: 2, windowMs: 10 * 60 * 1000 }, // 2 creates / 10 min
    invite: { max: 10, windowMs: 10 * 60 * 1000 }, // 10 invite fetches / 10 min
};
/**
 * Known WA error patterns for group operations.
 * Use with classifyGroupOpError() to classify errors before retrying.
 */
exports.GROUP_OP_ERRORS = {
    REACHOUT_RESTRICTED: 'account_reachout_restricted',
    RATE_OVERLIMIT: 'rate-overlimit',
    PRIVACY_BLOCK: '403', // groupParticipantsUpdate returned status '403'
    INVITE_EXPIRED: 'gone', // groupInviteCode returned 'gone' — code expired
    GROUP_LOCKED: 'locked', // groupRevokeInvite returned 'locked'
};
/**
 * Classify a caught error from a group operation.
 */
function classifyGroupOpError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('account_reachout_restricted') || msg.includes('reachout'))
        return exports.GROUP_OP_ERRORS.REACHOUT_RESTRICTED;
    if (msg.includes('rate-overlimit') || msg.includes('429'))
        return exports.GROUP_OP_ERRORS.RATE_OVERLIMIT;
    if (msg.includes('locked'))
        return exports.GROUP_OP_ERRORS.GROUP_LOCKED;
    if (msg.includes('gone'))
        return exports.GROUP_OP_ERRORS.INVITE_EXPIRED;
    return null;
}
function extractPrivacyBlock(result) {
    if (!Array.isArray(result))
        return { blocked: false };
    for (const r of result) {
        const entry = r;
        if (entry.status !== '403')
            continue;
        // Traverse content to find add_request with code
        const content = Array.isArray(entry.content) ? entry.content : [];
        for (const c of content) {
            if (c.tag === 'add_request' && typeof c.attrs === 'object') {
                const attrs = c.attrs;
                if (attrs.code) {
                    return {
                        blocked: true,
                        inviteCode: attrs.code,
                        inviteLink: `https://chat.whatsapp.com/${attrs.code}`,
                    };
                }
            }
        }
        // 403 without invite code — privacy block but WA didn't provide link
        return { blocked: true };
    }
    return { blocked: false };
}
class GroupOperationGuard {
    limits;
    windows = new Map();
    constructor(config = {}) {
        this.limits = { ...DEFAULT_LIMITS, ...config.limits };
    }
    /**
     * Check whether an operation is allowed under the current rate limits.
     * @param op   Operation type
     * @param key  Unique key scoping the limit (e.g. groupJid, clientId, or composite)
     */
    check(op, key) {
        const limit = this.limits[op];
        const windowKey = `${op}:${key}`;
        const now = Date.now();
        const entry = this.windows.get(windowKey);
        if (!entry || now > entry.resetAt) {
            this.windows.set(windowKey, { count: 1, resetAt: now + limit.windowMs });
            return { allowed: true };
        }
        if (entry.count >= limit.max) {
            const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
            return {
                allowed: false,
                reason: `Too many ${op} attempts. WhatsApp rate-limits group operations — wait ${Math.ceil(retryAfterSec / 60)} min before trying again.`,
                retryAfterSec,
            };
        }
        entry.count++;
        return { allowed: true };
    }
    /**
     * Reset the counter for a specific operation + key.
     * Call this if you want to allow immediate retry after a successful operation.
     */
    reset(op, key) {
        this.windows.delete(`${op}:${key}`);
    }
    /** Snapshot of all active windows (for observability). */
    getStats() {
        const stats = {};
        for (const [key, val] of this.windows) {
            stats[key] = { ...val };
        }
        return stats;
    }
}
exports.GroupOperationGuard = GroupOperationGuard;
