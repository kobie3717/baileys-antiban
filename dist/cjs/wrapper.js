"use strict";
/**
 * Socket Wrapper — Drop-in replacement that wraps sendMessage with anti-ban protection
 *
 * Works with both baileys and @oxidezap/baileyrs transports.
 *
 * Usage with baileys:
 *   import makeWASocket from 'baileys';
 *   import { wrapSocket } from 'baileys-antiban';
 *
 *   const sock = makeWASocket({ ... });
 *   const safeSock = wrapSocket(sock);
 *
 * Usage with baileyrs:
 *   import { makeWASocket } from '@oxidezap/baileyrs';
 *   import { wrapSocket } from 'baileys-antiban';
 *
 *   const sock = makeWASocket({ ... });
 *   const safeSock = wrapSocket(sock);
 *
 *   // Use safeSock.sendMessage() — automatically rate-limited and monitored
 *   await safeSock.sendMessage(jid, { text: 'Hello!' });
 *
 *   // Check health anytime
 *   console.log(safeSock.antiban.getStats());
 *
 * Note: reachoutTimeLock timelock module silently noops on baileyrs until upstream
 * emits reachoutTimeLock events — confirmed NOT present in baileyrs v0.0.8.
 * Timelock guard will operate in detection-only mode (relies on 463 errors only).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapSocket = wrapSocket;
exports.wrapSocketWithFingerprint = wrapSocketWithFingerprint;
const antiban_js_1 = require("./antiban.js");
const sessionStability_js_1 = require("./sessionStability.js");
const groupOperationGuard_js_1 = require("./groupOperationGuard.js");
const legitimacySignalInjector_js_1 = require("./legitimacySignalInjector.js");
/**
 * Wrap a Baileys socket with anti-ban protection.
 * The returned socket has the same API but sendMessage() is protected.
 */
