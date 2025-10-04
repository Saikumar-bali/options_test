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
            // If token is not provided, fetch instrument details first
            if (!token) {
                const instrument = await this.getInstrumentDetails(symbol, exchange);
                if (!instrument) {
                    this.logger.warn(`Could not find instrument details for ${symbol} to fetch LTP.`);
                    return null;
                }
                token = instrument.symboltoken;
            }
            
            // Use getCandleData to fetch the last close price as a fallback
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