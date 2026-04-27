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
export interface LidResolverConfig {
    /** Canonical form to normalize to. Default: 'pn' (phone-number) */
    canonical?: 'pn' | 'lid';
    /** Optional persistence hooks — if provided, map survives restarts */
    persistence?: {
        load?: () => Promise<Record<string, any>> | Record<string, any>;
        save?: (map: Record<string, any>) => Promise<void> | void;
    };
    /** Max entries to hold in memory (LRU). Default 10_000 */
    maxEntries?: number;
}
export interface LidMapping {
    lid: string;
    pn: string;
    phone?: string;
    learnedAt: number;
    seenCount: number;
}
export interface LidResolverStats {
    totalMappings: number;
    learnedFromEvents: number;
    lookupsServed: number;
    lookupMisses: number;
    canonicalForm: 'pn' | 'lid';
}
export declare class LidResolver {
    private config;
    private persistence?;
    private lidToPn;
    private pnToLid;
    private stats;
    constructor(config?: LidResolverConfig);
    /**
     * Learn from a message event. Idempotent.
     * Accepts partial mappings — will use whatever fields are available.
     */
    learn(mapping: {
        lid?: string;
        pn?: string;
        phone?: string;
    }): void;
    /**
     * Given any form (LID or PN), return the canonical form.
     * Falls back to input if unknown (no throw).
     */
    resolveCanonical(jid: string): string;
    /**
     * Lookup partner form. Returns null if unknown.
     */
    getLid(pn: string): string | null;
    getPn(lid: string): string | null;
    /**
     * Full mapping for inspection
     */
    getMapping(jid: string): LidMapping | null;
    /**
     * Learn LID↔PN mappings from group metadata participants.
     * Call this after fetchGroupMetadata() to pre-populate the map.
     * Supports both {id: '@lid', phoneNumber: '@s.whatsapp.net'} and
     * {id: '@s.whatsapp.net', lid: '@lid'} participant formats (v7 + v6 shapes).
     *
     * @param participants - Group metadata participants array from Baileys
     * @returns Number of new mappings learned
     */
    learnFromGroupMetadata(participants: Array<{
        id: string;
        lid?: string;
        phoneNumber?: string;
        phone?: string;
        number?: string;
    }>): number;
    /**
     * Seed from persistence (called automatically in constructor if persistence provided)
     */
    hydrate(): Promise<void>;
    /**
     * Flush current map to persistence
     */
    flush(): Promise<void>;
    getStats(): LidResolverStats;
    /**
     * Clear everything
     */
    reset(): void;
    destroy(): void;
    /**
     * Normalize JID: strip device suffix `:N`
     */
    private normalizeJid;
    /**
     * Evict least recently accessed mapping (LRU)
     */
    private evictLRU;
}
