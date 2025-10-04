// File: /src/pre_market_analysis/api_service.js
const axios = require('axios');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const SCRIP_MASTER_CACHE_PATH = path.resolve(__dirname, 'scrip_master_cache.json');

class ApiService {
    constructor(masterController) {
        if (!masterController) {
            throw new Error("ApiService requires a valid MasterController instance.");
        }
        this.masterController = masterController;
        this.instrumentCache = new Map();
        this.logger = masterController.logger || console;
        this.scripMaster = null;
    }

    async initialize() {
        await this.loadScripMaster();
    }

    async loadScripMaster() {
        try {
            // Try to load from cache first
            if (fs.existsSync(SCRIP_MASTER_CACHE_PATH)) {
                const cacheData = fs.readFileSync(SCRIP_MASTER_CACHE_PATH, 'utf8');
                this.scripMaster = JSON.parse(cacheData);
                this.logger.info(`Loaded scrip master from cache with ${this.scripMaster.length} instruments`);
                return;
            }
        } catch (error) {
            this.logger.warn('Failed to load scrip master cache:', error.message);
        }

        try {
            // Fetch fresh scrip master data
            this.logger.info('Downloading fresh scrip master data...');
            const response = await axios.get(SCRIP_MASTER_URL);
            this.scripMaster = response.data;
            
            // Process and cache the data
            this.scripMaster = this.scripMaster.map(entry => ({
                ...entry,
                expiry: entry.expiry ? moment(entry.expiry, 'DD-MMM-YYYY').format('DDMMMYYYY').toUpperCase() : null,
                strike: entry.strike || '-1.000000',
                optionType: (entry.instrumenttype?.startsWith('OPT') && entry.symbol) ? 
                           entry.symbol.slice(-2) : null
            }));

            // Save to cache
            fs.writeFileSync(SCRIP_MASTER_CACHE_PATH, JSON.stringify(this.scripMaster, null, 2));
            this.logger.info(`Downloaded and cached scrip master with ${this.scripMaster.length} instruments`);
        } catch (error) {
            this.logger.error('Failed to fetch scrip master:', error.message);
            throw new Error('Could not load instrument data');
        }
    }

    async fetchHistoricalCandlesAPI(params) {
        try {
            if (!params.symboltoken) {
                const instrument = await this.getInstrumentDetails(params.tradingsymbol, params.exchange);
                if (!instrument) {
                    this.logger.warn(`Could not find instrument details for ${params.tradingsymbol} to fetch candles.`);
                    return [];
                }
                params.symboltoken = instrument.token; 
            }

            const intervalMap = { "15minute": "FIFTEEN_MINUTE", "60minute": "ONE_HOUR" };
            const apiInterval = intervalMap[params.interval] || params.interval.toUpperCase();

            const candleParams = {
                exchange: params.exchange,
                symboltoken: params.symboltoken,
                interval: apiInterval,
                fromdate: `${params.from_date} 09:15`,
                todate: `${params.to_date} 15:30`
            };
            
            this.logger.debug?.(`DEBUG: Sending getCandleData with params: ${JSON.stringify(candleParams)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (response && response.status && response.data && Array.isArray(response.data)) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            
            this.logger.warn(`No candle data returned for ${params.tradingsymbol}. Full response: ${JSON.stringify(response)}`);
            return [];
        } catch (error) {
            this.logger.error(`Error fetching historical data for ${params.tradingsymbol}:`, error.message);
            return [];
        }
    }

    async getCurrentPriceAPI(symbol, exchange, token) {
        try {
            // If token is not provided, fetch instrument details first
            if (!token) {
                const instrument = await this.getInstrumentDetails(symbol, exchange);
                if (!instrument) {
                    this.logger.warn(`Could not find instrument details for ${symbol} to fetch LTP.`);
                    return null;
                }
                token = instrument.token;
            }
            
            // Use getCandleData to fetch the last close price
            const toDate = moment().tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm');
            const fromDate = moment().tz("Asia/Kolkata").subtract(2, 'days').format('YYYY-MM-DD HH:mm');
            
            const params = {
                exchange: exchange,
                symboltoken: token,
                interval: "ONE_DAY",
                fromdate: fromDate,
                todate: toDate
            };

            this.logger.debug?.(`DEBUG: Fetching last close for ${symbol} with params: ${JSON.stringify(params)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [params]);
            
            // Handle response and extract last close price
            if (response && response.status && response.data && Array.isArray(response.data) && response.data.length > 0) {
                const lastCandle = response.data[response.data.length - 1];
                const closePriceIndex = 4; // [timestamp, open, high, low, close, volume]
                
                if (lastCandle && typeof lastCandle[closePriceIndex] === 'number') {
                    return { ltp: lastCandle[closePriceIndex] };
                }
            }
            
            this.logger.warn(`Could not fetch last close for ${symbol}. Response: ${JSON.stringify(response)}`);
            return null;
        } catch (error) {
            this.logger.error(`Error in getCurrentPriceAPI for ${symbol}:`, error.message);
            return null;
        }
    }
    
    async fetchOptionsDetailsByStrikes(underlyingSymbol, strikes, expiry) {
        const optionContracts = [];
        const underlyingBaseSymbol = underlyingSymbol.replace('-EQ', '');
        const expiryString = moment(expiry).format('DDMMMYY').toUpperCase();
        
        for (const strike of strikes) {
            const ceSymbol = `${underlyingBaseSymbol}${expiryString}${strike}CE`;
            const peSymbol = `${underlyingBaseSymbol}${expiryString}${strike}PE`;
            
            const [ceDetails, peDetails] = await Promise.all([
                this.getInstrumentDetails(ceSymbol, 'NFO'),
                this.getInstrumentDetails(peSymbol, 'NFO')
            ]);
            
            if (ceDetails) optionContracts.push({ ...ceDetails, instrument_type: 'CE', strike_price: strike, expiry_date: expiry });
            if (peDetails) optionContracts.push({ ...peDetails, instrument_type: 'PE', strike_price: strike, expiry_date: expiry });
        }
        return optionContracts;
    }

    async getInstrumentDetails(symbol, exchange) {
        const cacheKey = `${symbol}_${exchange}`;
        if (this.instrumentCache.has(cacheKey)) return this.instrumentCache.get(cacheKey);
        
        if (!this.scripMaster) {
            await this.initialize();
        }

        const entry = this.scripMaster.find(item => 
            item.tradingsymbol === symbol && 
            item.exch_seg === exchange
        );

        if (entry) {
            // Map to expected format
            const instrument = {
                token: entry.token,
                symboltoken: entry.token, // alias for compatibility
                tradingsymbol: entry.tradingsymbol,
                exchange: entry.exch_seg,
                name: entry.name,
                instrumenttype: entry.instrumenttype,
                strike: entry.strike,
                expiry: entry.expiry
            };
            
            this.instrumentCache.set(cacheKey, instrument);
            return instrument;
        }
        
        this.logger.warn(`Instrument details not found for symbol: ${symbol} in exchange: ${exchange}`);
        return null;
    }
}

module.exports = ApiService;