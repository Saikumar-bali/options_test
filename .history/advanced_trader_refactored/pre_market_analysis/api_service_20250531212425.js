// File: /src/pre_market_analysis/api_service.js
const moment = require('moment-timezone');

class ApiService {
    constructor(masterController) {
        if (!masterController) {
            throw new Error("ApiService requires a valid MasterController instance.");
        }
        this.masterController = masterController;
        this.instrumentCache = new Map();
        // Ensure logger is available. PreMarketAnalyzer passes it as this.api.logger.
        // Fallback to console if not explicitly set.
        this.logger = masterController.logger || console; 
    }

    async fetchHistoricalCandlesAPI(params) {
        try {
            if (!params.symboltoken) {
                const instrument = await this.getInstrumentDetails(params.tradingsymbol, params.exchange);
                if (!instrument) {
                    this.logger.warn(`Could not find instrument details for ${params.tradingsymbol} to fetch candles.`);
                    return [];
                }
                params.symboltoken = instrument.symboltoken; 
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
            
            this.logger.debug?.(`DEBUG: Sending getCandleData with params: ${JSON.stringify(candleParams)}`); // Safely call debug
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
            const ltpParams = { exchange, tradingsymbol: symbol, symboltoken: token };
            
            // !!! VERY IMPORTANT !!!
            // 1. VERIFY METHOD NAME: 'getLtpData' might still be incorrect for your smartapi-javascript SDK.
            //    If you get "method not found" errors, find the correct name in your SDK's documentation.
            // 2. VERIFY PARAMETERS: Even if the name is right, the 'ltpParams' structure must match
            //    exactly what your SDK's LTP function expects. Check the SDK documentation.
            const response = await this.masterController.enqueueApiCall('getLtpData', [ltpParams]); // Or the correct method name
            
            if (response?.status && response.data?.ltp !== undefined) {
                 return { ltp: response.data.ltp };
            }
            this.logger.warn(`Could not parse LTP from response for ${symbol}. Response: ${JSON.stringify(response)}`);
            return null;
        } catch (error) {
            this.logger.error(`Error fetching LTP for ${symbol}.`);
            this.logger.error(`LTP Error Object (Stringified with props):`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
            this.logger.error(`LTP Error Message:`, error?.message);
            this.logger.error(`LTP Error Stack:`, error?.stack);
            // The `{}` you see suggests the error object might be empty or non-standard.
            // More detailed logging in MasterController.processApiCallQueue for the initial catch might be needed if this isn't enough.
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
        
        try {
            const apiResponse = await this.masterController.enqueueApiCall('searchScrip', [{ exchange, searchscrip: symbol }]);
            let exactMatch = null;

            if (Array.isArray(apiResponse)) { // Handles cases like RELIANCE-EQ success
                exactMatch = apiResponse.find(item => item.tradingsymbol === symbol && item.exchange === exchange);
            } 
            else if (apiResponse && apiResponse.status === true && Array.isArray(apiResponse.data)) { // Standard success response
                exactMatch = apiResponse.data.find(item => item.tradingsymbol === symbol && item.exchange === exchange);
            } 
            // apiResponse might be an error object from the API (e.g., 403 for INFY) or an unexpected structure
            else if (apiResponse && typeof apiResponse.status === 'number' && apiResponse.status !== true) {
                // This is an error response from the API, like the 403 for INFY. exactMatch remains null.
            }
            else { // Unexpected structure not fitting known success or error patterns
                this.logger.warn(`Unexpected response structure from searchScrip for ${symbol} in ${exchange}. Raw response: ${JSON.stringify(apiResponse)}`);
            }

            if (exactMatch) {
                this.instrumentCache.set(cacheKey, exactMatch);
                return exactMatch;
            }
            
            this.logger.warn(`Instrument details not found for symbol: ${symbol} in exchange: ${exchange}. API Response: ${JSON.stringify(apiResponse)}`);
            return null;
        } catch (error) {
            this.logger.error(`Error in getInstrumentDetails for ${symbol} (${exchange}):`, error);
            return null;
        }
    }
}

module.exports = ApiService;