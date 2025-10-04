// File: /src/services/InstrumentManager.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const SCRIP_MASTER_PATH = path.join(__dirname, '../../pre_market_analysis/data_store/scripMaster.json');

class InstrumentManager {
    constructor(logger) {
        this.logger = logger;
        this.scripMaster = null;
        this.tokenToDetailsMap = new Map();
        this.symbolAndExchangeToDetailsMap = new Map();
    }

    async initialize() {
        try {
            let scripMasterData;
            const dataStoreDir = path.dirname(SCRIP_MASTER_PATH);
            if (!fs.existsSync(dataStoreDir)) {
                fs.mkdirSync(dataStoreDir, { recursive: true });
            }

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
                const response = await axios.get(SCRIP_MASTER_URL);
                fs.writeFileSync(SCRIP_MASTER_PATH, JSON.stringify(response.data, null, 2));
                this.logger.info("✅ Scrip Master downloaded successfully.");
                scripMasterData = response.data;
            }

            if (Array.isArray(scripMasterData)) {
                this.scripMaster = scripMasterData;
                this.buildInstrumentMaps();
                this.logger.info(`Scrip Master loaded with ${this.scripMaster.length} instruments.`);
            } else {
                this.logger.error("Scrip Master data is not an array. Cannot load instruments.");
                this.scripMaster = [];
            }

        } catch (error) {
            this.logger.error("Failed to download or load Scrip Master.", error.message);
            if (fs.existsSync(SCRIP_MASTER_PATH) && !this.scripMaster) {
                try {
                    this.logger.info("Trying to use local copy due to download failure...");
                    const localData = JSON.parse(fs.readFileSync(SCRIP_MASTER_PATH, 'utf-8'));
                    if (Array.isArray(localData)) {
                        this.scripMaster = localData;
                        this.buildInstrumentMaps();
                        this.logger.info(`Scrip Master loaded locally with ${this.scripMaster.length} instruments.`);
                    } else {
                        this.logger.error("Local Scrip Master data is not an array.");
                        this.scripMaster = [];
                    }
                } catch (localError) {
                    this.logger.error("Failed to load local Scrip Master either.", localError.message);
                    this.scripMaster = [];
                }
            } else if (!this.scripMaster) {
                this.scripMaster = [];
            }
        }
    }

    buildInstrumentMaps() {
        this.tokenToDetailsMap.clear();
        this.symbolAndExchangeToDetailsMap.clear();
        if (!this.scripMaster) return;

        for (const instrument of this.scripMaster) {
            if (instrument.token) {
                this.tokenToDetailsMap.set(instrument.token, instrument);
                
                // Add alternative token mapping for indices
                if (instrument.name === 'NIFTY' && instrument.token === '26000') {
                    this.tokenToDetailsMap.set('99926000', instrument);
                    instrument.alt_token = '99926000';
                }
                if (instrument.name === 'BANKNIFTY' && instrument.token === '26009') {
                    this.tokenToDetailsMap.set('99926009', instrument);
                    instrument.alt_token = '99926009';
                }
            }
            if (instrument.symbol && instrument.exch_seg) {
                const key = `${instrument.symbol}_${instrument.exch_seg}`;
                this.symbolAndExchangeToDetailsMap.set(key, instrument);
                
                // Add alternative symbol mapping
                if (instrument.symbol.endsWith('-EQ')) {
                    const baseSymbol = instrument.symbol.replace('-EQ', '');
                    const baseKey = `${baseSymbol}_${instrument.exch_seg}`;
                    this.symbolAndExchangeToDetailsMap.set(baseKey, instrument);
                }
            }
        }
    }

    getInstrumentDetailsByToken(token) {
        if (!this.scripMaster) {
            this.logger.warn("Scrip Master not loaded, cannot get details by token.");
            return null;
        }
        return this.tokenToDetailsMap.get(String(token)) || null;
    }

    getInstrumentDetails(symbol, exchange) {
        if (!this.scripMaster) {
            this.logger.warn("Scrip Master not loaded, cannot get details by symbol/exchange.");
            return null;
        }
        const key = `${symbol}_${exchange}`;
        const instrument = this.symbolAndExchangeToDetailsMap.get(key);
        
        if (!instrument) {
            // Try with EQ suffix if not found
            const eqKey = `${symbol}-EQ_${exchange}`;
            return this.symbolAndExchangeToDetailsMap.get(eqKey) || null;
        }
        return instrument;
    }

    findOption(underlyingName, strikePrice, expiryDate, optionType) {
        if (!this.scripMaster) {
            this.logger.warn("Scrip Master not loaded, cannot find option.");
            return null;
        }
        const formattedExpiry = moment(expiryDate, 'YYYY-MM-DD').format('DDMMMYY').toUpperCase();
        const strikePriceNum = parseFloat(strikePrice);

        return this.scripMaster.find(item =>
            item.name === underlyingName &&
            (item.instrumenttype === 'OPTIDX' || item.instrumenttype === 'OPTSTK') &&
            item.exch_seg === 'NFO' &&
            item.expiry.toUpperCase() === formattedExpiry &&
            parseFloat(item.strike) * 100 === strikePriceNum * 100 &&
            item.optiontype === optionType.toUpperCase()
        );
    }
}

module.exports = InstrumentManager;