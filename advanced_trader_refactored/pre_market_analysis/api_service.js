// File: /src/pre_market_analysis/api_service.js
const moment = require('moment-timezone');

class ApiService {
    constructor(masterController, instrumentManager, logger) {
        this.masterController = masterController;
        this.instrumentManager = instrumentManager;
        this.logger = logger;
    }

    /**
     * Corrected, simpler date range logic. It fetches data up to the current moment.
     */
    getSafeDateRange(durationDays) {
        const toDate = moment().tz("Asia/Kolkata");
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
                    this.logger.warn(`ScripMaster lookup failed for ${params.tradingsymbol}`);
                    return [];
                }
                params.symboltoken = instrument.token;
            }
            const intervalMap = { "15minute": "FIFTEEN_MINUTE", "60minute": "ONE_HOUR", "ONE_DAY": "ONE_DAY" };
            const candleParams = {
                exchange: params.exchange,
                symboltoken: params.symboltoken,
                interval: intervalMap[params.interval],
                fromdate: `${params.from_date} 09:15`,
                todate: `${params.to_date} 15:30`
            };
            // this.logger.debug(`[CandleFetch] Sending getCandleData. Params: ${JSON.stringify(candleParams)}`);
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (response?.status && Array.isArray(response.data) && response.data.length > 0) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            this.logger.warn(`No new candle data returned from API for ${params.tradingsymbol}`);
            return [];
        } catch (error) {
            this.logger.error(`Error fetching historical data for ${params.tradingsymbol}:`, error.message);
            return [];
        }
    }

    // ... The rest of api_service.js remains the same ...
    async getAtmPriceAndCandles(symbol, exchange, token) {
        try {
            this.logger.info(`Attempting to derive current price (ATM) for ${symbol} (${token}) via last daily candle data...`);
            const { from_date, to_date } = this.getSafeDateRange(10);
            const candles = await this.fetchHistoricalCandlesAPI({ tradingsymbol: symbol, exchange, symboltoken: token, interval: "ONE_DAY", from_date, to_date });
            if (candles.length > 0) {
                const lastClose = candles[candles.length - 1].close;
                this.logger.info(`[LTP_DERIVATION] Derived ATM price for ${symbol} as ${lastClose} from the close of the last daily candle.`);
                return { price: lastClose, candles: candles };
            } else {
                 this.logger.warn(`[LTP_DERIVATION] Could not derive ATM price for ${symbol}: No daily candle data found.`);
            }
        } catch (error) {
            this.logger.warn(`[LTP_DERIVATION] Daily candle method failed for ${symbol}. Reason: ${error.message || 'Unknown'}. Trying final fallback.`);
        }
        const instrument = this.instrumentManager.getInstrumentByToken(token);
        if (instrument?.close) {
            const lastClose = parseFloat(instrument.close);
            this.logger.info(`[LTP_DERIVATION] Derived ATM price for ${symbol} as ${lastClose} from Scrip Master.`);
            return { price: lastClose, candles: null }; 
        }
        this.logger.error(`CRITICAL: Could not determine ATM price for ${symbol} via any method.`);
        return { price: null, candles: null };
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