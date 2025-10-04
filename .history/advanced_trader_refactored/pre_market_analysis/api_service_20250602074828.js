// File: /src/pre_market_analysis/api_service.js
const moment = require('moment-timezone');

class ApiService {
    constructor(masterController, instrumentManager, logger) {
        if (!masterController || !instrumentManager) {
            throw new Error("ApiService requires MasterController and InstrumentManager instances.");
        }
        this.masterController = masterController;
        this.instrumentManager = instrumentManager; //
        this.logger = logger;
    }

    getSafeDateRange(durationDays) {
        let toDate = moment.tz("Asia/Kolkata");
        // Ensure toDate is not in the future if script runs slightly before midnight
        const realNow = moment.tz("Asia/Kolkata"); 
        if (toDate.isAfter(realNow)) {
            toDate = realNow;
        }
        // Ensure fromDate is also calculated based on the adjusted toDate
        const fromDate = toDate.clone().subtract(durationDays, 'days');
        return { 
            from_date: fromDate.format('YYYY-MM-DD'), 
            to_date: toDate.format('YYYY-MM-DD') 
        };
    }

    async fetchHistoricalCandlesAPI(params) {
        try {
            if (!params.symboltoken) {
                // Use instrumentManager to get details from the local scrip master
                const instrument = this.instrumentManager.getInstrumentDetails(params.tradingsymbol, params.exchange); //
                if (!instrument) {
                    this.logger.warn(`Could not find instrument details for ${params.tradingsymbol} in Scrip Master via fetchHistoricalCandlesAPI.`);
                    return [];
                }
                // Ensure your scrip master provides 'token' (or 'symboltoken')
                params.symboltoken = instrument.token || instrument.symboltoken; 
                if(!params.symboltoken) {
                    this.logger.warn(`Symbol token missing for ${params.tradingsymbol} even after Scrip Master lookup.`);
                    return [];
                }
            }

            const intervalMap = { "15minute": "FIFTEEN_MINUTE", "60minute": "ONE_HOUR", "ONE_DAY": "ONE_DAY" }; // Added ONE_DAY
            const candleParams = {
                exchange: params.exchange,
                symboltoken: params.symboltoken,
                interval: intervalMap[params.interval] || params.interval.toUpperCase(),
                fromdate: `${params.from_date} 09:00`, // Adjusted for broader daily range start
                todate: `${params.to_date} ${moment.tz("Asia/Kolkata").format('HH:mm')}` // Use current time for todate if fetching for today
            };
            
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]); // [candleParams] is correct

            if (response?.status && Array.isArray(response.data)) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            this.logger.warn(`No candle data returned or unexpected format for ${params.tradingsymbol} from fetchHistoricalCandlesAPI. Response: ${JSON.stringify(response)}`);
            return [];
        } catch (error) {
            this.logger.error(`Error fetching historical data for ${params.tradingsymbol}:`, error.message || error);
            return [];
        }
    }

    // <mark style="background-color: red; color: white;">
    // MODIFIED SECTION TO DERIVE LTP FROM LAST CANDLE
    // </mark>
    async getCurrentPriceAPI(symbol, exchange, token) {
        this.logger.info(`Attempting to derive current price (LTP) for ${symbol} via last candle data...`);
        try {
            // For Pre-Market, previous day's close is often sufficient.
            // We fetch a few days of daily candles to ensure we get the last trading day's close.
            const today = moment.tz("Asia/Kolkata");
            const toDateString = today.format('YYYY-MM-DD');
            const fromDateString = today.clone().subtract(7, 'days').format('YYYY-MM-DD'); // Fetch last 7 days to be safe

            const candleParams = {
                exchange: exchange,
                symboltoken: token,
                interval: "ONE_DAY", // Fetch daily candles
                fromdate: `${fromDateString} 09:00`, 
                todate: `${toDateString} ${today.format('HH:mm')}` 
            };
            
            // Ensure candleParams is passed as an array of arguments to enqueueApiCall
            const candleResponse = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (candleResponse && candleResponse.status === true && Array.isArray(candleResponse.data) && candleResponse.data.length > 0) {
                const lastCandle = candleResponse.data[candleResponse.data.length - 1];
                // Assuming candle format from Angel: [timestamp, open, high, low, close, volume]
                const ltp = lastCandle[4]; 
                this.logger.info(`Derived LTP for ${symbol} as ${ltp} from the close of the last daily candle (${lastCandle[0]}).`);
                return { ltp: ltp };
            } else {
                this.logger.warn(`Could not derive LTP for ${symbol}: No candle data found or unexpected format. Response: ${JSON.stringify(candleResponse)}`);
                return null;
            }
        } catch (error) {
            this.logger.error(`Error in getCurrentPriceAPI (deriving LTP from candle) for ${symbol}:`, error.message || error);
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