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

        try {
            this.logger.info("Downloading latest Scrip Master file...");
            const response = await axios.get(SCRIP_MASTER_URL, { timeout: 10000 });
            scripMasterData = response.data;
            fs.writeFileSync(SCRIP_MASTER_PATH, JSON.stringify(scripMasterData));
            this.logger.info("✅ Scrip Master downloaded successfully.");
        } catch (error) {
            this.logger.error("Failed to download Scrip Master. Trying to use local copy.", error.message);
            if (fs.existsSync(SCRIP_MASTER_PATH)) {
                scripMasterData = JSON.parse(fs.readFileSync(SCRIP_MASTER_PATH, 'utf-8'));
                this.logger.info("✅ Loaded Scrip Master from local file.");
            } else {
                throw new Error("CRITICAL: Scrip Master could not be loaded. Cannot continue.");
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
        return this.symbolAndExchangeToDetailsMap.get(key) || null;
    }

    findOption(underlyingName, strikePrice, expiryDate, optionType) {
        const formattedExpiry = moment(expiryDate, 'YYYY-MM-DD').format('DDMMMYY').toUpperCase();
        const strikePriceNum = parseFloat(strikePrice);

        // This search can't use a map, so it remains a find operation
        return this.scripMaster.find(item =>
            item.name === underlyingName &&
            (item.instrumenttype === 'OPTIDX' || item.instrumenttype === 'OPTSTK') &&
            item.exch_seg === 'NFO' &&
            item.expiry.toUpperCase() === formattedExpiry &&
            parseFloat(item.strike) / 100 === strikePriceNum &&
            item.opttype === optionType
        );
    }
}
module.exports = InstrumentManager;