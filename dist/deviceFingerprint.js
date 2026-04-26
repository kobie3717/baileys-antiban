/**
 * Device Fingerprint Randomization
 *
 * Randomizes appVersion, osVersion, and deviceModel to prevent Meta's
 * clientPayload fingerprinting. Addresses the #1 gap in anti-ban coverage.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
// Default pools - real-world values observed in the wild
const DEFAULT_APP_VERSION_POOL = [
    [2, 24, 5, 18],
    [2, 24, 5, 17],
    [2, 24, 4, 77],
    [2, 24, 5, 15],
    [2, 24, 3, 91],
    [2, 24, 5, 20],
];
const DEFAULT_OS_VERSION_POOL = ['10', '11', '12', '13', '14'];
const DEFAULT_DEVICE_MODEL_POOL = [
    'Pixel 6',
    'Pixel 7',
    'Galaxy S22',
    'Galaxy S23',
    'Xiaomi 13',
    'Xiaomi 12',
    'OnePlus 11',
    'Moto G84',
    'Moto G54',
    'Realme 11',
    'Vivo V29',
    'Oppo Find X6',
];
/**
 * Simple deterministic PRNG using mulberry32
 * Seeded from string hash for consistent results per session
 */
class SeededRandom {
    state;
    constructor(seed) {
        // Hash string to 32-bit seed
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = (hash << 5) - hash + seed.charCodeAt(i);
            hash = hash & hash; // Convert to 32-bit int
        }
        this.state = Math.abs(hash) || 1;
    }
    next() {
        let t = (this.state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    pick(array) {
        return array[Math.floor(this.next() * array.length)];
    }
}
/**
 * Generate a randomized fingerprint for one session.
 * Stable for the same sessionId — call once per socket init.
 */
export function generateFingerprint(config = {}, sessionId) {
    const { enabled = true, randomizeAppVersion = true, randomizeOsVersion = true, randomizeDeviceModel = true, seed, appVersionPool = DEFAULT_APP_VERSION_POOL, osVersionPool = DEFAULT_OS_VERSION_POOL, deviceModelPool = DEFAULT_DEVICE_MODEL_POOL, } = config;
    const finalSessionId = sessionId || `session-${Date.now()}-${Math.random()}`;
    const rng = new SeededRandom(seed || finalSessionId);
    // Pick random values if enabled, otherwise use first pool item
    const appVersion = enabled && randomizeAppVersion
        ? rng.pick(appVersionPool)
        : appVersionPool[0];
    const osVersion = enabled && randomizeOsVersion ? rng.pick(osVersionPool) : osVersionPool[0];
    const deviceModel = enabled && randomizeDeviceModel
        ? rng.pick(deviceModelPool)
        : deviceModelPool[0];
    return {
        appVersion: [...appVersion], // Copy to avoid mutation
        osVersion,
        deviceModel,
        sessionId: finalSessionId,
    };
}
/**
 * Apply fingerprint to a Baileys SocketConfig before makeWASocket().
 *
 * Example:
 *   const fp = generateFingerprint({});
 *   const sock = makeWASocket(applyFingerprint(socketConfig, fp));
 */
export function applyFingerprint(socketConfig, fp) {
    // Create defensive copy
    const config = { ...socketConfig };
    // Apply version if field exists
    if (config.version !== undefined || 'version' in config || true) {
        config.version = fp.appVersion;
    }
    // Apply browser tuple if field exists
    // Baileys browser format: [deviceName, osVersion, appVersion]
    if (config.browser !== undefined || 'browser' in config || true) {
        config.browser = [
            fp.deviceModel,
            fp.osVersion,
            `WhatsApp/${fp.appVersion.join('.')}`,
        ];
    }
    return config;
}
