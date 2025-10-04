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
        
        // Handle weekends and holidays
        if (toDate.day() === 0) { // Sunday
            toDate = toDate.subtract(2, 'days');
        } else if (toDate.day() === 6) { // Saturday
            toDate = toDate.subtract(1, 'days');
        }
        
        // Ensure we're not requesting future dates
        if (toDate.isAfter(realNow, 'day')) {
            toDate = realNow.subtract(1, 'days');
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

            const intervalMap = {
                "15minute": "FIFTEEN_MINUTE",
                "60minute": "ONE_HOUR",
                "ONE_DAY": "ONE_DAY"
            };
            
            // Handle exchange-specific time formats
            let toTime = "15:30";
            if (params.exchange === 'MCX') toTime = "23:30";
            if (params.exchange === 'CDS') toTime = "19:00";
            
            const candleParams = {
                exchange: params.exchange,
                symboltoken: params.symboltoken,
                interval: intervalMap[params.interval] || params.interval.toUpperCase(),
                fromdate: `${params.from_date} 09:00`,
                todate: params.interval === "ONE_DAY"
                    ? `${params.to_date} ${toTime}`
                    : `${params.to_date} ${moment.tz("Asia/Kolkata").format('HH:mm')}`
            };

            this.logger.debug(`[CandleFetch] Sending getCandleData for ${params.tradingsymbol}. Token: ${params.symboltoken}. Params: ${JSON.stringify(candleParams)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (response?.status && Array.isArray(response.data)) {
                return response.data.map(c => ({
                    timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
                }));
            }

            this.logger.warn(`[CandleFetch] No candle data returned or unexpected format for ${params.tradingsymbol}. Response: ${JSON.stringify(response)}`);
            return [];
        } catch (error) {
            this.logger.error(`[CandleFetch] Error fetching historical data for ${params.tradingsymbol}:`, error.message || error);
            return [];
        }
    }

    async getCurrentPriceAPI(symbol, exchange, token) {
        try {
            let tokenToUse = token;
            if (!tokenToUse) {
                const instrument = this.instrumentManager.getInstrumentDetails(symbol, exchange);
                if (instrument && (instrument.token || instrument.symboltoken)) {
                    tokenToUse = instrument.token || instrument.symboltoken;
                    this.logger.info(`Resolved token for ${symbol}: ${tokenToUse}`);
                } else {
                    this.logger.warn(`[LTP_DERIVATION] Could not find instrument details for ${symbol} in Scrip Master.`);
                    return null;
                }
            }

            this.logger.info(`Attempting to derive current price (LTP) for ${symbol} (${tokenToUse}) via last candle data...`);
            
            // Get safe date range (handles weekends/holidays)
            const dateRange = this.getSafeDateRange(10);
            const fromDateString = dateRange.from_date;
            const toDateString = dateRange.to_date;

            // Handle exchange-specific time formats
            let toTime = "15:30";
            if (exchange === 'MCX') toTime = "23:30";
            if (exchange === 'CDS') toTime = "19:00";

            const candleParams = {
                exchange: exchange,
                symboltoken: tokenToUse,
                interval: "ONE_DAY",
                fromdate: `${fromDateString} 09:00`,
                todate: `${toDateString} ${toTime}`
            };

            this.logger.debug(`[LTP_DERIVATION] Sending getCandleData for ${symbol}. Token: ${tokenToUse}. Params: ${JSON.stringify(candleParams)}`);
            const candleResponse = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            // Handle 403 errors specifically
            if (candleResponse?.status === false && candleResponse?.message?.includes('403')) {
                this.logger.warn(`[LTP_DERIVATION] Access forbidden for ${symbol}. Using alternative token resolution.`);
                return this.handleForbiddenToken(symbol, exchange);
            }

            if (candleResponse && candleResponse.status === true && Array.isArray(candleResponse.data) && candleResponse.data.length > 0) {
                const lastCandle = candleResponse.data[candleResponse.data.length - 1];
                const ltp = lastCandle[4];
                this.logger.info(`[LTP_DERIVATION] Derived LTP for ${symbol} as ${ltp} from the close of the last daily candle (${lastCandle[0]}).`);
                return { ltp: ltp };
            } else {
                this.logger.warn(`[LTP_DERIVATION] Could not derive LTP for ${symbol}: No candle data found or unexpected format. Response: ${JSON.stringify(candleResponse)}`);
                return null;
            }
        } catch (error) {
            this.logger.error(`[LTP_DERIVATION] Error in getCurrentPriceAPI for ${symbol}:`, error.message || error);
            return null;
        }
    }

    async handleForbiddenToken(symbol, exchange) {
        try {
            // Special handling for indices
            if (symbol === 'BANKNIFTY' || symbol === 'NIFTY') {
                this.logger.info(`[LTP_DERIVATION] Using index token fallback for ${symbol}`);
                const indexToken = symbol === 'BANKNIFTY' ? '26009' : '26000';
                return this.getCurrentPriceAPI(symbol, exchange, indexToken);
            }
            
            // For equities, try removing suffix
            if (symbol.includes('-EQ')) {
                const baseSymbol = symbol.replace('-EQ', '');
                this.logger.info(`[LTP_DERIVATION] Trying base symbol without -EQ: ${baseSymbol}`);
                const instrument = this.instrumentManager.getInstrumentDetails(baseSymbol, exchange);
                if (instrument) {
                    return this.getCurrentPriceAPI(baseSymbol, exchange, instrument.token);
                }
            }
            
            // Try alternative token resolution
            const instrument = this.instrumentManager.getInstrumentDetails(symbol, exchange);
            if (instrument && instrument.alt_token) {
                this.logger.info(`[LTP_DERIVATION] Trying alternative token: ${instrument.alt_token}`);
                return this.getCurrentPriceAPI(symbol, exchange, instrument.alt_token);
            }
            
            this.logger.warn(`[LTP_DERIVATION] No fallback available for ${symbol}`);
            return null;
        } catch (fallbackError) {
            this.logger.error(`[LTP_DERIVATION] Fallback failed for ${symbol}:`, fallbackError.message);
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