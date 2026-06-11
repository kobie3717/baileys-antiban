/**
 * Topology Throttler — Network topology-based anti-ban enforcement
 *
 * WhatsApp bans based on NETWORK TOPOLOGY, not just message timing:
 * - How fast you expand your contact graph
 * - Cold-contact ratio (strangers vs known contacts)
 * - Reply reciprocity
 * - Group-source clustering (mass-DMing group members)
 *
 * This module enforces graph expansion limits and scores contact risk
 * before each send, acting as the primary enforcement layer for high-risk
 * cold outreach.
 *
 * Key insight: A 30% reply rate is the minimum to unlock more cold sends.
 * Below that, WhatsApp's ML models flag you as a spammer.
 */

export type ContactRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ContactRiskAssessment {
  jid: string;
  risk: ContactRisk;
  score: number;          // 0-100, higher = riskier
  reasons: string[];      // e.g. ['first_contact', 'no_mutual_groups', 'cold_number']
  recommendation: 'send' | 'delay' | 'abort';
  suggestedDelayMs?: number;
}

export interface ContactRiskConfig {
  // Thresholds that affect risk scoring
  firstContactPenalty?: number;           // default 40 — first message to this JID ever
  noReplyPenalty?: number;                // default 20 — sent before, never replied
  noMutualGroupsPenalty?: number;         // default 15 — no shared groups
  recentContactBonus?: number;            // default -20 — messaged in last 24h
  repliedBeforeBonus?: number;            // default -30 — they've replied before

  // Risk thresholds
  delayThreshold?: number;                // score >= this → recommend delay (default 40)
  abortThreshold?: number;               // score >= this → recommend abort (default 75)
}

export interface TopologyThrottlerConfig {
  // Graph expansion limits (the real ban signals)
  maxNewContactsPerHour?: number;         // default 5 — cold outreach limit
  maxNewContactsPerDay?: number;          // default 20
  minReplyRatioForNewContacts?: number;   // default 0.3 — need 30% reply rate to unlock more cold sends
  maxSameGroupContacts?: number;          // default 10 — don't mass-DM entire group
  maxContactsFromSameSource?: number;     // default 8 — e.g. same phone prefix cluster

  // Enforcement
  blockOnLimitReached?: boolean;          // default true — throw vs warn
  cooldownMs?: number;                    // default 3600000 (1hr) — wait after limit hit

  // Contact risk
  riskConfig?: ContactRiskConfig;
}

interface ContactRecord {
  firstContactAt: number;
  sendTimestamps: number[];      // sliding window of sends
  replyTimestamps: number[];     // sliding window of replies
  blocked: boolean;
  sourceGroup?: string;          // which group this contact came from
}

interface TopologyLimits {
  newContactsThisHour: number;
  newContactsToday: number;
  lastHourResetAt: number;
  lastDayResetAt: number;
  limitHitAt?: number;           // when we hit the limit (for cooldown)
}

const TIME_CONSTANTS = {
  MS_PER_HOUR: 3600000,
  MS_PER_DAY: 86400000,
  MS_PER_24H: 86400000,
  REPLY_WINDOW_DAYS: 7,
} as const;

const DEFAULT_CONFIG: Required<TopologyThrottlerConfig> = {
  maxNewContactsPerHour: 5,
  maxNewContactsPerDay: 20,
  minReplyRatioForNewContacts: 0.3,
  maxSameGroupContacts: 10,
  maxContactsFromSameSource: 8,
  blockOnLimitReached: true,
  cooldownMs: TIME_CONSTANTS.MS_PER_HOUR,
  riskConfig: {
    firstContactPenalty: 40,
    noReplyPenalty: 20,
    noMutualGroupsPenalty: 15,
    recentContactBonus: -20,
    repliedBeforeBonus: -30,
    delayThreshold: 40,
    abortThreshold: 75,
  },
};

const DEFAULT_RISK_CONFIG: Required<ContactRiskConfig> = {
  firstContactPenalty: 40,
  noReplyPenalty: 20,
  noMutualGroupsPenalty: 15,
  recentContactBonus: -20,
  repliedBeforeBonus: -30,
  delayThreshold: 40,
  abortThreshold: 75,
};

export interface TopologyThrottlerState {
  contacts: Array<[string, ContactRecord]>;
  limits: TopologyLimits;
  sourceGroupCounts: Array<[string, number]>;
}

export class TopologyThrottler {
  private config: Required<TopologyThrottlerConfig>;
  private riskConfig: Required<ContactRiskConfig>;
  private contacts = new Map<string, ContactRecord>();
  private limits: TopologyLimits;
  private sourceGroupCounts = new Map<string, number>();

  constructor(config?: TopologyThrottlerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.riskConfig = { ...DEFAULT_RISK_CONFIG, ...this.config.riskConfig };

    this.limits = {
      newContactsThisHour: 0,
      newContactsToday: 0,
      lastHourResetAt: Date.now(),
      lastDayResetAt: Date.now(),
    };
  }

