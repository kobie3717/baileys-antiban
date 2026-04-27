/**
 * LID Resolver — Maintains bidirectional LID↔PN mapping for contacts
 *
 * WhatsApp migrated to LID (Linked Identity) in 2024. A contact now has two JIDs:
 * - Phone number form: "27825651069@s.whatsapp.net"
 * - LID form: "123456789@lid"
 *
 * Messages can arrive under either form. If an encryption session was established
 * under one form and a message arrives under the other, decryption fails → "Bad MAC".
 *
 * This utility:
 * - Learns LID↔PN mappings from message events
 * - Normalizes JIDs to a canonical form (phone number by default)
 * - Provides lookup for cross-form resolution
 * - Optionally persists state across restarts
 *
 * This is a standalone utility — can be used independently or via JidCanonicalizer.
 */
const DEFAULT_CONFIG = {
    canonical: 'pn',
    maxEntries: 10_000,
};
export class LidResolver {
    config;
    persistence;
    // Bidirectional maps: lid→pn and pn→lid
    lidToPn = new Map();
    pnToLid = new Map(); // pn → lid (for quick reverse lookup)
    stats = {
        learnedFromEvents: 0,
        lookupsServed: 0,
        lookupMisses: 0,
    };
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.persistence = config.persistence;
        // Auto-hydrate if persistence provided
        if (this.persistence?.load) {
            void this.hydrate();
        }
    }
    /**
     * Learn from a message event. Idempotent.
     * Accepts partial mappings — will use whatever fields are available.
     */
    learn(mapping) {
        let lid = mapping.lid ? this.normalizeJid(mapping.lid) : undefined;
        let pn = mapping.pn ? this.normalizeJid(mapping.pn) : undefined;
        const phone = mapping.phone;
        // Validate we have both lid and pn (or can derive pn from phone)
        if (!lid || (!pn && !phone)) {
            return; // Insufficient data
        }
        // Derive pn from phone if not provided
        if (!pn && phone) {
            pn = `${phone}@s.whatsapp.net`;
        }
        // Validate forms
        if (!lid || !pn)
            return;
        if (!lid.endsWith('@lid'))
            return;
        if (!pn.endsWith('@s.whatsapp.net'))
            return;
        // Check if we already know this mapping
        const existing = this.lidToPn.get(lid);
        if (existing) {
            // Already learned — just increment seen count
            existing.seenCount++;
            existing.learnedAt = Date.now(); // Update access time for LRU
            return;
        }
        // Learn new mapping
        const extractedPhone = phone || pn.split('@')[0];
        const newMapping = {
            lid,
            pn,
            phone: extractedPhone,
            learnedAt: Date.now(),
            seenCount: 1,
        };
        // Check if we need to evict (LRU)
        if (this.lidToPn.size >= this.config.maxEntries) {
            this.evictLRU();
        }
        this.lidToPn.set(lid, newMapping);
        this.pnToLid.set(pn, lid);
        this.stats.learnedFromEvents++;
        // Async flush to persistence (don't await)
        if (this.persistence?.save) {
            void this.flush();
        }
    }
    /**
     * Given any form (LID or PN), return the canonical form.
     * Falls back to input if unknown (no throw).
     */
    resolveCanonical(jid) {
        const normalized = this.normalizeJid(jid);
        if (this.config.canonical === 'pn') {
            // Want PN form
            if (normalized.endsWith('@lid')) {
                const mapping = this.lidToPn.get(normalized);
                if (mapping) {
                    this.stats.lookupsServed++;
                    mapping.learnedAt = Date.now(); // Update LRU access time
                    return mapping.pn;
                }
                this.stats.lookupMisses++;
                return jid; // Fallback to original input
            }
            // Already PN form
            this.stats.lookupsServed++;
            return normalized;
        }
        else {
            // Want LID form
            if (normalized.endsWith('@s.whatsapp.net')) {
                const lid = this.pnToLid.get(normalized);
                if (lid) {
                    this.stats.lookupsServed++;
                    const mapping = this.lidToPn.get(lid);
                    if (mapping) {
                        mapping.learnedAt = Date.now(); // Update LRU access time
                    }
                    return lid;
                }
                this.stats.lookupMisses++;
                return jid; // Fallback to original input
            }
            // Already LID form
            this.stats.lookupsServed++;
            return normalized;
        }
    }
    /**
     * Lookup partner form. Returns null if unknown.
     */
    getLid(pn) {
        const normalized = this.normalizeJid(pn);
        const lid = this.pnToLid.get(normalized);
        if (lid) {
            const mapping = this.lidToPn.get(lid);
            if (mapping) {
                mapping.learnedAt = Date.now(); // Update LRU access time
            }
        }
        return lid || null;
    }
    getPn(lid) {
        const normalized = this.normalizeJid(lid);
        const mapping = this.lidToPn.get(normalized);
        if (mapping) {
            mapping.learnedAt = Date.now(); // Update LRU access time
            return mapping.pn;
        }
        return null;
    }
    /**
     * Full mapping for inspection
     */
    getMapping(jid) {
        const normalized = this.normalizeJid(jid);
        // Try as LID first
        const byLid = this.lidToPn.get(normalized);
        if (byLid) {
            byLid.learnedAt = Date.now(); // Update LRU access time
            return byLid;
        }
        // Try as PN
        const lid = this.pnToLid.get(normalized);
        if (lid) {
            const mapping = this.lidToPn.get(lid);
            if (mapping) {
                mapping.learnedAt = Date.now(); // Update LRU access time
                return mapping;
            }
        }
        return null;
    }
    /**
     * Learn LID↔PN mappings from group metadata participants.
     * Call this after fetchGroupMetadata() to pre-populate the map.
     * Supports both {id: '@lid', phoneNumber: '@s.whatsapp.net'} and
     * {id: '@s.whatsapp.net', lid: '@lid'} participant formats (v7 + v6 shapes).
     *
     * @param participants - Group metadata participants array from Baileys
     * @returns Number of new mappings learned
     */
    learnFromGroupMetadata(participants) {
        let learned = 0;
        for (const p of participants) {
            const domain = p.id.split('@')[1] || '';
            if (domain === 'lid' && (p.phoneNumber || p.phone || p.number)) {
                const pn = p.phoneNumber || (p.phone ? `${p.phone}@s.whatsapp.net` : null) || (p.number ? `${p.number}@s.whatsapp.net` : null);
                if (pn) {
                    const prevSize = this.lidToPn.size;
                    this.learn({ lid: p.id, pn });
                    if (this.lidToPn.size > prevSize)
                        learned++;
                }
            }
            else if (domain === 's.whatsapp.net' && p.lid) {
                const lid = p.lid.endsWith('@lid') ? p.lid : `${p.lid}@lid`;
                const prevSize = this.lidToPn.size;
                this.learn({ lid, pn: p.id });
                if (this.lidToPn.size > prevSize)
                    learned++;
            }
        }
        return learned;
    }
    /**
     * Seed from persistence (called automatically in constructor if persistence provided)
     */
    async hydrate() {
        if (!this.persistence?.load)
            return;
        try {
            const stored = await this.persistence.load();
            if (!stored || typeof stored !== 'object')
                return;
            // Restore mappings
            for (const [lid, serialized] of Object.entries(stored)) {
                if (typeof serialized === 'string') {
                    // Old format: lid → pn string
                    const pn = serialized;
                    const phone = pn.split('@')[0];
                    const mapping = {
                        lid,
                        pn,
                        phone,
                        learnedAt: Date.now(),
                        seenCount: 1,
                    };
                    this.lidToPn.set(lid, mapping);
                    this.pnToLid.set(pn, lid);
                }
                else if (typeof serialized === 'object' && serialized !== null) {
                    // New format: lid → LidMapping object
                    const mapping = serialized;
                    this.lidToPn.set(lid, mapping);
                    this.pnToLid.set(mapping.pn, lid);
                }
            }
        }
        catch (error) {
            // Silently fail hydration — don't crash on corrupt persistence
        }
    }
    /**
     * Flush current map to persistence
     */
    async flush() {
        if (!this.persistence?.save)
            return;
        try {
            const toStore = {};
            for (const [lid, mapping] of this.lidToPn.entries()) {
                toStore[lid] = mapping;
            }
            await this.persistence.save(toStore);
        }
        catch (error) {
            // Silently fail flush — don't crash
        }
    }
    getStats() {
        return {
            totalMappings: this.lidToPn.size,
            learnedFromEvents: this.stats.learnedFromEvents,
            lookupsServed: this.stats.lookupsServed,
            lookupMisses: this.stats.lookupMisses,
            canonicalForm: this.config.canonical,
        };
    }
    /**
     * Clear everything
     */
    reset() {
        this.lidToPn.clear();
        this.pnToLid.clear();
        this.stats = {
            learnedFromEvents: 0,
            lookupsServed: 0,
            lookupMisses: 0,
        };
    }
    destroy() {
        this.reset();
        // Flush one final time
        if (this.persistence?.save) {
            void this.flush();
        }
    }
    // Private helpers
    /**
     * Normalize JID: strip device suffix `:N`
     */
    normalizeJid(jid) {
        // Strip device suffix e.g. "123:45@s.whatsapp.net" → "123@s.whatsapp.net"
        return jid.replace(/:\d+@/, '@');
    }
    /**
     * Evict least recently accessed mapping (LRU)
     */
    evictLRU() {
        let oldestLid = null;
        let oldestTime = Infinity;
        for (const [lid, mapping] of this.lidToPn.entries()) {
            if (mapping.learnedAt < oldestTime) {
                oldestTime = mapping.learnedAt;
                oldestLid = lid;
            }
        }
        if (oldestLid) {
            const mapping = this.lidToPn.get(oldestLid);
            if (mapping) {
                this.pnToLid.delete(mapping.pn);
            }
            this.lidToPn.delete(oldestLid);
        }
    }
}
