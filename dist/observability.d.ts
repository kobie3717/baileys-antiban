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
import type { AntiBanStats } from './antiban.js';
/**
 * Pluggable logger interface compatible with winston, pino, console
 */
export interface AntiBanLogger {
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
}
/**
 * Create a simple console logger with timestamps and prefix
 */
export declare function createConsoleLogger(prefix?: string): AntiBanLogger;
/**
 * Export AntiBan stats as Prometheus text format (exposition format v0.0.4)
 */
export declare function exportPrometheusMetrics(stats: AntiBanStats, labels?: Record<string, string>): string;
/**
 * Create an HTTP handler for Prometheus metrics (Express/Fastify compatible)
 */
export declare function createMetricsHandler(getStats: () => AntiBanStats, labels?: Record<string, string>): {
    /**
     * HTTP request handler (Express/Fastify compatible)
     */
    handle: (_req: unknown, res: {
        setHeader: (name: string, value: string) => void;
        end: (data: string) => void;
    }) => void;
    /**
     * Get metrics as plain text (for non-HTTP usage)
     */
    text: () => string;
};
/**
 * Configuration for periodic metrics export
 */
export interface PeriodicExporterConfig {
    /**
     * Export interval in milliseconds (default: 30000)
     */
    intervalMs?: number;
    /**
     * Callback invoked with Prometheus text on each interval
     */
    onMetrics: (text: string) => void;
    /**
     * Additional labels to attach to all metrics
     */
    labels?: Record<string, string>;
}
/**
 * Handle for controlling periodic export
 */
export interface PeriodicExporterHandle {
    /**
     * Stop the periodic exporter
     */
    stop(): void;
}
/**
 * Create a periodic metrics exporter that calls onMetrics on an interval
 */
export declare function createPeriodicExporter(getStats: () => AntiBanStats, config: PeriodicExporterConfig): PeriodicExporterHandle;