  /**
   * Assess contact risk before sending.
   * This is the main check — call before every send to a new/unknown contact.
   */
  assessContact(jid: string, context: {
    messageType?: 'dm' | 'group' | 'broadcast';
    sourceGroup?: string;       // which group you got their number from
    knownGroups?: string[];     // groups you share with them
    hasReplied?: boolean;       // have they ever replied to you
    lastContactAt?: number;     // last time you sent them something
    lastReplyAt?: number;       // last time they replied
  }): ContactRiskAssessment {
    this.resetLimitsIfNeeded();

    const record = this.contacts.get(jid);
    const now = Date.now();

    let score = 0;
    const reasons: string[] = [];

    // First contact penalty
    if (!record) {
      score += this.riskConfig.firstContactPenalty;
      reasons.push('first_contact');
    } else {
      // Has record — check reply history
      if (record.replyTimestamps.length === 0 && record.sendTimestamps.length > 0) {
        score += this.riskConfig.noReplyPenalty;
        reasons.push('no_reply_history');
      }
    }

    // No mutual groups penalty
    if (!context.knownGroups || context.knownGroups.length === 0) {
      score += this.riskConfig.noMutualGroupsPenalty;
      reasons.push('no_mutual_groups');
    }

    // Recent contact bonus
    if (context.lastContactAt && (now - context.lastContactAt) < TIME_CONSTANTS.MS_PER_24H) {
      score += this.riskConfig.recentContactBonus;
      reasons.push('recent_contact');
    }

    // Replied before bonus
    if (context.hasReplied || (record && record.replyTimestamps.length > 0)) {
      score += this.riskConfig.repliedBeforeBonus;
      reasons.push('has_replied');
    }

    // Clamp score to 0-100
    score = Math.max(0, Math.min(100, score));

    // Determine risk level
    let risk: ContactRisk;
    let recommendation: 'send' | 'delay' | 'abort';
    let suggestedDelayMs: number | undefined;

    if (score >= this.riskConfig.abortThreshold) {
      risk = 'CRITICAL';
      recommendation = 'abort';
      reasons.push('risk_too_high');
    } else if (score >= this.riskConfig.delayThreshold) {
      risk = score >= 60 ? 'HIGH' : 'MEDIUM';
      recommendation = 'delay';
      // Exponential delay based on score
      const delayMinutes = Math.floor((score - this.riskConfig.delayThreshold) / 10);
      suggestedDelayMs = delayMinutes * 60000;
      reasons.push('recommend_delay');
    } else {
      risk = score >= 30 ? 'MEDIUM' : 'LOW';
      recommendation = 'send';
    }

    return {
      jid,
      risk,
      score,
      reasons,
      recommendation,
      suggestedDelayMs,
    };
  }

  /**
   * Record a sent message to this contact.
   */
  recordSent(jid: string, sourceGroup?: string): void {
    this.resetLimitsIfNeeded();

    const now = Date.now();
    let record = this.contacts.get(jid);

    if (!record) {
      // New contact — increment limits
      record = {
        firstContactAt: now,
        sendTimestamps: [],
        replyTimestamps: [],
        blocked: false,
        sourceGroup,
      };
      this.contacts.set(jid, record);

      this.limits.newContactsThisHour++;
      this.limits.newContactsToday++;

      // Track source group
      if (sourceGroup) {
        const count = this.sourceGroupCounts.get(sourceGroup) || 0;
        this.sourceGroupCounts.set(sourceGroup, count + 1);
      }
    }

    // Add send timestamp (keep sliding window)
    record.sendTimestamps.push(now);
    this.cleanupTimestamps(record.sendTimestamps, TIME_CONSTANTS.REPLY_WINDOW_DAYS * TIME_CONSTANTS.MS_PER_DAY);
  }

  /**
   * Record a reply from this contact.
   */
  recordReplied(jid: string): void {
    const record = this.contacts.get(jid);
    if (!record) return;

    const now = Date.now();
    record.replyTimestamps.push(now);
    this.cleanupTimestamps(record.replyTimestamps, TIME_CONSTANTS.REPLY_WINDOW_DAYS * TIME_CONSTANTS.MS_PER_DAY);
  }

  /**
   * Record that this contact blocked you.
   */
  recordBlocked(jid: string): void {
    const record = this.contacts.get(jid);
    if (!record) return;

    record.blocked = true;
  }

