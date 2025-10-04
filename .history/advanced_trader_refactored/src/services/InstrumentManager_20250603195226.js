// File: /src/services/InstrumentManager.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const SCRIP_MASTER_PATH = path.join(__dirname, '../../pre_market_analysis/data_store/scripMaster.json'); // Adjusted based on typical structure


class InstrumentManager {
    constructor(logger) {
        this.logger = logger;
        this.scripMaster = null;
        this.tokenToDetailsMap = new Map();
        this.symbolAndExchangeToDetailsMap = new Map();
    }

    async initialize() {
        // ... (initialize method from your previous working version, ensuring scripMaster is loaded and maps are built)
        let scripMasterData;
        const dataStoreDir = path.dirname(SCRIP_MASTER_PATH);
        if (!fs.existsSync(dataStoreDir)) fs.mkdirSync(dataStoreDir, { recursive: true });

        let downloadNew = true;
        if (fs.existsSync(SCRIP_MASTER_PATH)) {
            const stats = fs.statSync(SCRIP_MASTER_PATH);
            const lastModified = moment(stats.mtime);
            if (moment().diff(lastModified, 'hours') < 24) {
                this.logger.info("Scrip Master is recent. Using local copy.");
                try {
                    scripMasterData = JSON.parse(fs.readFileSync(SCRIP_MASTER_PATH, 'utf-8'));
                    downloadNew = false;
                } catch (e) {
                    this.logger.error(`Error parsing local Scrip Master: ${e.message}. Will attempt download.`);
                    downloadNew = true;
                }
            }
        }

        if (downloadNew) {
            try {
                this.logger.info("Downloading latest Scrip Master file...");
                const response = await axios.get(SCRIP_MASTER_URL);
                fs.writeFileSync(SCRIP_MASTER_PATH, JSON.stringify(response.data, null, 2));
                this.logger.info("✅ Scrip Master downloaded successfully.");
                scripMasterData = response.data;
            } catch (downloadError) {
                this.logger.error(`Failed to download Scrip Master: ${downloadError.message}.`);
                if (fs.existsSync(SCRIP_MASTER_PATH) && !scripMasterData) { // If download failed and no prior data loaded
                    this.logger.info("Attempting to use existing local Scrip Master due to download failure...");
                    try {
                        scripMasterData = JSON.parse(fs.readFileSync(SCRIP_MASTER_PATH, 'utf-8'));
                    } catch (e) {
                        this.logger.error(`Error parsing local Scrip Master after download fail: ${e.message}.`);
                    }
                }
            }
        }
        
        if (Array.isArray(scripMasterData)) {
            this.scripMaster = scripMasterData;
            this.buildInstrumentMaps();
            this.logger.info(`Scrip Master loaded with ${this.tokenToDetailsMap.size} mapped instruments by token.`);
        } else {
            this.logger.error("Scrip Master data is not an array or couldn't be loaded. Instrument lookups will fail.");
            this.scripMaster = [];
        }
    }
    
    buildInstrumentMaps() {
        this.tokenToDetailsMap.clear();
        this.symbolAndExchangeToDetailsMap.clear();
        if (!this.scripMaster || !Array.isArray(this.scripMaster)) {
            this.logger.warn("Cannot build instrument maps: scripMaster is null or not an array.");
            return;
        }
        this.logger.info("Building instrument maps for fast lookup...");
        for (const instrument of this.scripMaster) {
            if (instrument.token) {
                this.tokenToDetailsMap.set(String(instrument.token), instrument);
            }
            // For symbol-based lookup, prioritize 'tradingsymbol' if available, else 'symbol'
            const lookupSymbol = instrument.tradingsymbol || instrument.symbol;
            if (lookupSymbol && instrument.exch_seg) {
                 // Handle NIFTY/BANKNIFTY name vs symbol variations if necessary based on scrip master content
                const keySymbol = (instrument.name === "NIFTY" || instrument.name === "BANKNIFTY") ? instrument.name : lookupSymbol;
                const key = `${keySymbol}_${instrument.exch_seg}`;
                this.symbolAndExchangeToDetailsMap.set(key, instrument);
            }
        }
         this.logger.info(`Built maps. Token map size: ${this.tokenToDetailsMap.size}, Symbol map size: ${this.symbolAndExchangeToDetailsMap.size}`);
    }

