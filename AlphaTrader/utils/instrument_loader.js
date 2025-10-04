// File: /trading-bot/utils/instrument_loader.js

const fs = require('fs');
const path = require('path');

class InstrumentLoader {
    constructor() {
        this.instrumentFilePath = process.env.INSTRUMENT_FILE_PATH || path.resolve(__dirname, '../data/instruments.json');
        this.instruments = [];
        this.instrumentMap = new Map();
        this.underlyingMap = new Map();
    }

    async loadInstruments() {
        if (!fs.existsSync(this.instrumentFilePath)) {
             throw new Error(`Instrument file not found at path: ${this.instrumentFilePath}`);
        }
        console.log(`Loading instruments from: ${this.instrumentFilePath}`);

        try {
            const fileContent = fs.readFileSync(this.instrumentFilePath, 'utf8');
            const jsonData = JSON.parse(fileContent);

            if (!Array.isArray(jsonData)) {
                throw new Error("Instrument file is not a valid JSON array.");
            }

            for (const row of jsonData) {
                const instrument = {
                    token: row.token,
                    symbol: row.symbol,
                    name: row.name,
                    expiry: row.expiry,
                    strike: row.strike ? parseFloat(row.strike) / 100.0 : -1,
                    lotsize: parseInt(row.lotsize),
                    instrumenttype: row.instrumenttype,
                    exch_seg: row.exch_seg,
                    tick_size: parseFloat(row.tick_size),
                    optiontype: row.optionType || row.optiontype || row.option_type,
                };

                if (instrument.token && instrument.symbol) {
                    this.instruments.push(instrument);
                    this.instrumentMap.set(instrument.token, instrument);

                    if (!this.underlyingMap.has(instrument.name)) {
                        this.underlyingMap.set(instrument.name, []);
                    }
                    this.underlyingMap.get(instrument.name).push(instrument);
                }
            }

            console.log(`✅ Loaded ${this.instruments.length} instruments from JSON.`);

        } catch (err) {
            console.error("❌ Error reading or parsing instrument JSON file:", err.message);
            throw err;
        }
    }

    getInstrumentByToken(token) {
        return this.instrumentMap.get(token);
    }
    
    // **DEFINITIVE FIX:** This lookup now correctly uses the exact names from the file.
    getInstrumentsByUnderlying(underlyingSymbol) {
        // Based on the logs, the names in the file are exactly what's in the config.
        // This reverts the previous "smart" lookups and uses a direct, reliable match.
        return this.underlyingMap.get(underlyingSymbol);
    }
}

module.exports = InstrumentLoader;
