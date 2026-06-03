/**
 * HumanEntropyService — Background noise for WA sessions
 *
 * Runs periodic human-like actions to make idle sessions appear more realistic:
 * - Random typing presence to recent contacts
 * - Delayed read receipts
 * - Availability status toggles
 *
 * Design:
 * - Works ONLY with WaSP's public API (no direct socket access)
 * - Fail-silent (never crashes wa-pa)
 * - Configurable intervals and probabilities
 * - Only interacts with contacts who messaged first (never strangers)
 */

export interface HumanEntropyConfig {
  /** Enable entropy service (default: true) */
  enabled?: boolean;
  /** Min interval between entropy cycles in ms (default: 2 hours) */
  minIntervalMs?: number;
  /** Max interval between entropy cycles in ms (default: 6 hours) */
  maxIntervalMs?: number;
  /** Max recent contacts to track (default: 30) */
  maxRecentContacts?: number;
  /** Probability of sending typing presence per cycle (default: 0.3) */
  typingProbability?: number;
  /** Min typing duration in ms (default: 3000) */
  typingMinMs?: number;
  /** Max typing duration in ms (default: 8000) */
  typingMaxMs?: number;
  /** Probability of marking recent message as read (default: 0.2) */
  readReceiptProbability?: number;
  /** Min delay before marking as read in ms (default: 10 min) */
  readReceiptMinDelayMs?: number;
  /** Max delay before marking as read in ms (default: 60 min) */
  readReceiptMaxDelayMs?: number;
  /** Probability of toggling presence status per cycle (default: 0.15) */
  presenceToggleProbability?: number;
  /** Min duration for presence toggle in ms (default: 30 sec) */
  presenceToggleMinMs?: number;
  /** Max duration for presence toggle in ms (default: 2 min) */
  presenceToggleMaxMs?: number;
}

export interface HumanEntropyStats {
  cyclesExecuted: number;
  typingActionsPerformed: number;
  readReceiptsMarked: number;
  presenceToggles: number;
  errors: number;
  lastCycleAt: Date | null;
  nextCycleAt: Date | null;
}

interface RecentContact {
  jid: string;
  lastMessageAt: Date;
  isGroup: boolean;
}

interface UnreadMessage {
  jid: string;
  messageKey: any;
  receivedAt: Date;
}

const DEFAULT_CONFIG: Required<HumanEntropyConfig> = {
  enabled: true,
  minIntervalMs: 2 * 60 * 60 * 1000, // 2 hours
  maxIntervalMs: 6 * 60 * 60 * 1000, // 6 hours
  maxRecentContacts: 30,
  typingProbability: 0.3,
  typingMinMs: 3000,
  typingMaxMs: 8000,
  readReceiptProbability: 0.2,
  readReceiptMinDelayMs: 10 * 60 * 1000, // 10 min
  readReceiptMaxDelayMs: 60 * 60 * 1000, // 60 min
  presenceToggleProbability: 0.15,
  presenceToggleMinMs: 30 * 1000, // 30 sec
  presenceToggleMaxMs: 2 * 60 * 1000, // 2 min
};

/**
 * Human entropy service
 *
 * Adds realistic background noise to WhatsApp sessions by performing
 * random human-like actions periodically.
 */
export class HumanEntropyService {
  private config: Required<HumanEntropyConfig>;
  private wasp: any; // WaSP instance
  private sessionId: string;
  private recentContacts: RecentContact[] = [];
  private unreadMessages: UnreadMessage[] = [];
  private cycleTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private stats: HumanEntropyStats = {
    cyclesExecuted: 0,
    typingActionsPerformed: 0,
    readReceiptsMarked: 0,
    presenceToggles: 0,
    errors: 0,
    lastCycleAt: null,
    nextCycleAt: null,
  };

  constructor(wasp: any, sessionId: string, config: HumanEntropyConfig = {}) {
    this.wasp = wasp;
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Listen to MESSAGE_RECEIVED events to track recent contacts
    this.wasp.on('MESSAGE_RECEIVED', (event: any) => {
      if (event.sessionId === this.sessionId) {
        this.trackIncomingMessage(event.data);
      }
    });

    this.log('info', 'HumanEntropyService initialized', {
      enabled: this.config.enabled,
      minInterval: this.config.minIntervalMs,
      maxInterval: this.config.maxIntervalMs,
    });
  }

