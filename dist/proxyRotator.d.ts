/**
 * Proxy Rotation — Native proxy injection for Baileys with health tracking
 *
 * WhatsApp's ban detection includes IP reputation scoring. Datacenter IPs (VPS)
 * are flagged, while residential/4G proxies stay alive. No Baileys library handles
 * native proxy injection — every implementation is DIY hacks. We close that gap.
 *
 * Features:
 * - Multi-strategy rotation (round-robin, random, LRU, weighted)
 * - Auto-failover on endpoint failure
 * - Scheduled rotation for proactive IP rotation
 * - Cooldown periods between endpoint reuse
 * - Health tracking and auto-resurrection
 * - Lazy-loaded proxy agent dependencies (optional peerDeps)
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
import type { Agent } from 'node:http';
export interface ProxyEndpoint {
    type: 'socks5' | 'socks5h' | 'http' | 'https';
    host: string;
    port: number;
    username?: string;
    password?: string;
    /** Optional health label — humans use this in logs */
    label?: string;
    /** Cooldown after last use, in ms (default: 0) */
    cooldownMs?: number;
}
export interface ProxyRotatorConfig {
    /** Pool of proxy endpoints. Required. */
    pool: ProxyEndpoint[];
    /** Strategy for picking next proxy (default: 'round-robin') */
    strategy?: 'round-robin' | 'random' | 'least-recently-used' | 'weighted';
    /** Auto-rotate on these triggers (default: ['disconnect', 'ban-warning']) */
    rotateOn?: Array<'disconnect' | 'ban-warning' | 'scheduled' | 'manual'>;
    /** Scheduled rotation interval in ms (only if rotateOn includes 'scheduled') */
    scheduledIntervalMs?: number;
    /** Max consecutive failures before marking endpoint dead (default: 3) */
    maxFailures?: number;
    /** How long a "dead" endpoint stays out of rotation (default: 600_000 = 10min) */
    deadCooldownMs?: number;
    /** Logger */
    logger?: {
        info?: Function;
        warn?: Function;
        error?: Function;
    };
}
export interface ProxyRotatorStats {
    totalRotations: number;
    rotationsByTrigger: Record<string, number>;
    endpointHealth: Array<{
        label: string;
        inUse: boolean;
        failures: number;
        lastUsedAt: Date | null;
        isDead: boolean;
    }>;
    currentEndpoint: string | null;
}
export interface ProxyRotatorHandle {
    /** Get an Agent for the current endpoint. Use this in fetchOptions.agent or makeWASocket's options.agent */
    currentAgent(): Agent | null;
    /** Get the current endpoint's metadata */
    current(): ProxyEndpoint | null;
    /** Force rotate to next endpoint. Reason logged in stats. */
    rotate(reason?: 'manual' | 'disconnect' | 'ban-warning' | 'scheduled'): ProxyEndpoint | null;
    /** Mark current endpoint as failed (increments failure counter, may auto-rotate) */
    markFailure(): void;
    /** Clear all dead-flags (e.g. for cooldown override) */
    resurrectAll(): void;
    /** Stop scheduled rotation timer + dispose */
    stop(): void;
    /** Stats */
    getStats(): ProxyRotatorStats;
}
export declare function proxyRotator(config: ProxyRotatorConfig): ProxyRotatorHandle;
