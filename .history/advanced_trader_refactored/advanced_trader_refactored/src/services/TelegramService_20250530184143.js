// File: /advanced_trader_refactored/src/services/TelegramService.js
const TelegramBot = require("node-telegram-bot-api");

class TelegramService {
    constructor(strategy) {
        this.strategy = strategy;
        this.config = strategy.config;
        this.riskManager = strategy.riskManager;
        this.positionManager = strategy.positionManager;
        this.candleManager = strategy.candleManager;

        if (!this.config.telegramBotToken || !this.config.chatId) {
            this.strategy.logger.warn("Telegram token or chatId not configured. Bot disabled.");
            this.bot = null;
            return;
        }
        this.bot = new TelegramBot(this.config.telegramBotToken, { polling: true });
    }

    sendAlert(message) {
        if (!this.bot) return;
        try {
            this.bot.sendMessage(this.config.chatId, `📈 ${this.config.strategyName}: ${message}`);
        } catch (error) {
            this.strategy.logger.error("Telegram send error:", error.message);
        }
    }

    stopPolling() {
        if (this.bot) this.bot.stopPolling();
    }
    
    setupCommands() {
        if (!this.bot) return;

        this.bot.onText(/\/status/, (msg) => {
            if (msg.chat.id.toString() !== this.config.chatId) return;
            let statusMsg = `*${this.config.strategyName} Status*\n`;
            const tradingStatus = this.riskManager.isTradingHalted() 
                ? (this.riskManager.isManuallyHalted() ? 'MANUALLY HALTED 🔴' : 'HALTED (Limit) ⚠️') 
                : 'ACTIVE 🟢';
            statusMsg += `Trading: ${tradingStatus}\n`;
            statusMsg += `Daily P&L: ₹${this.riskManager.getPnL().toFixed(2)}\n`;
            statusMsg += `Open Positions: ${this.positionManager.getOpenPositionCount()}\n`;
            
            this.positionManager.getAllPositions().forEach(pos => {
                const ltp = this.candleManager.getLtp(pos.token) || pos.buyPrice;
                const pnl = (ltp - pos.buyPrice) * pos.quantity * (pos.option_type === "PE" ? -1 : 1);
                statusMsg += `  - ${pos.symbol} Q:${pos.quantity} @${pos.buyPrice.toFixed(2)} | LTP: ${ltp.toFixed(2)} | P&L: ₹${pnl.toFixed(2)}\n`;
            });
            this.bot.sendMessage(msg.chat.id, statusMsg, { parse_mode: "Markdown" });
        });

        this.bot.onText(/\/halt/, (msg) => {
            if (msg.chat.id.toString() === this.config.chatId) this.riskManager.haltTrading();
        });

        this.bot.onText(/\/resume/, (msg) => {
            if (msg.chat.id.toString() === this.config.chatId) this.riskManager.resumeTrading();
        });
        
        this.bot.onText(/\/report/, async (msg) => {
             if (msg.chat.id.toString() === this.config.chatId) {
                 this.sendAlert("📊 Generating on-demand daily report...");
                 await this.strategy.reportGenerator.generate(true);
             }
        });
    }
}

module.exports = TelegramService;