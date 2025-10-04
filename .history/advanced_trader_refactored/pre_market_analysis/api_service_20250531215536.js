// File: /src/pre_market_analysis/api_service.js
const moment = require('moment-timezone');

class ApiService {
    constructor(masterController) {
        if (!masterController) {
            throw new Error("ApiService requires a valid MasterController instance.");
        }
        this.masterController = masterController;
        this.instrumentCache = new Map();
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
            
            // !!! ================================================================= !!!
            // !!! CRITICAL ACTION REQUIRED BY YOU                                   !!!
            // !!! ================================================================= !!!
            // The method name 'getLtpData' IS INCORRECT for your smartapi-javascript SDK.
            // The error "API method getLtpData not found" proves this.
            //
            // YOU MUST:
            // 1. FIND THE CORRECT METHOD NAME for fetching LTP in your SDK's documentation
            //    (or by inspecting the smartApiInstance object as described in the instructions).
            // 2. REPLACE 'getLtpData' below with that ACTUAL CORRECT METHOD NAME.
            // 3. VERIFY that 'ltpParams' MATCHES what the correct method expects.
            //
            // Example: If the correct method is 'fetchLTPQuote', change it to:
            // const response = await this.masterController.enqueueApiCall('fetchLTPQuote', [ltpParams]);
            //
            // Until this is done, LTP fetching WILL FAIL.
            // !!! ================================================================= !!!
            const response = await this.masterController.enqueueApiCall('getLtpData', [ltpParams]); 
            
            if (response?.status && response.data?.ltp !== undefined) {
                 return { ltp: response.data.ltp };
            }
            this.logger.warn(`Could not parse LTP from response for ${symbol} (after attempted call). Response: ${JSON.stringify(response)}`);
            return null;
        } catch (error) {
            // This catch block will receive the "API method ... not found" error if the name is still wrong.
            this.logger.error(`Error in getCurrentPriceAPI for ${symbol}:`);
            this.logger.error(`LTP Error Details (Stringified):`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
            this.logger.error(`LTP Error Message:`, error?.message); // This will show "API method ... not found"
            this.logger.error(`LTP Error Stack:`, error?.stack);
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

            if (Array.isArray(apiResponse)) {
                exactMatch = apiResponse.find(item => item.tradingsymbol === symbol && item.exchange === exchange);
            } 
            else if (apiResponse && apiResponse.status === true && Array.isArray(apiResponse.data)) {
                exactMatch = apiResponse.data.find(item => item.tradingsymbol === symbol && item.exchange === exchange);
            } 
            else if (apiResponse && typeof apiResponse.status === 'number' && apiResponse.status !== true) {
                // Known API error structure (e.g., 403), exactMatch remains null.
            }
            else { 
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