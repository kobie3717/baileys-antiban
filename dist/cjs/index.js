"use strict";
/**
 * baileys-antiban — Anti-ban middleware for Baileys
 *
 * Wraps a Baileys socket with human-like messaging patterns
 * to minimize the risk of WhatsApp banning your number.
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRetryJitter = exports.getTypingJitter = exports.getMessageSendJitter = exports.applySessionFingerprint = exports.generateSessionFingerprint = exports.proxyRotator = exports.readReceiptVariance = exports.credsSnapshot = exports.applyFingerprint = exports.generateFingerprint = exports.messageRecovery = exports.applyGroupMultiplier = exports.shouldUseGroupProfile = exports.isBroadcast = exports.isNewsletter = exports.isGroup = exports.StateManager = exports.PRESETS = exports.resolveConfig = exports.FileStateAdapter = exports.Scheduler = exports.WebhookAlerts = exports.ContentVariator = exports.MessageQueue = exports.wrapSocketWithFingerprint = exports.wrapSocket = exports.getRetryReasonDescription = exports.isMacError = exports.parseRetryReason = exports.MAC_ERROR_CODES = exports.MessageRetryReason = exports.createLidFirstResolver = exports.LidFirstResolver = exports.DeafSessionDetector = exports.classifyDisconnect = exports.wrapWithSessionStability = exports.SessionHealthMonitor = exports.JidCanonicalizer = exports.LidResolver = exports.PostReconnectThrottle = exports.RetryReasonTracker = exports.getCircadianMultiplier = exports.PresenceChoreographer = exports.ContactGraphWarmer = exports.ReplyRatioGuard = exports.TimelockGuard = exports.HealthMonitor = exports.WarmUp = exports.RateLimiter = exports.AntiBan = void 0;
exports.createPeriodicExporter = exports.createMetricsHandler = exports.exportPrometheusMetrics = exports.createConsoleLogger = exports.BanRecoveryOrchestrator = exports.LegitimacySignalInjector = exports.GROUP_OP_ERRORS = exports.extractPrivacyBlock = exports.classifyGroupOpError = exports.GroupOperationGuard = exports.AbortError = exports.STEALTH_BROWSER_POOL = exports.rampPresenceAfterConnect = exports.getStealthSocketConfig = exports.createStealthFingerprint = exports.getBatteryState = exports.getVoiceNoteMetadata = void 0;
// Core
var antiban_js_1 = require("./antiban.js");
Object.defineProperty(exports, "AntiBan", { enumerable: true, get: function () { return antiban_js_1.AntiBan; } });
var rateLimiter_js_1 = require("./rateLimiter.js");
Object.defineProperty(exports, "RateLimiter", { enumerable: true, get: function () { return rateLimiter_js_1.RateLimiter; } });
var warmup_js_1 = require("./warmup.js");
Object.defineProperty(exports, "WarmUp", { enumerable: true, get: function () { return warmup_js_1.WarmUp; } });
var health_js_1 = require("./health.js");
Object.defineProperty(exports, "HealthMonitor", { enumerable: true, get: function () { return health_js_1.HealthMonitor; } });
var timelockGuard_js_1 = require("./timelockGuard.js");
Object.defineProperty(exports, "TimelockGuard", { enumerable: true, get: function () { return timelockGuard_js_1.TimelockGuard; } });
// v1.3 new modules
var replyRatio_js_1 = require("./replyRatio.js");
Object.defineProperty(exports, "ReplyRatioGuard", { enumerable: true, get: function () { return replyRatio_js_1.ReplyRatioGuard; } });
var contactGraph_js_1 = require("./contactGraph.js");
Object.defineProperty(exports, "ContactGraphWarmer", { enumerable: true, get: function () { return contactGraph_js_1.ContactGraphWarmer; } });
var presenceChoreographer_js_1 = require("./presenceChoreographer.js");
Object.defineProperty(exports, "PresenceChoreographer", { enumerable: true, get: function () { return presenceChoreographer_js_1.PresenceChoreographer; } });
Object.defineProperty(exports, "getCircadianMultiplier", { enumerable: true, get: function () { return presenceChoreographer_js_1.getCircadianMultiplier; } });
// v1.5 new modules
var retryTracker_js_1 = require("./retryTracker.js");
Object.defineProperty(exports, "RetryReasonTracker", { enumerable: true, get: function () { return retryTracker_js_1.RetryReasonTracker; } });
var reconnectThrottle_js_1 = require("./reconnectThrottle.js");
Object.defineProperty(exports, "PostReconnectThrottle", { enumerable: true, get: function () { return reconnectThrottle_js_1.PostReconnectThrottle; } });
// v1.6 new modules
var lidResolver_js_1 = require("./lidResolver.js");
Object.defineProperty(exports, "LidResolver", { enumerable: true, get: function () { return lidResolver_js_1.LidResolver; } });
var jidCanonicalizer_js_1 = require("./jidCanonicalizer.js");
Object.defineProperty(exports, "JidCanonicalizer", { enumerable: true, get: function () { return jidCanonicalizer_js_1.JidCanonicalizer; } });
// v2.0 new modules
var sessionStability_js_1 = require("./sessionStability.js");
Object.defineProperty(exports, "SessionHealthMonitor", { enumerable: true, get: function () { return sessionStability_js_1.SessionHealthMonitor; } });
Object.defineProperty(exports, "wrapWithSessionStability", { enumerable: true, get: function () { return sessionStability_js_1.wrapWithSessionStability; } });
Object.defineProperty(exports, "classifyDisconnect", { enumerable: true, get: function () { return sessionStability_js_1.classifyDisconnect; } });
Object.defineProperty(exports, "DeafSessionDetector", { enumerable: true, get: function () { return sessionStability_js_1.DeafSessionDetector; } });
// v2.1 new modules
var lidFirstResolver_js_1 = require("./lidFirstResolver.js");
Object.defineProperty(exports, "LidFirstResolver", { enumerable: true, get: function () { return lidFirstResolver_js_1.LidFirstResolver; } });
Object.defineProperty(exports, "createLidFirstResolver", { enumerable: true, get: function () { return lidFirstResolver_js_1.createLidFirstResolver; } });
var retryReason_js_1 = require("./retryReason.js");
Object.defineProperty(exports, "MessageRetryReason", { enumerable: true, get: function () { return retryReason_js_1.MessageRetryReason; } });
Object.defineProperty(exports, "MAC_ERROR_CODES", { enumerable: true, get: function () { return retryReason_js_1.MAC_ERROR_CODES; } });
Object.defineProperty(exports, "parseRetryReason", { enumerable: true, get: function () { return retryReason_js_1.parseRetryReason; } });
Object.defineProperty(exports, "isMacError", { enumerable: true, get: function () { return retryReason_js_1.isMacError; } });
Object.defineProperty(exports, "getRetryReasonDescription", { enumerable: true, get: function () { return retryReason_js_1.getRetryReasonDescription; } });
// Socket wrapper
var wrapper_js_1 = require("./wrapper.js");
Object.defineProperty(exports, "wrapSocket", { enumerable: true, get: function () { return wrapper_js_1.wrapSocket; } });
Object.defineProperty(exports, "wrapSocketWithFingerprint", { enumerable: true, get: function () { return wrapper_js_1.wrapSocketWithFingerprint; } });
// Optional features
var messageQueue_js_1 = require("./messageQueue.js");
Object.defineProperty(exports, "MessageQueue", { enumerable: true, get: function () { return messageQueue_js_1.MessageQueue; } });
var contentVariator_js_1 = require("./contentVariator.js");
Object.defineProperty(exports, "ContentVariator", { enumerable: true, get: function () { return contentVariator_js_1.ContentVariator; } });
var webhooks_js_1 = require("./webhooks.js");
Object.defineProperty(exports, "WebhookAlerts", { enumerable: true, get: function () { return webhooks_js_1.WebhookAlerts; } });
var scheduler_js_1 = require("./scheduler.js");
Object.defineProperty(exports, "Scheduler", { enumerable: true, get: function () { return scheduler_js_1.Scheduler; } });
// State persistence
var stateAdapter_js_1 = require("./stateAdapter.js");
Object.defineProperty(exports, "FileStateAdapter", { enumerable: true, get: function () { return stateAdapter_js_1.FileStateAdapter; } });
// v3.0 new modules
var presets_js_1 = require("./presets.js");
Object.defineProperty(exports, "resolveConfig", { enumerable: true, get: function () { return presets_js_1.resolveConfig; } });
Object.defineProperty(exports, "PRESETS", { enumerable: true, get: function () { return presets_js_1.PRESETS; } });
var persist_js_1 = require("./persist.js");
Object.defineProperty(exports, "StateManager", { enumerable: true, get: function () { return persist_js_1.StateManager; } });
var profiles_js_1 = require("./profiles.js");
Object.defineProperty(exports, "isGroup", { enumerable: true, get: function () { return profiles_js_1.isGroup; } });
Object.defineProperty(exports, "isNewsletter", { enumerable: true, get: function () { return profiles_js_1.isNewsletter; } });
Object.defineProperty(exports, "isBroadcast", { enumerable: true, get: function () { return profiles_js_1.isBroadcast; } });
Object.defineProperty(exports, "shouldUseGroupProfile", { enumerable: true, get: function () { return profiles_js_1.shouldUseGroupProfile; } });
Object.defineProperty(exports, "applyGroupMultiplier", { enumerable: true, get: function () { return profiles_js_1.applyGroupMultiplier; } });
// v3.1 new modules
var messageRecovery_js_1 = require("./messageRecovery.js");
Object.defineProperty(exports, "messageRecovery", { enumerable: true, get: function () { return messageRecovery_js_1.messageRecovery; } });
// v3.2 new modules
var deviceFingerprint_js_1 = require("./deviceFingerprint.js");
Object.defineProperty(exports, "generateFingerprint", { enumerable: true, get: function () { return deviceFingerprint_js_1.generateFingerprint; } });
Object.defineProperty(exports, "applyFingerprint", { enumerable: true, get: function () { return deviceFingerprint_js_1.applyFingerprint; } });
var credsSnapshot_js_1 = require("./credsSnapshot.js");
Object.defineProperty(exports, "credsSnapshot", { enumerable: true, get: function () { return credsSnapshot_js_1.credsSnapshot; } });
var readReceiptVariance_js_1 = require("./readReceiptVariance.js");
Object.defineProperty(exports, "readReceiptVariance", { enumerable: true, get: function () { return readReceiptVariance_js_1.readReceiptVariance; } });
// v3.5 new modules
var proxyRotator_js_1 = require("./proxyRotator.js");
Object.defineProperty(exports, "proxyRotator", { enumerable: true, get: function () { return proxyRotator_js_1.proxyRotator; } });
// v3.6 new modules (Obscura-inspired)
var sessionFingerprint_js_1 = require("./sessionFingerprint.js");
Object.defineProperty(exports, "generateSessionFingerprint", { enumerable: true, get: function () { return sessionFingerprint_js_1.generateSessionFingerprint; } });
Object.defineProperty(exports, "applySessionFingerprint", { enumerable: true, get: function () { return sessionFingerprint_js_1.applySessionFingerprint; } });
Object.defineProperty(exports, "getMessageSendJitter", { enumerable: true, get: function () { return sessionFingerprint_js_1.getMessageSendJitter; } });
Object.defineProperty(exports, "getTypingJitter", { enumerable: true, get: function () { return sessionFingerprint_js_1.getTypingJitter; } });
Object.defineProperty(exports, "getRetryJitter", { enumerable: true, get: function () { return sessionFingerprint_js_1.getRetryJitter; } });
Object.defineProperty(exports, "getVoiceNoteMetadata", { enumerable: true, get: function () { return sessionFingerprint_js_1.getVoiceNoteMetadata; } });
Object.defineProperty(exports, "getBatteryState", { enumerable: true, get: function () { return sessionFingerprint_js_1.getBatteryState; } });
Object.defineProperty(exports, "createStealthFingerprint", { enumerable: true, get: function () { return sessionFingerprint_js_1.createStealthFingerprint; } });
// v3.8 new modules
var stealthConnect_js_1 = require("./stealthConnect.js");
Object.defineProperty(exports, "getStealthSocketConfig", { enumerable: true, get: function () { return stealthConnect_js_1.getStealthSocketConfig; } });
Object.defineProperty(exports, "rampPresenceAfterConnect", { enumerable: true, get: function () { return stealthConnect_js_1.rampPresenceAfterConnect; } });
Object.defineProperty(exports, "STEALTH_BROWSER_POOL", { enumerable: true, get: function () { return stealthConnect_js_1.STEALTH_BROWSER_POOL; } });
Object.defineProperty(exports, "AbortError", { enumerable: true, get: function () { return stealthConnect_js_1.AbortError; } });
// v4.0 new modules
var groupOperationGuard_js_1 = require("./groupOperationGuard.js");
Object.defineProperty(exports, "GroupOperationGuard", { enumerable: true, get: function () { return groupOperationGuard_js_1.GroupOperationGuard; } });
Object.defineProperty(exports, "classifyGroupOpError", { enumerable: true, get: function () { return groupOperationGuard_js_1.classifyGroupOpError; } });
Object.defineProperty(exports, "extractPrivacyBlock", { enumerable: true, get: function () { return groupOperationGuard_js_1.extractPrivacyBlock; } });
Object.defineProperty(exports, "GROUP_OP_ERRORS", { enumerable: true, get: function () { return groupOperationGuard_js_1.GROUP_OP_ERRORS; } });
// v4.1 new modules
var legitimacySignalInjector_js_1 = require("./legitimacySignalInjector.js");
Object.defineProperty(exports, "LegitimacySignalInjector", { enumerable: true, get: function () { return legitimacySignalInjector_js_1.LegitimacySignalInjector; } });
// v4.2 new modules
var banRecoveryOrchestrator_js_1 = require("./banRecoveryOrchestrator.js");
Object.defineProperty(exports, "BanRecoveryOrchestrator", { enumerable: true, get: function () { return banRecoveryOrchestrator_js_1.BanRecoveryOrchestrator; } });
// Observability
var observability_js_1 = require("./observability.js");
Object.defineProperty(exports, "createConsoleLogger", { enumerable: true, get: function () { return observability_js_1.createConsoleLogger; } });
Object.defineProperty(exports, "exportPrometheusMetrics", { enumerable: true, get: function () { return observability_js_1.exportPrometheusMetrics; } });
Object.defineProperty(exports, "createMetricsHandler", { enumerable: true, get: function () { return observability_js_1.createMetricsHandler; } });
Object.defineProperty(exports, "createPeriodicExporter", { enumerable: true, get: function () { return observability_js_1.createPeriodicExporter; } });
