/**
 * JID Circuit Breaker — Per-recipient circuit breaker for send protection
 *
 * Tracks failures per JID and opens circuit after threshold to prevent
 * cascading failures and reduce ban risk on problematic recipients.
 *
 * State machine:
 * - closed: Normal operation, sends allowed
 * - open: Threshold exceeded, sends blocked until cooldown
 * - half-open: Cooldown elapsed, allow one probe send
 *
 * Usage:
 *   const breaker = createJidCircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
 *   if (!breaker.canSend(jid)) throw new Error('circuit open');
 *   // ... send message ...
 *   breaker.recordSuccess(jid);  // or recordFailure(jid)
 */

export interface JidCircuitBreakerConfig {
  failureThreshold?: number; // default 3
  cooldownMs?: number; // default 30_000
  logger?: { warn(msg: string, ctx?: object): void; info(msg: string, ctx?: object): void };
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface JidCircuitBreakerStats {
  open: number;
  halfOpen: number;
  closed: number;
  total: number;
}

type CircuitEntry = {
  state: CircuitState;
  failures: number;
  openedAt: number | null;
  halfOpenProbeUsed: boolean;
};

const EVICTION_AGE_MS = 10 * 60 * 1000; // 10 minutes

export class JidCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly logger?: { warn(msg: string, ctx?: object): void; info(msg: string, ctx?: object): void };
  private readonly circuits = new Map<string, CircuitEntry>();

  constructor(config?: JidCircuitBreakerConfig) {
    this.failureThreshold = config?.failureThreshold ?? 3;
    this.cooldownMs = config?.cooldownMs ?? 30_000;
    this.logger = config?.logger;
  }

  private evictStale(): void {
    const now = Date.now();
    const staleJids: string[] = [];

    this.circuits.forEach((entry, jid) => {
      const age = entry.openedAt ? now - entry.openedAt : Infinity;
      if (age > EVICTION_AGE_MS && entry.state === 'closed') {
        staleJids.push(jid);
      }
    });

    for (const jid of staleJids) {
      this.circuits.delete(jid);
    }
  }

  private getOrCreateEntry(jid: string): CircuitEntry {
    let entry = this.circuits.get(jid);
    if (!entry) {
      entry = {
        state: 'closed',
        failures: 0,
        openedAt: null,
        halfOpenProbeUsed: false,
      };
      this.circuits.set(jid, entry);

      // Evict stale entries periodically
      if (this.circuits.size > 1000) {
        this.evictStale();
      }
    }
    return entry;
  }

  canSend(jid: string): boolean {
    const entry = this.getOrCreateEntry(jid);
    const now = Date.now();

    if (entry.state === 'closed') {
      return true;
    }

    if (entry.state === 'open') {
      // Check if cooldown has elapsed
      if (entry.openedAt && now - entry.openedAt >= this.cooldownMs) {
        // Transition to half-open
        entry.state = 'half-open';
        entry.halfOpenProbeUsed = false;
        this.logger?.info('[circuit-breaker] transitioning to half-open', { jid });
        return true;
      }
      return false;
    }

    if (entry.state === 'half-open') {
      // Allow one probe
      if (!entry.halfOpenProbeUsed) {
        entry.halfOpenProbeUsed = true;
        return true;
      }
      return false;
    }

    return false;
  }

  recordSuccess(jid: string): void {
    const entry = this.getOrCreateEntry(jid);

    if (entry.state === 'half-open') {
      // Probe succeeded, reset to closed
      entry.state = 'closed';
      entry.failures = 0;
      entry.openedAt = null;
      entry.halfOpenProbeUsed = false;
      this.logger?.info('[circuit-breaker] reset to closed after successful probe', { jid });
    } else if (entry.state === 'closed') {
      // Normal operation, reset failure count
      entry.failures = 0;
    }
  }

  recordFailure(jid: string): void {
    const entry = this.getOrCreateEntry(jid);
    const now = Date.now();

    if (entry.state === 'half-open') {
      // Probe failed, reopen circuit
      entry.state = 'open';
      entry.openedAt = now;
      entry.halfOpenProbeUsed = false;
      this.logger?.warn('[circuit-breaker] reopened after failed probe', { jid });
      return;
    }

    if (entry.state === 'closed') {
      entry.failures += 1;
      if (entry.failures >= this.failureThreshold) {
        entry.state = 'open';
        entry.openedAt = now;
        this.logger?.warn('[circuit-breaker] opened circuit', { jid, failures: entry.failures, threshold: this.failureThreshold });
      }
    }
  }

  getState(jid: string): CircuitState {
    const entry = this.circuits.get(jid);
    return entry?.state ?? 'closed';
  }

  getJitter(isBroadcast: boolean): number {
    if (!isBroadcast) return 0;
    return Math.floor(Math.random() * 500) + 400;
  }

  getStats(): JidCircuitBreakerStats {
    let open = 0;
    let halfOpen = 0;
    let closed = 0;

    this.circuits.forEach((entry) => {
      if (entry.state === 'open') open++;
      else if (entry.state === 'half-open') halfOpen++;
      else closed++;
    });

    return {
      open,
      halfOpen,
      closed,
      total: this.circuits.size,
    };
  }

  /**
   * BUG FIX 2: Export all circuit states for persistence
   * Returns array of { jid, state, failures, openedAt, halfOpenProbeUsed }
   */
  exportState(): Array<{ jid: string; state: CircuitState; failures: number; openedAt: number | null; halfOpenProbeUsed: boolean }> {
    const result: Array<{ jid: string; state: CircuitState; failures: number; openedAt: number | null; halfOpenProbeUsed: boolean }> = [];
    this.circuits.forEach((entry, jid) => {
      // Only export circuits that are open or half-open (non-trivial state)
      if (entry.state !== 'closed' || entry.failures > 0) {
        result.push({
          jid,
          state: entry.state,
          failures: entry.failures,
          openedAt: entry.openedAt,
          halfOpenProbeUsed: entry.halfOpenProbeUsed,
        });
      }
    });
    return result;
  }

  /**
   * BUG FIX 2: Import circuit states from persistence
   * Restores open/half-open circuits so blocked JIDs remain blocked after restart
   */
  importState(states: Array<{ jid: string; state: CircuitState; failures: number; openedAt: number | null; halfOpenProbeUsed?: boolean }>): void {
    for (const item of states) {
      this.circuits.set(item.jid, {
        state: item.state,
        failures: item.failures,
        openedAt: item.openedAt,
        halfOpenProbeUsed: item.halfOpenProbeUsed ?? false,
      });
    }
  }
}

export function createJidCircuitBreaker(config?: JidCircuitBreakerConfig): JidCircuitBreaker {
  return new JidCircuitBreaker(config);
}
