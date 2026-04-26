/**
 * JID Canonicalizer — Opt-in middleware for LID/PN normalization
 *
 * Wraps LidResolver to provide automatic:
 * 1. Learning from incoming message events
 * 2. Canonicalization of outbound send targets
 *
 * This mitigates the LID/PN race condition that causes "Bad MAC / No Session /
 * Invalid PreKey" errors (Baileys issue #1769, our PR #2372).
 *
 * Usage:
 *   const canonicalizer = new JidCanonicalizer({ enabled: true });
 *
 *   // On incoming event
 *   canonicalizer.onIncomingEvent({ messages: [...] });
 *
 *   // On outbound send
 *   const canonicalJid = canonicalizer.canonicalizeTarget(jid);
 *   await sock.sendMessage(canonicalJid, content);
 *
 * Note: This is a middleware-layer mitigation. The root fix requires merging
 * PR #2372 into Baileys' crypto pipeline.
 */
import { LidResolver, type LidResolverConfig, type LidResolverStats } from './lidResolver.js';
export interface JidCanonicalizerConfig {
    /** Enable canonicalization (default: false — opt-in) */
    enabled?: boolean;
    /** Provide your own resolver to share across modules. Otherwise one is created. */
    resolver?: LidResolver;
    /** Config for creating a new resolver (ignored if resolver provided) */
    resolverConfig?: LidResolverConfig;
    /** Canonicalize outbound sendMessage targets. Default true. */
    canonicalizeOutbound?: boolean;
    /** Learn from inbound events. Default true. */
    learnFromEvents?: boolean;
}
export interface JidCanonicalizerStats {
    resolver: LidResolverStats;
    outboundCanonicalized: number;
    outboundPassthrough: number;
    inboundLearned: number;
    canonicalKeyHits: number;
    canonicalKeyMisses: number;
}
export declare class JidCanonicalizer {
    private config;
    private lidResolver;
    private ownsResolver;
    private stats;
    constructor(config?: JidCanonicalizerConfig);
    /**
     * Access the underlying resolver (for cross-module sharing)
     */
    get resolver(): LidResolver;
    /**
     * Called by wrapper on every outbound send. Returns canonical JID.
     */
    canonicalizeTarget(jid: string): string;
    /**
     * Returns a stable, canonical thread key for storage / DB indexing.
     *
     * Different from `canonicalizeTarget()` (which picks the right send target):
     * - canonicalizeTarget('1234@lid') → '+27...@s.whatsapp.net' (best send target)
     * - canonicalKey('1234@lid')      → 'thread:27...'  (stable thread identifier)
     *
     * If LID has known PN mapping → use phone-number form
     * If only LID known → use LID stripped of suffix
     * Always lowercase, no @-suffix, prefixed with `thread:`
     *
     * Apps using this as their DB key won't double-thread on LID/PN drift.
     *
     * @param jid - WhatsApp JID (can be PN, LID, group, or broadcast)
     * @returns Stable thread key for DB indexing
     */
    canonicalKey(jid: string): string;
    /**
     * Called by wrapper on messages.upsert event. Learns mappings.
     */
    onIncomingEvent(upsert: {
        messages: Array<any>;
        type?: string;
    }): void;
    /**
     * Called by wrapper on messages.update event. Learns from sent-message refs.
     */
    onMessageUpdate(updates: Array<any>): void;
    getStats(): JidCanonicalizerStats;
    destroy(): void;
    /**
     * Extract LID↔PN mappings from a message object
     */
    private learnFromMessage;
    /**
     * Extract mappings from message.key
     */
    private learnFromMessageKey;
}
