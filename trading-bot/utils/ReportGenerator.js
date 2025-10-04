// File: /trading-bot/utils/ReportGenerator.js

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const moment = require("moment-timezone");

class ReportGenerator {
    /**
     * Generates a PDF trade report from an array of trade objects.
     * @param {Array<Object>} trades - Array of completed trades.
     * @param {Array<Object>} openPositions - Array of currently open positions.
     * @returns {Promise<string>} - The path to the generated report.
     */
    generateTradeReport(trades, openPositions = []) {
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
            doc.fontSize(20).text('Daily market positions Report', { align: 'center' });
            doc.fontSize(12).text(`Date: ${reportDate}`, { align: 'center' });
            doc.moveDown(2);

            // --- Summary Section ---
            const totalTrades = trades.length;
            const winningTrades = trades.filter(t => typeof t === 'object' && t.pnl > 0).length;
            const losingTrades = totalTrades - winningTrades;
            const totalPnl = trades.reduce((sum, t) => sum + (typeof t === 'object' ? (t.pnl || 0) : 0), 0);
            
            // --- FIX: Calculate Unrealized P&L using the live LTP ---
            const totalUnrealizedPnl = openPositions.reduce((sum, pos) => {
                // Use the last traded price (ltp) tracked by the PositionManager.
                const currentPrice = pos.ltp || pos.entryPrice; 
                const unrealizedPnl = (currentPrice - pos.entryPrice) * pos.instrument.lotsize * pos.lots;
                return sum + unrealizedPnl;
            }, 0);


            doc.fontSize(16).text('Summary', { underline: true });
            doc.moveDown();
            doc.fontSize(12)
               .text(`Total Closed positions: ${totalTrades}`)
               .text(`Winning positions: ${winningTrades}`)
               .text(`Losing positions: ${losingTrades}`)
               .text(`Hit Ratio: ${totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(2) : 0}%`)
               .text(`Total Realized P&L: ₹${totalPnl.toFixed(2)}`, {
                    fillColor: totalPnl >= 0 ? 'green' : 'red'
               });
            
            // --- Display Unrealized P&L in Summary ---
            doc.fontSize(12)
                .text(`Total Unrealized P&L: ₹${totalUnrealizedPnl.toFixed(2)}`, {
                    fillColor: totalUnrealizedPnl >= 0 ? 'green' : 'red'
                });

            doc.moveDown(2);

            // --- Closed Positions Table ---
            if (totalTrades > 0) {
                doc.fontSize(16).text('Closed positions Log', { underline: true });
                doc.moveDown();
                this.generateClosedTradesTable(doc, trades);
            } else {
                doc.fontSize(12).text('No positions were closed in this session.');
            }
            doc.moveDown(2);

            // --- Open Positions Table ---
            if (openPositions.length > 0) {
                doc.addPage(); // Start open positions on a new page for clarity
                doc.fontSize(16).text('Open Positions', { underline: true });
                doc.moveDown();
                this.generateOpenPositionsTable(doc, openPositions);
            } else {
                doc.fontSize(12).text('No positions are currently open.');
            }
            
            doc.end();

            writeStream.on('finish', () => resolve(reportPath));
            writeStream.on('error', (err) => {
                console.error("Error writing PDF stream:", err);
                reject(err);
            });
        });
    }

    /**
     * Generates a table for closed trades.
     * @param {PDFDocument} doc - The PDFKit document instance.
     * @param {Array<Object>} trades - The array of closed trade data.
     */
    generateClosedTradesTable(doc, trades) {
        const tableTop = doc.y;
        const columnSpacing = 15;
        const rowHeight = 20; 
        const pageMargin = doc.page.margins.bottom;

        const columnWidths = {
            time: 80,
            symbol: 170,
            entry: 60,
            exit: 60,
            pnl: 80
        };
        const headers = ['Time', 'Symbol', 'Entry', 'Exit', 'P&L (₹)'];

        const drawHeaders = () => {
            let x = doc.x;
            doc.fontSize(10).font('Helvetica-Bold');
            headers.forEach((header, i) => {
                const key = Object.keys(columnWidths)[i];
                doc.text(header, x, doc.y, { width: columnWidths[key], align: 'left' });
                x += columnWidths[key] + columnSpacing;
            });
            doc.font('Helvetica').moveDown();
            const headerBottom = doc.y;
            doc.strokeColor("#aaaaaa").moveTo(doc.page.margins.left, headerBottom).lineTo(doc.page.width - doc.page.margins.right, headerBottom).stroke();
        };

        drawHeaders();

        trades.forEach((trade, index) => {
            if (doc.y + rowHeight > doc.page.height - pageMargin) {
                doc.addPage();
                drawHeaders();
            }

            let x = doc.page.margins.left;
            const y = doc.y + 5;

            if (typeof trade !== 'object' || trade === null) {
                doc.fillColor('red').text(`[Error] Row ${index + 1}: Invalid trade data.`, x, y);
                doc.fillColor('black').moveDown();
                return;
            }

            const time = trade.timestamp && typeof trade.timestamp === 'string' ? trade.timestamp.split(' ')[1] : 'N/A';
            doc.text(time, x, y, { width: columnWidths.time });
            x += columnWidths.time + columnSpacing;

            const symbol = trade.symbol ? String(trade.symbol) : 'N/A';
            doc.text(symbol, x, y, { width: columnWidths.symbol });
            x += columnWidths.symbol + columnSpacing;

            const entry = typeof trade.entryPrice === 'number' ? trade.entryPrice.toFixed(2) : 'N/A';
            doc.text(entry, x, y, { width: columnWidths.entry });
            x += columnWidths.entry + columnSpacing;

            const exit = typeof trade.exitPrice === 'number' ? trade.exitPrice.toFixed(2) : 'N/A';
            doc.text(exit, x, y, { width: columnWidths.exit });
            x += columnWidths.exit + columnSpacing;
            
            const pnl = typeof trade.pnl === 'number' ? trade.pnl.toFixed(2) : 'N/A';
            const pnlColor = (typeof trade.pnl === 'number' && trade.pnl >= 0) ? 'green' : 'red';
            doc.fillColor(pnlColor).text(pnl, x, y, { width: columnWidths.pnl, align: 'right' });
            
            doc.fillColor('black').moveDown();

            const rowBottom = doc.y;
            doc.strokeColor("#eeeeee").moveTo(doc.page.margins.left, rowBottom).lineTo(doc.page.width - doc.page.margins.right, rowBottom).stroke();
        });
    }

    /**
     * Generates a table for currently open positions.
     * @param {PDFDocument} doc - The PDFKit document instance.
     * @param {Array<Object>} openPositions - The array of open position data.
     */
    generateOpenPositionsTable(doc, openPositions) {
        const columnSpacing = 15;
        const rowHeight = 20;
        const pageMargin = doc.page.margins.bottom;

        const columnWidths = {
            symbol: 180,
            entry: 80,
            current: 80,
            pnl: 100
        };
        const headers = ['Symbol', 'Entry Price', 'Current Price', 'Unrealized P&L (₹)'];

        const drawHeaders = () => {
            let x = doc.x;
            doc.fontSize(10).font('Helvetica-Bold');
            headers.forEach((header, i) => {
                const key = Object.keys(columnWidths)[i];
                doc.text(header, x, doc.y, { width: columnWidths[key], align: 'left' });
                x += columnWidths[key] + columnSpacing;
            });
            doc.font('Helvetica').moveDown();
            const headerBottom = doc.y;
            doc.strokeColor("#aaaaaa").moveTo(doc.page.margins.left, headerBottom).lineTo(doc.page.width - doc.page.margins.right, headerBottom).stroke();
        };

        drawHeaders();

        openPositions.forEach((pos, index) => {
            if (doc.y + rowHeight > doc.page.height - pageMargin) {
                doc.addPage();
                drawHeaders();
            }

            let x = doc.page.margins.left;
            const y = doc.y + 5;

            if (typeof pos !== 'object' || pos === null || !pos.instrument) {
                doc.fillColor('red').text(`[Error] Row ${index + 1}: Invalid position data.`, x, y);
                doc.fillColor('black').moveDown();
                return;
            }
            
            // --- FIX: Calculate Unrealized P&L using the live LTP and remaining lots ---
            const currentPrice = pos.ltp || pos.entryPrice;
            const unrealizedPnl = (currentPrice - pos.entryPrice) * pos.instrument.lotsize * pos.lots;
            const pnlColor = unrealizedPnl >= 0 ? 'green' : 'red';

            const symbol = String(pos.instrument.symbol);
            doc.text(symbol, x, y, { width: columnWidths.symbol });
            x += columnWidths.symbol + columnSpacing;

            const entry = pos.entryPrice.toFixed(2);
            doc.text(entry, x, y, { width: columnWidths.entry });
            x += columnWidths.entry + columnSpacing;

            const current = currentPrice.toFixed(2);
            doc.text(current, x, y, { width: columnWidths.current });
            x += columnWidths.current + columnSpacing;

            doc.fillColor(pnlColor).text(unrealizedPnl.toFixed(2), x, y, { width: columnWidths.pnl, align: 'right' });

            doc.fillColor('black').moveDown();

            const rowBottom = doc.y;
            doc.strokeColor("#eeeeee").moveTo(doc.page.margins.left, rowBottom).lineTo(doc.page.width - doc.page.margins.right, rowBottom).stroke();
        });
    }
}

module.exports = ReportGenerator;