    getInstrumentDetails(symbol, exchange) { // Used by PreMarketAnalyzer to get token for underlyings
        if (!this.symbolAndExchangeToDetailsMap.size) this.buildInstrumentMaps(); // Failsafe
        
        // Try direct match first (e.g., "RELIANCE-EQ_NSE")
        let key = `${symbol}_${exchange}`;
        let instrument = this.symbolAndExchangeToDetailsMap.get(key);

        // Fallback for indices if direct key fails (scrip master might use "NIFTY" as symbol for "NIFTY" name)
        if (!instrument && (symbol === "NIFTY" || symbol === "BANKNIFTY") && exchange === "NSE") {
            key = `${symbol}_${exchange}`; // This key should be built correctly in buildInstrumentMaps using item.name
            instrument = this.symbolAndExchangeToDetailsMap.get(key);
        }
        
        if (!instrument) {
            // this.logger.debug(`[getInstrumentDetails] Instrument not found for key: ${key}`);
        }
        return instrument || null;
    }

    getInstrumentByToken(token) {
        if (!this.tokenToDetailsMap.size) this.buildInstrumentMaps();
        return this.tokenToDetailsMap.get(String(token)) || null;
    }
    
    // <mark style="background-color: red; color: white;">
    // MODIFIED findOption with DETAILED LOGGING
    // </mark>
    findOption(underlyingName, strikePrice, expiryDate, optionType) { // underlyingName e.g. "TCS", "NIFTY"
        if (!this.scripMaster) {
            this.logger.warn("[findOption] Scrip Master not loaded. Cannot find option.");
            return null;
        }
        
        const strikePriceNum = parseFloat(strikePrice);
        const formattedExpiry = moment(expiryDate, 'YYYY-MM-DD').format('DDMMMYYYY').toUpperCase(); // e.g., 05JUN2025
        const upperOptionType = optionType.toUpperCase(); // CE or PE

        // this.logger.debug(`[findOption] Searching for: Name=${underlyingName}, Strike=${strikePriceNum}, Expiry=${formattedExpiry}, Type=${upperOptionType}`);

        const foundOption = this.scripMaster.find(item => {
            // Basic filtering for options
            if (item.exch_seg !== 'NFO' || (item.instrumenttype !== 'OPTIDX' && item.instrumenttype !== 'OPTSTK')) {
                return false;
            }

            const itemName = item.name ? item.name.toUpperCase() : '';
            const itemExpiry = item.expiry ? item.expiry.toUpperCase() : '';
            const itemOptType = item.opttype ? item.opttype.toUpperCase() : ''; // Scrip master uses 'opttype'
            const itemStrike = parseFloat(item.strike); // Scrip master strike is usually in actual value * 100 (paisa)

            const itemStrikeInRupees = itemStrike / 100;

            const nameMatch = itemName === underlyingName.toUpperCase();
            const expiryMatch = itemExpiry === formattedExpiry;
            const optTypeMatch = itemOptType === upperOptionType;
            const strikeMatch = Math.abs(itemStrikeInRupees - strikePriceNum) < 0.01; // Comparing rupee values

            // if (nameMatch && expiryMatch && optTypeMatch && strikePriceNum === YOUR_TARGET_STRIKE_FOR_LOGGING) { // Temporarily log one specific case
            //     this.logger.debug(`[findOptionDebug] Checking item: ${item.symbol} | Name: ${itemName} (Match:${nameMatch}) | Expiry: ${itemExpiry} (Match:${expiryMatch}) | OptType: ${itemOptType} (Match:${optTypeMatch}) | ScripStrike: ${itemStrikeInRupees}, TargetStrike: ${strikePriceNum} (Match:${strikeMatch})`);
            // }
            
            return nameMatch && expiryMatch && optTypeMatch && strikeMatch;
        });

        if (!foundOption) {
             this.logger.debug(`[findOption] No match found for ${underlyingName} ${strikePriceNum} ${upperOptionType} ${formattedExpiry}`);
        } else {
            // this.logger.debug(`[findOption] Found: ${foundOption.symbol}`);
        }
        return foundOption || null;
    }
}

module.exports = InstrumentManager;