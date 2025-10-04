// File: /src/pre_market_analysis/csv_handler.js
const fs = require('fs');
const moment = require('moment-timezone');

class CsvHandler {
    static save(filePath, candles) {
        if (!candles || candles.length === 0) return;
        const header = "Timestamp,Open,High,Low,Close,Volume\n";
        const rows = candles.map(c => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join("\n");
        fs.writeFileSync(filePath, header + rows);
    }
    static read(filePath) {
        if (!fs.existsSync(filePath)) return [];
        return fs.readFileSync(filePath, 'utf-8').split("\n").slice(1).map(row => {
            const [ts, o, h, l, c, v] = row.split(',');
            if (!ts) return null;
            return { timestamp: ts, open: +o, high: +h, low: +l, close: +c, volume: +v };
        }).filter(Boolean);
    }
}
module.exports = CsvHandler;