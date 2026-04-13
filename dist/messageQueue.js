/**
 * Persistent Message Queue — Messages survive crashes and restarts
 *
 * Instead of fire-and-forget, queue messages and let the anti-ban
 * system drain them at a safe pace. Failed messages auto-retry.
 */
import { EventEmitter } from 'events';
const DEFAULT_CONFIG = {
    maxAttempts: 3,
    retryBaseDelayMs: 30000,
    maxQueueSize: 1000,
    priorityOrder: true,
};
export class MessageQueue extends EventEmitter {
    config;
    queue = [];
    processing = false;
    sendFn = null;
    drainTimer = null;
    idCounter = 0;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Set the send function (called for each message when drained)
     * This should be the anti-ban wrapped sendMessage
     */
    setSendFunction(fn) {
        this.sendFn = fn;
    }
    /**
     * Add a message to the queue
     */
    add(recipient, content, options) {
        if (this.queue.length >= this.config.maxQueueSize) {
            throw new Error(`Queue full (${this.config.maxQueueSize} messages)`);
        }
        const id = `msg_${Date.now()}_${++this.idCounter}`;
        const message = {
            id,
            recipient,
            content,
            priority: options?.priority || 'normal',
            addedAt: Date.now(),
            attempts: 0,
            maxAttempts: this.config.maxAttempts,
            scheduledFor: options?.scheduledFor?.getTime(),
            metadata: options?.metadata,
        };
        this.queue.push(message);
        this.sortQueue();
        this.emit('added', message);
        return id;
    }
    /**
     * Add multiple messages (e.g., broadcast to many recipients)
     */
    addBulk(recipients, content, options) {
        return recipients.map(r => this.add(r, content, options));
    }
    /**
     * Start processing the queue
     */
    start(intervalMs = 1000) {
        if (this.drainTimer)
            return;
        this.drainTimer = setInterval(() => this.processNext(), intervalMs);
        this.emit('started');
    }
    /**
     * Stop processing
     */
    stop() {
        if (this.drainTimer) {
            clearInterval(this.drainTimer);
            this.drainTimer = null;
        }
        this.emit('stopped');
    }
    /**
     * Clean up all timers and resources.
     * Call this when disposing of the queue.
     */
    destroy() {
        this.stop();
    }
    /**
     * Process the next message in the queue
     */
    async processNext() {
        if (this.processing || !this.sendFn)
            return;
        const now = Date.now();
        const message = this.queue.find(m => (!m.scheduledFor || m.scheduledFor <= now));
        if (!message)
            return;
        this.processing = true;
        try {
            message.attempts++;
            await this.sendFn(message.recipient, message.content);
            // Success — remove from queue
            this.queue = this.queue.filter(m => m.id !== message.id);
            this.emit('sent', message);
        }
        catch (err) {
            message.lastError = err.message;
            if (err.message?.includes('baileys-antiban')) {
                // Anti-ban blocked it — don't count as attempt, try later
                message.attempts--;
                this.emit('delayed', message, err.message);
            }
            else if (message.attempts >= message.maxAttempts) {
                // Max retries reached — move to dead letter
                this.queue = this.queue.filter(m => m.id !== message.id);
                this.emit('failed', message, err.message);
            }
            else {
                // Schedule retry with exponential backoff
                const backoff = this.config.retryBaseDelayMs * Math.pow(2, message.attempts - 1);
                message.scheduledFor = Date.now() + backoff;
                this.emit('retry', message, message.attempts, backoff);
            }
        }
        finally {
            this.processing = false;
        }
    }
    /**
     * Get queue stats
     */
    getStats() {
        const now = Date.now();
        return {
            total: this.queue.length,
            pending: this.queue.filter(m => !m.scheduledFor || m.scheduledFor <= now).length,
            scheduled: this.queue.filter(m => m.scheduledFor && m.scheduledFor > now).length,
            byPriority: {
                high: this.queue.filter(m => m.priority === 'high').length,
                normal: this.queue.filter(m => m.priority === 'normal').length,
                low: this.queue.filter(m => m.priority === 'low').length,
            },
            processing: this.processing,
            isRunning: this.drainTimer !== null,
        };
    }
    /**
     * Clear all messages
     */
    clear() {
        const count = this.queue.length;
        this.queue = [];
        this.emit('cleared', count);
    }
    /**
     * Remove a specific message
     */
    remove(id) {
        const before = this.queue.length;
        this.queue = this.queue.filter(m => m.id !== id);
        return this.queue.length < before;
    }
    /**
     * Export queue for persistence
     */
    export() {
        return [...this.queue];
    }
    /**
     * Import queue (e.g., after restart)
     */
    import(messages) {
        this.queue = [...messages];
        this.sortQueue();
    }
    sortQueue() {
        if (!this.config.priorityOrder)
            return;
        const priorityWeight = { high: 0, normal: 1, low: 2 };
        this.queue.sort((a, b) => {
            const pDiff = priorityWeight[a.priority] - priorityWeight[b.priority];
            if (pDiff !== 0)
                return pDiff;
            return a.addedAt - b.addedAt; // FIFO within same priority
        });
    }
}
