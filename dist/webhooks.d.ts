/**
 * Webhook Alerts — Get notified on Telegram/Discord/Slack when risk changes
 */
export interface WebhookConfig {
    /** Webhook URLs to POST to */
    urls: string[];
    /** Minimum risk level to trigger alert (default: 'medium') */
    minRiskLevel: 'low' | 'medium' | 'high' | 'critical';
    /** Cooldown between alerts in ms (default: 300000 — 5 min) */
    cooldownMs: number;
    /** Include stats in payload (default: true) */
    includeStats: boolean;
    /** Custom headers for webhook requests */
    headers?: Record<string, string>;
    /** Telegram bot token + chat ID for direct Telegram alerts */
    telegram?: {
        botToken: string;
        chatId: string;
    };
    /** Discord webhook URL */
    discord?: {
        webhookUrl: string;
    };
}
export declare class WebhookAlerts {
    private config;
    private lastAlertTime;
    constructor(config?: Partial<WebhookConfig>);
    /**
     * Send alert if risk level warrants it
     */
    alert(data: {
        risk: string;
        score: number;
        recommendation: string;
        reasons: string[];
        stats?: any;
    }): Promise<void>;
    private postWebhook;
}