  /**
   * Check if topology limits allow sending to a new contact.
   * Returns whether allowed and reason/retry time if blocked.
   */
  canSendToNewContact(): { allowed: boolean; reason?: string; retryAfterMs?: number } {
    this.resetLimitsIfNeeded();

    const now = Date.now();

    // Check cooldown
    if (this.limits.limitHitAt) {
      const cooldownEndsAt = this.limits.limitHitAt + this.config.cooldownMs;
      if (now < cooldownEndsAt) {
        const retryAfterMs = cooldownEndsAt - now;
        return {
          allowed: false,
          reason: `Cooldown active — limit hit recently`,
          retryAfterMs,
        };
      } else {
        // Cooldown expired
        delete this.limits.limitHitAt;
      }
    }

    // Check hourly limit
    if (this.limits.newContactsThisHour >= this.config.maxNewContactsPerHour) {
      this.limits.limitHitAt = now;
      const retryAfterMs = (this.limits.lastHourResetAt + TIME_CONSTANTS.MS_PER_HOUR) - now;
      return {
        allowed: false,
        reason: `Hourly new contact limit reached (${this.config.maxNewContactsPerHour})`,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    // Check daily limit
    if (this.limits.newContactsToday >= this.config.maxNewContactsPerDay) {
      this.limits.limitHitAt = now;
      const retryAfterMs = (this.limits.lastDayResetAt + TIME_CONSTANTS.MS_PER_DAY) - now;
      return {
        allowed: false,
        reason: `Daily new contact limit reached (${this.config.maxNewContactsPerDay})`,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    // Check reply ratio requirement
    const replyRatio = this.calculateReplyRatio();
    if (replyRatio !== null && replyRatio < this.config.minReplyRatioForNewContacts) {
      // Poor reply ratio — need to improve engagement before more cold sends
      return {
        allowed: false,
        reason: `Reply ratio too low (${Math.round(replyRatio * 100)}% < ${Math.round(this.config.minReplyRatioForNewContacts * 100)}%)`,
        retryAfterMs: TIME_CONSTANTS.MS_PER_HOUR, // arbitrary — user needs to improve engagement
      };
    }

    return { allowed: true };
  }

  /**
   * Get topology statistics.
   */
  getTopologyStats(): {
    newContactsThisHour: number;
    newContactsToday: number;
    replyRatio: number | null;
    blockedRatio: number | null;
    hotspots: Array<{ sourceGroup: string; count: number }>;
  } {
    this.resetLimitsIfNeeded();

    const replyRatio = this.calculateReplyRatio();
    const blockedRatio = this.calculateBlockedRatio();

    // Get top 5 source group hotspots
    const hotspots = Array.from(this.sourceGroupCounts.entries())
      .map(([sourceGroup, count]) => ({ sourceGroup, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      newContactsThisHour: this.limits.newContactsThisHour,
      newContactsToday: this.limits.newContactsToday,
      replyRatio,
      blockedRatio,
      hotspots,
    };
  }

  /**
   * Export state for persistence.
   */
  exportState(): TopologyThrottlerState {
    return {
      contacts: Array.from(this.contacts.entries()),
      limits: { ...this.limits },
      sourceGroupCounts: Array.from(this.sourceGroupCounts.entries()),
    };
  }

  /**
   * Import state from persistence.
   */
  importState(state: TopologyThrottlerState): void {
    if (state.contacts) {
      this.contacts = new Map(state.contacts);
    }
    if (state.limits) {
      this.limits = { ...state.limits };
    }
    if (state.sourceGroupCounts) {
      this.sourceGroupCounts = new Map(state.sourceGroupCounts);
    }
  }

  // Private helpers

  private resetLimitsIfNeeded(): void {
    const now = Date.now();

    // Reset hourly counter
    if (now - this.limits.lastHourResetAt >= TIME_CONSTANTS.MS_PER_HOUR) {
      this.limits.newContactsThisHour = 0;
      this.limits.lastHourResetAt = now;
    }

    // Reset daily counter
    if (now - this.limits.lastDayResetAt >= TIME_CONSTANTS.MS_PER_DAY) {
      this.limits.newContactsToday = 0;
      this.limits.lastDayResetAt = now;

      // Clear source group counts daily
      this.sourceGroupCounts.clear();
    }
  }

  private calculateReplyRatio(): number | null {
    const now = Date.now();
    const windowMs = TIME_CONSTANTS.REPLY_WINDOW_DAYS * TIME_CONSTANTS.MS_PER_DAY;

    let totalSent = 0;
    let totalReplies = 0;

    for (const record of this.contacts.values()) {
      // Count sends in window
      const recentSends = record.sendTimestamps.filter(t => now - t < windowMs);
      totalSent += recentSends.length;

      // Count replies in window
      const recentReplies = record.replyTimestamps.filter(t => now - t < windowMs);
      totalReplies += recentReplies.length;
    }

    if (totalSent === 0) return null; // No data yet

    return totalReplies / totalSent;
  }

  private calculateBlockedRatio(): number | null {
    const totalContacts = this.contacts.size;
    if (totalContacts === 0) return null;

    let blockedCount = 0;
    for (const record of this.contacts.values()) {
      if (record.blocked) blockedCount++;
    }

    return blockedCount / totalContacts;
  }

  private cleanupTimestamps(timestamps: number[], maxAgeMs: number): void {
    const now = Date.now();
    const cutoff = now - maxAgeMs;

    // Remove old timestamps (in-place filter)
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < timestamps.length; readIdx++) {
      if (timestamps[readIdx] >= cutoff) {
        timestamps[writeIdx++] = timestamps[readIdx];
      }
    }
    timestamps.length = writeIdx;
  }
}
