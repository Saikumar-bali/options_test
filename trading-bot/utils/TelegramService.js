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
            console.log("✅ Primary Telegram bot initialized");
        } else {
            this.bot = null;
            console.warn("⚠️ Primary bot token (TELEGRAM_BOT_TOKEN) or chat ID is not set.");
        }

        // Second bot for specific trade alerts
        if (this.alertBotToken && this.chatId) {
            this.alertBot = new TelegramBot(this.alertBotToken);
            console.log("✅ Alert Telegram bot initialized");
        } else {
            this.alertBot = null;
            console.warn("⚠️ Alert bot token (TELEGRAM_BOT_TOKEN1) is not set. Specific trade alerts will not be sent.");
        }
    }

    setupCommands(context, aiService) {
        if (!this.bot) {
            console.warn("⚠️ Cannot setup commands - primary bot not initialized");
            return;
        }

        const { strategies, allTrades, reportGenerator, shutdown, positionManager } = context;

        // --- AI Analysis Command ---
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

        // --- Status Command ---
        this.bot.onText(/\/status/, (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;

            let statusMessage = "🤖 *Bot Status Overview*\n\n";
            strategies.forEach((strategy, name) => {
                const pnl = strategy.getUnrealizedPnL ? strategy.getUnrealizedPnL() : 0;
                const strategyStatus = strategy.getStrategyStatus ? strategy.getStrategyStatus() : null;

                statusMessage += `*${name}* - ${strategy.isActive ? 'ACTIVE ✅' : 'STOPPED ❌'}\n`;
                statusMessage += `  - Unrealized P&L: ₹${pnl.toFixed(2)}\n`;

                if (strategyStatus) {
                    if (strategyStatus.waitingForCE || strategyStatus.waitingForPE) {
                        statusMessage += `  - Waiting for entries: `;
                        if (strategyStatus.waitingForCE) statusMessage += `CE `;
                        if (strategyStatus.waitingForPE) statusMessage += `PE `;
                        statusMessage += `\n`;
                    }
                    statusMessage += `  - Open positions: ${strategyStatus.openPositions}\n`;
                }

                statusMessage += `\n`;
            });

            this.sendMessage(statusMessage);
        });

        // --- P&L Command ---
        this.bot.onText(/\/pnl/, (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;

            const realizedPnl = allTrades.reduce((sum, trade) => sum + trade.profit, 0);
            let unrealizedPnl = 0;

            strategies.forEach(strategy => {
                if (strategy.getUnrealizedPnL) {
                    unrealizedPnl += strategy.getUnrealizedPnL();
                }
            });

            const totalPnl = realizedPnl + unrealizedPnl;
            const totalPnlSign = totalPnl >= 0 ? '🟢' : '🔴';
            const realizedSign = realizedPnl >= 0 ? '🟢' : '🔴';
            const unrealizedSign = unrealizedPnl >= 0 ? '🟢' : '🔴';

            let pnlMessage = `💰 *Daily P&L Summary*\n\n`;
            pnlMessage += `*Realized P&L:* ₹${realizedPnl.toFixed(2)} ${realizedSign}\n`;
            pnlMessage += `*Unrealized P&L:* ₹${unrealizedPnl.toFixed(2)} ${unrealizedSign}\n`;
            pnlMessage += `--------------------------------\n`;
            pnlMessage += `*Total P&L:* ₹${totalPnl.toFixed(2)} ${totalPnlSign}`;

            this.sendMessage(pnlMessage);
        });

        // --- Live P&L Command ---
        this.bot.onText(/\/livepnl/, (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;

            // Get positions from ALL strategies, not just main positionManager
            const allLivePositions = [];

            // Check main positionManager
            const mainPositions = positionManager.getLivePositions();
            if (mainPositions && mainPositions.length > 0) {
                allLivePositions.push(...mainPositions);
            }

            // Check all registered strategies for their own positions
            strategies.forEach((strategy, name) => {
                if (strategy.getLivePositions && typeof strategy.getLivePositions === 'function') {
                    const strategyPositions = strategy.getLivePositions();
                    if (strategyPositions && strategyPositions.length > 0) {
                        allLivePositions.push(...strategyPositions);
                    }
                }
            });

            if (allLivePositions.length === 0) {
                this.sendMessage("📭 *No Open Positions*\n\nThere are no open positions currently.");
                return;
            }

            let message = "📊 *Live P&L - Open Positions*\n\n";
            let totalLivePnl = 0;

            allLivePositions.forEach((pos, index) => {
                const pnlSign = pos.pnl >= 0 ? '🟢' : '🔴';
                message += `*${index + 1}. ${pos.symbol}*\n`;
                message += `   - Strategy: ${pos.strategy || 'Unknown'}\n`;
                message += `   - Type: ${pos.optionType || 'Stock'}\n`;
                message += `   - Lots: ${pos.lots}\n`;
                message += `   - Entry: ${pos.entryPrice.toFixed(2)}\n`;
                message += `   - LTP: ${pos.ltp.toFixed(2)}\n`;
                message += `   - P&L: *₹${pos.pnl.toFixed(2)}* ${pnlSign}\n\n`;
                totalLivePnl += pos.pnl;
            });

            message += `--------------------------------\n`;
            const totalPnlSign = totalLivePnl >= 0 ? '🟢' : '🔴';
            message += `*Total Live P&L:* *₹${totalLivePnl.toFixed(2)}* ${totalPnlSign}`;

            this.sendMessage(message);
        });

        // --- Strategy Control Commands ---
        this.bot.onText(/\/stop (.+)/, (msg, match) => {
            if (msg.chat.id.toString() !== this.chatId) return;
            const strategyName = match[1].toUpperCase();
            const strategy = strategies.get(strategyName);
            if (strategy) {
                strategy.stop();
                this.sendMessage(`⏸️ *${strategyName} Strategy Stopped*\n\nStrategy has been paused. No new positions will be taken.`);
            } else {
                this.sendMessage(`❌ Strategy *${strategyName}* not found. Available strategies: ${Array.from(strategies.keys()).join(', ')}`);
            }
        });

        this.bot.onText(/\/start (.+)/, (msg, match) => {
            if (msg.chat.id.toString() !== this.chatId) return;
            const strategyName = match[1].toUpperCase();
            const strategy = strategies.get(strategyName);
            if (strategy) {
                strategy.start();
                this.sendMessage(`▶️ *${strategyName} Strategy Started*\n\nStrategy is now active and monitoring for opportunities.`);
            } else {
                this.sendMessage(`❌ Strategy *${strategyName}* not found. Available strategies: ${Array.from(strategies.keys()).join(', ')}`);
            }
        });

        // --- Detailed SMMA Status Command ---
        this.bot.onText(/\/smma_status/, (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;
            const smmaStrategy = strategies.get('SMMA');
            if (smmaStrategy && smmaStrategy.sendDetailedStatus) {
                smmaStrategy.sendDetailedStatus();
            } else {
                this.sendMessage("❌ SMMA strategy not found or status method not available.");
            }
        });

        // --- Report Command ---
        // *** FIX: Updated to fetch all open positions for on-demand report ***
        this.bot.onText(/\/report/, async (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;
            await this.sendMessage("📊 Generating on-demand trade report...");

            // --- FIX: Aggregate open positions from ALL strategies ---
            let allOpenPositions = [];
            const { positionManager, strategies, allTrades } = context;

            // 1. Get positions from main positionManager
            if (positionManager && positionManager.openPositions) {
                allOpenPositions = allOpenPositions.concat(positionManager.openPositions);
            }

            // 2. Get positions from individual strategies (like SMMA)
            if (strategies) {
                strategies.forEach((strategy, name) => {
                    if (strategy.getLivePositionsForReport && typeof strategy.getLivePositionsForReport === 'function') {
                        const strategyPositions = strategy.getLivePositionsForReport();
                        if (strategyPositions && strategyPositions.length > 0) {
                            allOpenPositions = allOpenPositions.concat(strategyPositions);
                        }
                    }
                });
            }
            // --- END FIX ---

            if (allTrades.length > 0 || allOpenPositions.length > 0) {
                const reportPath = await reportGenerator.generateTradeReport(allTrades, allOpenPositions);
                await this.sendReport(reportPath, "📈 On-demand trade report generated.");
            } else {
                this.sendMessage("📭 No trades executed and no open positions. Report cannot be generated.");
            }
        });

        // --- Exit Command ---
        this.bot.onText(/\/exit/, (msg) => {
            if (msg.chat.id.toString() === this.chatId) {
                this.sendMessage("🛑 Shutting down trading bot...");
                shutdown();
            }
        });

        // --- Help Command ---
        this.bot.onText(/\/help/, (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;

            const helpMessage = `🤖 *Trading Bot Commands*\n\n` +
                `*/start <strategy>* - Start a strategy (e.g., /start SMMA)\n` +
                `*/stop <strategy>* - Stop a strategy\n` +
                `*/status* - Overall bot status\n` +
                `*/pnl* - Daily P&L summary\n` +
                `*/livepnl* - Live P&L of open positions\n` +
                `*/smma_status* - Detailed SMMA strategy status\n` +
                `*/report* - Generate trade report\n` +
                `*/ask <question>* - AI analysis\n` +
                `*/exit* - Shutdown bot\n` +
                `*/help* - This help message`;

            this.sendMessage(helpMessage);
        });

        console.log("✅ Telegram commands setup completed");
    }


    /**
     * Sends a message using the primary bot.
     */
    async sendMessage(message) {
        if (!this.bot) {
            console.warn("⚠️ Cannot send message - primary bot not initialized");
            return;
        }
        try {
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error("❌ Error sending Telegram message:", error.message);
        }
    }


    /**
     * Sends a message using the secondary/alert bot.
     */
    async sendAlertMessage(message) {
        if (!this.alertBot) {
            // Fallback to the main bot if the alert bot isn't configured
            await this.sendMessage(message);
            return;
        }
        try {
            await this.alertBot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error("❌ Error sending Telegram alert message:", error.message);
        }
    }

    async sendReport(filePath, caption = "") {
        if (!this.bot) return;
        try {
            await this.bot.sendDocument(this.chatId, filePath, { caption });
        } catch (error) {
            console.error("❌ Error sending Telegram report:", error.message);
        }
    }


}

module.exports = TelegramService;