// File: /src/services/InstrumentManager.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
// Corrected path to be relative to the project root structure
const SCRIP_MASTER_PATH = path.join(__dirname, '../../pre_market_analysis/data_store/scripMaster.json');

class InstrumentManager {
    constructor(logger) {
        this.logger = logger;
        this.scripMaster = null;
        this.tokenToDetailsMap = new Map();
        this.symbolAndExchangeToDetailsMap = new Map();
    }

    async initialize() {
        let scripMasterData;
        const dataStoreDir = path.dirname(SCRIP_MASTER_PATH);
        if (!fs.existsSync(dataStoreDir)) fs.mkdirSync(dataStoreDir, { recursive: true });

        let downloadNew = true;
        if (fs.existsSync(SCRIP_MASTER_PATH)) {
            const stats = fs.statSync(SCRIP_MASTER_PATH);
            const lastModified = moment(stats.mtime);
            if (moment().diff(lastModified, 'hours') < 24) {
                this.logger.info("Scrip Master is recent. Using local copy.");
                scripMasterData = JSON.parse(fs.readFileSync(SCRIP_MASTER_PATH, 'utf-8'));
                downloadNew = false;
            }
        }

        if (downloadNew) {
            try {
                this.logger.info("Downloading new Scrip Master...");
                const response = await axios.get(SCRIP_MASTER_URL);
                scripMasterData = response.data;
                fs.writeFileSync(SCRIP_MASTER_PATH, JSON.stringify(scripMasterData, null, 2));
                this.logger.info("New Scrip Master downloaded and saved.");
            } catch (error) {
                this.logger.error(`Failed to download Scrip Master: ${error.message}`);
                if (fs.existsSync(SCRIP_MASTER_PATH)) {
                    this.logger.warn("Using stale local copy of Scrip Master as a fallback.");
                    scripMasterData = JSON.parse(fs.readFileSync(SCRIP_MASTER_PATH, 'utf-8'));
                } else {
                    throw new Error("Scrip Master is unavailable.");
                }
            }
        }
        
        this.scripMaster = scripMasterData;
        this.buildInstrumentMaps();
    }

    buildInstrumentMaps() {
        this.logger.info("Building instrument maps for fast lookup...");
        this.scripMaster.forEach(item => {
            if (item && item.token) {
                this.tokenToDetailsMap.set(item.token, item);
                const key = `${item.symbol}-${item.exch_seg}`;
                this.symbolAndExchangeToDetailsMap.set(key, item);
            }
        });
        this.logger.info(`Scrip Master loaded with ${this.scripMaster.length} instruments.`);
    }

    /**
     * [NEW] Gets all unique expiry dates for a given underlying name.
     * @param {string} underlyingName - The name of the underlying (e.g., 'NIFTY').
     * @returns {Array<string>} A unique array of expiry strings.
     */
    getExpiriesForUnderlying(underlyingName) {
        if (!this.scripMaster) {
            this.logger.warn(`Scrip Master not loaded, cannot get expiries for ${underlyingName}`);
            return [];
        }
        const expiries = new Set();
        this.scripMaster.forEach(item => {
            if (item && item.name === underlyingName && item.expiry) {
                expiries.add(item.expiry);
            }
        });
        return [...expiries];
    }

    getInstrumentByToken(token) {
        return this.tokenToDetailsMap.get(token);
    }

    getInstrumentDetails(symbol, exchange = 'NSE') {
        return this.symbolAndExchangeToDetailsMap.get(`${symbol}-${exchange}`);
    }

    findOption(underlyingName, strikePrice, expiry, optionType) {
        if (!this.scripMaster) {
            this.logger.warn("findOption called before Scrip Master was initialized.");
            return null;
        }

        const formattedExpiry = expiry.toUpperCase();
        const strikePriceNum = Number(strikePrice);
        let hasLoggedDebug = false;

        const result = this.scripMaster.find(item => {
            if (!item || !item.name || !item.expiry || !item.strike || !item.opttype) return false;

            const isNfoOption = (item.instrumenttype === 'OPTIDX' || item.instrumenttype === 'OPTSTK') && item.exch_seg === 'NFO';
            if (!isNfoOption) return false;

            const nameMatch = item.name === underlyingName;
            if (!nameMatch) return false;

            if (!hasLoggedDebug) {
                 this.logger.debug(`[FIND_OPTION_DIAGNOSTICS] Searching for: Name='${underlyingName}', Expiry='${formattedExpiry}', Strike='${strikePriceNum}', Type='${optionType}'`);
                 this.logger.debug(`[FIND_OPTION_DIAGNOSTICS] First instrument entry check: Name='${item.name}', Expiry='${item.expiry.toUpperCase()}', Strike='${parseFloat(item.strike) / 100}', Type='${item.opttype}'`);
                 hasLoggedDebug = true;
            }

            const expiryMatch = item.expiry.toUpperCase() === formattedExpiry;
            const optTypeMatch = item.opttype === optionType;
            const itemStrike = parseFloat(item.strike) / 100;
            const strikeMatch = Math.abs(itemStrike - strikePriceNum) < 0.01;
            
            return expiryMatch && strikeMatch && optTypeMatch;
        });

        if (!result) {
            this.logger.warn(`[findOption] Final search failed for ${underlyingName} ${strikePriceNum} ${optionType} with expiry ${formattedExpiry}`);
        }

        return result || null;
    }
}

module.exports = InstrumentManager;