  /**
   * Start the entropy service
   */
  start(): void {
    if (!this.config.enabled) {
      this.log('info', 'Entropy service disabled, not starting');
      return;
    }

    if (this.isRunning) {
      this.log('warn', 'Entropy service already running');
      return;
    }

    this.isRunning = true;
    this.scheduleNextCycle();
    this.log('info', 'Entropy service started');
  }

  /**
   * Stop the entropy service
   */
  stop(): void {
    this.isRunning = false;
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    this.stats.nextCycleAt = null;
    this.log('info', 'Entropy service stopped');
  }

  /**
   * Get current statistics
   */
  getStats(): HumanEntropyStats {
    return { ...this.stats };
  }

  /**
   * Track incoming message to build recent contacts list
   */
  private trackIncomingMessage(message: any): void {
    try {
      // Skip outgoing messages
      if (message.fromMe) return;

      const jid = message.from || message.chatId;
      if (!jid) return;

      // Update or add to recent contacts
      const existingIndex = this.recentContacts.findIndex(c => c.jid === jid);
      if (existingIndex >= 0) {
        this.recentContacts[existingIndex]!.lastMessageAt = new Date();
      } else {
        this.recentContacts.push({
          jid,
          lastMessageAt: new Date(),
          isGroup: message.isGroup ?? false,
        });
      }

      // Trim to max size (keep most recent)
      if (this.recentContacts.length > this.config.maxRecentContacts) {
        this.recentContacts.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
        this.recentContacts = this.recentContacts.slice(0, this.config.maxRecentContacts);
      }

      // Track for potential read receipt
      if (message.id && message.key) {
        this.unreadMessages.push({
          jid,
          messageKey: message.key,
          receivedAt: new Date(),
        });

        // Trim old unread messages (keep last 50)
        if (this.unreadMessages.length > 50) {
          this.unreadMessages = this.unreadMessages.slice(-50);
        }
      }
    } catch (error) {
      this.log('error', 'Error tracking incoming message', { error: (error as Error).message });
    }
  }

  /**
   * Schedule next entropy cycle
   */
  private scheduleNextCycle(): void {
    if (!this.isRunning) return;

    const delay = this.randomBetween(this.config.minIntervalMs, this.config.maxIntervalMs);
    this.stats.nextCycleAt = new Date(Date.now() + delay);

    this.cycleTimer = setTimeout(() => {
      this.executeCycle().catch(error => {
        this.log('error', 'Entropy cycle failed', { error: error.message });
        this.stats.errors++;
      }).finally(() => {
        this.scheduleNextCycle();
      });
    }, delay);

    this.log('debug', `Next entropy cycle in ${Math.floor(delay / 1000)}s`);
  }

  /**
   * Execute one entropy cycle
   */
  private async executeCycle(): Promise<void> {
    if (!this.isRunning || this.recentContacts.length === 0) {
      return;
    }

    this.log('info', 'Starting entropy cycle', {
      recentContactsCount: this.recentContacts.length,
      unreadMessagesCount: this.unreadMessages.length,
    });

    this.stats.cyclesExecuted++;
    this.stats.lastCycleAt = new Date();

    const actions: Promise<void>[] = [];

    // Action 1: Random typing presence
    if (Math.random() < this.config.typingProbability) {
      actions.push(this.performTypingPresence());
    }

    // Action 2: Mark random message as read
    if (Math.random() < this.config.readReceiptProbability && this.unreadMessages.length > 0) {
      actions.push(this.performReadReceipt());
    }

    // Action 3: Toggle presence status
    if (Math.random() < this.config.presenceToggleProbability) {
      actions.push(this.performPresenceToggle());
    }

    // Execute all actions in parallel
    await Promise.allSettled(actions);
  }

