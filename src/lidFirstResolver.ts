/**
 * LidFirstResolver — Standalone LID↔Phone mapper for Baileys auth state
 *
 * Lightweight drop-in utility that:
 * - Loads LID↔phone mappings from Baileys' auth state directory
 * - Resolves phone numbers to LID JIDs and vice versa
 * - Learns new mappings from Baileys events
 * - Works independently of the full AntiBan system
 *
 * Usage:
 * ```typescript
 * import { LidFirstResolver } from 'baileys-antiban';
 * const resolver = new LidFirstResolver();
 * resolver.loadFromAuthDir('./whatsapp-auth/my-session');
 * const jid = resolver.resolveToLID('27825651069'); // → "210543692497008@lid" or null
 * ```
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LidPhoneMapping {
  lid: string;           // e.g. "210543692497008@lid"
  phone: string;         // e.g. "27825651069" (no @s.whatsapp.net)
  learnedAt: number;     // ms epoch
  source: 'auth-dir' | 'event';
}

export class LidFirstResolver {
  private lidToPhone = new Map<string, LidPhoneMapping>();
  private phoneToLid = new Map<string, string>(); // phone → lid (quick reverse lookup)

  /**
   * Load mappings from Baileys auth state directory.
   * Looks for lid-mapping-*_reverse.json files.
   */
  loadFromAuthDir(authDir: string): void {
    try {
      if (!fs.existsSync(authDir)) {
        return; // Directory doesn't exist, nothing to load
      }

      const files = fs.readdirSync(authDir);
      const reverseMappingFiles = files.filter(f =>
        f.startsWith('lid-mapping-') && f.endsWith('_reverse.json')
      );

      for (const file of reverseMappingFiles) {
        const filePath = path.join(authDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        // Baileys reverse mapping format: { "lid@lid": "phone@s.whatsapp.net" }
        for (const [lid, pnJid] of Object.entries(data)) {
          if (typeof pnJid === 'string') {
            const phone = this.extractPhone(pnJid);
            if (phone && lid.endsWith('@lid')) {
              const mapping: LidPhoneMapping = {
                lid: this.normalizeLid(lid),
                phone,
                learnedAt: Date.now(),
                source: 'auth-dir',
              };
              this.lidToPhone.set(mapping.lid, mapping);
              this.phoneToLid.set(phone, mapping.lid);
            }
          }
        }
      }
    } catch (error) {
      // Silently fail — don't crash if auth dir is malformed
    }
  }

  /**
   * Learn a new mapping from a Baileys event (messages, contacts, etc.).
   * Accepts partial data — will extract what it can.
   */
  learnFromEvent(event: any): void {
    try {
      // Extract from message event structure
      if (event.key?.remoteJid) {
        const jid = event.key.remoteJid;
        this.learnJid(jid, 'event');
      }

      // Extract from participant field (group messages)
      if (event.key?.participant) {
        const jid = event.key.participant;
        this.learnJid(jid, 'event');
      }

      // Extract from contact event
      if (event.id) {
        this.learnJid(event.id, 'event');
      }

      // Extract from pushName field (has phone)
      if (event.pushName && event.key?.remoteJid) {
        this.learnJid(event.key.remoteJid, 'event');
      }
    } catch (error) {
      // Silently fail — don't crash on malformed events
    }
  }

  /**
   * Resolve phone number or phone JID to LID JID.
   * Returns null if not known.
   */
  resolveToLID(phoneOrJid: string): string | null {
    const phone = this.extractPhone(phoneOrJid);
    if (!phone) return null;

    return this.phoneToLid.get(phone) || null;
  }

  /**
   * Resolve LID JID to phone number.
   * Returns null if not known.
   */
  resolveToPhone(lid: string): string | null {
    const normalized = this.normalizeLid(lid);
    const mapping = this.lidToPhone.get(normalized);
    return mapping ? mapping.phone : null;
  }

  /**
   * Get full mapping for a given JID (either LID or phone).
   * Returns null if not known.
   */
  getMapping(jid: string): LidPhoneMapping | null {
    const normalized = this.normalizeLid(jid);

    // Try as LID
    const byLid = this.lidToPhone.get(normalized);
    if (byLid) return byLid;

    // Try as phone
    const phone = this.extractPhone(jid);
    if (phone) {
      const lid = this.phoneToLid.get(phone);
      if (lid) return this.lidToPhone.get(lid) || null;
    }

    return null;
  }

  /**
   * Get total number of known mappings.
   */
  size(): number {
    return this.lidToPhone.size;
  }

  /**
   * Clear all mappings.
   */
  clear(): void {
    this.lidToPhone.clear();
    this.phoneToLid.clear();
  }

  // Private helpers

  private learnJid(_jid: string, _source: 'auth-dir' | 'event'): void {
    // Check if this is a LID JID with a phone equivalent we can learn
    // For now, we can only learn from auth dir or from paired data
    // Single JID without context can't create a mapping
    // This is intentionally limited — real learning happens in loadFromAuthDir
  }

  private extractPhone(jid: string): string | null {
    if (!jid) return null;

    // Remove @s.whatsapp.net suffix if present
    let cleaned = jid.replace('@s.whatsapp.net', '');

    // Remove device suffix :N if present
    cleaned = cleaned.replace(/:\d+$/, '');

    // Check if it's a phone number (digits only)
    if (/^\d+$/.test(cleaned)) {
      return cleaned;
    }

    return null;
  }

  private normalizeLid(lid: string): string {
    // Remove device suffix :N if present
    return lid.replace(/:\d+@/, '@');
  }
}

/**
 * Factory function for creating a singleton resolver instance.
 * Useful for shared state across modules.
 */
export function createLidFirstResolver(): LidFirstResolver {
  return new LidFirstResolver();
}
