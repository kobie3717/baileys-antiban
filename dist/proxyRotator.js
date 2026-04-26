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
import { createRequire } from 'node:module';
// Create require for optional peer dependency loading in ESM
const require = createRequire(import.meta.url);
const NoopLogger = {
    info: () => { },
    warn: () => { },
    error: () => { },
};
export function proxyRotator(config) {
    const { pool, strategy = 'round-robin', rotateOn = ['disconnect', 'ban-warning'], scheduledIntervalMs = 0, maxFailures = 3, deadCooldownMs = 600_000, // 10 minutes
    logger = NoopLogger, } = config;
    if (!pool || pool.length === 0) {
        throw new Error('proxyRotator: pool cannot be empty');
    }
    // Warn once for pool size 1
    if (pool.length === 1) {
        logger.warn?.('proxyRotator: pool size is 1. Rotation is a no-op.');
    }
    // Warn for aggressive scheduled rotation
    if (scheduledIntervalMs > 0 && scheduledIntervalMs < 60_000) {
        logger.warn?.(`proxyRotator: scheduledIntervalMs (${scheduledIntervalMs}ms) is < 60s. May hammer proxy provider.`);
    }
    // Internal state
    const states = pool.map((endpoint) => ({
        endpoint,
        failures: 0,
        lastUsedAt: null,
        isDead: false,
    }));
    let currentIndex = 0;
    let totalRotations = 0;
    const rotationsByTrigger = {};
    let scheduledTimer = null;
    // Agent cache: map endpoint -> Agent (cleared on rotation)
    const agentCache = new Map();
    // Module cache for lazy-loaded proxy agents
    const moduleCache = {};
    function buildProxyUrl(endpoint) {
        const { type, host, port, username, password } = endpoint;
        const auth = username && password ? `${username}:${password}@` : '';
        return `${type}://${auth}${host}:${port}`;
    }
    function createAgentForEndpointSync(endpoint) {
        // Check cache first
        if (agentCache.has(endpoint)) {
            return agentCache.get(endpoint);
        }
        const url = buildProxyUrl(endpoint);
        let agent = null;
        try {
            if (endpoint.type === 'socks5' || endpoint.type === 'socks5h') {
                if (!moduleCache['socks-proxy-agent']) {
                    try {
                        moduleCache['socks-proxy-agent'] = require('socks-proxy-agent');
                    }
                    catch {
                        logger.error?.('socks-proxy-agent not installed. Run: npm install socks-proxy-agent');
                        return null;
                    }
                }
                agent = new moduleCache['socks-proxy-agent'].SocksProxyAgent(url);
            }
            else if (endpoint.type === 'http') {
                if (!moduleCache['http-proxy-agent']) {
                    try {
                        moduleCache['http-proxy-agent'] = require('http-proxy-agent');
                    }
                    catch {
                        logger.error?.('http-proxy-agent not installed. Run: npm install http-proxy-agent');
                        return null;
                    }
                }
                agent = new moduleCache['http-proxy-agent'].HttpProxyAgent(url);
            }
            else if (endpoint.type === 'https') {
                if (!moduleCache['https-proxy-agent']) {
                    try {
                        moduleCache['https-proxy-agent'] = require('https-proxy-agent');
                    }
                    catch {
                        logger.error?.('https-proxy-agent not installed. Run: npm install https-proxy-agent');
                        return null;
                    }
                }
                agent = new moduleCache['https-proxy-agent'].HttpsProxyAgent(url);
            }
            else {
                logger.error?.(`Unknown proxy type: ${endpoint.type}`);
                return null;
            }
            // Cache the agent
            if (agent) {
                agentCache.set(endpoint, agent);
            }
            return agent;
        }
        catch (err) {
            logger.error?.(`Failed to create agent for ${endpoint.label || endpoint.host}: ${err}`);
            return null;
        }
    }
    function getAliveEndpoints() {
        const now = Date.now();
        return states
            .map((s, idx) => {
            // Dead check with auto-resurrection
            if (s.isDead && s.lastUsedAt) {
                if (now - s.lastUsedAt.getTime() >= deadCooldownMs) {
                    s.isDead = false;
                    s.failures = 0;
                    logger.info?.(`Resurrected endpoint ${s.endpoint.label || s.endpoint.host} after cooldown`);
                }
            }
            // Cooldown check
            const cooldown = s.endpoint.cooldownMs || 0;
            if (cooldown > 0 && s.lastUsedAt) {
                if (now - s.lastUsedAt.getTime() < cooldown) {
                    return -1; // Still in cooldown
                }
            }
            return !s.isDead ? idx : -1;
        })
            .filter((idx) => idx !== -1);
    }
    function selectNextIndex(alive) {
        if (alive.length === 0)
            return currentIndex; // All dead, stay on current
        if (strategy === 'round-robin') {
            // Pick next after currentIndex in circular fashion
            const afterCurrent = alive.filter((idx) => idx > currentIndex);
            if (afterCurrent.length > 0)
                return afterCurrent[0];
            return alive[0]; // Wrap around
        }
        if (strategy === 'random') {
            return alive[Math.floor(Math.random() * alive.length)];
        }
        if (strategy === 'least-recently-used') {
            // Pick the one with oldest lastUsedAt (never-used = highest priority)
            const neverUsed = alive.filter((idx) => states[idx].lastUsedAt === null);
            if (neverUsed.length > 0) {
                return neverUsed[0];
            }
            let oldestIdx = alive[0];
            let oldestTime = states[oldestIdx].lastUsedAt.getTime();
            for (const idx of alive) {
                const time = states[idx].lastUsedAt.getTime();
                if (time < oldestTime) {
                    oldestTime = time;
                    oldestIdx = idx;
                }
            }
            return oldestIdx;
        }
        if (strategy === 'weighted') {
            // Weighted by inverse failure count (healthier = more likely)
            const weights = alive.map((idx) => {
                const failures = states[idx].failures;
                return 1 / (failures + 1); // Avoid divide-by-zero
            });
            const totalWeight = weights.reduce((a, b) => a + b, 0);
            let rand = Math.random() * totalWeight;
            for (let i = 0; i < alive.length; i++) {
                rand -= weights[i];
                if (rand <= 0)
                    return alive[i];
            }
            return alive[alive.length - 1]; // Fallback
        }
        return alive[0]; // Default fallback
    }
    function rotateImpl(reason = 'manual') {
        if (pool.length === 1) {
            // No-op for single endpoint
            return states[0].endpoint;
        }
        const alive = getAliveEndpoints();
        if (alive.length === 0) {
            logger.warn?.('All endpoints are dead. Cannot rotate.');
            return states[currentIndex].endpoint;
        }
        const nextIdx = selectNextIndex(alive);
        if (nextIdx === currentIndex && alive.length > 1) {
            // Try to pick a different one if possible
            const others = alive.filter((idx) => idx !== currentIndex);
            if (others.length > 0) {
                currentIndex = others[0];
            }
            else {
                currentIndex = nextIdx;
            }
        }
        else {
            currentIndex = nextIdx;
        }
        states[currentIndex].lastUsedAt = new Date();
        totalRotations++;
        rotationsByTrigger[reason] = (rotationsByTrigger[reason] || 0) + 1;
        const label = states[currentIndex].endpoint.label || states[currentIndex].endpoint.host;
        logger.info?.(`Rotated to endpoint ${label} (reason: ${reason})`);
        return states[currentIndex].endpoint;
    }
    function markFailureImpl() {
        const state = states[currentIndex];
        state.failures++;
        const label = state.endpoint.label || state.endpoint.host;
        logger.warn?.(`Endpoint ${label} failed (${state.failures}/${maxFailures})`);
        if (state.failures >= maxFailures) {
            state.isDead = true;
            logger.error?.(`Endpoint ${label} marked DEAD after ${maxFailures} failures`);
            // Auto-rotate to next alive endpoint
            const alive = getAliveEndpoints();
            if (alive.length > 0) {
                rotateImpl('manual'); // Trigger rotation as recovery
            }
        }
    }
    function resurrectAllImpl() {
        let count = 0;
        for (const state of states) {
            if (state.isDead) {
                state.isDead = false;
                state.failures = 0;
                count++;
            }
        }
        if (count > 0) {
            logger.info?.(`Resurrected ${count} dead endpoint(s)`);
        }
    }
    function stopImpl() {
        if (scheduledTimer) {
            clearInterval(scheduledTimer);
            scheduledTimer = null;
            logger.info?.('Stopped scheduled rotation timer');
        }
    }
    function getStatsImpl() {
        return {
            totalRotations,
            rotationsByTrigger: { ...rotationsByTrigger },
            endpointHealth: states.map((s) => ({
                label: s.endpoint.label || s.endpoint.host,
                inUse: states[currentIndex] === s,
                failures: s.failures,
                lastUsedAt: s.lastUsedAt,
                isDead: s.isDead,
            })),
            currentEndpoint: states[currentIndex].endpoint.label || states[currentIndex].endpoint.host,
        };
    }
    function currentAgentImpl() {
        const endpoint = states[currentIndex].endpoint;
        return createAgentForEndpointSync(endpoint);
    }
    function currentImpl() {
        return states[currentIndex].endpoint;
    }
    // Setup scheduled rotation if enabled
    if (rotateOn.includes('scheduled') && scheduledIntervalMs > 0) {
        scheduledTimer = setInterval(() => {
            rotateImpl('scheduled');
        }, scheduledIntervalMs);
        logger.info?.(`Scheduled rotation enabled (every ${scheduledIntervalMs}ms)`);
    }
    // Initialize: select first endpoint
    states[0].lastUsedAt = new Date();
    return {
        currentAgent: currentAgentImpl,
        current: currentImpl,
        rotate: rotateImpl,
        markFailure: markFailureImpl,
        resurrectAll: resurrectAllImpl,
        stop: stopImpl,
        getStats: getStatsImpl,
    };
}
