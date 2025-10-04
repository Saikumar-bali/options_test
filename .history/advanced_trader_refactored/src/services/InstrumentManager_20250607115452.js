// File: /src/services/InstrumentManager.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const SCRIP_MASTER_PATH = path.join(__dirname, '../pre_market_analysis/data_store/scripMaster.json');

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
                this.logger.info("Downloading latest Scrip Master file...");
                const response = await axios.get(SCRIP_MASTER_URL, { timeout: 15000 });
                scripMasterData = response.data;
                fs.writeFileSync(SCRIP_MASTER_PATH, JSON.stringify(scripMasterData));
                this.logger.info("✅ Scrip Master downloaded successfully.");
            } catch (error) {
                this.logger.error("Failed to download Scrip Master. Trying to use older local copy if available.", error.message);
                if (fs.existsSync(SCRIP_MASTER_PATH)) {
                    scripMasterData = JSON.parse(fs.readFileSync(SCRIP_MASTER_PATH, 'utf-8'));
                    this.logger.info("✅ Loaded Scrip Master from local file as fallback.");
                } else {
                    throw new Error("CRITICAL: Scrip Master could not be loaded. Cannot continue.");
                }
            }
        }
        
        this.scripMaster = scripMasterData;
        this.buildMaps();
    }

    buildMaps() {
        this.logger.info("Building instrument maps for fast lookup...");
        for (const instrument of this.scripMaster) {
            this.tokenToDetailsMap.set(instrument.token, instrument);
            const key = `${instrument.symbol}_${instrument.exch_seg}`;
            this.symbolAndExchangeToDetailsMap.set(key, instrument);
        }
        this.logger.info(`Scrip Master loaded with ${this.scripMaster.length} instruments.`);
    }

    getInstrumentByToken(token) {
        return this.tokenToDetailsMap.get(String(token)) || null;
    }

    getInstrumentDetails(symbol, exchange) {
        const key = `${symbol}_${exchange}`;
        return this.symbolAndExchangeToDetailsMap.get(key) || this.symbolAndExchangeToDetailsMap.get(`${symbol}-EQ_${exchange}`) || null;
    }
    
    findOption(underlyingName, strikePrice, expiryDate, optionType) {
        if (!this.scripMaster) return null;
        
        const strikePriceNum = parseFloat(strikePrice);
        const formattedExpiry = moment(expiryDate, 'YYYY-MM-DD').format('DDMMMYYYY').toUpperCase();

        // This is a flag to print the debug log only once per search.
        let hasLoggedDebug = false;

        const result = this.scripMaster.find(item => {
            // Basic matching for name, type, and segment
            const isNfoOption = (item.instrumenttype === 'OPTIDX' || item.instrumenttype === 'OPTSTK') && item.exch_seg === 'NFO';
            if (!isNfoOption) return false;

            const nameMatch = item.name === underlyingName;
            if (!nameMatch) return false;

            // Once we find a potential instrument by name, we log the details
            if (!hasLoggedDebug) {
                 this.logger.debug(`[FIND_OPTION_DIAGNOSTICS] Searching for: Name='${underlyingName}', Expiry='${formattedExpiry}', Strike='${strikePriceNum}', Type='${optionType}'`);
                 this.logger.debug(`[FIND_OPTION_DIAGNOSTICS] First match in ScripMaster: Name='${item.name}', Expiry='${item.expiry.toUpperCase()}', Strike='${parseFloat(item.strike) / 100}', Type='${item.opttype}'`);
                 hasLoggedDebug = true; // Prevent logging for every single item in the scrip master
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