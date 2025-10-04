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

    /**
     * *** FIX: This new method corrects the date range to ensure the 'to' date is not in the future. ***
     * This prevents errors when the system clock is set ahead.
     */
    getSafeDateRange(durationDays) {
        let toDate = moment.tz("Asia/Kolkata");
        const realNow = moment(); // The actual current time

        // If the system clock is set to the future, use the real current time as the end date.
        if (toDate.isAfter(realNow)) {
            toDate = realNow;
        }

        const fromDate = toDate.clone().subtract(durationDays, 'days');
        return {
            from_date: fromDate.format('YYYY-MM-DD'),
            to_date: toDate.format('YYYY-MM-DD')
        };
    }

    async fetchHistoricalCandlesAPI(params) {
        try {
            if (!params.symboltoken) {
                const instrument = await this.getInstrumentDetails(params.tradingsymbol, params.exchange);
                if (!instrument) {
                    this.logger?.warn(`Could not find instrument details for ${params.tradingsymbol} to fetch candles.`);
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
            
            this.logger?.debug(`DEBUG: Sending getCandleData with params: ${JSON.stringify(candleParams)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (response?.status && Array.isArray(response.data)) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            
            this.logger?.warn(`No candle data returned for ${params.tradingsymbol}.`);
            return [];
        } catch (error) {
            this.logger?.error(`Error fetching historical data for ${params.tradingsymbol}:`, error.message);
            return [];
        }
    }

    async getCurrentPriceAPI(symbol, exchange, token) {
        try {
            const ltpParams = { exchange, tradingsymbol: symbol, symboltoken: token };
            
            // *** FIX: Changed getLTP to the correct method name, getLtpData. ***
            const response = await this.masterController.enqueueApiCall('getLtpData', [ltpParams]);
            
            return (response?.status && response.data) ? { ltp: response.data.ltp } : null;
        } catch (error) {
            this.logger?.error(`Error fetching LTP for ${symbol}:`, error);
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
            const exactMatch = response?.data?.find(item => item.symbol === symbol);

            if (exactMatch) {
                this.instrumentCache.set(symbol, exactMatch);
                return exactMatch;
            }
            return null;
        } catch (error) {
            this.logger?.error(`Error searching for script ${symbol}:`, error);
            return null;
        }
    }
}
module.exports = ApiService;