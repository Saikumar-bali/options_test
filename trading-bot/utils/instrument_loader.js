// File: /trading-bot/utils/instrument_loader.js

const { default: axios } = require('axios');
const fs = require('fs');
const path = require('path');

class InstrumentLoader {
    constructor() {
        this.instrumentFilePath = process.env.INSTRUMENT_FILE_PATH || path.resolve(__dirname, '../data/instruments.json');
        this.instruments = [];
        this.instrumentMap = new Map();
        this.underlyingMap = new Map();
        this.instrumentFileUrl = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
    }

    async downloadInstruments() {
        console.log('🔄 Checking for updated instrument file...');
        try {
            const response = await axios.get(this.instrumentFileUrl, { responseType: 'json' });
            const currentData = JSON.stringify(response.data);

            // Create directory if doesn't exist
            const dir = path.dirname(this.instrumentFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Only write if content changed
            if (fs.existsSync(this.instrumentFilePath)) {
                const existingData = fs.readFileSync(this.instrumentFilePath, 'utf8');
                if (existingData === currentData) {
                    console.log('ℹ️ Instrument file is already up-to-date.');
                    return false;
                }
            }

            fs.writeFileSync(this.instrumentFilePath, currentData);
            console.log(`✅ Successfully downloaded and saved the latest instrument file to ${this.instrumentFilePath}`);
            return true;
        } catch (error) {
            console.error('❌ Failed to download instrument file:', error.message);
            if (!fs.existsSync(this.instrumentFilePath)) {
                throw new Error("Fatal: Instrument file is missing and could not be downloaded.");
            }
            return false;
        }
    }
    async loadInstruments() {
        if (!fs.existsSync(this.instrumentFilePath)) {
            console.log('ℹ️ Instrument file not found. Downloading...');
            await this.downloadInstruments();
        }
        console.log(`Loading instruments from: ${this.instrumentFilePath}`);

        try {
            const fileContent = fs.readFileSync(this.instrumentFilePath, 'utf8');
            const jsonData = JSON.parse(fileContent);


            // Handle both formats: direct array or object with data property
            const instrumentsArray = Array.isArray(jsonData) ?
                jsonData :
                (jsonData.data || []);

             if (!Array.isArray(instrumentsArray)) {
                throw new Error("Instrument file is not a valid JSON array.");
            }

            for (const row of instrumentsArray) {
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

                // **RECOMMENDED SOLUTION IMPLEMENTED START**
                // If the instrument is from a Futures & Options segment (BFO or NFO),
                // convert the tick size from paisa to rupees.
                if (instrument.exch_seg === 'BFO' || instrument.exch_seg === 'NFO') {
                    instrument.tick_size = instrument.tick_size / 100; // e.g., 5.0 becomes 0.05
                }
                // **RECOMMENDED SOLUTION IMPLEMENTED END**

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