/**
 * Read Receipt Timing Variance
 *
 * Extends presence choreography to randomize read-receipt delay.
 * Instant reads = bot signal. Gaussian jitter makes reads feel human.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */

export interface ReadReceiptVarianceConfig {
  /** Mean delay before sending read receipt, ms */
  meanMs?: number;
  /** Standard deviation, ms */
  stdDevMs?: number;
  /** Min clamp, ms */
  minMs?: number;
  /** Max clamp, ms */
  maxMs?: number;
  /** Skip variance for messages older than this (already-read backlog) */
  skipIfOlderThanMs?: number;
}

export interface ReadReceiptVariance {
  /** Wrap a sock — call sock.readMessages internally with jittered delay */
  wrap<T extends { readMessages: Function }>(sock: T): T;
  /** Manually compute jittered delay (for users wiring their own receipt logic) */
  delayMs(): number;
  /** Stop pending timers */
  stop(): void;
}

/**
 * Box-Muller transform for Gaussian random samples
 * Returns a value from normal distribution (mean=0, stdDev=1)
 */
function gaussianRandom(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random(); // Avoid log(0)
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function readReceiptVariance(
  config: ReadReceiptVarianceConfig = {}
): ReadReceiptVariance {
  const {
    meanMs = 1500,
    stdDevMs = 800,
    minMs = 200,
    maxMs = 8000,
    skipIfOlderThanMs = 60_000,
  } = config;

  const pendingTimers = new Set<NodeJS.Timeout>();

  function delayMs(): number {
    // Generate Gaussian sample and scale to configured mean/stdDev
    const gaussian = gaussianRandom();
    const value = meanMs + gaussian * stdDevMs;

    // Clamp to min/max
    return Math.max(minMs, Math.min(maxMs, value));
  }

  function wrap<T extends { readMessages: Function }>(sock: T): T {
    const originalReadMessages = sock.readMessages.bind(sock);

    // Proxy the readMessages method
    const wrappedReadMessages = async (keys: any[]) => {
      // Check if messages are too old (backlog)
      const now = Date.now();
      const oldMessages = keys.every((key: any) => {
        if (!key.messageTimestamp) return false;
        const msgTime =
          typeof key.messageTimestamp === 'number'
            ? key.messageTimestamp * 1000 // Baileys uses seconds
            : parseInt(key.messageTimestamp, 10) * 1000;
        return now - msgTime > skipIfOlderThanMs;
      });

      if (oldMessages) {
        // Skip delay for backlog messages
        return originalReadMessages(keys);
      }

      // Apply jittered delay
      const delay = delayMs();

      return new Promise((resolve, reject) => {
        const timer = setTimeout(async () => {
          pendingTimers.delete(timer);
          try {
            const result = await originalReadMessages(keys);
            resolve(result);
          } catch (err) {
            reject(err);
          }
        }, delay);

        pendingTimers.add(timer);
      });
    };

    // Return proxy with wrapped readMessages
    return new Proxy(sock, {
      get(target, prop) {
        if (prop === 'readMessages') {
          return wrappedReadMessages;
        }
        return (target as any)[prop];
      },
    });
  }

  function stop(): void {
    for (const timer of pendingTimers) {
      clearTimeout(timer);
    }
    pendingTimers.clear();
  }

  return {
    wrap,
    delayMs,
    stop,
  };
}
