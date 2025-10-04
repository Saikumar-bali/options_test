// File: /src/pre_market_analysis/api_service.js
const moment = require('moment-timezone');

class ApiService {
    constructor(masterController) {
        if (!masterController) {
            throw new Error("ApiService requires a valid MasterController instance.");
        }
        this.masterController = masterController;
        this.instrumentCache = new Map();
    }

    async fetchHistoricalCandlesAPI(params) {
        try {
            if (!params.symboltoken) {
                const instrument = await this.getInstrumentDetails(params.tradingsymbol, params.exchange);
                if (!instrument) {
                    console.warn(`Could not find instrument details for ${params.tradingsymbol} to fetch candles.`);
                    return [];
                }
                // FIX 3: Access the correct property for symbol token
                params.symboltoken = instrument.symboltoken;
            }

            // Map user-friendly intervals to API-specific strings
            const intervalMap = { "15minute": "FIFTEEN_MINUTE", "60minute": "ONE_HOUR" };
            const apiInterval = intervalMap[params.interval] || params.interval.toUpperCase();

            const candleParams = {
                exchange: params.exchange,
                symboltoken: params.symboltoken,
                interval: apiInterval,
                fromdate: `${params.from_date} 09:15`,
                todate: `${params.to_date} 15:30`
            };
            
            this.logger?.debug(`DEBUG: Sending getCandleData with params: ${JSON.stringify(candleParams)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (response && response.status && response.data && Array.isArray(response.data)) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            
            console.warn(`No candle data returned for ${params.tradingsymbol}. Full response: ${JSON.stringify(response)}`);
            return [];
        } catch (error) {
            console.error(`Error fetching historical data for ${params.tradingsymbol}:`, error.message);
            return [];
        }
    }

    async getCurrentPriceAPI(symbol, exchange, token) {
        try {
            const ltpParams = { exchange, tradingsymbol: symbol, symboltoken: token };
            // FIX 1: Use the correct API method name for LTP (assuming 'getLtpData')
            // Replace 'getLtpData' if your SDK uses a different name (e.g., 'ltpData', 'fetchLTP')
            const response = await this.masterController.enqueueApiCall('getLtpData', [ltpParams]);
            return (response?.status && response.data) ? { ltp: response.data.ltp } : null;
        } catch (error) {
            console.error(`Error fetching LTP for ${symbol}:`, error);
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
        if (this.instrumentCache.has(symbol)) return this.instrumentCache.get(symbol);
        try {
            const response = await this.masterController.enqueueApiCall('searchScrip', [{ exchange, searchscrip: symbol }]);
            // FIX 2: Match against 'tradingsymbol' instead of 'symbol'
            const exactMatch = response?.data?.find(item => item.tradingsymbol === symbol);
            if (exactMatch) {
                this.instrumentCache.set(symbol, exactMatch);
                return exactMatch;
            }
            console.warn(`Instrument details not found for symbol: ${symbol} in exchange: ${exchange}. Response: ${JSON.stringify(response)}`);
            return null;
        } catch (error) {
            console.error(`Error searching for script ${symbol}:`, error);
            return null;
        }
    }
}

module.exports = ApiService;