function wrapSocket(sock, config, warmUpState, wrapOptions) {
    const antiban = new antiban_js_1.AntiBan(config, warmUpState);
    const options = {
        autoRespondToIncoming: false,
        ...wrapOptions,
    };
    // Deaf session detector — optional, enabled via wrapOptions.deafSession
    const deafDetector = options.deafSession
        ? new sessionStability_js_1.DeafSessionDetector(options.deafSession)
        : null;
    if (deafDetector)
        deafDetector.attach(sock);
    // Group operation guard — intercept group methods with rate limiting
    if (options.groupOpGuard !== false) {
        const guard = new groupOperationGuard_js_1.GroupOperationGuard(options.groupOpGuard || {});
        const origUpdate = sock.groupParticipantsUpdate?.bind(sock);
        if (origUpdate) {
            sock.groupParticipantsUpdate = async (jid, participants, action) => {
                const op = action === 'add' ? 'add' : action === 'remove' ? 'remove' : 'add';
                const check = guard.check(op, jid);
                if (!check.allowed)
                    throw new Error(check.reason || 'Group operation rate limited');
                return origUpdate(jid, participants, action);
            };
        }
        const origCreate = sock.groupCreate?.bind(sock);
        if (origCreate) {
            sock.groupCreate = async (subject, participants) => {
                const check = guard.check('create', subject);
                if (!check.allowed)
                    throw new Error(check.reason || 'Group creation rate limited');
                return origCreate(subject, participants);
            };
        }
    }
    // Legitimacy signal injector — wrap sendMessage for typo injection
    let legitimacyInjector = null;
    if (options.legitimacySignals !== false) {
        legitimacyInjector = new legitimacySignalInjector_js_1.LegitimacySignalInjector(typeof options.legitimacySignals === 'object' ? options.legitimacySignals : {});
    }
    // Hook into Baileys events for health monitoring
    // Prefer ev.process() (Baileys ≥ late 2022) for batched event handling
    // Fall back to ev.on() for older versions
    if (typeof sock.ev.process === 'function') {
        sock.ev.process(async (events) => {
            // Handle connection updates
            if (events['connection.update']) {
                const update = events['connection.update'];
                if (update.connection === 'close') {
                    const reason = update.lastDisconnect?.error?.output?.statusCode || 'unknown';
                    antiban.onDisconnect(reason);
                    antiban.destroy(); // Clean up all timers
                    deafDetector?.onDisconnect();
                    deafDetector?.destroy();
                    // Fleet event: detect ban-like disconnect codes
                    if (options.fleetEventStore) {
                        const banCodes = [401, 403, 428, 515]; // 401=logged out, 403=forbidden, 428=banned, 515=restart required
                        if (typeof reason === 'number' && banCodes.includes(reason)) {
                            void options.fleetEventStore.emit('ban', { statusCode: reason });
                        }
                    }
                }
                if (update.connection === 'open') {
                    antiban.onReconnect();
                    deafDetector?.onConnect();
                    // Fleet event: recovery from previous ban/warn
                    if (options.fleetEventStore) {
                        const health = antiban.getStats().health;
                        if (health.risk === 'low') {
                            void options.fleetEventStore.emit('recovery', { risk: health.risk });
                        }
                    }
                }
                // Reachout timelock detection
                if (update.reachoutTimeLock) {
                    antiban.timelock.onTimelockUpdate({
                        isActive: update.reachoutTimeLock.isActive,
                        timeEnforcementEnds: update.reachoutTimeLock.timeEnforcementEnds,
                        enforcementType: update.reachoutTimeLock.enforcementType,
                    });
                    // Fleet event: timelock
                    if (options.fleetEventStore && update.reachoutTimeLock.isActive) {
                        void options.fleetEventStore.emit('timelock', {
                            enforcementType: update.reachoutTimeLock.enforcementType,
                            endsAt: update.reachoutTimeLock.timeEnforcementEnds,
                        });
                    }
                }
            }
            // Catch 463 errors from message updates + track retries + learn LID mappings
            if (events['messages.update']) {
                const updates = events['messages.update'];
                deafDetector?.onMessageActivity();
                for (const update of updates) {
                    // 463 error detection
                    if (update?.update?.messageStubParameters) {
                        const params = Array.isArray(update.update.messageStubParameters)
                            ? update.update.messageStubParameters
                            : [];
                        if (params.includes(463) || params.includes('463')) {
                            antiban.timelock.record463Error();
                            // Fleet event: rate limit detected
                            if (options.fleetEventStore) {
                                void options.fleetEventStore.emit('rate_limit', { error: '463' });
                            }
                        }
                    }
                    // Retry tracking
                    antiban.retryTracker.onMessageUpdate(update);
                    // Delivery receipt tracking
                    const status = update?.update?.status;
                    const msgId = update?.key?.id;
                    // status 3 = DELIVERY_ACK (double tick), status 4 = READ
                    if (msgId && (status === 3 || status === 4)) {
                        antiban.onDeliveryReceipt(msgId);
                    }
                }
                // LID canonicalizer learning
                antiban.jidCanonicalizer?.onMessageUpdate(updates);
            }
            // Register known chats from incoming messages + handle reply suggestions + learn LID mappings
            if (events['messages.upsert']) {
                const { messages } = events['messages.upsert'];
                deafDetector?.onMessageActivity();
                // Learn LID mappings FIRST (before any other processing)
                antiban.jidCanonicalizer?.onIncomingEvent(events['messages.upsert']);
                for (const msg of messages || []) {
                    const jid = msg.key?.remoteJid;
                    if (!jid)
                        continue;
                    // Register known chat
                    antiban.timelock.registerKnownChat(jid);
                    // Skip self messages
                    const isSelf = msg.key?.fromMe || false;
                    if (isSelf)
                        continue;
                    // Extract message text
                    const msgText = msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption ||
                        '';
                    // Handle incoming message (updates reply ratio + contact graph)
                    const replySuggestion = antiban.onIncomingMessage(jid, msgText);
                    // Auto-respond if enabled and suggested
                    if (options.autoRespondToIncoming && replySuggestion.shouldReply && replySuggestion.suggestedText) {
                        // Random delay 3-15s
                        const replyDelay = Math.floor(Math.random() * 12000) + 3000;
                        setTimeout(async () => {
                            try {
                                await sock.sendMessage(jid, { text: replySuggestion.suggestedText });
                            }
                            catch (error) {
                                // Silently fail — auto-reply is best-effort
                            }
                        }, replyDelay);
                    }
                }
            }
        });
    }
    else {
        // Fallback to ev.on() for older Baileys versions
        sock.ev.on('connection.update', (update) => {
            if (update.connection === 'close') {
                const reason = update.lastDisconnect?.error?.output?.statusCode || 'unknown';
                antiban.onDisconnect(reason);
                antiban.destroy(); // Clean up all timers
                deafDetector?.onDisconnect();
                deafDetector?.destroy();
                // Fleet event: detect ban-like disconnect codes
                if (options.fleetEventStore) {
                    const banCodes = [401, 403, 428, 515]; // 401=logged out, 403=forbidden, 428=banned, 515=restart required
                    if (typeof reason === 'number' && banCodes.includes(reason)) {
                        void options.fleetEventStore.emit('ban', { statusCode: reason });
                    }
                }
            }
            if (update.connection === 'open') {
                antiban.onReconnect();
                deafDetector?.onConnect();
                // Fleet event: recovery from previous ban/warn
                if (options.fleetEventStore) {
                    const health = antiban.getStats().health;
                    if (health.risk === 'low') {
                        void options.fleetEventStore.emit('recovery', { risk: health.risk });
                    }
                }
            }
            // Reachout timelock detection
            if (update.reachoutTimeLock) {
                antiban.timelock.onTimelockUpdate({
                    isActive: update.reachoutTimeLock.isActive,
                    timeEnforcementEnds: update.reachoutTimeLock.timeEnforcementEnds,
                    enforcementType: update.reachoutTimeLock.enforcementType,
                });
                // Fleet event: timelock
                if (options.fleetEventStore && update.reachoutTimeLock.isActive) {
                    void options.fleetEventStore.emit('timelock', {
                        enforcementType: update.reachoutTimeLock.enforcementType,
                        endsAt: update.reachoutTimeLock.timeEnforcementEnds,
                    });
                }
            }
        });
        // Catch 463 errors from message updates + track retries + learn LID mappings
        sock.ev.on('messages.update', (updates) => {
            deafDetector?.onMessageActivity();
            for (const update of updates) {
                // 463 error detection
                if (update?.update?.messageStubParameters) {
                    const params = update.update.messageStubParameters;
                    if (params.includes(463) || params.includes('463')) {
                        antiban.timelock.record463Error();
                        // Fleet event: rate limit detected
                        if (options.fleetEventStore) {
                            void options.fleetEventStore.emit('rate_limit', { error: '463' });
                        }
                    }
                }
                // Retry tracking
                antiban.retryTracker.onMessageUpdate(update);
                // Delivery receipt tracking
                const status = update?.update?.status;
                const msgId = update?.key?.id;
                // status 3 = DELIVERY_ACK (double tick), status 4 = READ
                if (msgId && (status === 3 || status === 4)) {
                    antiban.onDeliveryReceipt(msgId);
                }
            }
            // LID canonicalizer learning
            antiban.jidCanonicalizer?.onMessageUpdate(updates);
        });
        // Register known chats from incoming messages + handle reply suggestions + learn LID mappings
        sock.ev.on('messages.upsert', (upsert) => {
            const { messages } = upsert;
            deafDetector?.onMessageActivity();
            // Learn LID mappings FIRST (before any other processing)
            antiban.jidCanonicalizer?.onIncomingEvent(upsert);
            for (const msg of messages || []) {
                const jid = msg.key?.remoteJid;
                if (!jid)
                    continue;
                // Register known chat
                antiban.timelock.registerKnownChat(jid);
                // Skip self messages
                const isSelf = msg.key?.fromMe || false;
                if (isSelf)
                    continue;
                // Extract message text
                const msgText = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    msg.message?.videoMessage?.caption ||
                    '';
                // Handle incoming message (updates reply ratio + contact graph)
                const replySuggestion = antiban.onIncomingMessage(jid, msgText);
                // Auto-respond if enabled and suggested
                if (options.autoRespondToIncoming && replySuggestion.shouldReply && replySuggestion.suggestedText) {
                    // Random delay 3-15s
                    const replyDelay = Math.floor(Math.random() * 12000) + 3000;
                    setTimeout(async () => {
                        try {
                            await sock.sendMessage(jid, { text: replySuggestion.suggestedText });
                        }
                        catch (error) {
                            // Silently fail — auto-reply is best-effort
                        }
                    }, replyDelay);
                }
            }
        });
    }
    // Create proxy that intercepts sendMessage
    const originalSendMessage = sock.sendMessage.bind(sock);
    // Serializes beforeSend→afterSend so rate limiter accounting is accurate
    // under concurrent sends. Without this, all concurrent callers read the same
    // committed state before any afterSend records, bypassing per-minute limits.
    let sendLock = Promise.resolve();
    const wrappedSendMessage = async (jid, content, options) => {
        /**
         * LID/PN Canonicalization — Normalize JID to canonical form
         *
         * This mitigates the LID/PN race that causes "Bad MAC / No Session / Invalid PreKey"
         * errors (Baileys #1769, our PR #2372). When a message event arrives under one form
         * (e.g. LID) but the crypto session was established under another (e.g. PN), decryption
         * fails. By normalizing all outbound targets to a single form, we reduce this race.
         *
         * This is middleware-layer mitigation only. Root fix requires PR #2372 merged upstream.
         */
        const canonicalJid = antiban.jidCanonicalizer?.canonicalizeTarget(jid) || jid;
        // Extract text content for rate limiter analysis
        let text = content?.text || content?.caption || content?.image?.caption || '';
        // Check for typo injection (only for text messages)
        let typoResult = null;
        if (legitimacyInjector && content?.text && typeof content.text === 'string' && content.text.length > 10) {
            typoResult = legitimacyInjector.shouldInjectTypo(content.text);
        }
        // Chain this send onto the previous — each waits for the prior send's
        // afterSend to commit before running its own beforeSend check.
        const sendResult = sendLock.then(async () => {
            // Circuit breaker check (before antiban.beforeSend)
            if (options.circuitBreaker) {
                if (!options.circuitBreaker.canSend(canonicalJid)) {
                    throw new Error('[baileys-antiban] circuit-breaker: send blocked for ' + canonicalJid);
                }
            }
            const decision = await antiban.beforeSend(canonicalJid, text);
            if (!decision.allowed) {
                throw new Error(`[baileys-antiban] Message blocked: ${decision.reason}`);
            }
            // Apply delay from rate limiter
            if (decision.delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, decision.delayMs));
            }
            // Apply circuit breaker jitter for broadcast messages
            if (options.circuitBreaker) {
                const isBroadcast = canonicalJid.endsWith('@broadcast') || canonicalJid.endsWith('@newsletter');
                const jitter = options.circuitBreaker.getJitter(isBroadcast);
                if (jitter > 0) {
                    await new Promise(resolve => setTimeout(resolve, jitter));
                }
            }
            // Send message (using canonical JID)
            // If typo injection is active, send typo first, then correction
            try {
                let result;
                if (typoResult) {
                    // Send typo version first
                    const typoContent = { ...content, text: typoResult.typoText };
                    await originalSendMessage(canonicalJid, typoContent, options);
                    // Wait for correction delay
                    await new Promise(r => setTimeout(r, typoResult.correctionDelay));
                    // Send corrected version
                    const correctionContent = { ...content, text: typoResult.correctionText };
                    result = await originalSendMessage(canonicalJid, correctionContent, options);
                }
                else {
                    // Normal send
                    result = await originalSendMessage(canonicalJid, content, options);
                }
                // Pass msgId to afterSend for delivery tracking
                const msgId = result?.key?.id;
                antiban.afterSend(canonicalJid, text, msgId);
                antiban.timelock.registerKnownChat(canonicalJid);
                // Clear retry tracking on successful send
                if (msgId) {
                    antiban.retryTracker.clear(msgId);
                }
                // Circuit breaker success
                if (options.circuitBreaker) {
                    options.circuitBreaker.recordSuccess(canonicalJid);
                }
                return result;
            }
            catch (error) {
                // Circuit breaker failure
                if (options.circuitBreaker) {
                    options.circuitBreaker.recordFailure(canonicalJid);
                }
                // Baileys PR #2587: partial-encrypt Boom now carries structured data:
                //   error.data.failed[]   — per-recipient { jid, error } failures
                //   error.data.firstCause — most likely root cause string
                // Extract for richer health-monitor diagnostics vs plain error.message.
                const boomData = error?.data;
                if (boomData?.failed?.length) {
                    const cause = boomData.firstCause ?? 'unknown';
                    const failedJids = boomData.failed.map((f) => f.jid).join(', ');
                    antiban.afterSendFailed(`encrypt-all-failed firstCause=${cause} jids=[${failedJids}]`);
                }
                else {
                    antiban.afterSendFailed(error instanceof Error ? error.message : String(error));
                }
                throw error;
            }
        });
        // Advance the lock regardless of success/failure so the chain never stalls
        sendLock = sendResult.then(() => { }, () => { });
        return sendResult;
    };
    // Return enhanced socket
    const wrapped = Object.create(sock);
    wrapped.sendMessage = wrappedSendMessage;
    wrapped.antiban = antiban;
    // Expose destroy method directly so consumers can call it manually if needed
    wrapped.antiban.destroy = antiban.destroy.bind(antiban);
    return wrapped;
}
/**
 * Helper function to create a wrapped socket with device fingerprint applied.
 *
 * This combines device fingerprint generation, socket creation, and wrapping
 * into a single call.
 *
 * Usage:
 *   import makeWASocket from 'baileys';
 *   import { wrapSocketWithFingerprint } from 'baileys-antiban';
 *
 *   const wrapped = wrapSocketWithFingerprint(makeWASocket, socketConfig, {
 *     fingerprintSeed: 'stable-seed-123',
 *     groupOpGuard: {},
 *     legitimacySignals: {}
 *   });
 *
 * @param makeWASocket - Baileys makeWASocket factory function
 * @param socketConfig - Base socket configuration
 * @param wrapOptions - Combined wrapper options + fingerprintSeed
 */
function wrapSocketWithFingerprint(makeWASocket, socketConfig, wrapOptions) {
    // Import fingerprint functions dynamically to avoid circular deps
    const { generateFingerprint, applyFingerprint } = require('./deviceFingerprint.js');
    const seed = wrapOptions?.fingerprintSeed ||
        socketConfig.auth?.creds?.me?.id ||
        String(Date.now());
    const fp = generateFingerprint({ seed });
    const config = applyFingerprint(socketConfig, fp);
    const sock = makeWASocket(config);
    return wrapSocket(sock, undefined, undefined, wrapOptions);
}
