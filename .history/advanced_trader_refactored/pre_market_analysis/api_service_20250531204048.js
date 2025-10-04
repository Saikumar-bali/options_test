// File: /src/pre_market_analysis/api_service.js
const moment = require('moment-timezone');

class ApiService {
    constructor(masterController) {
        if (!masterController) {
            throw new Error("ApiService requires a valid MasterController instance.");
        }
        this.masterController = masterController;
        this.instrumentCache = new Map(); // Cache to avoid repeated lookups
    }

    async fetchHistoricalCandlesAPI(params) {
        try {
            // If token is not provided, try to find it using the symbol.
            if (!params.symboltoken) {
                const instrument = await this.getInstrumentDetails(params.tradingsymbol, params.exchange);
                if (!instrument) {
                    console.warn(`Could not find instrument details for ${params.tradingsymbol} to fetch candles.`);
                    return [];
                }
                params.symboltoken = instrument.token;
            }

            const candleParams = {
                exchange: params.exchange,
                symboltoken: params.symboltoken,
                interval: params.interval.toUpperCase(),
                fromdate: `${params.from_date} 09:15`,
                todate: `${params.to_date} 15:30`
            };

            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);
            
            if (response && response.status && response.data) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            console.warn(`No candle data returned for ${params.tradingsymbol}.`);
            return [];
        } catch (error) {
            console.error(`Error fetching historical data for ${params.tradingsymbol}:`, error);
            return [];
        }
    }

    async getCurrentPriceAPI(symbol, exchange, token) {
        try {
            const ltpParams = { exchange, tradingsymbol: symbol, symboltoken: token };
            const response = await this.masterController.enqueueApiCall('getLTP', [ltpParams]);
            return (response && response.status && response.data) ? { ltp: response.data.ltp } : null;
        } catch (error) {
            console.error(`Error fetching LTP for ${symbol}:`, error);
            return null;
        }
    }
    
    async fetchOptionsDetailsByStrikes(underlyingSymbol, strikes, expiry) {
        const optionContracts = [];
        const expiryString = moment(expiry).format('DDMMMYY').toUpperCase();
        
        for (const strike of strikes) {
            const ceSymbol = `${underlyingSymbol}${expiryString}${strike}CE`;
            const peSymbol = `${underlyingSymbol}${expiryString}${strike}PE`;
            
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
            const exactMatch = response?.data?.find(item => item.symbol === symbol);
            if (exactMatch) {
                this.instrumentCache.set(symbol, exactMatch);
                return exactMatch;
            }
            return null;
        } catch (error) {
            console.error(`Error searching for script ${symbol}:`, error);
            return null;
        }
    }
}

module.exports = ApiService;