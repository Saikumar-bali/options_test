// File: /option_level_trader/utils/TelegramService.js
const TelegramBot = require('node-telegram-bot-api');

class TelegramService {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.bot = null;

        if (this.token) {
            try {
                // FIX: Polling MUST be true to receive commands like /livepnl
                this.bot = new TelegramBot(this.token, { polling: true }); 
                console.log("✅ TelegramService initialized with Polling ON.");
                
                // Handle polling errors to prevent crash
                this.bot.on("polling_error", (err) => console.log(`[Telegram Polling Error] ${err.message}`));

            } catch (error) {
                console.error("❌ Failed to initialize TelegramBot:", error.message);
            }
        } else {
            console.warn("⚠️ TELEGRAM_BOT_TOKEN is missing in .env. Telegram alerts will be disabled.");
        }

        if (!this.chatId) {
            console.warn("⚠️ TELEGRAM_CHAT_ID is missing in .env. Telegram alerts will not be sent.");
        }
    }

    // Called from main.js to wire up logic
    initializeCommands(positionManager, reportGenerator, allTrades) {
        if (!this.bot) return;

        console.log("ℹ️ Registering Telegram Commands: /livepnl, /report, /status");

        // Command: /livepnl
        this.bot.onText(/\/livepnl/, (msg) => {
            const chatId = msg.chat.id;
            const pnlMsg = positionManager.getLivePnLSummary();
            this.bot.sendMessage(chatId, pnlMsg, { parse_mode: 'Markdown' });
        });

        // Command: /report
        this.bot.onText(/\/report/, async (msg) => {
            const chatId = msg.chat.id;
            this.bot.sendMessage(chatId, "📊 Generating report...");
            try {
                // We pass current open positions as well
                const reportPath = await reportGenerator.generateTradeReport(allTrades, positionManager.openPositions);
                await this.sendReport(reportPath, "📄 Requested Trade Report");
            } catch (e) {
                this.bot.sendMessage(chatId, `❌ Error: ${e.message}`);
            }
        });

        // Command: /status
        this.bot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            const openCount = positionManager.openPositions.length;
            const pendingCount = positionManager.pendingOrders.length;
            this.bot.sendMessage(chatId, `✅ *Bot Status: Running*\nOpen Positions: ${openCount}\nPending Orders: ${pendingCount}`, { parse_mode: 'Markdown' });
        });
    }

    async sendMessage(message) {
        if (!this.bot || !this.chatId) {
            console.log(`[Telegram (Simulated)] ${message.replace(/\*/g, '')}`);
            return;
        }

        try {
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error(`❌ Error sending Telegram message: ${error.message}`);
        }
    }

    async sendAlertMessage(message) {
        await this.sendMessage(`🚨 *ALERT* 🚨\n\n${message}`);
    }

    async sendReport(filePath, caption = "") {
        if (!this.bot || !this.chatId) {
            console.log(`[Telegram (Simulated)] Sending report: ${filePath}`);
            return;
        }

        try {
            await this.bot.sendDocument(this.chatId, filePath, { caption: caption });
            console.log(`[Telegram] Report sent: ${filePath}`);
        } catch (error) {
            console.error(`❌ Error sending Telegram report: ${error.message}`);
        }
    }
}

module.exports = TelegramService;