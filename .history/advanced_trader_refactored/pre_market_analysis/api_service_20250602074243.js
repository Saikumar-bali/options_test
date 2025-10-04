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
        const realNow = moment();
        if (toDate.isAfter(realNow)) toDate = realNow;
        const fromDate = toDate.clone().subtract(durationDays, 'days');
        return { from_date: fromDate.format('YYYY-MM-DD'), to_date: toDate.format('YYYY-MM-DD') };
    }

    async fetchHistoricalCandlesAPI(params) {
        try {
            if (!params.symboltoken) {
                const instrument = this.instrumentManager.getInstrumentDetails(params.tradingsymbol, params.exchange); //
                if (!instrument) {
                    this.logger.warn(`Could not find instrument details for ${params.tradingsymbol} in Scrip Master.`);
                    return [];
                }
                params.symboltoken = instrument.token; // Ensure 'token' is the correct property name from your scrip master
            }

            const intervalMap = { "15minute": "FIFTEEN_MINUTE", "60minute": "ONE_HOUR" };
            const candleParams = {
                exchange: params.exchange,
                symboltoken: params.symboltoken,
                interval: intervalMap[params.interval] || params.interval.toUpperCase(),
                fromdate: `${params.from_date} 09:15`,
                todate: `${params.to_date} 15:30`
            };
            
            const response = await this.masterController.enqueueApiCall('getCandleData', [candleParams]);

            if (response?.status && Array.isArray(response.data)) {
                return response.data.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
            }
            this.logger.warn(`No candle data returned or unexpected format for ${params.tradingsymbol}. Response: ${JSON.stringify(response)}`);
            return [];
        } catch (error) {
            this.logger.error(`Error fetching historical data for ${params.tradingsymbol}:`, error.message);
            return [];
        }
    }

    async getCurrentPriceAPI(symbol, exchange, token) {
        try {
            const ltpParams = { exchange, tradingsymbol: symbol, symboltoken: token };
            // <mark style="background-color: red; color: white;">
            // !!! ================================================================= !!!
            // !!! CRITICAL ACTION REQUIRED BY YOU                                   !!!
            // !!! ================================================================= !!!
            // The method name 'getLtpData' IS INCORRECT for your smartapi-javascript SDK.
            // The error "API method getLtpData not found" proves this.
            //
            // YOU MUST:
            // 1. FIND THE CORRECT METHOD NAME for fetching LTP in your SDK's documentation
            //    (or by inspecting the smartApiInstance object as described in the instructions).
            // 2. REPLACE 'getLtpData' below with that ACTUAL CORRECT METHOD NAME.
            // 3. VERIFY that 'ltpParams' MATCHES what the correct method expects.
            //
            // Example: If the correct method is 'fetchLTPQuote', change it to:
            // const response = await this.masterController.enqueueApiCall('fetchLTPQuote', [ltpParams]);
            // (Note: MasterController's enqueueApiCall expects args as an array if multiple,
            // or a single object if the SDK method takes a single object. Your current ltpParams
            // is an object, and enqueueApiCall in MasterController.js passes it as ...args.
            // The line `const response = await this.masterController.enqueueApiCall('getLtpData', ltpParams);`
            // in your uploaded api_service.js passes ltpParams directly, not in an array.
            // Ensure this matches how MasterController's processApiCallQueue invokes the SDK method.)
            //
            // !!! ================================================================= !!!
            // </mark>
            const response = await this.masterController.enqueueApiCall('getLtpData', [ltpParams]); // Ensure this line is correct based on your SDK and MasterController

            if (response?.status && response.data?.ltp !== undefined) {
                 return { ltp: response.data.ltp };
            }
            this.logger.warn(`Could not parse LTP from response for ${symbol}. Response: ${JSON.stringify(response)}`);
            return null;
        } catch (error) {
            this.logger.error(`Error fetching LTP for ${symbol}:`, error.message || error);
            return null;
        }
    }
    
    async fetchOptionsDetailsByStrikes(underlyingSymbol, strikes, expiry) {
        const optionContracts = [];
        const baseSymbol = underlyingSymbol.replace('-EQ', ''); //
        
        for (const strike of strikes) {
            const ceDetails = this.instrumentManager.findOption(baseSymbol, strike, expiry, 'CE'); //
            if (ceDetails) optionContracts.push({ ...ceDetails, instrument_type: 'CE', strike_price: strike, expiry_date: expiry });
            
            const peDetails = this.instrumentManager.findOption(baseSymbol, strike, expiry, 'PE'); //
            if (peDetails) optionContracts.push({ ...peDetails, instrument_type: 'PE', strike_price: strike, expiry_date: expiry });
        }
        return optionContracts;
    }
}
module.exports = ApiService;