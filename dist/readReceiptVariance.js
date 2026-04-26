/**
 * Read Receipt Timing Variance
 *
 * Extends presence choreography to randomize read-receipt delay.
 * Instant reads = bot signal. Gaussian jitter makes reads feel human.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
/**
 * Box-Muller transform for Gaussian random samples
 * Returns a value from normal distribution (mean=0, stdDev=1)
 */
function gaussianRandom() {
    let u = 0;
    let v = 0;
    while (u === 0)
        u = Math.random(); // Avoid log(0)
    while (v === 0)
        v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
export function readReceiptVariance(config = {}) {
    const { meanMs = 1500, stdDevMs = 800, minMs = 200, maxMs = 8000, skipIfOlderThanMs = 60_000, } = config;
    const pendingTimers = new Set();
    function delayMs() {
        // Generate Gaussian sample and scale to configured mean/stdDev
        const gaussian = gaussianRandom();
        const value = meanMs + gaussian * stdDevMs;
        // Clamp to min/max
        return Math.max(minMs, Math.min(maxMs, value));
    }
    function wrap(sock) {
        const originalReadMessages = sock.readMessages.bind(sock);
        // Proxy the readMessages method
        const wrappedReadMessages = async (keys) => {
            // Check if messages are too old (backlog)
            const now = Date.now();
            const oldMessages = keys.every((key) => {
                if (!key.messageTimestamp)
                    return false;
                const msgTime = typeof key.messageTimestamp === 'number'
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
                    }
                    catch (err) {
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
                return target[prop];
            },
        });
    }
    function stop() {
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
