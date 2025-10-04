// File: /trading-bot/strategies/S_R_BB_Strategy.js

const BaseStrategy = require('./BaseStrategy.js');
const SupportResistance = require('../indicators/SupportResistance');
const BollingerBandsIndicator = require('../indicators/BollingerBands');
const { findATMOptions, getHistoricalDataParams } = require('../utils/helpers');

class S_R_BB_Strategy extends BaseStrategy {
    constructor(masterController, config, instrumentLoader, telegramService) {
        super(masterController, config, instrumentLoader, telegramService);

        this.underlying = { symbol: config.underlying, token: config.token, ltp: 0 };
        this.options = new Map();
        this.supportLevels = [];
        this.resistanceLevels = [];
        this.lastLevelCheck = 0;
        this.levelCheckCooldown = 5 * 60 * 1000;
        this.isUpdatingLevels = false;
    }

    async initialize() {
        await this.updateUnderlyingLTP();
        if (this.underlying.ltp > 0) await this.updateLevelsAndOptions();
    }
    
    getTokensToTrack() {
        const tokens = [{ ...this.underlying, exch_seg: this.config.exchange }];
        this.options.forEach(opt => tokens.push(opt.instrument));
        return tokens;
    }

    processData(tick) {
        if (tick.token === this.underlying.token) {
            this.underlying.ltp = tick.last_price;
            this.checkPriceAction();
            if (!this.isUpdatingLevels && (Date.now() - this.lastLevelCheck > this.levelCheckCooldown)) {
                this.updateLevelsAndOptions();
            }
        }
        if (this.options.has(tick.token)) this.options.get(tick.token).ltp = tick.last_price;
    }
    
    async updateLevelsAndOptions() {
        this.isUpdatingLevels = true;
        try {
            const historyParams = getHistoricalDataParams({token: this.underlying.token, exch_seg: this.config.exchange}, this.config.timeframe, this.config.s_r_days);
            const history = await this.masterController.getHistoricalData(historyParams);
            
            // BUG FIX & DEBUGGING: Check if the imported module has the function before calling it.
            if (typeof SupportResistance.detectLevels !== 'function') {
                console.error(`\n[${this.strategyId}] FATAL ERROR: SupportResistance.detectLevels is not a function.`);
                console.error("Please ensure the file 'indicators/SupportResistance.js' correctly exports the class with 'module.exports = SupportResistance;' at the end.");
                console.log("DEBUG: The imported SupportResistance module actually contains:", SupportResistance);
                this.isUpdatingLevels = false;
                return; // Exit to prevent crash
            }

            if (history && history.status && history.data) {
                const candles = history.data.map(c => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }));
                const { supports, resistances } = SupportResistance.detectLevels(candles, this.underlying.ltp, this.config.support_resistance);
                this.supportLevels = supports;
                this.resistanceLevels = resistances;
                if (this.config.options.enabled) await this.setupOptions();
            }
        } finally {
            this.lastLevelCheck = Date.now();
            this.isUpdatingLevels = false;
        }
    }
    
    checkPriceAction() {
        const ltp = this.underlying.ltp;
        if (this.resistanceLevels.length > 0 && ltp >= this.resistanceLevels[0].level) this.evaluateOptions('PE');
        if (this.supportLevels.length > 0 && ltp <= this.supportLevels[0].level) this.evaluateOptions('CE');
    }

    evaluateOptions(optionType) {
        this.options.forEach(opt => {
            if (opt.instrument.optiontype === optionType && opt.bb && opt.ltp > 0 && opt.ltp <= opt.bb.lower) {
                this.triggerTrade(opt);
            }
        });
    }
    
    triggerTrade(optionData) {
        console.log(`[${this.strategyId}] SIMULATING TRADE for ${optionData.instrument.symbol}`);
        const tradeDataObject = {
            symbol: optionData.instrument.symbol,
            entryPrice: optionData.ltp,
            exitPrice: optionData.ltp + 5,
            profit: 5 * this.config.lot_size,
            timestamp: new Date().toISOString(),
        };
        this.logTrade(tradeDataObject);
    }

    async updateUnderlyingLTP() {
        try {
            const params = getHistoricalDataParams({token: this.underlying.token, exch_seg: this.config.exchange}, 'ONE_MINUTE', 1);
            const { data } = await this.masterController.getHistoricalData(params);
            if (data && data.length > 0) this.underlying.ltp = data[data.length - 1][4];
        } catch(e) { /* ignore */ }
    }

    async setupOptions() {
        this.masterController.unsubscribeFromTokens(Array.from(this.options.values()).map(o => o.instrument));
        this.options.clear();
        
        const foundOptions = findATMOptions(this.instrumentLoader, this.underlying.symbol, this.underlying.ltp, this.config.options.expiry_date, this.config.options.atm_strikes);
        
        for (const optionInstrument of foundOptions) {
            const historyParams = getHistoricalDataParams(optionInstrument, this.config.timeframe, 30);
            const history = await this.masterController.getHistoricalData(historyParams);
            let bb = null;
            if (history && history.status && history.data && history.data.length > 0) {
                 const closePrices = history.data.map(c => c[4]);
                 const bbValues = BollingerBandsIndicator.calculate(closePrices, this.config.bollinger_bands);
                 if (bbValues.length > 0) bb = bbValues[bbValues.length-1];
            }
            this.options.set(optionInstrument.token, { instrument: optionInstrument, ltp: 0, bb: bb });
        }
        
        this.masterController.subscribeToTokens();
    }
}

module.exports = S_R_BB_Strategy;
