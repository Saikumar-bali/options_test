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

    async fetchHistoricalCandlesAPI(params) { // params comes from PreMarketAnalyzer
        try {
            if (!params.tradingsymbol || !params.exchange || !params.interval || !params.from_date || !params.to_date) {
                this.logger.error(`[CandleFetch] Missing critical parameters in call to fetchHistoricalCandlesAPI: ${JSON.stringify(params)}`);
                return [];
            }
            
            if (!params.symboltoken) {
                const instrument = this.instrumentManager.getInstrumentDetails(params.tradingsymbol, params.exchange);
                if (!instrument) {
                    this.logger.warn(`[CandleFetch] Could not find instrument details for ${params.tradingsymbol} in Scrip Master.`);
                    return [];
                }
                params.symboltoken = instrument.token || instrument.symboltoken;
                if (!params.symboltoken) {
                    this.logger.warn(`[CandleFetch] Symbol token missing for ${params.tradingsymbol} even after Scrip Master lookup.`);
                    return [];
                }
            }

            const intervalMap = { "15minute": "FIFTEEN_MINUTE", "60minute": "ONE_HOUR", "ONE_DAY": "ONE_DAY" };
            const apiInterval = intervalMap[params.interval] || params.interval.toUpperCase();

            if (!apiInterval) {
                 this.logger.error(`[CandleFetch] Could not determine API interval for input: ${params.interval}`);
                 return [];
            }

            const candleParams = {
                exchange: params.exchange,
                symboltoken: params.symboltoken,
                // <mark style="background-color: red; color: white;">
                // Ensure 'interval' is correctly set using apiInterval
                // </mark>
                interval: apiInterval, 
                fromdate: `${params.from_date} 09:00`, // Consistent start time
                todate: params.interval === "ONE_DAY"
                    ? `${params.to_date} 15:30` // Fixed EOD for daily
                    : `${params.to_date} ${moment.tz("Asia/Kolkata").format('HH:mm')}` // Current time for intraday
            };

            this.logger.debug(`[CandleFetch] Sending getCandleData for ${params.tradingsymbol}. Token: ${params.symboltoken}. Params: ${JSON.stringify(candleParams)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (response?.status === true && Array.isArray(response.data)) { // Check for explicit true status
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            this.logger.warn(`[CandleFetch] No candle data returned or unexpected format for ${params.tradingsymbol}. API Response: ${JSON.stringify(response)}`);
            return [];
        } catch (error) {
            this.logger.error(`[CandleFetch] Error fetching historical data for ${params.tradingsymbol}:`, error.message || error);
            return [];
        }
    }

    async getCurrentPriceAPI(symbol, exchange, token) { // This is used for deriving ATM from daily candles
        this.logger.info(`Attempting to derive current price (ATM) for ${symbol} (${token}) via last daily candle data...`);
        try {
            const today = moment.tz("Asia/Kolkata");
            const toDateString = today.format('YYYY-MM-DD');
            const fromDateString = today.clone().subtract(10, 'days').format('YYYY-MM-DD');

            const candleParamsForLtp = {
                exchange: exchange,
                symboltoken: token,
                interval: "ONE_DAY", // Intentionally using ONE_DAY for stable ATM price derivation
                fromdate: `${fromDateString} 09:00`,
                todate: `${toDateString} 15:30`
            };

            this.logger.debug(`[LTP_DERIVATION] Sending getCandleData for ${symbol}. Token: ${token}. Params: ${JSON.stringify(candleParamsForLtp)}`);
            const candleResponse = await this.masterController.enqueueApiCall('getCandleData', [candleParamsForLtp]);

            if (candleResponse && candleResponse.status === true && Array.isArray(candleResponse.data) && candleResponse.data.length > 0) {
                const lastCandle = candleResponse.data[candleResponse.data.length - 1];
                const ltp = lastCandle[4];
                this.logger.info(`[LTP_DERIVATION] Derived ATM price for ${symbol} as ${ltp} from the close of the last daily candle (${lastCandle[0]}).`);
                return { ltp: ltp };
            } else {
                this.logger.warn(`[LTP_DERIVATION] Could not derive ATM price for ${symbol}: No daily candle data found or unexpected format. Response: ${JSON.stringify(candleResponse)}`);
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
            if (ceDetails) optionContracts.push({ ...ceDetails, instrument_type: 'CE', strike_price: strike, expiry_date: expiry });

            const peDetails = this.instrumentManager.findOption(baseSymbol, strike, expiry, 'PE');
            if (peDetails) optionContracts.push({ ...peDetails, instrument_type: 'PE', strike_price: strike, expiry_date: expiry });
        }
        return optionContracts;
    }
}
module.exports = ApiService;