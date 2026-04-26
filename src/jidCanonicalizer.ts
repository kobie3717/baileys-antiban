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
  outboundPassthrough: number;  // already canonical or no mapping known
  inboundLearned: number;
  canonicalKeyHits: number;
  canonicalKeyMisses: number;
}

const DEFAULT_CONFIG: Required<Omit<JidCanonicalizerConfig, 'resolver' | 'resolverConfig'>> = {
  enabled: false,
  canonicalizeOutbound: true,
  learnFromEvents: true,
};

export class JidCanonicalizer {
  private config: Required<Omit<JidCanonicalizerConfig, 'resolver' | 'resolverConfig'>>;
  private lidResolver: LidResolver;
  private ownsResolver: boolean; // Track if we created the resolver (for destroy)

  private stats = {
    outboundCanonicalized: 0,
    outboundPassthrough: 0,
    inboundLearned: 0,
    canonicalKeyHits: 0,
    canonicalKeyMisses: 0,
  };

  constructor(config: JidCanonicalizerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Use provided resolver or create new one
    if (config.resolver) {
      this.lidResolver = config.resolver;
      this.ownsResolver = false;
    } else {
      this.lidResolver = new LidResolver(config.resolverConfig);
      this.ownsResolver = true;
    }
  }

  /**
   * Access the underlying resolver (for cross-module sharing)
   */
  get resolver(): LidResolver {
    return this.lidResolver;
  }

  /**
   * Called by wrapper on every outbound send. Returns canonical JID.
   */
  canonicalizeTarget(jid: string): string {
    if (!this.config.enabled || !this.config.canonicalizeOutbound) {
      return jid;
    }

    const canonical = this.lidResolver.resolveCanonical(jid);
    if (canonical !== jid) {
      this.stats.outboundCanonicalized++;
    } else {
      this.stats.outboundPassthrough++;
    }

    return canonical;
  }

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
  canonicalKey(jid: string): string {
    // Defensive: handle null/undefined/empty
    if (!jid || typeof jid !== 'string' || jid.trim() === '') {
      return 'thread:invalid';
    }

    const normalized = jid.trim().toLowerCase();

    // Extract parts: user@domain
    const atIndex = normalized.indexOf('@');
    if (atIndex === -1) {
      return 'thread:invalid';
    }

    const user = normalized.substring(0, atIndex);
    const domain = normalized.substring(atIndex + 1);

    // Handle special domains
    if (domain === 'g.us') {
      // Group chat
      return `thread:group:${user}`;
    }

    if (domain === 'broadcast') {
      // Broadcast list
      return `thread:broadcast:${user}`;
    }

    if (domain === 'newsletter') {
      // Newsletter (WA Channels)
      return `thread:newsletter:${user}`;
    }

    // Handle @s.whatsapp.net (PN form)
    if (domain === 's.whatsapp.net') {
      this.stats.canonicalKeyHits++;
      return `thread:${user}`;
    }

    // Handle @lid form
    if (domain === 'lid') {
      // Try to resolve to PN via learned mappings
      const mapping = this.lidResolver.getMapping(normalized);
      if (mapping?.pn) {
        // We have a PN mapping — use it
        const pnUser = mapping.pn.split('@')[0];
        this.stats.canonicalKeyHits++;
        return `thread:${pnUser}`;
      } else {
        // No PN known yet — use LID form
        this.stats.canonicalKeyMisses++;
        return `thread:lid:${user}`;
      }
    }

    // Unknown domain — return generic form
    return `thread:${domain}:${user}`;
  }

  /**
   * Called by wrapper on messages.upsert event. Learns mappings.
   */
  onIncomingEvent(upsert: { messages: Array<any>; type?: string }): void {
    if (!this.config.enabled || !this.config.learnFromEvents) {
      return;
    }

    for (const msg of upsert.messages || []) {
      this.learnFromMessage(msg);
    }
  }

  /**
   * Called by wrapper on messages.update event. Learns from sent-message refs.
   */
  onMessageUpdate(updates: Array<any>): void {
    if (!this.config.enabled || !this.config.learnFromEvents) {
      return;
    }

    for (const update of updates) {
      // messages.update doesn't typically carry LID info — mostly for retry tracking
      // But handle edge case where update.key has participant/participantPn
      if (update.key) {
        this.learnFromMessageKey(update.key);
      }
    }
  }

  getStats(): JidCanonicalizerStats {
    return {
      resolver: this.lidResolver.getStats(),
      outboundCanonicalized: this.stats.outboundCanonicalized,
      outboundPassthrough: this.stats.outboundPassthrough,
      inboundLearned: this.stats.inboundLearned,
      canonicalKeyHits: this.stats.canonicalKeyHits,
      canonicalKeyMisses: this.stats.canonicalKeyMisses,
    };
  }

  destroy(): void {
    // Only destroy resolver if we created it
    if (this.ownsResolver) {
      this.lidResolver.destroy();
    }
  }

  // Private helpers

  /**
   * Extract LID↔PN mappings from a message object
   */
  private learnFromMessage(msg: any): void {
    if (!msg.key) return;

    // Extract from message key
    this.learnFromMessageKey(msg.key);

    // Additional extraction from message envelope (if present)
    // Some Baileys forks/versions expose participantPn at the message level
    if (msg.participantPn && msg.key.participant) {
      this.lidResolver.learn({
        lid: msg.key.participant.endsWith('@lid') ? msg.key.participant : undefined,
        pn: msg.participantPn,
      });
      this.stats.inboundLearned++;
    }
  }

  /**
   * Extract mappings from message.key
   */
  private learnFromMessageKey(key: any): void {
    if (!key) return;

    // Case 1: participant (LID) + participantPn (PN)
    // This appears in group messages where sender uses LID
    if (key.participant && key.participantPn) {
      if (key.participant.endsWith('@lid')) {
        this.lidResolver.learn({
          lid: key.participant,
          pn: key.participantPn,
        });
        this.stats.inboundLearned++;
      }
    }

    // Case 2: remoteJid (LID) + senderPn (PN)
    // This appears in 1:1 messages from LID senders
    if (key.remoteJid && key.senderPn) {
      if (key.remoteJid.endsWith('@lid')) {
        this.lidResolver.learn({
          lid: key.remoteJid,
          pn: key.senderPn,
        });
        this.stats.inboundLearned++;
      }
    }

    // Case 3: participant (PN) exists but we have remoteJid (LID)
    // Inverse case where participant is PN form
    if (key.participant && key.remoteJid) {
      if (key.participant.endsWith('@s.whatsapp.net') && key.remoteJid.endsWith('@lid')) {
        this.lidResolver.learn({
          lid: key.remoteJid,
          pn: key.participant,
        });
        this.stats.inboundLearned++;
      }
    }
  }
}
