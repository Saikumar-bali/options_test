// File: /src/services/InstrumentManager.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

class InstrumentManager {
    constructor(logger) {
        this.logger = logger;
        this.scripMaster = null;
        this.tokenToDetailsMap = new Map();
        this.symbolAndExchangeToDetailsMap = new Map();
    }

    async initialize(scripMasterPath) {
        const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
        const SCRIP_MASTER_PATH = scripMasterPath;

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
            this.logger.info("Downloading latest Scrip Master file...");
            const response = await axios.get(SCRIP_MASTER_URL, { timeout: 15000 });
            scripMasterData = response.data;
            fs.writeFileSync(SCRIP_MASTER_PATH, JSON.stringify(scripMasterData));
        }
        
        this.scripMaster = scripMasterData;
        this.buildMaps();
    }

    buildMaps() {
        this.logger.info("Building instrument maps for fast lookup...");
        this.scripMaster.forEach(instrument => {
            this.tokenToDetailsMap.set(instrument.token, instrument);
            const key = `${instrument.symbol}_${instrument.exch_seg}`;
            this.symbolAndExchangeToDetailsMap.set(key, instrument);
        });
        this.logger.info(`Scrip Master loaded with ${this.scripMaster.length} instruments.`);
    }

    getInstrumentDetails(symbol, exchange) {
        const key = `${symbol}_${exchange}`;
        return this.symbolAndExchangeToDetailsMap.get(key) || null;
    }
    
    findOption(underlyingName, strikePrice, expiryDate, optionType) {
        if (!this.scripMaster) return null;
        
        const strikePriceNum = parseFloat(strikePrice);
        // *** THE FINAL FIX: Changed DDMMMYY to DDMMMYYYY to match your scripMaster.json file ***
        const formattedExpiry = moment(expiryDate, 'YYYY-MM-DD').format('DDMMMYYYY').toUpperCase();

        const result = this.scripMaster.find(item => {
            if (item.name !== underlyingName || item.exch_seg !== 'NFO' || (item.instrumenttype !== 'OPTIDX' && item.instrumenttype !== 'OPTSTK')) {
                return false;
            }
            const expiryMatch = item.expiry.toUpperCase() === formattedExpiry;
            if (!expiryMatch) return false;

            const optTypeMatch = item.opttype === optionType;
            if(!optTypeMatch) return false;
            
            const itemStrike = parseFloat(item.strike) / 100;
            const strikeMatch = Math.abs(itemStrike - strikePriceNum) < 0.01;
            
            return strikeMatch;
        });

        if (!result) {
             this.logger.debug(`[findOption] No match found for ${underlyingName} ${strikePriceNum} ${optionType} with expiry ${formattedExpiry}`);
        }

        return result || null;
    }
}
module.exports = InstrumentManager;