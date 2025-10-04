// File: /pre_market_analyzer/data_processing/csv_handler.js
const fs = require('fs');
const path = require('path');

class CsvHandler {
    static saveCandlesToCsv(filePath, candles) {
        if (!candles || candles.length === 0) return;
        const header = "Timestamp,Open,High,Low,Close,Volume\n";
        const rows = candles.map(c =>
            `${moment(c.timestamp).toISOString()},${c.open},${c.high},${c.low},${c.close},${c.volume}`
        ).join("\n");
        
        fs.writeFileSync(filePath, header + rows);
        console.log(`Data saved to ${filePath}`);
    }

    static readCandlesFromCsv(filePath) {
        if (!fs.existsSync(filePath)) return [];
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const rows = fileContent.split("\n").slice(1); // Skip header
        return rows.map(row => {
            const [timestamp, open, high, low, close, volume] = row.split(',');
            if (!timestamp) return null; // Handle empty lines
            return {
                timestamp: moment(timestamp).valueOf(), // Convert to Unix ms for consistency
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseInt(volume)
            };
        }).filter(Boolean); // Remove nulls from empty lines
    }
}

module.exports = CsvHandler;