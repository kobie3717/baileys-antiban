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
  content: any; // Baileys message content
  priority: 'high' | 'normal' | 'low';
  addedAt: number;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  scheduledFor?: number; // Send after this timestamp
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

const DEFAULT_CONFIG: MessageQueueConfig = {
  maxAttempts: 3,
  retryBaseDelayMs: 30000,
  maxQueueSize: 1000,
  priorityOrder: true,
};

export class MessageQueue extends EventEmitter {
  private config: MessageQueueConfig;
  private queue: QueuedMessage[] = [];
  private processing = false;
  private sendFn: ((recipient: string, content: any) => Promise<void>) | null = null;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private idCounter = 0;

  constructor(config: Partial<MessageQueueConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the send function (called for each message when drained)
   * This should be the anti-ban wrapped sendMessage
   */
  setSendFunction(fn: (recipient: string, content: any) => Promise<void>): void {
    this.sendFn = fn;
  }

  /**
   * Add a message to the queue
   */
  add(recipient: string, content: any, options?: {
    priority?: 'high' | 'normal' | 'low';
    scheduledFor?: Date;
    metadata?: Record<string, any>;
  }): string {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Queue full (${this.config.maxQueueSize} messages)`);
    }

    const id = `msg_${Date.now()}_${++this.idCounter}`;
    const message: QueuedMessage = {
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
  addBulk(recipients: string[], content: any, options?: {
    priority?: 'high' | 'normal' | 'low';
    metadata?: Record<string, any>;
  }): string[] {
    return recipients.map(r => this.add(r, content, options));
  }

  /**
   * Start processing the queue
   */
  start(intervalMs = 1000): void {
    if (this.drainTimer) return;
    this.drainTimer = setInterval(() => this.processNext(), intervalMs);
    this.emit('started');
  }

  /**
   * Stop processing
   */
  stop(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    this.emit('stopped');
  }

  /**
   * Process the next message in the queue
   */
  private async processNext(): Promise<void> {
    if (this.processing || !this.sendFn) return;
    
    const now = Date.now();
    const message = this.queue.find(m => 
      (!m.scheduledFor || m.scheduledFor <= now)
    );
    
    if (!message) return;

    this.processing = true;

    try {
      message.attempts++;
      await this.sendFn(message.recipient, message.content);
      
      // Success — remove from queue
      this.queue = this.queue.filter(m => m.id !== message.id);
      this.emit('sent', message);
    } catch (err: any) {
      message.lastError = err.message;

      if (err.message?.includes('baileys-antiban')) {
        // Anti-ban blocked it — don't count as attempt, try later
        message.attempts--;
        this.emit('delayed', message, err.message);
      } else if (message.attempts >= message.maxAttempts) {
        // Max retries reached — move to dead letter
        this.queue = this.queue.filter(m => m.id !== message.id);
        this.emit('failed', message, err.message);
      } else {
        // Schedule retry with exponential backoff
        const backoff = this.config.retryBaseDelayMs * Math.pow(2, message.attempts - 1);
        message.scheduledFor = Date.now() + backoff;
        this.emit('retry', message, message.attempts, backoff);
      }
    } finally {
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
  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    this.emit('cleared', count);
  }

  /**
   * Remove a specific message
   */
  remove(id: string): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter(m => m.id !== id);
    return this.queue.length < before;
  }

  /**
   * Export queue for persistence
   */
  export(): QueuedMessage[] {
    return [...this.queue];
  }

  /**
   * Import queue (e.g., after restart)
   */
  import(messages: QueuedMessage[]): void {
    this.queue = [...messages];
    this.sortQueue();
  }

  private sortQueue(): void {
    if (!this.config.priorityOrder) return;
    const priorityWeight = { high: 0, normal: 1, low: 2 };
    this.queue.sort((a, b) => {
      const pDiff = priorityWeight[a.priority] - priorityWeight[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.addedAt - b.addedAt; // FIFO within same priority
    });
  }
}
