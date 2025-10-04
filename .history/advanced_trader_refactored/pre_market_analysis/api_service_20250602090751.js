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

    /**
     * *** FIX: Creates a more robust date range, ending on the last trading day. ***
     */
    getSafeDateRange(durationDays) {
        let toDate = moment.tz("Asia/Kolkata");
        
        // If it's the weekend or Monday morning before market open, set 'todate' to last Friday
        if (toDate.day() === 0) { // Sunday
            toDate.subtract(2, 'days');
        } else if (toDate.day() === 6) { // Saturday
            toDate.subtract(1, 'days');
        } else if (toDate.day() === 1 && toDate.hour() < 9) { // Monday before 9 AM
             toDate.subtract(3, 'days');
        } else if (toDate.hour() < 9) { // Any other weekday before 9 AM
            toDate.subtract(1, 'days');
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
                if (!instrument) { this.logger.warn(`ScripMaster lookup failed for ${params.tradingsymbol}`); return []; }
                params.symboltoken = instrument.token;
            }
            const intervalMap = { "15minute": "FIFTEEN_MINUTE", "60minute": "ONE_HOUR", "ONE_DAY": "ONE_DAY" };
            const candleParams = { exchange: params.exchange, symboltoken: params.symboltoken, interval: intervalMap[params.interval], fromdate: `${params.from_date} 09:15`, todate: `${params.to_date} 15:30` };
            
            this.logger.debug(`[CandleFetch] Sending getCandleData for ${params.tradingsymbol}. Token: ${params.symboltoken}. Params: ${JSON.stringify(candleParams)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (response?.status && Array.isArray(response.data) && response.data.length > 0) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            return [];
        } catch (error) { this.logger.error(`Error fetching historical data for ${params.tradingsymbol}:`, error.message); return []; }
    }

    /**
     * *** FIX: Removed the failing getLtpData call. This now uses a robust two-step fallback. ***
     */
    async getAtmPrice(symbol, exchange, token) {
        // 1. Primary Method: Get the close of the last daily candle
        try {
            this.logger.info(`Attempting to derive current price (LTP) for ${symbol} (${token}) via last candle data...`);
            const { from_date, to_date } = this.getSafeDateRange(10);
            const candles = await this.fetchHistoricalCandlesAPI({ tradingsymbol: symbol, exchange, symboltoken: token, interval: "ONE_DAY", from_date, to_date });

            if (candles.length > 0) {
                const lastClose = candles[candles.length - 1].close;
                this.logger.info(`[LTP] Derived LTP for ${symbol} as ${lastClose} from the close of the last daily candle.`);
                return lastClose;
            }
        } catch (error) {
            this.logger.warn(`[LTP] Daily candle method failed for ${symbol}. Reason: ${error.message || 'Unknown'}. Trying final fallback.`);
        }

        // 2. Final Fallback: Get the 'close' price from the Scrip Master file
        const instrument = this.instrumentManager.getInstrumentByToken(token);
        if (instrument?.close) {
            const lastClose = parseFloat(instrument.close);
            this.logger.info(`[LTP] Derived LTP for ${symbol} as ${lastClose} from Scrip Master.`);
            return lastClose;
        }

        this.logger.error(`CRITICAL: Could not determine LTP for ${symbol} via any method.`);
        return null;
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