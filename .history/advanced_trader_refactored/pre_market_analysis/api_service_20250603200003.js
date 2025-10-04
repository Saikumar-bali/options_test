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
                params.symboltoken = instrument.token || instrument.symboltoken;
                if (!params.symboltoken) {
                    this.logger.warn(`[CandleFetch] Symbol token still missing for ${params.tradingsymbol} after ScripMaster lookup.`);
                    return [];
                }
            }
            const intervalMap = { "15minute": "FIFTEEN_MINUTE", "60minute": "ONE_HOUR", "ONE_DAY": "ONE_DAY" };
            let apiInterval = intervalMap[params.interval];
            if (!apiInterval) {
                this.logger.warn(`[CandleFetch] Interval "${params.interval}" not in standard map, attempting uppercase. Config should use '15minute', '60minute', or 'ONE_DAY'.`);
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
                interval: apiInterval,
                fromdate: `${params.from_date} 09:00`,
                todate: (params.interval === "ONE_DAY" || apiInterval === "ONE_DAY")
                    ? `${params.to_date} 15:30`
                    : `${params.to_date} ${moment.tz("Asia/Kolkata").format('HH:mm')}`
            };
            this.logger.debug(`[CandleFetch] Sending getCandleData for ${params.tradingsymbol}. Token: ${params.symboltoken}. Params: ${JSON.stringify(candleParams)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);
            if (response?.status === true && Array.isArray(response.data) && response.data.length > 0) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            this.logger.warn(`[CandleFetch] Failed to fetch candles or received empty data for ${params.tradingsymbol} (Interval: ${apiInterval}). API Response: ${JSON.stringify(response)}`);
            return [];
        } catch (error) {
            this.logger.error(`[CandleFetch] Exception during fetchHistoricalCandlesAPI for ${params.tradingsymbol}:`, error.message || error);
            return [];
        }
    }

    async getCurrentPriceAPI(symbol, exchange, token) { // For ATM price
        let attemptInterval = "ONE_DAY";
        let durationDays = 10; 
        this.logger.info(`Attempting to derive current price (ATM) for ${symbol} (Token: ${token || 'N/A'}) using ${attemptInterval} candles...`);

        try {
            if (!token) {
                this.logger.warn(`[LTP_DERIVATION] Token is undefined for ${symbol}. Cannot fetch candles for ATM.`);
                return null;
            }

            const today = moment.tz("Asia/Kolkata");
            let fromDateString = today.clone().subtract(durationDays, 'days').format('YYYY-MM-DD');
            let toDateString = today.format('YYYY-MM-DD');

            let candleParamsForLtp = {
                exchange: exchange,
                symboltoken: token,
                interval: attemptInterval,
                fromdate: `${fromDateString} 09:00`,
                todate: `${toDateString} 15:30`
            };

            this.logger.debug(`[LTP_DERIVATION] Sending getCandleData for ${symbol} (ATM). Token: ${token}. Params: ${JSON.stringify(candleParamsForLtp)}`);
            let apiResponse = await this.masterController.enqueueApiCall('getCandleData', [candleParamsForLtp]);

            if (apiResponse && apiResponse.status === true && Array.isArray(apiResponse.data) && apiResponse.data.length > 0) {
                const lastCandleArray = apiResponse.data[apiResponse.data.length - 1];
                const ltp = lastCandleArray[4];
                this.logger.info(`[LTP_DERIVATION] Derived ATM price for ${symbol} as ${ltp} from the close of the last ${attemptInterval} candle (${lastCandleArray[0]}).`);
                return { ltp: ltp };
            } else {
                this.logger.warn(`[LTP_DERIVATION] Could not derive ATM price for ${symbol} (using ${attemptInterval}). Status: ${apiResponse?.status}, ErrorCode: ${apiResponse?.errorcode}, Message: ${apiResponse?.message}, DataLength: ${apiResponse?.data?.length}. Full Response: ${JSON.stringify(apiResponse)}`);
                
                // Fallback for NIFTY/BANKNIFTY if daily fails with empty data but success status
                if ((symbol === "NIFTY" || symbol === "BANKNIFTY") && apiResponse?.status === true && (!apiResponse?.data || apiResponse.data.length === 0)) {
                    this.logger.info(`[LTP_DERIVATION_FALLBACK] Daily data for ${symbol} was empty. Attempting with ONE_HOUR data...`);
                    attemptInterval = "ONE_HOUR";
                    durationDays = 3; // Fetch last 3 days of hourly to get a recent close
                    fromDateString = today.clone().subtract(durationDays, 'days').format('YYYY-MM-DD');
                    
                    const hourlyParams = { 
                        ...candleParamsForLtp, 
                        interval: attemptInterval, 
                        fromdate: `${fromDateString} 09:00`,
                        // todate remains same (today 15:30), API will give up to available
                    };
                    this.logger.debug(`[LTP_DERIVATION_FALLBACK] Sending getCandleData for ${symbol} (ATM hourly). Params: ${JSON.stringify(hourlyParams)}`);
                    apiResponse = await this.masterController.enqueueApiCall('getCandleData', [hourlyParams]);
                    
                    if (apiResponse && apiResponse.status === true && Array.isArray(apiResponse.data) && apiResponse.data.length > 0) {
                        const lastHourlyCandleArray = apiResponse.data[apiResponse.data.length - 1];
                        const ltp = lastHourlyCandleArray[4];
                        this.logger.info(`[LTP_DERIVATION_FALLBACK] Derived ATM price for ${symbol} as ${ltp} from last ONE_HOUR candle (${lastHourlyCandleArray[0]}).`);
                        return { ltp: ltp };
                    } else {
                         this.logger.warn(`[LTP_DERIVATION_FALLBACK] Hourly data fetch for ${symbol} also failed or empty. Full Response: ${JSON.stringify(apiResponse)}`);
                    }
                }
                return null; 
            }
        } catch (error) {
            this.logger.error(`[LTP_DERIVATION] Exception in getCurrentPriceAPI (deriving ATM) for ${symbol}:`, error.message || error);
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
            if (peDetails) optionContracts.push({ ...peDetails, instrument_type: 'PE', strike_price: strike, expiry_date: expiry, symbol: ceDetails.symbol, lotsize: peDetails.lotsize });
        }
        return optionContracts;
    }
}
module.exports = ApiService;