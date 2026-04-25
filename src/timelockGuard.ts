/**
 * Timelock Guard — Manages reachout timelock state and routing decisions
 *
 * When WhatsApp timelocks an account (463 error), this guard:
 * - Tracks the timelock state (active, expiry, enforcement type)
 * - Blocks messages to NEW contacts (no tctoken / no prior chat)
 * - Allows messages to EXISTING contacts (have tctoken / prior chat history)
 * - Auto-resumes when the timelock expires
 * - Fires callbacks for alerting (Telegram/Discord/webhook)
 */

export interface TimelockState {
  isActive: boolean;
  enforcementType?: string;
  expiresAt?: Date;
  detectedAt?: Date;
  /** Number of 463 errors seen in current lock period */
  errorCount: number;
}

export interface TimelockGuardConfig {
  /** Callback when timelock is detected */
  onTimelockDetected?: (state: TimelockState) => void;
  /** Callback when timelock expires/lifts */
  onTimelockLifted?: (state: TimelockState) => void;
  /** Extra safety buffer after expiry before resuming (default: 10000ms / 10s) */
  resumeBufferMs: number;
}

const DEFAULT_CONFIG: TimelockGuardConfig = {
  resumeBufferMs: 10_000,
};

export class TimelockGuard {
  private config: TimelockGuardConfig;
  private state: TimelockState = {
    isActive: false,
    errorCount: 0,
  };
  private knownChats: Set<string> = new Set();
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private timerGeneration = 0; // BUG FIX 4: Track timer validity to prevent race conditions

  constructor(config: Partial<TimelockGuardConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update timelock state from Baileys connection.update event
   */
  onTimelockUpdate(data: {
    isActive?: boolean;
    timeEnforcementEnds?: Date;
    enforcementType?: string;
  }): void {
    const wasActive = this.state.isActive;

    this.state.isActive = !!data.isActive;
    this.state.enforcementType = data.enforcementType;
    this.state.expiresAt = data.timeEnforcementEnds;

    if (this.state.isActive && !wasActive) {
      this.state.detectedAt = new Date();
      this.state.errorCount = 0;
      this.config.onTimelockDetected?.(this.getState());
      this.scheduleResume();
    } else if (this.state.isActive && wasActive) {
      // Already locked but expiry updated — reschedule timer with new expiry
      this.scheduleResume();
    }

    if (!this.state.isActive && wasActive) {
      this.clearResumeTimer();
      this.config.onTimelockLifted?.(this.getState());
    }
  }

  /**
   * Record a 463 error from a failed send
   */
  record463Error(): void {
    this.state.errorCount++;
    if (!this.state.isActive) {
      // First 463 before MEX query returns — assume locked for 60s
      this.state.isActive = true;
      this.state.detectedAt = new Date();
      this.state.expiresAt = new Date(Date.now() + 60_000);
      this.config.onTimelockDetected?.(this.getState());
      this.scheduleResume();
    }
  }

  /**
   * Register a JID as a known/existing chat (has tctoken / prior history)
   */
  registerKnownChat(jid: string): void {
    this.knownChats.add(jid);
  }

  /**
   * Register multiple known chats at once (e.g. from chat list on connect)
   */
  registerKnownChats(jids: string[]): void {
    for (const jid of jids) {
      this.knownChats.add(jid);
    }
  }

  /**
   * Check if a message to this recipient should be allowed
   */
  canSend(jid: string): { allowed: boolean; reason?: string } {
    if (!this.state.isActive) {
      return { allowed: true };
    }

    // Check if expiry has passed (with buffer)
    if (this.state.expiresAt) {
      const expiryWithBuffer = this.state.expiresAt.getTime() + this.config.resumeBufferMs;
      if (Date.now() >= expiryWithBuffer) {
        this.lift();
        return { allowed: true };
      }
    }

    // Groups always flow (tctokens not required for group msgs)
    if (jid.endsWith('@g.us') || jid.endsWith('@newsletter')) {
      return { allowed: true };
    }

    // Known chats (have tctoken) can proceed
    if (this.knownChats.has(jid)) {
      return { allowed: true };
    }

    // New contact while timelocked — block
    const expiresIn = this.state.expiresAt
      ? Math.max(0, this.state.expiresAt.getTime() - Date.now())
      : 60_000;

    return {
      allowed: false,
      reason: `Reachout timelocked (${this.state.enforcementType || 'unknown'}). `
        + `New contacts blocked. Expires in ${Math.ceil(expiresIn / 1000)}s.`,
    };
  }

  /**
   * Get current timelock state
   */
  getState(): TimelockState {
    return { ...this.state };
  }

  /**
   * Check if currently timelocked
   */
  isTimelocked(): boolean {
    if (!this.state.isActive) return false;

    // Auto-lift if expired
    if (this.state.expiresAt) {
      const expiryWithBuffer = this.state.expiresAt.getTime() + this.config.resumeBufferMs;
      if (Date.now() >= expiryWithBuffer) {
        this.lift();
        return false;
      }
    }

    return true;
  }

  /**
   * Get the set of known chat JIDs
   */
  getKnownChats(): Set<string> {
    return new Set(this.knownChats);
  }

  /**
   * Manually lift the timelock
   */
  lift(): void {
    if (this.state.isActive) {
      this.state.isActive = false;
      this.clearResumeTimer();
      this.config.onTimelockLifted?.(this.getState());
    }
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.state = { isActive: false, errorCount: 0 };
    this.knownChats.clear();
    this.clearResumeTimer();
  }

  private scheduleResume(): void {
    this.clearResumeTimer();
    if (this.state.expiresAt) {
      const delay = this.state.expiresAt.getTime() - Date.now() + this.config.resumeBufferMs;
      if (delay > 0) {
        // BUG FIX 4: Increment generation to invalidate any pending timers
        this.timerGeneration++;
        const currentGeneration = this.timerGeneration;

        this.resumeTimer = setTimeout(() => {
          // Only lift if this timer is still valid (not superseded by a newer scheduleResume call)
          if (currentGeneration === this.timerGeneration) {
            this.lift();
          }
        }, delay);
      }
    }
  }

  private clearResumeTimer(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
      // Increment generation to invalidate any pending timer callbacks
      this.timerGeneration++;
    }
  }
}
