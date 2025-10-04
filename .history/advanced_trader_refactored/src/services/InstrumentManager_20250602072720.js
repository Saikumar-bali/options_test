// File: /src/services/InstrumentManager.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const SCRIP_MASTER_PATH = path.join(__dirname, '../pre_market_analysis/data_store/scripMaster.json');

class InstrumentManager {
    constructor(logger) {
        this.logger = logger;
        this.scripMaster = null;
    }

    /**
     * Downloads the scrip master file if it's missing or old, then loads it into memory.
     */
    async initialize() {
        try {
            // For simplicity, we download it every time. In a real scenario, you might check file age.
            this.logger.info("Downloading latest Scrip Master file...");
            const response = await axios.get(SCRIP_MASTER_URL);
            fs.writeFileSync(SCRIP_MASTER_PATH, JSON.stringify(response.data, null, 2));
            this.logger.info("✅ Scrip Master downloaded successfully.");
            
            this.scripMaster = response.data;
        } catch (error) {
            this.logger.error("Failed to download Scrip Master. Trying to use local copy.", error.message);
            // Try to load from a local copy if download fails
            if (fs.existsSync(SCRIP_MASTER_PATH)) {
                this.scripMaster = JSON.parse(fs.readFileSync(SCRIP_MASTER_PATH, 'utf-8'));
                this.logger.info("✅ Loaded Scrip Master from local file.");
            } else {
                throw new Error("CRITICAL: Scrip Master could not be loaded. Cannot continue.");
            }
        }
    }

    /**
     * Finds an instrument's details from the local scrip master.
     * @param {string} symbol - The trading symbol (e.g., 'RELIANCE-EQ', 'NIFTY').
     * @param {string} exchange - The exchange segment (e.g., 'NSE', 'NFO').
     * @returns {object|null}
     */
    getInstrumentDetails(symbol, exchange) {
        if (!this.scripMaster) {
            this.logger.warn("Scrip Master is not loaded, cannot find instrument details.");
            return null;
        }
        // For indices, the symbol in scrip master is just the name (e.g., "NIFTY")
        const searchSymbol = exchange === 'NSE' && symbol.endsWith('-EQ') ? symbol : symbol;

        const instrument = this.scripMaster.find(item => 
            item.symbol === searchSymbol && item.exch_seg === exchange
        );

        return instrument || null;
    }

    /**
     * Finds an option contract based on underlying, strike, and expiry.
     * @returns {object|null}
     */
    findOption(underlyingSymbol, strikePrice, expiryDate, optionType) {
        if (!this.scripMaster) return null;
        const expiryMoment = moment(expiryDate).format('DDMMMYY').toUpperCase();
        
        return this.scripMaster.find(item =>
            item.name === underlyingSymbol &&
            item.instrumenttype === 'OPTIDX' || item.instrumenttype === 'OPTSTK' &&
            item.strike == strikePrice * 100 && // Strike price in master file is multiplied by 100
            item.expiry === expiryMoment &&
            item.opttype === optionType
        );
    }
}

module.exports = InstrumentManager;