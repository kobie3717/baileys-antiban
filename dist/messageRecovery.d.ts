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
    onRecoveryComplete?: (stats: {
        chats: number;
        recovered: number;
        durationMs: number;
    }) => void | Promise<void>;
    /** Logger (default NoopLogger) */
    logger?: {
        info?: Function;
        warn?: Function;
        error?: Function;
    };
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
export declare function messageRecovery(sock: any, config: MessageRecoveryConfig): MessageRecoveryHandle;
