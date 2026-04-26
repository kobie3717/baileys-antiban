/**
 * Device Fingerprint Randomization
 *
 * Randomizes appVersion, osVersion, and deviceModel to prevent Meta's
 * clientPayload fingerprinting. Addresses the #1 gap in anti-ban coverage.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
export interface DeviceFingerprintConfig {
    /** Master switch */
    enabled?: boolean;
    /** Vary appVersion patch number within safe range */
    randomizeAppVersion?: boolean;
    /** Vary osVersion (Android build string) */
    randomizeOsVersion?: boolean;
    /** Pick random deviceModel from real-world device pool */
    randomizeDeviceModel?: boolean;
    /** Optional seed for deterministic randomization (testing) */
    seed?: string;
    /** User-supplied override pools */
    appVersionPool?: number[][];
    osVersionPool?: string[];
    deviceModelPool?: string[];
}
export interface DeviceFingerprint {
    appVersion: number[];
    osVersion: string;
    deviceModel: string;
    /** Stable across same session, different per session-id */
    sessionId: string;
}
/**
 * Generate a randomized fingerprint for one session.
 * Stable for the same sessionId — call once per socket init.
 */
export declare function generateFingerprint(config?: DeviceFingerprintConfig, sessionId?: string): DeviceFingerprint;
/**
 * Apply fingerprint to a Baileys SocketConfig before makeWASocket().
 *
 * Example:
 *   const fp = generateFingerprint({});
 *   const sock = makeWASocket(applyFingerprint(socketConfig, fp));
 */
export declare function applyFingerprint(socketConfig: any, fp: DeviceFingerprint): any;
