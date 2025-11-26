// File: /option_level_trader/utils/instrument_loader.js
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
        // Always attempt to download the latest instrument file (safe: downloadInstruments
        // will skip writing if the file is already up-to-date).
        try {
            await this.downloadInstruments();
        } catch (e) {
            // If download fails but a local file exists we proceed; otherwise the later
            // read will throw and surface the error.
            console.warn('Instrument download attempt failed (will continue if local file exists):', e.message || e);
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
                    lot_size: parseInt(row.lotsize),
                    instrument_type: row.instrumenttype,
                    exch_seg: row.exch_seg,
                    tick_size: parseFloat(row.tick_size),
                    optiontype: row.optionType || row.optiontype || row.option_type,
                };

                // If the instrument is from a Futures & Options segment (BFO or NFO),
                // convert the tick size from paisa to rupees.
                if (instrument.exch_seg === 'BFO' || instrument.exch_seg === 'NFO') {
                    instrument.tick_size = instrument.tick_size / 100; // e.g., 5.0 becomes 0.05
                }

                if (instrument.token && instrument.symbol) {
                    this.instruments.push(instrument);
                    this.instrumentMap.set(instrument.token, instrument);

                    // Create a set of normalized keys for the underlying so lookups
                    // tolerate common naming differences (e.g. CRUDEOIL vs CRUDEOILCOM)
                    const rawName = (instrument.name || '').toString();
                    const normalize = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    const base = normalize(rawName);

                    const candidateKeys = new Set();
                    candidateKeys.add(base);

                    // If underlying ends with 'COM', also add version without it, and vice-versa
                    if (base.endsWith('COM')) {
                        candidateKeys.add(base.replace(/COM$/, ''));
                    } else {
                        candidateKeys.add(base + 'COM');
                    }

                    // Also add a shorter variant by removing common suffixes like 'M' (e.g., CRUDEOILM)
                    candidateKeys.add(base.replace(/[A-Z]$/, ''));

                    for (const key of candidateKeys) {
                        if (!key) continue;
                        if (!this.underlyingMap.has(key)) {
                            this.underlyingMap.set(key, []);
                        }
                        this.underlyingMap.get(key).push(instrument);
                    }
                }
            }

            console.log(`✅ Loaded ${this.instruments.length} instruments from JSON.`);
            // Debug: print a sample of underlying keys to help verify mappings
            try {
                const keys = Array.from(this.underlyingMap.keys()).slice(0, 30);
                console.log('🔎 Loaded underlying keys (sample):', keys.join(', '));
            } catch (e) {
                // ignore
            }

        } catch (err) {
            console.error("❌ Error reading or parsing instrument JSON file:", err.message);
            throw err;
        }
    }

    getInstrumentByToken(token) {
        return this.instrumentMap.get(token);
    }

    // Returns instruments for an underlying symbol (exact match)
    getInstrumentsByUnderlying(underlyingSymbol) {
        if (!underlyingSymbol) return undefined;
        const normalize = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const base = normalize(underlyingSymbol.toString());

        // Try exact normalized key
        if (this.underlyingMap.has(base)) return this.underlyingMap.get(base);

        // Try with/without COM suffix
        if (base.endsWith('COM')) {
            const without = base.replace(/COM$/, '');
            if (this.underlyingMap.has(without)) return this.underlyingMap.get(without);
        } else {
            const withCom = base + 'COM';
            if (this.underlyingMap.has(withCom)) return this.underlyingMap.get(withCom);
        }

        // Fallback: return any key that contains the base as substring
        for (const [key, list] of this.underlyingMap.entries()) {
            if (key.includes(base) || base.includes(key)) return list;
        }

        return undefined;
    }
}

module.exports = InstrumentLoader;
