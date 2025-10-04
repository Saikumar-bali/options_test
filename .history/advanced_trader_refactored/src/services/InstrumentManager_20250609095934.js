// File: /src/services/InstrumentManager.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

class InstrumentManager {
    constructor(logger, config) {
        this.logger = logger;
        this.config = config;
        this.scripMaster = null;
        this.symbolToDetailsMap = new Map();
    }

    async initialize() {
        const SCRIP_MASTER_PATH = path.join(this.config.preMarketAnalysis.data_store_path, 'scripMaster.json');
        
        // Download or load scrip master
        try {
            this.logger.info("Downloading new Scrip Master...");
            const response = await axios.get(SCRIP_MASTER_URL, { timeout: 20000 });
            this.scripMaster = response.data;
            fs.writeFileSync(SCRIP_MASTER_PATH, JSON.stringify(this.scripMaster));
            this.logger.info("New Scrip Master downloaded and saved.");
        } catch (error) {
            this.logger.error("Failed to download Scrip Master. Will try to use local copy.", error.message);
            if (fs.existsSync(SCRIP_MASTER_PATH)) {
                this.scripMaster = JSON.parse(fs.readFileSync(SCRIP_MASTER_PATH, 'utf-8'));
                this.logger.info("Loaded Scrip Master from local file.");
            } else {
                throw new Error("CRITICAL: Scrip Master could not be loaded from URL or local file.");
            }
        }
        
        this.buildMaps();
    }

    buildMaps() {
        this.logger.info("Building instrument maps for fast lookup...");
        for (const instrument of this.scripMaster) {
            if (instrument.symbol) {
                this.symbolToDetailsMap.set(instrument.symbol.toUpperCase(), instrument);
            }
        }
        this.logger.info(`Scrip Master loaded. ${this.symbolToDetailsMap.size} symbols mapped.`);
    }

    findOption(underlyingName, strikePrice, expiryDate, optionType) {
        const baseSymbol = underlyingName.replace('-EQ', '');
        const expiry = moment(expiryDate, 'YYYY-MM-DD').format('DDMMMYY').toUpperCase();
        const tradingSymbol = `${baseSymbol}${expiry}${strikePrice}${optionType}`;

        const instrument = this.symbolToDetailsMap.get(tradingSymbol);
        if (instrument) {
            this.logger.debug(`[findOption] SUCCESS: Found ${tradingSymbol}`);
        } else {
            this.logger.warn(`[findOption] FAILED: Could not find symbol ${tradingSymbol}`);
        }
        return instrument || null;
    }

    findFuture(underlyingName, expiryDate) {
        const baseSymbol = underlyingName.replace('-EQ', '');
        const expiry = moment(expiryDate, 'YYYY-MM-DD').format('DDMMMYY').toUpperCase();
        const tradingSymbol = `${baseSymbol}${expiry}FUT`;

        const instrument = this.symbolToDetailsMap.get(tradingSymbol);
        if (instrument) {
            this.logger.info(`[findFuture] SUCCESS: Found ${tradingSymbol}`);
        } else {
            this.logger.warn(`[findFuture] FAILED: Could not find symbol ${tradingSymbol}`);
        }
        return instrument || null;
    }
}
module.exports = InstrumentManager;