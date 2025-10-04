// File: /trading-bot/utils/ReportGenerator.js

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const moment = require("moment-timezone");

class ReportGenerator {
    /**
     * Generates a PDF trade report from an array of trade objects.
     * @param {Array<Object>} trades - Array of completed trades.
     * @returns {Promise<string>} - The path to the generated report.
     */
    generateTradeReport(trades) {
        return new Promise((resolve, reject) => {
            const reportDate = moment.tz("Asia/Kolkata").format('YYYY-MM-DD');
            const reportDir = path.resolve(__dirname, '../../reports');
            if (!fs.existsSync(reportDir)) {
                fs.mkdirSync(reportDir, { recursive: true });
            }
            const reportPath = path.join(reportDir, `Trade_Report_${reportDate}.pdf`);

            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const writeStream = fs.createWriteStream(reportPath);
            doc.pipe(writeStream);

            // --- Report Header ---
            doc.fontSize(20).text('Daily Trading Report', { align: 'center' });
            doc.fontSize(12).text(`Date: ${reportDate}`, { align: 'center' });
            doc.moveDown(2);

            // --- Summary Section ---
            const totalTrades = trades.length;
            const winningTrades = trades.filter(t => t.profit > 0).length;
            const losingTrades = totalTrades - winningTrades;
            const totalPnl = trades.reduce((sum, t) => sum + t.profit, 0);

            doc.fontSize(16).text('Summary', { underline: true });
            doc.moveDown();
            doc.fontSize(12)
               .text(`Total Trades: ${totalTrades}`)
               .text(`Winning Trades: ${winningTrades}`)
               .text(`Losing Trades: ${losingTrades}`)
               .text(`Hit Ratio: ${totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(2) : 0}%`)
               .text(`Total Realized P&L: ₹${totalPnl.toFixed(2)}`, {
                    fillColor: totalPnl >= 0 ? 'green' : 'red'
               });
            doc.moveDown(2);

            // --- Trades Table ---
            if (totalTrades > 0) {
                doc.fontSize(16).text('Trade Log', { underline: true });
                doc.moveDown();
                this.generateTable(doc, trades);
            } else {
                doc.fontSize(12).text('No trades were executed in this session.');
            }
            
            // Finalize the PDF
            doc.end();

            writeStream.on('finish', () => resolve(reportPath));
            writeStream.on('error', reject);
        });
    }

    /**
     * Helper to generate a table in the PDF.
     * @param {PDFDocument} doc - The PDFKit document instance.
     * @param {Array<Object>} trades - The array of trade data.
     */
    generateTable(doc, trades) {
        const tableTop = doc.y;
        const columnSpacing = 15;
        const columnWidths = {
            time: 90,
            symbol: 180,
            entry: 60,
            exit: 60,
            pnl: 80
        };

        const headers = ['Time', 'Symbol', 'Entry', 'Exit', 'P&L (₹)'];
        let x = doc.x;
        
        // Draw headers
        doc.fontSize(10).font('Helvetica-Bold');
        headers.forEach(header => {
            doc.text(header, x, tableTop, { width: columnWidths[header.toLowerCase().split(' ')[0]], align: 'left' });
            x += columnWidths[header.toLowerCase().split(' ')[0]] + columnSpacing;
        });
        doc.font('Helvetica').moveDown();
        const headerBottom = doc.y;
        doc.strokeColor("#aaaaaa").moveTo(doc.x, headerBottom).lineTo(doc.page.width - doc.x, headerBottom).stroke();

        // Draw rows
        trades.forEach(trade => {
            x = doc.x;
            const y = doc.y + 5;
            doc.text(trade.timestamp.split(' ')[1], x, y, { width: columnWidths.time });
            x += columnWidths.time + columnSpacing;

            doc.text(trade.symbol, x, y, { width: columnWidths.symbol });
            x += columnWidths.symbol + columnSpacing;

            doc.text(trade.entryPrice.toFixed(2), x, y, { width: columnWidths.entry });
            x += columnWidths.entry + columnSpacing;

            doc.text(trade.exitPrice.toFixed(2), x, y, { width: columnWidths.exit });
            x += columnWidths.exit + columnSpacing;
            
            const pnlColor = trade.profit >= 0 ? 'green' : 'red';
            doc.fillColor(pnlColor).text(trade.profit.toFixed(2), x, y, { width: columnWidths.pnl, align: 'right' });
            doc.fillColor('black').moveDown();

            const rowBottom = doc.y;
            doc.strokeColor("#eeeeee").moveTo(doc.x, rowBottom).lineTo(doc.page.width - doc.x, rowBottom).stroke();
        });
    }
}

module.exports = ReportGenerator;
