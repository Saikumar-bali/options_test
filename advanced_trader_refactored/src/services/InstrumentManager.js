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

    /**
     * [CORRECTED] Normalizes data on load and builds maps.
     */
    buildInstrumentMaps() {
        this.logger.info("Normalizing Scrip Master data and building instrument maps...");
        this.scripMaster.forEach(item => {
            if (item && item.token) {
                // --- NORMALIZATION FIX ---
                // If opttype is missing/null, derive it from the symbol.
                if (item.instrumenttype?.startsWith('OPT') && !item.opttype && item.symbol) {
                    if (item.symbol.endsWith('CE')) {
                        item.opttype = 'CE';
                    } else if (item.symbol.endsWith('PE')) {
                        item.opttype = 'PE';
                    }
                }
                // --- END OF FIX ---

                this.tokenToDetailsMap.set(item.token, item);
                const key = `${item.symbol}-${item.exch_seg}`;
                this.symbolAndExchangeToDetailsMap.set(key, item);
            }
        });
        
        const sampleOption = this.scripMaster.find(i => i.name === 'NIFTY' && i.instrumenttype === 'OPTIDX');
        this.logger.debug(`Sample NIFTY option after normalization: ${JSON.stringify(sampleOption)}`);
        this.logger.info(`Scrip Master loaded with ${this.scripMaster.length} instruments.`);
    }

    getExpiriesForUnderlying(underlyingName) {
        if (!this.scripMaster) return [];
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
    
    /**
     * [CORRECTED] Finds an option contract with robust matching.
     */
    findOption(underlyingName, strikePrice, expiry, optionType) {
        if (!this.scripMaster) return null;

        const formattedExpiry = expiry.toUpperCase();
        const strikePriceNum = Number(strikePrice);

        const result = this.scripMaster.find(item => {
            if (!item || !item.name || !item.expiry || !item.strike || !item.instrumenttype) return false;
            
            const isNfoOption = (item.instrumenttype === 'OPTIDX' || item.instrumenttype === 'OPTSTK') && item.exch_seg === 'NFO';
            if (!isNfoOption) return false;
            
            const nameMatch = item.name === underlyingName;
            if (!nameMatch) return false;

            // --- ROBUST MATCHING LOGIC ---
            // 1. Use the correct field: 'opttype'
            const optTypeMatch = item.opttype === optionType;
            
            // 2. Compare strikes numerically, not as strings
            const itemStrikeNum = parseFloat(item.strike) / 100;
            const strikeMatch = Math.abs(itemStrikeNum - strikePriceNum) < 0.01;

            // 3. Match expiry
            const expiryMatch = item.expiry.toUpperCase() === formattedExpiry;
            // --- END OF LOGIC ---
            
            return nameMatch && expiryMatch && optTypeMatch && strikeMatch;
        });

        if (!result) {
            this.logger.warn(`Final search failed for: ${underlyingName} ${strikePriceNum} ${optionType} ${formattedExpiry}`);
        }

        return result || null;
    }
}

module.exports = InstrumentManager;