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
export interface LidPhoneMapping {
    lid: string;
    phone: string;
    learnedAt: number;
    source: 'auth-dir' | 'event';
}
export declare class LidFirstResolver {
    private lidToPhone;
    private phoneToLid;
    /**
     * Load mappings from Baileys auth state directory.
     * Looks for lid-mapping-*_reverse.json files.
     */
    loadFromAuthDir(authDir: string): void;
    /**
     * Learn a new mapping from a Baileys event (messages, contacts, etc.).
     * Accepts partial data — will extract what it can.
     */
    learnFromEvent(event: any): void;
    /**
     * Resolve phone number or phone JID to LID JID.
     * Returns null if not known.
     */
    resolveToLID(phoneOrJid: string): string | null;
    /**
     * Resolve LID JID to phone number.
     * Returns null if not known.
     */
    resolveToPhone(lid: string): string | null;
    /**
     * Get full mapping for a given JID (either LID or phone).
     * Returns null if not known.
     */
    getMapping(jid: string): LidPhoneMapping | null;
    /**
     * Get total number of known mappings.
     */
    size(): number;
    /**
     * Clear all mappings.
     */
    clear(): void;
    private learnJid;
    private extractPhone;
    private normalizeLid;
}
/**
 * Factory function for creating a singleton resolver instance.
 * Useful for shared state across modules.
 */
export declare function createLidFirstResolver(): LidFirstResolver;
