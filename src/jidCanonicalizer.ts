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
