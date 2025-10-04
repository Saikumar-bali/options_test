// File: /trading-bot/utils/TelegramService.js

const TelegramBot = require("node-telegram-bot-api");

class TelegramService {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;

        if (!this.botToken || !this.chatId) {
            console.warn("⚠️ Telegram token or chat ID not configured. Notifications will be disabled.");
            this.bot = null;
            return;
        }
        
        this.bot = new TelegramBot(this.botToken);
        console.log("✅ Telegram Service Initialized.");
    }

    /**
     * Sends a formatted text message to the configured chat.
     * @param {string} message - The message to send. Supports Markdown.
     */
    async sendMessage(message) {
        if (!this.bot) return;
        try {
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error("❌ Telegram send message error:", error.message);
        }
    }

    /**
     * Sends a document (like a PDF report) to the configured chat.
     * @param {string} filePath - The local path to the file to send.
     * @param {string} caption - An optional caption for the file.
     */
    async sendReport(filePath, caption = "") {
        if (!this.bot) return;
        try {
            await this.bot.sendDocument(this.chatId, filePath, { caption });
            console.log(`✅ Telegram: Report sent successfully.`);
        } catch (error) {
            console.error("❌ Telegram send report error:", error.message);
        }
    }
}

module.exports = TelegramService;
