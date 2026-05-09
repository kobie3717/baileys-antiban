/**
 * Observability — Prometheus metrics export + pluggable structured logging
 *
 * Usage:
 *   // Logging
 *   import { createConsoleLogger } from 'baileys-antiban';
 *   const logger = createConsoleLogger('[my-bot]');
 *   logger.info('Message sent', { recipient: jid });
 *
 *   // Metrics export for Express
 *   import { createMetricsHandler } from 'baileys-antiban';
 *   const metricsHandler = createMetricsHandler(() => antiban.getStats());
 *   app.get('/metrics', metricsHandler.handle);
 *
 *   // Periodic push to external system
 *   import { createPeriodicExporter } from 'baileys-antiban';
 *   const exporter = createPeriodicExporter(() => antiban.getStats(), {
 *     intervalMs: 30_000,
 *     onMetrics: (text) => pushToVictoriaMetrics(text),
 *   });
 */
/**
 * Create a simple console logger with timestamps and prefix
 */
export function createConsoleLogger(prefix = '[baileys-antiban]') {
    const format = (level, msg, meta) => {
        const timestamp = new Date().toISOString();
        const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
        return `${timestamp} ${level} ${prefix} ${msg}${metaStr}`;
    };
    return {
        debug: (msg, meta) => console.log(format('DEBUG', msg, meta)),
        info: (msg, meta) => console.log(format('INFO', msg, meta)),
        warn: (msg, meta) => console.warn(format('WARN', msg, meta)),
        error: (msg, meta) => console.error(format('ERROR', msg, meta)),
    };
}
/**
 * Export AntiBan stats as Prometheus text format (exposition format v0.0.4)
 */
