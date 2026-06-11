"use strict";
/**
 * Unified State Export — Single-call export/import of ALL antiban state
 *
 * Enables Redis failover and cross-instance state migration.
 * CRDT-safe rate limit counters using increment-only approach.
 *
 * Features:
 * - Single snapshot of all module states
 * - CRDT-safe rate limiter state (never overwrites higher counts)
 * - Version tracking for migration
 * - Instance tracking for debugging
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportAntibanState = exportAntibanState;
exports.importAntibanState = importAntibanState;
/**
 * Export antiban state from individual modules.
 * Call with references to active module instances.
 */
function exportAntibanState(modules) {
    const snapshot = {
        version: 1,
        exportedAt: Date.now(),
        instanceId: modules.instanceId || `instance-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
    // Export warmup state
    if (modules.warmup) {
        snapshot.warmup = modules.warmup.exportState();
    }
    // Export health state
    if (modules.health) {
        const status = modules.health.getStatus();
        snapshot.health = {
            riskScore: status.score,
            disconnectEvents: [], // Health module doesn't expose raw events, only aggregate stats
        };
    }
    // Export rate limiter state (CRDT-safe)
    if (modules.rateLimiter) {
        const stats = modules.rateLimiter.getStats();
        snapshot.rateLimiter = {
            messages: [], // We don't expose raw messages, rely on knownChats + counters
            knownChats: Array.from(modules.rateLimiter.getKnownChats()),
            identicalCount: {},
            burstCount: 0,
            lastMessageTime: Date.now(),
            currentFactor: modules.rateLimiter.getCurrentFactor(),
            sentSinceExport: stats.lastDay, // Use last day count as increment baseline
        };
    }
    // Export circuit breaker states (BUG FIX 2)
    if (modules.circuits?.exportState) {
        snapshot.circuits = modules.circuits.exportState();
    }
    // Export timelock guard state
    if (modules.timelockGuard) {
        const state = modules.timelockGuard.getState();
        const knownChats = modules.timelockGuard.getKnownChats ? Array.from(modules.timelockGuard.getKnownChats()) : [];
        snapshot.timelockGuard = {
            active: state.isActive,
            expiresAt: state.expiresAt ? state.expiresAt.getTime() : undefined,
            affectedJids: knownChats,
            enforcementType: state.enforcementType,
        };
    }
    // Export message registry state
    if (modules.messageRegistry) {
        snapshot.messageRegistry = modules.messageRegistry.exportState();
    }
    // Export topology throttler state
    if (modules.topologyThrottler) {
        snapshot.topologyThrottler = modules.topologyThrottler.exportState();
    }
    // Export reputation voucher state
    if (modules.reputationVoucher) {
        snapshot.reputationVoucher = modules.reputationVoucher.exportState();
    }
    // Export engagement scores
    if (modules.engagementScores) {
        snapshot.engagementScores = Object.fromEntries(modules.engagementScores.entries());
    }
    return snapshot;
}
/**
 * Import antiban state into modules.
 * CRDT-safe for rate limiters (never overwrites higher counts).
 */
function importAntibanState(snapshot, modules) {
    // Import warmup state
    if (snapshot.warmup && modules.warmup?.importState) {
        modules.warmup.importState(snapshot.warmup);
    }
    // Import health state (reset to clean state, can't import raw events)
    if (snapshot.health && modules.health?.reset) {
        modules.health.reset();
    }
    // Import rate limiter state (CRDT-safe)
    if (snapshot.rateLimiter && modules.rateLimiter) {
        // Restore known chats
        if (snapshot.rateLimiter.knownChats) {
            modules.rateLimiter.restoreKnownChats(snapshot.rateLimiter.knownChats);
        }
        // CRDT-safe merge: only restore factor if not already higher
        const currentStats = modules.rateLimiter.getStats();
        const currentCount = currentStats.lastDay;
        const snapshotCount = snapshot.rateLimiter.sentSinceExport;
        // If current count is lower, we're likely a fresh instance, so restore factor
        if (currentCount < snapshotCount) {
            modules.rateLimiter.adaptLimits(snapshot.rateLimiter.currentFactor);
        }
        // If current count is higher, keep current state (concurrent instance ahead)
    }
    // Import circuit breaker states (BUG FIX 2)
    if (snapshot.circuits && modules.circuits?.importState) {
        modules.circuits.importState(snapshot.circuits);
    }
    // Import timelock guard state
    if (snapshot.timelockGuard && modules.timelockGuard) {
        if (snapshot.timelockGuard.active && modules.timelockGuard.onTimelockUpdate) {
            const expiresAt = snapshot.timelockGuard.expiresAt
                ? new Date(snapshot.timelockGuard.expiresAt)
                : undefined;
            modules.timelockGuard.onTimelockUpdate({
                isActive: snapshot.timelockGuard.active,
                timeEnforcementEnds: expiresAt,
                enforcementType: snapshot.timelockGuard.enforcementType,
            });
            // Restore known chats
            if (snapshot.timelockGuard.affectedJids && modules.timelockGuard.registerKnownChats) {
                modules.timelockGuard.registerKnownChats(snapshot.timelockGuard.affectedJids);
            }
        }
        else {
            modules.timelockGuard.reset();
        }
    }
    // Import message registry state
    if (snapshot.messageRegistry && modules.messageRegistry) {
        modules.messageRegistry.importState(snapshot.messageRegistry);
    }
    // Import topology throttler state
    if (snapshot.topologyThrottler && modules.topologyThrottler) {
        modules.topologyThrottler.importState(snapshot.topologyThrottler);
    }
    // Import reputation voucher state
    if (snapshot.reputationVoucher && modules.reputationVoucher) {
        modules.reputationVoucher.importState(snapshot.reputationVoucher);
    }
    // Import engagement scores
    if (snapshot.engagementScores && modules.engagementScores) {
        for (const [jid, score] of Object.entries(snapshot.engagementScores)) {
            modules.engagementScores.set(jid, score);
        }
    }
}
