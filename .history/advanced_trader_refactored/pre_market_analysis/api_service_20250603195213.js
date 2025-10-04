// File: /src/pre_market_analysis/api_service.js
const moment = require('moment-timezone');

class ApiService {
    constructor(masterController, instrumentManager, logger) {
        if (!masterController || !instrumentManager) {
            throw new Error("ApiService requires MasterController and InstrumentManager instances.");
        }
        this.masterController = masterController;
        this.instrumentManager = instrumentManager;
        this.logger = logger;
    }

    getSafeDateRange(durationDays) {
        let toDate = moment.tz("Asia/Kolkata");
        const realNow = moment.tz("Asia/Kolkata");
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
            // Validate essential parameters
            if (!params.tradingsymbol || !params.exchange || !params.interval || !params.from_date || !params.to_date) {
                this.logger.error(`[CandleFetch] Critical parameters missing for fetchHistoricalCandlesAPI. Received: ${JSON.stringify(params)}`);
                return [];
            }

            if (!params.symboltoken) {
                const instrument = this.instrumentManager.getInstrumentDetails(params.tradingsymbol, params.exchange);
                if (!instrument) {
                    this.logger.warn(`[CandleFetch] ScripMaster lookup failed for ${params.tradingsymbol} (${params.exchange}). Cannot fetch candles.`);
                    return [];
                }
                params.symboltoken = instrument.token || instrument.symboltoken; // Use 'token' or 'symboltoken'
                if (!params.symboltoken) {
                    this.logger.warn(`[CandleFetch] Symbol token still missing for ${params.tradingsymbol} after ScripMaster lookup.`);
                    return [];
                }
            }

            const intervalMap = { "15minute": "FIFTEEN_MINUTE", "60minute": "ONE_HOUR", "ONE_DAY": "ONE_DAY" };
            const apiInterval = intervalMap[params.interval]; // Directly use mapped value

            if (!apiInterval) {
                // Fallback if not in map, try uppercase (though config should ensure it's in map)
                this.logger.warn(`[CandleFetch] Interval "${params.interval}" not in standard map, attempting uppercase. Ensure config uses '15minute', '60minute', or 'ONE_DAY'.`);
                const upperInterval = params.interval.toUpperCase();
                if (["FIFTEEN_MINUTE", "ONE_HOUR", "ONE_DAY"].includes(upperInterval)) {
                    apiInterval = upperInterval;
                } else {
                    this.logger.error(`[CandleFetch] Invalid or unmapped interval: ${params.interval}. Cannot fetch candles.`);
                    return [];
                }
            }
            
            const candleParams = {
                exchange: params.exchange,
                symboltoken: params.symboltoken,
                // <mark style="background-color: red; color: white;">
                // CRITICAL: Ensuring 'interval' is part of candleParams
                // </mark>
                interval: apiInterval,
                fromdate: `${params.from_date} 09:00`, // Using 09:00 for broader start
                todate: (params.interval === "ONE_DAY" || apiInterval === "ONE_DAY") // Check both original and mapped
                    ? `${params.to_date} 15:30`
                    : `${params.to_date} ${moment.tz("Asia/Kolkata").format('HH:mm')}`
            };

            this.logger.debug(`[CandleFetch] Sending getCandleData for ${params.tradingsymbol}. Token: ${params.symboltoken}. Params: ${JSON.stringify(candleParams)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (response?.status === true && Array.isArray(response.data) && response.data.length > 0) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            // <mark style="background-color: red; color: white;">
            // Enhanced logging for failed candle fetch
            // </mark>
            this.logger.warn(`[CandleFetch] Failed to fetch candles or received empty data for ${params.tradingsymbol} (Interval: ${apiInterval}). API Response: ${JSON.stringify(response)}`);
            return []; // Return empty array on failure or no data
        } catch (error) {
            this.logger.error(`[CandleFetch] Exception during fetchHistoricalCandlesAPI for ${params.tradingsymbol}:`, error.message || error);
            return [];
        }
    }

    // This method is for ATM price using daily candles for stability
    async getCurrentPriceAPI(symbol, exchange, token) {
        this.logger.info(`Attempting to derive current price (ATM) for ${symbol} (${token || 'Token N/A'}) via last daily candle data...`);
        try {
            if (!token) { // Added check for token
                this.logger.warn(`[LTP_DERIVATION] Token is undefined for ${symbol}. Cannot fetch daily candles for ATM.`);
                return null;
            }
            const today = moment.tz("Asia/Kolkata");
            const toDateString = today.format('YYYY-MM-DD');
            const fromDateString = today.clone().subtract(10, 'days').format('YYYY-MM-DD');

            const candleParamsForLtp = {
                exchange: exchange,
                symboltoken: token,
                interval: "ONE_DAY",
                fromdate: `${fromDateString} 09:00`,
                todate: `${toDateString} 15:30`
            };

            this.logger.debug(`[LTP_DERIVATION] Sending getCandleData for ${symbol} (ATM). Token: ${token}. Params: ${JSON.stringify(candleParamsForLtp)}`);
            const candleResponse = await this.masterController.enqueueApiCall('getCandleData', [candleParamsForLtp]);

            if (candleResponse && candleResponse.status === true && Array.isArray(candleResponse.data) && candleResponse.data.length > 0) {
                const lastCandle = candleResponse.data[candleResponse.data.length - 1];
                const ltp = lastCandle[4];
                this.logger.info(`[LTP_DERIVATION] Derived ATM price for ${symbol} as ${ltp} from the close of the last daily candle.`);
                return { ltp: ltp };
            } else {
                this.logger.warn(`[LTP_DERIVATION] Could not derive ATM price for ${symbol}: No daily candle data found or unexpected format. API Response: ${JSON.stringify(candleResponse)}`);
                return null;
            }
        } catch (error) {
            this.logger.error(`[LTP_DERIVATION] Error in getCurrentPriceAPI (deriving ATM from daily candle) for ${symbol}:`, error.message || error);
            return null;
        }
    }
    
    async fetchOptionsDetailsByStrikes(underlyingSymbol, strikes, expiry) {
        const optionContracts = [];
        const baseSymbol = underlyingSymbol.replace('-EQ', '');
        for (const strike of strikes) {
            const ceDetails = this.instrumentManager.findOption(baseSymbol, strike, expiry, 'CE');
            if (ceDetails) optionContracts.push({ ...ceDetails, instrument_type: 'CE', strike_price: strike, expiry_date: expiry, symbol: ceDetails.symbol, lotsize: ceDetails.lotsize });
            
            const peDetails = this.instrumentManager.findOption(baseSymbol, strike, expiry, 'PE');
            if (peDetails) optionContracts.push({ ...peDetails, instrument_type: 'PE', strike_price: strike, expiry_date: expiry, symbol: peDetails.symbol, lotsize: peDetails.lotsize });
        }
        return optionContracts;
    }
}
module.exports = ApiService;