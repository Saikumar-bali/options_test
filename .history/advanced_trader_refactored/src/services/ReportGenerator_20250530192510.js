// File: /advanced_trader_refactored/src/services/ReportGenerator.js
const fs = require('fs');
const path = require('path');
const moment = require("moment-timezone");

class ReportGenerator {
    constructor(strategy) {
        this.strategy = strategy;
        this.logger = strategy.logger;
        this.config = strategy.config;
        this.telegramService = strategy.telegramService;
    }

    async generate(forceSend = false) {
        this.logger.info("Generating daily report...");
        try {
            const reportDate = moment.tz("Asia/Kolkata").format('YYYY-MM-DD');
            const tradeCsvFile = path.join(__dirname, '../../logs', this.config.logFiles.tradeLogCsv);

            const tradesToday = this.getTradesForDate(tradeCsvFile, reportDate);
            const openPositions = this.strategy.positionManager.getAllPositions();

            if (tradesToday.length === 0 && openPositions.length === 0 && !forceSend) {
                this.logger.info("No trades or open positions to report.");
                return;
            }

            const realizedPnl = tradesToday
                .filter(t => t.action.toUpperCase() === 'SELL' && t.pnl !== null)
                .reduce((sum, t) => sum + t.pnl, 0);

            let fileContent = this.buildReportText(reportDate, tradesToday, openPositions, realizedPnl);
            
            const fileName = `${this.config.strategyName}_Report_${reportDate}.txt`;
            const tempFilePath = path.join(__dirname, '../../', fileName);
            fs.writeFileSync(tempFilePath, fileContent);

            if (this.telegramService.bot) {
                await this.telegramService.bot.sendDocument(this.config.chatId, tempFilePath, {
                    caption: `📊 ${this.config.strategyName} Daily Report for ${reportDate}`
                });
                fs.unlinkSync(tempFilePath); // Delete file after sending
            }
            this.logger.info("✅ Daily report generated and sent.");

        } catch (e) {
            this.logger.error("❌ Failed to generate/send daily report:", e.message, e);
            this.telegramService.sendAlert(`⚠️ Error generating daily report: ${e.message}`);
        }
    }
    
    getTradesForDate(filePath, reportDate) {
        if (!fs.existsSync(filePath)) return [];
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').slice(1);
        return lines.map(line => {
            if (line.trim() === '') return null;
            const parts = line.split(',');
            if (!parts[0] || !parts[0].startsWith(reportDate)) return null;
            return {
                timestamp: parts[0], symbol: parts[2], action: parts[3],
                price: parseFloat(parts[4]), quantity: parseInt(parts[5]),
                pnl: parts[8] !== 'N/A' ? parseFloat(parts[8]) : null,
                reason: parts[9],
            };
        }).filter(Boolean);
    }
    
   buildReportText(reportDate, closedTrades, openPositions, realizedPnl) {
        let text = `📊 ${this.config.strategyName} - DAILY REPORT ${reportDate} 📊\n\n`;
        const { riskManager, candleManager } = this.strategy;
        const status = riskManager.isTradingHalted() 
            ? (riskManager.isManuallyHalted() ? 'MANUALLY HALTED 🔴' : 'HALTED (Limit) ⚠️') 
            : 'ACTIVE 🟢';
        text += `Trading Status: ${status}\n\n`;

        // Improved closed trades section with better formatting
        text += "--- CLOSED TRADES ---\n";
        if (closedTrades.length > 0) {
            // Header with proper column spacing
            text += "Time       Symbol                   Action      Qty   Price     P&L         Reason\n";
            text += "--------------------------------------------------------------------------------\n";
            
            closedTrades.forEach(t => {
                if (t.pnl !== null) {
                    const timeStr = moment(t.timestamp).format("HH:mm:ss");
                    // Format with fixed column widths
                    const formattedLine = [
                        timeStr.padEnd(9),
                        t.symbol.padEnd(25),
                        t.action.padEnd(6),
                        t.quantity.toString().padEnd(2),
                        t.price.toFixed(2).padStart(10),
                        t.pnl.toFixed(2).padStart(10),
                        t.reason
                    ].join('  ');
                    
                    text += `${formattedLine}\n`;
                }
            });
        } else {
            text += "No trades closed today.\n";
        }
        
        // Improved open positions section
        text += "\n--- OPEN POSITIONS ---\n";
        let unrealizedPnl = 0;
        if (openPositions.length > 0) {
            // Header with proper spacing
            text += "Symbol                   Qty   Bought@   LTP@      Unrealized P&L\n";
            text += "--------------------------------------------------------------------------------\n";
            
            openPositions.forEach(pos => {
                const ltp = candleManager.getLtp(pos.token) || pos.buyPrice;
                const pnl = (ltp - pos.buyPrice) * pos.quantity * 
                          (pos.option_type === "PE" ? -1 : 1);
                unrealizedPnl += pnl;
                
                // Format with fixed column widths
                const formattedLine = [
                    pos.symbol.padEnd(25),
                    pos.quantity.toString().padEnd(2),
                    pos.buyPrice.toFixed(2).padStart(10),
                    ltp.toFixed(2).padStart(10),
                    pnl.toFixed(2).padStart(15)
                ].join('  ');
                
                text += `${formattedLine}\n`;
            });
        } else {
            text += "No open positions at EOD.\n";
        }

        // Summary section
        text += "\n--------------------------------------------------------------------------------\n";
        text += `TOTAL REALIZED P&L:      ₹${realizedPnl.toFixed(2)}\n`;
        text += `TOTAL UNREALIZED P&L:    ₹${unrealizedPnl.toFixed(2)}\n`;
        text += `FINAL DAILY P&L (Strategy): ₹${riskManager.getPnL().toFixed(2)}\n`;

        return text;
    }
}

module.exports = ReportGenerator;