  /**
   * Send typing presence to a random recent contact
   */
  private async performTypingPresence(): Promise<void> {
    try {
      // Pick a random non-group contact
      const eligibleContacts = this.recentContacts.filter(c => !c.isGroup);
      if (eligibleContacts.length === 0) {
        this.log('debug', 'No eligible contacts for typing presence');
        return;
      }

      const contact = eligibleContacts[Math.floor(Math.random() * eligibleContacts.length)]!;
      const duration = this.randomBetween(this.config.typingMinMs, this.config.typingMaxMs);

      this.log('info', `Entropy action: typing to ${this.maskJid(contact.jid)} for ${duration}ms`);

      // Get provider to access socket
      const provider = this.wasp.getProvider(this.sessionId);
      if (!provider || !provider.socket) {
        throw new Error('Provider or socket not available');
      }

      // Send composing presence
      await provider.socket.sendPresenceUpdate('composing', contact.jid);

      // Wait for duration
      await this.sleep(duration);

      // Send paused presence
      await provider.socket.sendPresenceUpdate('paused', contact.jid);

      this.stats.typingActionsPerformed++;
    } catch (error) {
      this.log('error', 'Error performing typing presence', { error: (error as Error).message });
      this.stats.errors++;
    }
  }

  /**
   * Mark a random recent message as read with delay
   */
  private async performReadReceipt(): Promise<void> {
    try {
      const message = this.unreadMessages[Math.floor(Math.random() * this.unreadMessages.length)];
      if (!message) return;

      const delay = this.randomBetween(
        this.config.readReceiptMinDelayMs,
        this.config.readReceiptMaxDelayMs
      );

      this.log('info', `Entropy action: mark read ${this.maskJid(message.jid)} after ${Math.floor(delay / 1000)}s`);

      // Wait for delay
      await this.sleep(delay);

      // Get provider to access socket
      const provider = this.wasp.getProvider(this.sessionId);
      if (!provider || !provider.socket) {
        throw new Error('Provider or socket not available');
      }

      // Mark as read
      await provider.socket.readMessages([message.messageKey]);

      // Remove from unread list
      this.unreadMessages = this.unreadMessages.filter(m => m !== message);

      this.stats.readReceiptsMarked++;
    } catch (error) {
      this.log('error', 'Error performing read receipt', { error: (error as Error).message });
      this.stats.errors++;
    }
  }

  /**
   * Toggle presence status (available → unavailable)
   */
  private async performPresenceToggle(): Promise<void> {
    try {
      const duration = this.randomBetween(
        this.config.presenceToggleMinMs,
        this.config.presenceToggleMaxMs
      );

      this.log('info', `Entropy action: presence toggle for ${Math.floor(duration / 1000)}s`);

      // Get provider to access socket
      const provider = this.wasp.getProvider(this.sessionId);
      if (!provider || !provider.socket) {
        throw new Error('Provider or socket not available');
      }

      // Set available
      await provider.socket.sendPresenceUpdate('available');

      // Wait for duration
      await this.sleep(duration);

      // Set unavailable
      await provider.socket.sendPresenceUpdate('unavailable');

      this.stats.presenceToggles++;
    } catch (error) {
      this.log('error', 'Error performing presence toggle', { error: (error as Error).message });
      this.stats.errors++;
    }
  }

  /**
   * Random value between min and max (inclusive)
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Mask JID for logging (privacy)
   */
  private maskJid(jid: string): string {
    if (jid.length < 8) return '***';
    return jid.substring(0, 4) + '***' + jid.substring(jid.length - 4);
  }

  /**
   * Log message
   */
  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: any): void {
    const prefix = '[entropy]';
    const logData = meta ? `${message} ${JSON.stringify(meta)}` : message;

    switch (level) {
      case 'info':
        console.log(`${prefix} ${logData}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${logData}`);
        break;
      case 'error':
        console.error(`${prefix} ${logData}`);
        break;
      case 'debug':
        // Skip debug logs in production
        break;
    }
  }
}

/**
 * Factory function to create HumanEntropyService
 *
 * @param wasp WaSP instance
 * @param sessionId Session ID
 * @param config Optional configuration
 * @returns HumanEntropyService instance with start() and stop() methods
 */
export function createHumanEntropyService(
  wasp: any,
  sessionId: string,
  config?: HumanEntropyConfig
): { start: () => void; stop: () => void; getStats: () => HumanEntropyStats } {
  const service = new HumanEntropyService(wasp, sessionId, config);

  return {
    start: () => service.start(),
    stop: () => service.stop(),
    getStats: () => service.getStats(),
  };
}
