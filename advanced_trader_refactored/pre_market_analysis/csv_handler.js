// File: /src/pre_market_analysis/csv_handler.js
const fs = require('fs');

class CsvHandler {
    static save(filePath, candles) {
        if (!candles || candles.length === 0) return;
        const header = "Timestamp,Open,High,Low,Close,Volume\n";
        const rows = candles.map(c => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join("\n");
        try {
            fs.writeFileSync(filePath, header + rows);
        } catch (error) {
            console.error(`Error writing to CSV file at ${filePath}:`, error);
        }
    }

    /**
     * Loads candle data from a CSV file.
     * @param {string} filePath The path to the CSV file.
     * @returns {Array} An array of candle objects.
     */
    static load(filePath) {
        if (!fs.existsSync(filePath)) return [];
        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const rows = fileContent.split("\n").slice(1); // Skip header
            
            return rows.map(row => {
                const [ts, o, h, l, c, v] = row.split(',');
                if (!ts) return null; // Skip empty rows
                return { timestamp: ts, open: +o, high: +h, low: +l, close: +c, volume: +v };
            }).filter(Boolean); // Filter out any null rows
        } catch (error) {
            console.error(`Error reading CSV file at ${filePath}:`, error);
            return [];
        }
    }
}

module.exports = CsvHandler;