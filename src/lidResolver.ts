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
  lid: string;           // e.g. "123456789@lid"
  pn: string;            // e.g. "27825651069@s.whatsapp.net"
  phone?: string;        // e.g. "27825651069" (extracted)
  learnedAt: number;     // ms epoch
  seenCount: number;
}

export interface LidResolverStats {
  totalMappings: number;
  learnedFromEvents: number;
  lookupsServed: number;
  lookupMisses: number;
  canonicalForm: 'pn' | 'lid';
}

const DEFAULT_CONFIG: Required<Omit<LidResolverConfig, 'persistence'>> = {
  canonical: 'pn',
  maxEntries: 10_000,
};

export class LidResolver {
  private config: Required<Omit<LidResolverConfig, 'persistence'>>;
  private persistence?: LidResolverConfig['persistence'];

  // Bidirectional maps: lid→pn and pn→lid
  private lidToPn = new Map<string, LidMapping>();
  private pnToLid = new Map<string, string>(); // pn → lid (for quick reverse lookup)

  private stats = {
    learnedFromEvents: 0,
    lookupsServed: 0,
    lookupMisses: 0,
  };

  constructor(config: LidResolverConfig = {}) {
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
  learn(mapping: { lid?: string; pn?: string; phone?: string }): void {
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
    if (!lid || !pn) return;
    if (!lid.endsWith('@lid')) return;
    if (!pn.endsWith('@s.whatsapp.net')) return;

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
    const newMapping: LidMapping = {
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
  resolveCanonical(jid: string): string {
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
    } else {
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
  getLid(pn: string): string | null {
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

  getPn(lid: string): string | null {
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
  getMapping(jid: string): LidMapping | null {
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
   * Seed from persistence (called automatically in constructor if persistence provided)
   */
  async hydrate(): Promise<void> {
    if (!this.persistence?.load) return;

    try {
      const stored = await this.persistence.load();
      if (!stored || typeof stored !== 'object') return;

      // Restore mappings
      for (const [lid, serialized] of Object.entries(stored)) {
        if (typeof serialized === 'string') {
          // Old format: lid → pn string
          const pn = serialized;
          const phone = pn.split('@')[0];
          const mapping: LidMapping = {
            lid,
            pn,
            phone,
            learnedAt: Date.now(),
            seenCount: 1,
          };
          this.lidToPn.set(lid, mapping);
          this.pnToLid.set(pn, lid);
        } else if (typeof serialized === 'object' && serialized !== null) {
          // New format: lid → LidMapping object
          const mapping = serialized as LidMapping;
          this.lidToPn.set(lid, mapping);
          this.pnToLid.set(mapping.pn, lid);
        }
      }
    } catch (error) {
      // Silently fail hydration — don't crash on corrupt persistence
    }
  }

  /**
   * Flush current map to persistence
   */
  async flush(): Promise<void> {
    if (!this.persistence?.save) return;

    try {
      const toStore: Record<string, LidMapping> = {};
      for (const [lid, mapping] of this.lidToPn.entries()) {
        toStore[lid] = mapping;
      }
      await this.persistence.save(toStore);
    } catch (error) {
      // Silently fail flush — don't crash
    }
  }

  getStats(): LidResolverStats {
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
  reset(): void {
    this.lidToPn.clear();
    this.pnToLid.clear();
    this.stats = {
      learnedFromEvents: 0,
      lookupsServed: 0,
      lookupMisses: 0,
    };
  }

  destroy(): void {
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
  private normalizeJid(jid: string): string {
    // Strip device suffix e.g. "123:45@s.whatsapp.net" → "123@s.whatsapp.net"
    return jid.replace(/:\d+@/, '@');
  }

  /**
   * Evict least recently accessed mapping (LRU)
   */
  private evictLRU(): void {
    let oldestLid: string | null = null;
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
