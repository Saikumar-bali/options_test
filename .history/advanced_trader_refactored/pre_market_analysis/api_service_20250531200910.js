// File: /src/pre_market_analysis/api_service.js
const moment = require('moment-timezone');

class ApiService {
    constructor(masterController) {
        if (!masterController) {
            throw new Error("ApiService requires a valid MasterController instance.");
        }
        this.masterController = masterController;
    }

    /**
     * Fetches historical candle data using the MasterController.
     * @param {object} params - { tradingsymbol, exchange, interval, from_date, to_date }
     * @returns {Promise<Array>} A promise that resolves to an array of candle objects.
     */
    async fetchHistoricalCandlesAPI(params) {
        try {
            // First, we need the token for the given tradingsymbol
            const instrument = await this.getInstrumentDetails(params.tradingsymbol, params.exchange);
            if (!instrument) {
                console.warn(`Could not find instrument details for ${params.tradingsymbol}`);
                return [];
            }

            const candleParams = {
                exchange: params.exchange,
                symboltoken: instrument.token,
                interval: params.interval.toUpperCase(), // API might expect 'ONE_MINUTE', 'FIFTEEN_MINUTE', etc.
                fromdate: `${params.from_date} 09:15`,
                todate: `${params.to_date} 15:30`
            };

            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);
            
            if (response && response.status && response.data) {
                // Map the API response to our standardized candle format
                return response.data.map(c => ({
                    timestamp: c[0],
                    open: c[1],
                    high: c[2],
                    low: c[3],
                    close: c[4],
                    volume: c[5]
                }));
            }
            console.warn(`No candle data returned for ${params.tradingsymbol}. Response:`, response);
            return [];
        } catch (error) {
            console.error(`Error fetching historical data for ${params.tradingsymbol}:`, error);
            return [];
        }
    }

    /**
     * Fetches the current Last Traded Price (LTP) for an instrument.
     * @param {string} symbol - The trading symbol (e.g., 'NIFTY', 'RELIANCE').
     * @param {string} exchange - The exchange (e.g., 'NSE', 'NFO').
     * @returns {Promise<object|null>} A promise resolving to an object like { ltp: 123.45 } or null.
     */
    async getCurrentPriceAPI(symbol, exchange) {
        try {
            const instrument = await this.getInstrumentDetails(symbol, exchange);
            if (!instrument) return null;

            const ltpParams = {
                exchange: instrument.exch_seg,
                tradingsymbol: instrument.symbol,
                symboltoken: instrument.token
            };
            const response = await this.masterController.enqueueApiCall('getLTP', [ltpParams]);
            
            if (response && response.status && response.data) {
                return { ltp: response.data.ltp };
            }
            return null;
        } catch (error) {
            console.error(`Error fetching LTP for ${symbol}:`, error);
            return null;
        }
    }
    
    /**
     * Simulates fetching an options chain by searching for specific contracts.
     * A true options chain API would be more efficient.
     * @param {string} underlyingSymbol - e.g., 'NIFTY'.
     * @param {number} atmPrice - The current price to find strikes around.
     * @param {Array<number>} strikes - The list of strike prices to search for.
     * @returns {Promise<Array>} A promise resolving to a list of found option instrument details.
     */
    async fetchOptionsDetailsByStrikes(underlyingSymbol, atmPrice, strikes, expiry) {
        const optionContracts = [];
        const expiryString = moment(expiry).format('DDMMMYY').toUpperCase();
        
        for (const strike of strikes) {
            const ceSymbol = `${underlyingSymbol}${expiryString}${strike}CE`;
            const peSymbol = `${underlyingSymbol}${expiryString}${strike}PE`;
            
            const [ceDetails, peDetails] = await Promise.all([
                this.getInstrumentDetails(ceSymbol, 'NFO'),
                this.getInstrumentDetails(peSymbol, 'NFO')
            ]);
            
            if(ceDetails) optionContracts.push({ ...ceDetails, instrument_type: 'CE', strike_price: strike, expiry_date: expiry });
            if(peDetails) optionContracts.push({ ...peDetails, instrument_type: 'PE', strike_price: strike, expiry_date: expiry });
        }
        
        return optionContracts;
    }


    /**
     * A helper to get the full instrument details (like token) using a symbol.
     * This caches results to avoid repeated API calls for the same symbol.
     */
    async getInstrumentDetails(symbol, exchange) {
        // Simple in-memory cache
        if (!this.instrumentCache) this.instrumentCache = new Map();
        if (this.instrumentCache.has(symbol)) return this.instrumentCache.get(symbol);

        try {
            const searchParams = {
                "exchange": exchange,
                "searchscrip": symbol
            };
            const response = await this.masterController.enqueueApiCall('searchScrip', [searchParams]);

            if (response && response.status && response.data && response.data.length > 0) {
                // Find the exact match
                const exactMatch = response.data.find(item => item.symbol === symbol);
                if (exactMatch) {
                    this.instrumentCache.set(symbol, exactMatch);
                    return exactMatch;
                }
            }
            // console.warn(`Instrument not found for symbol: ${symbol}`);
            return null;
        } catch (error) {
            console.error(`Error searching for script ${symbol}:`, error);
            return null;
        }
    }
}

module.exports = ApiService;