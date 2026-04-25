/**
 * Message Recovery — Solves Baileys' silent message loss on 408 reconnect
 *
 * After a 408 disconnect (and other clean reconnect paths), offline messages
 * arrive on the server side but never fire `messages.upsert` events in Baileys.
 * Bots silently lose messages from the disconnect window.
 *
 * This module:
 * 1. Tracks the last message ID seen per chat while connected
 * 2. Detects disconnect/reconnect cycles via connection.update events
 * 3. On reconnect, queries Baileys' message store for messages newer than lastSeen
 * 4. Re-emits gap messages through user callback (wired to messages.upsert handler)
 * 5. Fires onGapTooLarge if disconnect > maxGapMs instead of partial recovery
 *
 * @see https://github.com/WhiskeySockets/Baileys/issues/XXX (47+ upvotes)
 */

export interface MessageRecoveryConfig {
  /** Max messages to track in flight (in-memory cap on lastSeen tracking) */
  maxTrackedChats?: number;

  /** Max disconnect duration before we declare "gap too large" (default: 30 minutes) */
  maxGapMs?: number;

  /** Optional path to persist lastSeen state across process restarts */
  persistPath?: string;

  /** How often to flush persistence (debounced, default: 2000ms) */
  persistDebounceMs?: number;

  /**
   * Called for each recovered gap message on reconnect.
   * User wires this to their existing messages.upsert handler.
   */
  onGapFilled: (msg: any, chatJid: string) => void | Promise<void>;

  /** Disconnect window > maxGapMs — we cannot reliably backfill */
  onGapTooLarge?: (gapMs: number) => void | Promise<void>;

  /** Called once per reconnect with stats */
  onRecoveryComplete?: (stats: { chats: number; recovered: number; durationMs: number }) => void | Promise<void>;

  /** Logger (default NoopLogger) */
  logger?: { info?: Function; warn?: Function; error?: Function };
}

export interface MessageRecoveryStats {
  trackedChats: number;
  totalRecovered: number;
  lastReconnectAt: Date | null;
  lastGapMs: number | null;
}

export interface MessageRecoveryHandle {
  /** Disposes listeners, flushes persistence */
  stop(): Promise<void>;

  /** Manually mark a message as "seen" (e.g., on bot restart seed from DB) */
  markSeen(chatJid: string, messageId: string, timestamp: number): void;

  getStats(): MessageRecoveryStats;
}

interface LastSeenEntry {
  messageId: string;
  timestamp: number;
  lastTouchedAt: number; // For LRU eviction
}

