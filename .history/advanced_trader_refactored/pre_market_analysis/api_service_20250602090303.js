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
        let toDate = moment.tz("Asia/Kolkata").startOf('day');
        // If today is a weekend, get data up to last Friday
        if (toDate.day() === 0) toDate.subtract(2, 'days');
        else if (toDate.day() === 6) toDate.subtract(1, 'days');

        const fromDate = toDate.clone().subtract(durationDays, 'days');
        return {
            from_date: fromDate.format('YYYY-MM-DD'),
            to_date: toDate.format('YYYY-MM-DD')
        };
    }

    async fetchHistoricalCandlesAPI(params) {
        // This method is now correct and doesn't need changes.
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
            if (response?.status && Array.isArray(response.data)) { return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })); }
            return [];
        } catch (error) { this.logger.error(`Error fetching historical data for ${params.tradingsymbol}:`, error.message); return []; }
    }

    /**
     * *** FIX: Implemented a robust "Triple Fallback" mechanism to get the current price. ***
     */
    async getAtmPrice(symbol, exchange, token) {
        // 1. Primary Method: Try the real-time LTP API call
        try {
            const ltpResponse = await this.masterController.enqueueApiCall('getLtpData', { exchange, tradingsymbol: symbol, symboltoken: token });
            if (ltpResponse?.status && ltpResponse.data?.ltp) {
                this.logger.info(`[LTP] Successfully fetched real-time LTP for ${symbol}: ${ltpResponse.data.ltp}`);
                return ltpResponse.data.ltp;
            }
        } catch (error) {
            this.logger.warn(`[LTP] Real-time LTP fetch failed for ${symbol}. Reason: ${error.message || 'Unknown'}. Trying fallback 1.`);
        }

        // 2. Fallback 1: Get the close of the last daily candle
        try {
            const { from_date, to_date } = this.getSafeDateRange(10); // Look back 10 days for last daily candle
            const candles = await this.fetchHistoricalCandlesAPI({ tradingsymbol: symbol, exchange, symboltoken: token, interval: "ONE_DAY", from_date, to_date });
            if (candles.length > 0) {
                const lastClose = candles[candles.length - 1].close;
                this.logger.info(`[LTP] Derived LTP for ${symbol} as ${lastClose} from last daily candle.`);
                return lastClose;
            }
        } catch (error) {
            this.logger.warn(`[LTP] Daily candle fallback failed for ${symbol}. Reason: ${error.message || 'Unknown'}. Trying fallback 2.`);
        }

        // 3. Fallback 2: Get the 'close' price from the Scrip Master file
        const instrument = this.instrumentManager.getInstrumentByToken(token);
        if (instrument?.close) {
            this.logger.info(`[LTP] Derived LTP for ${symbol} as ${instrument.close} from Scrip Master.`);
            return parseFloat(instrument.close);
        }

        this.logger.error(`CRITICAL: Could not determine LTP for ${symbol} via any method.`);
        return null;
    }
    
    async fetchOptionsDetailsByStrikes(underlyingSymbol, strikes, expiry) {
        // This method is correct and remains unchanged.
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