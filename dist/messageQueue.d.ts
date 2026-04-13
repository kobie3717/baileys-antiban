/**
 * Persistent Message Queue — Messages survive crashes and restarts
 *
 * Instead of fire-and-forget, queue messages and let the anti-ban
 * system drain them at a safe pace. Failed messages auto-retry.
 */
import { EventEmitter } from 'events';
export interface QueuedMessage {
    id: string;
    recipient: string;
    content: any;
    priority: 'high' | 'normal' | 'low';
    addedAt: number;
    attempts: number;
    maxAttempts: number;
    lastError?: string;
    scheduledFor?: number;
    metadata?: Record<string, any>;
}
export interface MessageQueueConfig {
    /** Max retry attempts per message (default: 3) */
    maxAttempts: number;
    /** Delay between retries in ms, doubles each attempt (default: 30000) */
    retryBaseDelayMs: number;
    /** Max queue size (default: 1000) */
    maxQueueSize: number;
    /** Path to persist queue (optional) */
    persistPath?: string;
    /** Process high priority first (default: true) */
    priorityOrder: boolean;
}
export declare class MessageQueue extends EventEmitter {
    private config;
    private queue;
    private processing;
    private sendFn;
    private drainTimer;
    private idCounter;
    constructor(config?: Partial<MessageQueueConfig>);
    /**
     * Set the send function (called for each message when drained)
     * This should be the anti-ban wrapped sendMessage
     */
    setSendFunction(fn: (recipient: string, content: any) => Promise<void>): void;
    /**
     * Add a message to the queue
     */
    add(recipient: string, content: any, options?: {
        priority?: 'high' | 'normal' | 'low';
        scheduledFor?: Date;
        metadata?: Record<string, any>;
    }): string;
    /**
     * Add multiple messages (e.g., broadcast to many recipients)
     */
    addBulk(recipients: string[], content: any, options?: {
        priority?: 'high' | 'normal' | 'low';
        metadata?: Record<string, any>;
    }): string[];
    /**
     * Start processing the queue
     */
    start(intervalMs?: number): void;
    /**
     * Stop processing
     */
    stop(): void;
    /**
     * Clean up all timers and resources.
     * Call this when disposing of the queue.
     */
    destroy(): void;
    /**
     * Process the next message in the queue
     */
    private processNext;
    /**
     * Get queue stats
     */
    getStats(): {
        total: number;
        pending: number;
        scheduled: number;
        byPriority: {
            high: number;
            normal: number;
            low: number;
        };
        processing: boolean;
        isRunning: boolean;
    };
    /**
     * Clear all messages
     */
    clear(): void;
    /**
     * Remove a specific message
     */
    remove(id: string): boolean;
    /**
     * Export queue for persistence
     */
    export(): QueuedMessage[];
    /**
     * Import queue (e.g., after restart)
     */
    import(messages: QueuedMessage[]): void;
    private sortQueue;
}
