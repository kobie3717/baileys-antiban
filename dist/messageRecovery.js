import { existsSync, readFileSync } from 'node:fs';
const DEFAULT_CONFIG = {
    maxTrackedChats: 1000,
    maxGapMs: 30 * 60_000, // 30 minutes
    persistDebounceMs: 2_000,
    onGapFilled: () => { },
    logger: {
        info: () => { },
        warn: () => { },
        error: () => { },
    },
};
export function messageRecovery(sock, config) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const logger = cfg.logger;
    // State
    const lastSeen = new Map();
    let disconnectedAt = null;
    let totalRecovered = 0;
    let lastReconnectAt = null;
    let lastGapMs = null;
    // Persistence
    let persistTimer = null;
    let loggedFetchWarning = false;
    // Load persisted state on startup (synchronous — seeds lastSeen before first event)
    if (cfg.persistPath) {
        loadPersistence();
    }
    // Listen to messages.upsert to track lastSeen
    const messagesListener = sock.ev.process
        ? setupProcessListener()
        : setupLegacyListener();
    // Listen to connection.update for disconnect/reconnect
    const connectionListener = (update) => {
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
        const listener = async (events) => {
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
        const listener = (upsert) => {
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
    function trackMessage(msg) {
        const jid = msg.key?.remoteJid;
        const messageId = msg.key?.id;
        const timestamp = msg.messageTimestamp;
        if (!jid || !messageId || !timestamp)
            return;
        // Skip self-messages to reduce noise
        if (msg.key?.fromMe)
            return;
        const now = Date.now();
        lastSeen.set(jid, {
            messageId,
            timestamp: typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10),
            lastTouchedAt: now,
        });
        // Evict oldest if over capacity
        if (lastSeen.size > cfg.maxTrackedChats) {
            evictOldest();
        }
        // Debounced persist
        schedulePersist();
    }
    function evictOldest() {
        let oldestJid = null;
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
    async function recoverMessages() {
        const recoveryStartMs = Date.now();
        const gapMs = recoveryStartMs - disconnectedAt;
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
                // Fetch messages newer than lastSeen timestamp.
                // Baileys v7 may have changed this signature — fall back gracefully on any error.
                let messages;
                try {
                    const result = await sock.fetchMessageHistory(jid, 50, { before: undefined });
                    messages = Array.isArray(result) ? result : [];
                }
                catch {
                    if (!loggedFetchWarning) {
                        logger.warn?.(`[messageRecovery] sock.fetchMessageHistory failed — signature may have changed in this Baileys version. Recovery skipped for this reconnect.`);
                        loggedFetchWarning = true;
                    }
                    continue;
                }
                if (!messages || !Array.isArray(messages))
                    continue;
                // Filter to messages newer than lastSeen
                const gapMessages = messages.filter((msg) => {
                    const ts = msg.messageTimestamp;
                    if (!ts)
                        return false;
                    const msgTs = typeof ts === 'number' ? ts : parseInt(ts, 10);
                    return msgTs > lastSeenEntry.timestamp;
                });
                // Sort chronologically (oldest first for replay)
                gapMessages.sort((a, b) => {
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
            }
            catch (err) {
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
    function schedulePersist() {
        if (!cfg.persistPath)
            return;
        if (persistTimer) {
            clearTimeout(persistTimer);
        }
        persistTimer = setTimeout(() => {
            void flushPersistence();
        }, cfg.persistDebounceMs);
    }
    async function flushPersistence() {
        if (!cfg.persistPath)
            return;
        try {
            const fs = await import('fs/promises');
            const data = {};
            for (const [jid, entry] of lastSeen) {
                data[jid] = {
                    id: entry.messageId,
                    timestamp: entry.timestamp,
                };
            }
            await fs.writeFile(cfg.persistPath, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch (err) {
            logger.error?.(`[messageRecovery] Failed to persist state: ${err.message}`);
        }
    }
    function loadPersistence() {
        if (!cfg.persistPath)
            return;
        try {
            if (!existsSync(cfg.persistPath))
                return;
            const raw = readFileSync(cfg.persistPath, 'utf-8');
            const data = JSON.parse(raw);
            for (const [jid, entry] of Object.entries(data)) {
                lastSeen.set(jid, {
                    messageId: entry.id,
                    timestamp: entry.timestamp,
                    lastTouchedAt: Date.now(),
                });
            }
            logger.info?.(`[messageRecovery] Loaded ${lastSeen.size} entries from ${cfg.persistPath}`);
        }
        catch (err) {
            logger.warn?.(`[messageRecovery] Failed to load persisted state: ${err.message}`);
        }
    }
    // Public API
    return {
        async stop() {
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
        markSeen(chatJid, messageId, timestamp) {
            lastSeen.set(chatJid, {
                messageId,
                timestamp,
                lastTouchedAt: Date.now(),
            });
            schedulePersist();
        },
        getStats() {
            return {
                trackedChats: lastSeen.size,
                totalRecovered,
                lastReconnectAt,
                lastGapMs,
            };
        },
    };
}