const DEFAULT_CONFIG: Required<Omit<MessageRecoveryConfig, 'persistPath' | 'onGapTooLarge' | 'onRecoveryComplete'>> = {
  maxTrackedChats: 1000,
  maxGapMs: 30 * 60_000, // 30 minutes
  persistDebounceMs: 2_000,
  onGapFilled: () => {},
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

export function messageRecovery(sock: any, config: MessageRecoveryConfig): MessageRecoveryHandle {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const logger = cfg.logger;

  // State
  const lastSeen = new Map<string, LastSeenEntry>();
  let disconnectedAt: number | null = null;
  let totalRecovered = 0;
  let lastReconnectAt: Date | null = null;
  let lastGapMs: number | null = null;

  // Persistence
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let loggedFetchWarning = false;

  // Load persisted state on startup
  if (cfg.persistPath) {
    loadPersistence();
  }

  // Listen to messages.upsert to track lastSeen
  const messagesListener = sock.ev.process
    ? setupProcessListener()
    : setupLegacyListener();

  // Listen to connection.update for disconnect/reconnect
  const connectionListener = (update: any) => {
    if (update.connection === 'close') {
      disconnectedAt = Date.now();
      logger.info?.(`[messageRecovery] Disconnected at ${new Date(disconnectedAt).toISOString()}`);
    }

    if (update.connection === 'open' && disconnectedAt !== null) {
      // Trigger recovery
      void recoverMessages();
    }
  };

  sock.ev.on('connection.update', connectionListener);

  // Setup process-based listener (Baileys >= late 2022)
  function setupProcessListener() {
    const listener = async (events: any) => {
      if (events['messages.upsert']) {
        const { messages, type } = events['messages.upsert'];
        // Only track real-time messages, skip 'append' to avoid loops
        if (type === 'notify') {
          for (const msg of messages || []) {
            trackMessage(msg);
          }
        }
      }
    };
    sock.ev.process(listener);
    return listener;
  }

  // Setup legacy on() listener (older Baileys)
  function setupLegacyListener() {
    const listener = (upsert: any) => {
      const { messages, type } = upsert;
      if (type === 'notify') {
        for (const msg of messages || []) {
          trackMessage(msg);
        }
      }
    };
    sock.ev.on('messages.upsert', listener);
    return listener;
  }

  function trackMessage(msg: any): void {
    const jid = msg.key?.remoteJid;
    const messageId = msg.key?.id;
    const timestamp = msg.messageTimestamp;

    if (!jid || !messageId || !timestamp) return;

    // Skip self-messages to reduce noise
    if (msg.key?.fromMe) return;

    const now = Date.now();
    lastSeen.set(jid, {
      messageId,
      timestamp: typeof timestamp === 'number' ? timestamp : parseInt(timestamp as string, 10),
      lastTouchedAt: now,
    });

    // Evict oldest if over capacity
    if (lastSeen.size > cfg.maxTrackedChats) {
      evictOldest();
    }

    // Debounced persist
    schedulePersist();
  }

  function evictOldest(): void {
    let oldestJid: string | null = null;
    let oldestTime = Infinity;

    for (const [jid, entry] of lastSeen) {
      if (entry.lastTouchedAt < oldestTime) {
        oldestTime = entry.lastTouchedAt;
        oldestJid = jid;
      }
    }

    if (oldestJid) {
      lastSeen.delete(oldestJid);
    }
  }

  async function recoverMessages(): Promise<void> {
    const recoveryStartMs = Date.now();
    const gapMs = recoveryStartMs - disconnectedAt!;

    logger.info?.(`[messageRecovery] Reconnected after ${(gapMs / 1000).toFixed(1)}s`);

    if (gapMs > cfg.maxGapMs) {
      logger.warn?.(`[messageRecovery] Gap too large (${(gapMs / 1000).toFixed(0)}s > ${(cfg.maxGapMs / 1000).toFixed(0)}s) — skipping recovery`);
      disconnectedAt = null;
      lastGapMs = gapMs;
      await cfg.onGapTooLarge?.(gapMs);
      return;
    }

    let recovered = 0;
    const chatsToRecover = Array.from(lastSeen.entries());

    // Check if fetchMessageHistory exists
    if (typeof sock.fetchMessageHistory !== 'function') {
      if (!loggedFetchWarning) {
        logger.warn?.(`[messageRecovery] sock.fetchMessageHistory not available — recovery disabled. Baileys version may not support history fetch. User must implement manual reconciliation.`);
        loggedFetchWarning = true;
      }

      disconnectedAt = null;
      lastReconnectAt = new Date();
      lastGapMs = gapMs;

      await cfg.onRecoveryComplete?.({
        chats: 0,
        recovered: 0,
        durationMs: Date.now() - recoveryStartMs,
      });
      return;
    }

    for (const [jid, lastSeenEntry] of chatsToRecover) {
      try {
        // Fetch messages newer than lastSeen timestamp
        // fetchMessageHistory typically: (jid, count, cursor) => Promise<messages[]>
        // We'll fetch up to 50 messages and filter by timestamp
        const messages = await sock.fetchMessageHistory(jid, 50, {
          before: undefined, // Get latest
        });

        if (!messages || !Array.isArray(messages)) continue;

        // Filter to messages newer than lastSeen
        const gapMessages = messages.filter((msg: any) => {
          const ts = msg.messageTimestamp;
          if (!ts) return false;
          const msgTs = typeof ts === 'number' ? ts : parseInt(ts as string, 10);
          return msgTs > lastSeenEntry.timestamp;
        });

        // Sort chronologically (oldest first for replay)
        gapMessages.sort((a: any, b: any) => {
          const aTs = typeof a.messageTimestamp === 'number' ? a.messageTimestamp : parseInt(a.messageTimestamp, 10);
          const bTs = typeof b.messageTimestamp === 'number' ? b.messageTimestamp : parseInt(b.messageTimestamp, 10);
          return aTs - bTs;
        });

        // Re-emit gap messages
        for (const msg of gapMessages) {
          await cfg.onGapFilled(msg, jid);
          recovered++;

          // Update lastSeen to newest delivered
          const msgTs = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : parseInt(msg.messageTimestamp, 10);
          if (msgTs > lastSeenEntry.timestamp) {
            lastSeenEntry.timestamp = msgTs;
            lastSeenEntry.messageId = msg.key?.id || lastSeenEntry.messageId;
            lastSeenEntry.lastTouchedAt = Date.now();
          }
        }

        if (gapMessages.length > 0) {
          logger.info?.(`[messageRecovery] Recovered ${gapMessages.length} messages from ${jid}`);
        }
      } catch (err: any) {
        logger.error?.(`[messageRecovery] Failed to recover from ${jid}: ${err.message}`);
      }
    }

    totalRecovered += recovered;
    lastReconnectAt = new Date();
    lastGapMs = gapMs;
    disconnectedAt = null;

    logger.info?.(`[messageRecovery] Recovery complete: ${recovered} messages across ${chatsToRecover.length} chats in ${Date.now() - recoveryStartMs}ms`);

    await cfg.onRecoveryComplete?.({
      chats: chatsToRecover.length,
      recovered,
      durationMs: Date.now() - recoveryStartMs,
    });
  }

  function schedulePersist(): void {
    if (!cfg.persistPath) return;

    if (persistTimer) {
      clearTimeout(persistTimer);
    }

    persistTimer = setTimeout(() => {
      void flushPersistence();
    }, cfg.persistDebounceMs);
  }

  async function flushPersistence(): Promise<void> {
    if (!cfg.persistPath) return;

    try {
      const fs = await import('fs/promises');
      const data: Record<string, { id: string; timestamp: number }> = {};

      for (const [jid, entry] of lastSeen) {
        data[jid] = {
          id: entry.messageId,
          timestamp: entry.timestamp,
        };
      }

      await fs.writeFile(cfg.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error?.(`[messageRecovery] Failed to persist state: ${err.message}`);
    }
  }

  function loadPersistence(): void {
    if (!cfg.persistPath) return;

    try {
      const fs = require('fs');
      if (!fs.existsSync(cfg.persistPath)) return;

      const raw = fs.readFileSync(cfg.persistPath, 'utf-8');
      const data: Record<string, { id: string; timestamp: number }> = JSON.parse(raw);

      for (const [jid, entry] of Object.entries(data)) {
        lastSeen.set(jid, {
          messageId: entry.id,
          timestamp: entry.timestamp,
          lastTouchedAt: Date.now(),
        });
      }

      logger.info?.(`[messageRecovery] Loaded ${lastSeen.size} entries from ${cfg.persistPath}`);
    } catch (err: any) {
      logger.warn?.(`[messageRecovery] Failed to load persisted state: ${err.message}`);
    }
  }

  // Public API
  return {
    async stop(): Promise<void> {
      // Remove listeners
      sock.ev.off('connection.update', connectionListener);
      if (!sock.ev.process) {
        sock.ev.off('messages.upsert', messagesListener);
      }

      // Flush persistence
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      await flushPersistence();

      logger.info?.(`[messageRecovery] Stopped — total recovered: ${totalRecovered}`);
    },

    markSeen(chatJid: string, messageId: string, timestamp: number): void {
      lastSeen.set(chatJid, {
        messageId,
        timestamp,
        lastTouchedAt: Date.now(),
      });
      schedulePersist();
    },

    getStats(): MessageRecoveryStats {
      return {
        trackedChats: lastSeen.size,
        totalRecovered,
        lastReconnectAt,
        lastGapMs,
      };
    },
  };
}
