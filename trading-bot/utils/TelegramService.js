// File: /trading-bot/utils/TelegramService.js

const TelegramBot = require("node-telegram-bot-api");
const moment = require("moment-timezone");

class TelegramService {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.alertBotToken = process.env.TELEGRAM_BOT_TOKEN1;

        // Main bot for general messages and commands
        if (this.botToken && this.chatId) {
            this.bot = new TelegramBot(this.botToken, { polling: true });
        } else {
            this.bot = null;
            console.warn("Primary bot token (TELEGRAM_BOT_TOKEN) or chat ID is not set.");
        }

        // Second bot for specific trade alerts
        if (this.alertBotToken && this.chatId) {
            // No polling is needed for the alert bot as it only sends messages
            this.alertBot = new TelegramBot(this.alertBotToken);
        } else {
            this.alertBot = null;
            console.warn("Alert bot token (TELEGRAM_BOT_TOKEN1) is not set. Specific trade alerts will not be sent.");
        }
    }

    // --- NEW --- Accept aiService as an argument
    setupCommands(context, aiService) {
        if (!this.bot) return; // Commands are only set up on the main bot
        // UPDATED: Destructured positionManager to use in new command
        const { strategies, allTrades, reportGenerator, shutdown, positionManager } = context;

        // --- The /ask command
        this.bot.onText(/\/ask (.+)/, async (msg, match) => {
            if (msg.chat.id.toString() !== this.chatId) return;
            
            const userQuestion = match[1];
            await this.sendMessage("🧠 *Thinking...* Asking the AI for insights. This may take a moment.");
            
            try {
                const aiResponse = await aiService.getInsights(userQuestion);
                await this.sendMessage(`*🤖 AI Analyst Says:*\n\n${aiResponse}`);
            } catch (error) {
                console.error("AI Service Error:", error);
                await this.sendMessage("Sorry, I encountered an error while talking to the AI. Please try again later.");
            }
        });

        // ... (other commands) ...
        this.bot.onText(/\/status/, (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;
            let statusMessage = "🤖 *Bot Status*\n\n";
            strategies.forEach((strategy, name) => {
                const pnl = strategy.getUnrealizedPnL();
                statusMessage += `*${name}* - ${strategy.isActive ? 'ACTIVE ✅' : 'STOPPED ❌'}\n`;
                statusMessage += `  - Unrealized P&L: ₹${pnl.toFixed(2)}\n`;
                if(strategy.openPositions.size > 0){
                    strategy.openPositions.forEach(pos => {
                         statusMessage += `    - Open: ${pos.instrument.symbol}\n`;
                    });
                }
            });
            this.sendMessage(statusMessage);
        });

        this.bot.onText(/\/pnl/, (msg) => {
             if (msg.chat.id.toString() !== this.chatId) return;
             const realizedPnl = allTrades.reduce((sum, trade) => sum + trade.profit, 0);
             let unrealizedPnl = 0;
             strategies.forEach(strategy => { unrealizedPnl += strategy.getUnrealizedPnL(); });
             const totalPnl = realizedPnl + unrealizedPnl;
             let pnlMessage = `💰 *Daily P&L Summary*\n  - Realized: ₹${realizedPnl.toFixed(2)}\n  - Unrealized: ₹${unrealizedPnl.toFixed(2)}\n--------------------------------\n  - *Total:* ₹${totalPnl.toFixed(2)}`;
             this.sendMessage(pnlMessage);
        });

        // --- NEW --- The /livepnl command for detailed real-time P&L
        this.bot.onText(/\/livepnl/, (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;

            const livePositions = positionManager.getLivePositions();

            if (livePositions.length === 0) {
                this.sendMessage("There are no open positions currently.");
                return;
            }

            let message = "📊 *Live P&L of Open Positions*\n\n";
            let totalLivePnl = 0;

            livePositions.forEach(pos => {
                const pnlSign = pos.pnl >= 0 ? '🟢' : '🔴';
                message += `*Symbol:* \`${pos.symbol}\`\n`;
                message += `  - Strategy: ${pos.strategy}\n`;
                message += `  - Lots: ${pos.lots}\n`;
                message += `  - Entry: ${pos.entryPrice.toFixed(2)}\n`;
                message += `  - LTP: ${pos.ltp.toFixed(2)}\n`;
                message += `  - P&L: *₹${pos.pnl.toFixed(2)}* ${pnlSign}\n\n`;
                totalLivePnl += pos.pnl;
            });

            message += `--------------------------------\n`;
            const totalPnlSign = totalLivePnl >= 0 ? '🟢' : '🔴';
            message += `*Total Live P&L:* *₹${totalLivePnl.toFixed(2)}* ${totalPnlSign}`;

            this.sendMessage(message);
        });


        this.bot.onText(/\/stop (.+)/, (msg, match) => {
            if (msg.chat.id.toString() !== this.chatId) return;
            const strategy = strategies.get(match[1].toUpperCase());
            if (strategy) { strategy.stop(); this.sendMessage(`*${match[1].toUpperCase()}* stopped. ⏸️`); }
        });

        this.bot.onText(/\/start (.+)/, (msg, match) => {
            if (msg.chat.id.toString() !== this.chatId) return;
            const strategy = strategies.get(match[1].toUpperCase());
            if (strategy) { strategy.start(); this.sendMessage(`*${match[1].toUpperCase()}* started. ▶️`); }
        });

        this.bot.onText(/\/report/, async (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;
            await this.sendMessage("Generating on-demand report...");
            if (allTrades.length > 0) {
                 const reportPath = await reportGenerator.generateTradeReport(allTrades);
                 await this.sendReport(reportPath, "On-demand trade report.");
            } else { this.sendMessage("No trades yet."); }
        });

        this.bot.onText(/\/exit/, (msg) => { if (msg.chat.id.toString() === this.chatId) shutdown(); });
    }

    /**
     * Sends a message using the primary bot.
     * @param {string} message The message to send.
     */
    async sendMessage(message) {
        if (!this.bot) return;
        try {
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        } catch (error) { /* ignore */ }
    }
    
    /**
     * Sends a message using the secondary/alert bot.
     * @param {string} message The message to send.
     */
    async sendAlertMessage(message) {
        if (!this.alertBot) {
            // Fallback to the main bot if the alert bot isn't configured
            await this.sendMessage(message);
            return;
        }
        try {
            await this.alertBot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        } catch (error) { /* ignore */ }
    }

    async sendReport(filePath, caption = "") {
        if (!this.bot) return;
        try {
            await this.bot.sendDocument(this.chatId, filePath, { caption });
        } catch (error) { /* ignore */ }
    }
}

module.exports = TelegramService;
