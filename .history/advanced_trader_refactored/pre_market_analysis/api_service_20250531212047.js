// File: /src/pre_market_analysis/api_service.js
const moment = require('moment-timezone');

class ApiService {
    constructor(masterController) {
        if (!masterController) {
            throw new Error("ApiService requires a valid MasterController instance.");
        }
        this.masterController = masterController;
        this.instrumentCache = new Map();
        // It's good practice to have the logger available if the class uses it.
        // If PreMarketAnalyzer sets this.api.logger, this is fine.
        // Otherwise, consider passing logger in constructor if ApiService methods need to log.
        this.logger = masterController.logger || console; // Fallback to console if no logger passed
    }

    async fetchHistoricalCandlesAPI(params) {
        try {
            if (!params.symboltoken) {
                const instrument = await this.getInstrumentDetails(params.tradingsymbol, params.exchange);
                if (!instrument) {
                    this.logger.warn(`Could not find instrument details for ${params.tradingsymbol} to fetch candles.`);
                    return [];
                }
                // Ensure correct property access for symbol token
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
            const ltpParams = { exchange, tradingsymbol: symbol, symboltoken: token };
            
            // !!! IMPORTANT !!!
            // The method name 'getLtpData' below might be incorrect for your smartapi-javascript SDK version.
            // If you still see "API method getLtpData not found",
            // you MUST find the correct method name from your SDK's documentation
            // and replace 'getLtpData' with that correct name.
            // Common alternatives could be 'getLTP', 'ltp', 'fetchLTP', etc.
            const response = await this.masterController.enqueueApiCall('getLtpData', [ltpParams]);
            
            if (response?.status && response.data?.ltp !== undefined) {
                 return { ltp: response.data.ltp };
            }
            this.logger.warn(`Could not parse LTP from response for ${symbol}. Response: ${JSON.stringify(response)}`);
            return null;
        } catch (error) {
            // The error "API method ... not found" will be caught here if the method name is wrong.
            this.logger.error(`Error fetching LTP for ${symbol}:`, error);
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

            // Check if apiResponse itself is the array (based on RELIANCE-EQ log)
            if (Array.isArray(apiResponse)) {
                exactMatch = apiResponse.find(item => item.tradingsymbol === symbol && item.exchange === exchange);
            } 
            // Fallback for structure { data: [...] } or other successful object responses
            else if (apiResponse && apiResponse.status === true && Array.isArray(apiResponse.data)) {
                exactMatch = apiResponse.data.find(item => item.tradingsymbol === symbol && item.exchange === exchange);
            } 
            // Handle cases where apiResponse is an error object (like 403 for TCS, INFY) or unexpected structure
            else {
                 // Log only if it's not a known error structure we expect to just pass through
                if (!(apiResponse && typeof apiResponse.status === 'number' && apiResponse.status !== true)) {
                    this.logger.warn(`Unexpected response structure from searchScrip for ${symbol} in ${exchange}. Raw response: ${JSON.stringify(apiResponse)}`);
                }
            }

            if (exactMatch) {
                this.instrumentCache.set(cacheKey, exactMatch);
                return exactMatch;
            }
            
            // This warning will trigger if no match is found or if the API returned an error (e.g., 403)
            this.logger.warn(`Instrument details not found for symbol: ${symbol} in exchange: ${exchange}. API Response: ${JSON.stringify(apiResponse)}`);
            return null;
        } catch (error) {
            this.logger.error(`Error in getInstrumentDetails for ${symbol} (${exchange}):`, error);
            return null;
        }
    }
}

module.exports = ApiService;