/**
 * Stealth Connect — Gradual presence ramp to reduce ban signals
 *
 * Inspired by GOWA's --presence-on-connect=unavailable flag. Bots that
 * instantly snap online and start blasting messages look suspicious.
 * This helper connects without advertising "online" presence, then
 * gradually ramps to "available" after a randomized delay.
 *
 * Usage:
 *   const config = getStealthSocketConfig({ os: 'My Custom App' });
 *   const sock = makeWASocket({ ...config, ...otherOptions });
 *   await rampPresenceAfterConnect(sock, { minDelayMs: 45000, maxDelayMs: 120000 });
 */
/**
 * Returns socket configuration for stealth connect.
 * Sets markOnlineOnConnect=false and provides sensible browser defaults.
 *
 * @param opts.os - Optional custom OS name for device fingerprint (default: 'Baileys')
 * @returns Partial socket config to merge into makeWASocket options
 */
export function getStealthSocketConfig(opts) {
    return {
        markOnlineOnConnect: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        ...(opts?.os && { defaultQueryTimeoutMs: undefined }), // placeholder — actual os field lives in auth
    };
}
/**
 * Ramps presence from unavailable to available after a randomized delay.
 * Call this after socket connects. Returns a promise that resolves once
 * presence is set. Can be awaited or fire-and-forget.
 *
 * @param sock - Baileys socket instance (must have sendPresenceUpdate method)
 * @param opts.minDelayMs - Minimum delay in ms (default: 30000 = 30s)
 * @param opts.maxDelayMs - Maximum delay in ms (default: 90000 = 90s)
 * @param opts.targetState - Presence state to set after delay (default: 'available')
 * @returns Promise that resolves when presence is updated
 */
export async function rampPresenceAfterConnect(sock, opts) {
    const minDelayMs = opts?.minDelayMs ?? 30000;
    const maxDelayMs = opts?.maxDelayMs ?? 90000;
    const targetState = opts?.targetState ?? 'available';
    // Random delay in [minDelayMs, maxDelayMs]
    const delayMs = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    // Send presence update (undefined = broadcast to all conversations)
    await sock.sendPresenceUpdate(targetState, undefined);
}