export function exportPrometheusMetrics(stats, labels) {
    const labelMap = { instance: 'default', ...labels };
    const labelStr = Object.entries(labelMap)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
    const lines = [];
    const addMetric = (name, type, help, value) => {
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} ${type}`);
        lines.push(`${name}{${labelStr}} ${value}`);
    };
    // Counters
    addMetric('antiban_messages_allowed_total', 'counter', 'Total messages allowed by AntiBan', stats.messagesAllowed);
    addMetric('antiban_messages_blocked_total', 'counter', 'Total messages blocked by AntiBan', stats.messagesBlocked);
    addMetric('antiban_total_delay_ms_total', 'counter', 'Total delay imposed (milliseconds)', stats.totalDelayMs);
    // Health gauges
    const riskMap = { low: 0, medium: 1, high: 2, critical: 3 };
    addMetric('antiban_health_score', 'gauge', 'Current health score (0=best, 100=worst)', stats.health.score);
    addMetric('antiban_health_risk', 'gauge', 'Risk level encoded as number (0=low, 1=medium, 2=high, 3=critical)', riskMap[stats.health.risk] ?? 0);
    addMetric('antiban_disconnects_last_hour', 'gauge', 'Disconnects in last hour', stats.health.stats.disconnectsLastHour);
    addMetric('antiban_failed_messages_last_hour', 'gauge', 'Failed messages in last hour', stats.health.stats.failedMessagesLastHour);
    addMetric('antiban_uptime_ms', 'gauge', 'Session uptime in milliseconds', stats.health.stats.uptimeMs);
    // Warm-up gauges
    addMetric('antiban_warmup_progress', 'gauge', 'Warm-up progress (0.0 to 1.0)', stats.warmUp.progress);
    addMetric('antiban_warmup_day', 'gauge', 'Current warm-up day', stats.warmUp.day);
    addMetric('antiban_warmup_today_sent', 'gauge', 'Messages sent today during warm-up', stats.warmUp.todaySent);
    addMetric('antiban_warmup_today_limit', 'gauge', 'Message limit for today during warm-up', stats.warmUp.todayLimit);
    // Rate limiter gauges
    addMetric('antiban_rate_last_minute', 'gauge', 'Messages sent in last minute', stats.rateLimiter.lastMinute);
    addMetric('antiban_rate_last_hour', 'gauge', 'Messages sent in last hour', stats.rateLimiter.lastHour);
    addMetric('antiban_rate_last_day', 'gauge', 'Messages sent in last day', stats.rateLimiter.lastDay);
    addMetric('antiban_rate_limit_per_minute', 'gauge', 'Rate limit per minute', stats.rateLimiter.limits.perMinute);
    addMetric('antiban_rate_limit_per_hour', 'gauge', 'Rate limit per hour', stats.rateLimiter.limits.perHour);
    addMetric('antiban_rate_limit_per_day', 'gauge', 'Rate limit per day', stats.rateLimiter.limits.perDay);
    addMetric('antiban_known_chats', 'gauge', 'Number of known chats', stats.rateLimiter.knownChats);
    // Reply ratio gauges (optional)
    if (stats.replyRatio) {
        addMetric('antiban_contacts_on_cooldown', 'gauge', 'Contacts currently on reply cooldown', stats.replyRatio.contactsOnCooldown);
    }
    else {
        addMetric('antiban_contacts_on_cooldown', 'gauge', 'Contacts currently on reply cooldown', 0);
    }
    // Contact graph gauges (optional)
    if (stats.contactGraph) {
        addMetric('antiban_known_contacts', 'gauge', 'Number of known contacts', stats.contactGraph.knownContacts);
        addMetric('antiban_pending_handshakes', 'gauge', 'Pending handshakes', stats.contactGraph.pendingHandshakes);
    }
    else {
        addMetric('antiban_known_contacts', 'gauge', 'Number of known contacts', 0);
        addMetric('antiban_pending_handshakes', 'gauge', 'Pending handshakes', 0);
    }
    // Retry tracker gauges (optional)
    if (stats.retryTracker) {
        addMetric('antiban_retry_spirals', 'gauge', 'Number of retry spirals detected', stats.retryTracker.spiralsDetected);
        addMetric('antiban_active_retries', 'gauge', 'Currently active retries', stats.retryTracker.activeRetries);
    }
    else {
        addMetric('antiban_retry_spirals', 'gauge', 'Number of retry spirals detected', 0);
        addMetric('antiban_active_retries', 'gauge', 'Currently active retries', 0);
    }
    // Reconnect throttle gauges (optional)
    if (stats.reconnectThrottle) {
        addMetric('antiban_reconnect_throttled', 'gauge', 'Whether reconnect is currently throttled (0=no, 1=yes)', stats.reconnectThrottle.isThrottled ? 1 : 0);
        addMetric('antiban_lifetime_reconnects', 'gauge', 'Total reconnects in session lifetime', stats.reconnectThrottle.lifetimeReconnects);
    }
    else {
        addMetric('antiban_reconnect_throttled', 'gauge', 'Whether reconnect is currently throttled (0=no, 1=yes)', 0);
        addMetric('antiban_lifetime_reconnects', 'gauge', 'Total reconnects in session lifetime', 0);
    }
    return lines.join('\n') + '\n';
}
/**
 * Create an HTTP handler for Prometheus metrics (Express/Fastify compatible)
 */
export function createMetricsHandler(getStats, labels) {
    return {
        /**
         * HTTP request handler (Express/Fastify compatible)
         */
        handle: (_req, res) => {
            const metrics = exportPrometheusMetrics(getStats(), labels);
            res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            res.end(metrics);
        },
        /**
         * Get metrics as plain text (for non-HTTP usage)
         */
        text: () => {
            return exportPrometheusMetrics(getStats(), labels);
        },
    };
}
/**
 * Create a periodic metrics exporter that calls onMetrics on an interval
 */
export function createPeriodicExporter(getStats, config) {
    const intervalMs = config.intervalMs ?? 30_000;
    const intervalId = setInterval(() => {
        const metrics = exportPrometheusMetrics(getStats(), config.labels);
        config.onMetrics(metrics);
    }, intervalMs);
    return {
        stop: () => clearInterval(intervalId),
    };
}
