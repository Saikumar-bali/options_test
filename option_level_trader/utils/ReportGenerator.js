// File: /option_level_trader/utils/ReportGenerator.js
const fs = require('fs');
const path = require('path');
const moment = require("moment-timezone");

class ReportGenerator {
    generateTradeReport(trades, openPositions = []) {
        return new Promise((resolve, reject) => {
            const reportDate = moment.tz("Asia/Kolkata").format('YYYY-MM-DD');
            const reportDir = path.resolve(__dirname, '../../reports');
            if (!fs.existsSync(reportDir)) {
                fs.mkdirSync(reportDir, { recursive: true });
            }
            const reportPath = path.join(reportDir, `Trade_Report_${reportDate}.txt`);

            let reportContent = `--- Trade Report ${reportDate} ---

`;

            const totalTrades = trades.length;
            const winningTrades = trades.filter(t => t.pnl > 0).length;
            const losingTrades = totalTrades - winningTrades;
            const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

            reportContent += `Summary:
`;
            reportContent += `Total Closed Trades: ${totalTrades}
`;
            reportContent += `Winning Trades: ${winningTrades}
`;
            reportContent += `Losing Trades: ${losingTrades}
`;
            reportContent += `Total Realized P&L: ₹${totalPnl.toFixed(2)}

`;

            if (totalTrades > 0) {
                reportContent += `Closed Trades:
`;
                trades.forEach(t => {
                    reportContent += `${t.timestamp} | ${t.symbol} | Entry: ${t.entryPrice.toFixed(2)} | Exit: ${t.exitPrice.toFixed(2)} | P&L: ${t.pnl.toFixed(2)}
`;
                });
                reportContent += `
`;
            }

            if (openPositions.length > 0) {
                reportContent += `Open Positions:
`;
                openPositions.forEach(p => {
                    const unrealizedPnl = (p.ltp - p.entryPrice) * p.instrument.lotsize;
                    reportContent += `${p.instrument.symbol} | Entry: ${p.entryPrice.toFixed(2)} | LTP: ${p.ltp.toFixed(2)} | Unrealized P&L: ${unrealizedPnl.toFixed(2)}
`;
                });
            }

            try {
                fs.writeFileSync(reportPath, reportContent);
                console.log("[ReportGenerator] Report generated at ${reportPath}");
                resolve(reportPath);
            } catch (error) {
                console.error(`[ReportGenerator] Error generating report:`, error);
                reject(error);
            }
        });
    }
}

module.exports = ReportGenerator;
