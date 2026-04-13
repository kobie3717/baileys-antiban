/**
 * Webhook Alerts — Get notified on Telegram/Discord/Slack when risk changes
 */
const DEFAULT_CONFIG = {
    urls: [],
    minRiskLevel: 'medium',
    cooldownMs: 300000,
    includeStats: true,
};
export class WebhookAlerts {
    config;
    lastAlertTime = 0;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Send alert if risk level warrants it
     */
    async alert(data) {
        const riskOrder = ['low', 'medium', 'high', 'critical'];
        if (riskOrder.indexOf(data.risk) < riskOrder.indexOf(this.config.minRiskLevel)) {
            return; // Below threshold
        }
        const now = Date.now();
        if (now - this.lastAlertTime < this.config.cooldownMs) {
            return; // Cooldown active
        }
        this.lastAlertTime = now;
        const payload = {
            source: 'baileys-antiban',
            timestamp: new Date().toISOString(),
            ...data,
        };
        // Send to generic webhook URLs
        for (const url of this.config.urls) {
            this.postWebhook(url, payload).catch(() => { });
        }
        // Telegram
        if (this.config.telegram) {
            const emoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' }[data.risk] || '⚪';
            const text = `${emoji} *baileys-antiban Alert*\n\nRisk: *${data.risk.toUpperCase()}* (score: ${data.score})\n${data.recommendation}\n\nReasons:\n${data.reasons.map(r => `• ${r}`).join('\n')}`;
            this.postWebhook(`https://api.telegram.org/bot${this.config.telegram.botToken}/sendMessage`, { chat_id: this.config.telegram.chatId, text, parse_mode: 'Markdown' }).catch(() => { });
        }
        // Discord
        if (this.config.discord) {
            const color = { low: 0x00ff00, medium: 0xffff00, high: 0xff8800, critical: 0xff0000 }[data.risk] || 0;
            this.postWebhook(this.config.discord.webhookUrl, {
                embeds: [{
                        title: '🛡️ baileys-antiban Alert',
                        color,
                        fields: [
                            { name: 'Risk', value: data.risk.toUpperCase(), inline: true },
                            { name: 'Score', value: String(data.score), inline: true },
                            { name: 'Recommendation', value: data.recommendation },
                            { name: 'Reasons', value: data.reasons.join('\n') },
                        ],
                        timestamp: new Date().toISOString(),
                    }],
            }).catch(() => { });
        }
    }
    async postWebhook(url, payload) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.headers,
                },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                console.error(`[baileys-antiban] Webhook failed: ${response.status}`);
            }
        }
        catch (err) {
            console.error(`[baileys-antiban] Webhook error:`, err);
        }
    }
}
