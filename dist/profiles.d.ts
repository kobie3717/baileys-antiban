export interface RateLimits {
    maxPerMinute: number;
    maxPerHour: number;
    maxPerDay: number;
}
/** @g.us = WhatsApp group */
export declare function isGroup(jid: string): boolean;
/** @newsletter = WhatsApp newsletter/channel */
export declare function isNewsletter(jid: string): boolean;
/** status@broadcast = broadcast list */
export declare function isBroadcast(jid: string): boolean;
/**
 * Returns true if the JID should use stricter (group) rate limits.
 * Groups and newsletters both get the group multiplier in v3.
 * v4: separate newsletter profile.
 */
export declare function shouldUseGroupProfile(jid: string): boolean;
/**
 * Scale rate limits by multiplier for group/newsletter JIDs.
 * Floors to integer, minimum 1 per limit.
 */
export declare function applyGroupMultiplier(limits: RateLimits, multiplier: number): RateLimits;
