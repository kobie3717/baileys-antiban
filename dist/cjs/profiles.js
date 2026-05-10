"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGroup = isGroup;
exports.isNewsletter = isNewsletter;
exports.isBroadcast = isBroadcast;
exports.shouldUseGroupProfile = shouldUseGroupProfile;
exports.applyGroupMultiplier = applyGroupMultiplier;
/** @g.us = WhatsApp group */
function isGroup(jid) {
    return jid.endsWith('@g.us');
}
/** @newsletter = WhatsApp newsletter/channel */
function isNewsletter(jid) {
    return jid.endsWith('@newsletter');
}
/** status@broadcast = broadcast list */
function isBroadcast(jid) {
    return jid === 'status@broadcast' || jid.endsWith('@broadcast');
}
/**
 * Returns true if the JID should use stricter (group) rate limits.
 * Groups and newsletters both get the group multiplier in v3.
 * v4: separate newsletter profile.
 */
function shouldUseGroupProfile(jid) {
    return isGroup(jid) || isNewsletter(jid);
}
/**
 * Scale rate limits by multiplier for group/newsletter JIDs.
 * Floors to integer, minimum 1 per limit.
 */
function applyGroupMultiplier(limits, multiplier) {
    return {
        maxPerMinute: Math.max(1, Math.floor(limits.maxPerMinute * multiplier)),
        maxPerHour: Math.max(1, Math.floor(limits.maxPerHour * multiplier)),
        maxPerDay: Math.max(1, Math.floor(limits.maxPerDay * multiplier)),
    };
}
