// File: /trading-bot/strategies/S_R_BB_Strategy.js

const moment = require('moment-timezone');
const EventEmitter = require('events');
const SupportResistance = require('../indicators/SupportResistance');
const BollingerBandsIndicator = require('../indicators/BollingerBands');
const { getHistoricalDataParams } = require('../utils/helpers'); // findATMOptions removed

class S_R_BB_Strategy extends EventEmitter {
    constructor(masterController, config, instrumentLoader, telegramService) {
        super();
        this.masterController = masterController;
        this.config = config;
        this.instrumentLoader = instrumentLoader;
        this.telegramService = telegramService;
        this.underlying = {
            symbol: config.underlying,
            token: config.token,
            exch_seg: config.exchange,
            ltp: 0,
        };
        this.options = new Map();
        this.supportLevels = [];
        this.resistanceLevels = [];
        this.isUpdatingLevels = false;

        this.isActive = true;
        this.openPositions = new Map(); // token -> { instrument, quantity, entryPrice }
    }

    start() {
        this.isActive = true;
        console.log(`[${this.underlying.symbol}] Strategy has been manually started.`);
    }

    stop() {
        this.isActive = false;
        console.log(`[${this.underlying.symbol}] Strategy has been manually stopped.`);
    }

    getUnrealizedPnL() {
        let pnl = 0;
        this.openPositions.forEach(pos => {
            const optionData = this.options.get(pos.instrument.token);
            const ltp = optionData ? optionData.ltp : pos.entryPrice;
            if (ltp > 0) {
                pnl += (ltp - pos.entryPrice) * pos.quantity;
            }
        });
        return pnl;
    }

    getLevelsAndLTP() {
        return {
            ltp: this.underlying.ltp,
            supports: this.supportLevels.map(s => s.level),
            resistances: this.resistanceLevels.map(r => r.level),
        };
    }

    processData(tick) {
        if (tick.token === this.underlying.token) this.underlying.ltp = tick.last_price;
        if (this.options.has(tick.token)) this.options.get(tick.token).ltp = tick.last_price;

        if (!this.isActive) return;

        if (tick.token === this.underlying.token) {
            this.checkPriceAction();
        }
    }

    async triggerTrade(optionData) {
        const now = Date.now();
        if (now - (optionData.lastTradeTime || 0) < 2 * 60 * 1000) return;
        optionData.lastTradeTime = now;

        if (this.openPositions.has(optionData.instrument.token)) {
            console.log(`[${optionData.instrument.symbol}] Trade signal ignored, position already open.`);
            return;
        }

        const entryPrice = optionData.ltp;
        console.log(`\n🔥🔥🔥 TRADE TRIGGERED! 🔥🔥🔥`);

        this.openPositions.set(optionData.instrument.token, {
            instrument: optionData.instrument,
            quantity: this.config.lot_size,
            entryPrice: entryPrice
        });

        const tradeMessage = `🚀 *Trade Alert: Position Opened*\n\n*Symbol:* \`${optionData.instrument.symbol}\`\n*Action:* BUY\n*Entry Price:* ${entryPrice}`;
        this.telegramService.sendMessage(tradeMessage);

        setTimeout(() => {
            this.closeSimulatedTrade(optionData.instrument.token);
        }, 5 * 60 * 1000);
    }

    closeSimulatedTrade(token) {
        const position = this.openPositions.get(token);
        if (!position) return;

        const optionData = this.options.get(token);
        const exitPrice = (optionData && optionData.ltp > 0) ? optionData.ltp : position.entryPrice * 1.05;

        if (!optionData || optionData.ltp === 0) {
            console.warn(`[${position.instrument.symbol}] Simulated exit used due to missing LTP.`);
        }

        const pnl = (exitPrice - position.entryPrice) * position.quantity;

        const tradeDataObject = {
            symbol: position.instrument.symbol,
            entryPrice: position.entryPrice,
            exitPrice: exitPrice,
            profit: pnl,
            timestamp: moment().tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm:ss'),
        };

        this.emit('tradeCompleted', tradeDataObject);
        this.openPositions.delete(token);

        const tradeMessage = `✅ *Trade Alert: Position Closed*\n\n*Symbol:* \`${position.instrument.symbol}\`\n*Exit Price:* ${exitPrice.toFixed(2)}\n*P&L:* ₹${pnl.toFixed(2)}`;
        this.telegramService.sendMessage(tradeMessage);
    }

    getTokensToTrack() {
        const tokens = [this.underlying];
        this.options.forEach(opt => tokens.push(opt.instrument));
        return tokens;
    }

    async initialize() {
        await this.updateLevelsAndOptions();
    }

    async updateUnderlyingLTP() {
        try {
            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(15, 'minutes');
            const params = getHistoricalDataParams(this.underlying, 'ONE_MINUTE', fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));
            const history = await this.masterController.getHistoricalData(params);
            if (history?.status && history.data?.length > 0) {
                this.underlying.ltp = history.data[history.data.length - 1][4];
            }
        } catch (e) {
            console.error(`[${this.underlying.symbol}] LTP update failed:`, e);
        }
    }

    async updateLevelsAndOptions() {
        this.isUpdatingLevels = true;
        try {
            await this.updateUnderlyingLTP();
            if (this.underlying.ltp <= 0) {
                 console.warn(`[${this.underlying.symbol}] Cannot update levels, LTP is 0.`);
                 return;
            }
            
            // --- FIX: Provide specific fromdate and todate ---
            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(this.config.historical_data.days, 'days');
            const historyParams = getHistoricalDataParams(this.underlying, this.config.historical_data.timeframe, fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));

            const history = await this.masterController.getHistoricalData(historyParams);
            if (history?.status && history.data) {
                const candles = history.data.map(c => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }));
                const { supports, resistances } = SupportResistance.detectLevels(candles, this.underlying.ltp, this.config.support_resistance);
                this.supportLevels = supports;
                this.resistanceLevels = resistances;

                console.log(`\n[${this.underlying.symbol}] S/R Levels Updated at LTP: ${this.underlying.ltp.toFixed(2)}`);
                console.log("Resistances:", JSON.stringify(this.resistanceLevels.map(r => r.level.toFixed(2))));
                console.log("Supports:   ", JSON.stringify(this.supportLevels.map(s => s.level.toFixed(2))));

                if (this.config.options.enabled) {
                    await this.setupOptions();
                }
            }
        } catch (err) {
            console.error(`[${this.underlying.symbol}] Failed to update levels and options:`, err);
        } finally {
            this.isUpdatingLevels = false;
        }
    }

    async setupOptions() {
        this.masterController.unsubscribeFromTokens(Array.from(this.options.values()).map(o => o.instrument));
        this.options.clear();

        // --- FIX: Call findATMOptions directly on the instrumentLoader instance ---
        const foundOptions = this.instrumentLoader.findATMOptions(this.underlying.symbol, this.underlying.ltp, this.config.options.expiry_date, this.config.options.atm_strikes);
        if (foundOptions.length === 0) {
            console.warn(`[${this.underlying.symbol}] No ATM options found.`);
            return;
        }
        
        console.log(`[${this.underlying.symbol}] Filtered down to ${foundOptions.length} ATM options.`);

        for (const optionInstrument of foundOptions) {
            await this.setupSingleOption(optionInstrument);
        }

        this.masterController.subscribeToTokens();
    }

    async setupSingleOption(optionInstrument) {
        // --- FIX: Provide specific fromdate and todate ---
        const toDate = moment().tz("Asia/Kolkata");
        const fromDate = toDate.clone().subtract(this.config.historical_data.days, 'days');
        const historyParams = getHistoricalDataParams(optionInstrument, this.config.historical_data.timeframe, fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));
        
        const history = await this.masterController.getHistoricalData(historyParams);
        let bb = [];
        if (history?.status && history.data?.length > 0) {
            const closePrices = history.data.map(c => c[4]);
            bb = BollingerBandsIndicator.calculate(closePrices, this.config.bollinger_bands);
        }

        this.options.set(optionInstrument.token, {
            instrument: optionInstrument,
            bb: bb.length > 0 ? bb[bb.length - 1] : null,
            ltp: 0,
            lastTradeTime: 0,
        });
    }

    checkPriceAction() {
        const ltp = this.underlying.ltp;
        if (this.resistanceLevels.length > 0 && ltp >= this.resistanceLevels[0].level) {
            this.evaluateOptions('PE');
        }
        if (this.supportLevels.length > 0 && ltp <= this.supportLevels[0].level) {
            this.evaluateOptions('CE');
        }
    }

    evaluateOptions(optionType) {
        this.options.forEach((optionData) => {
            const bbLower = optionData.bb?.lower;
            if (
                optionData.instrument.optiontype === optionType &&
                typeof bbLower === 'number' &&
                optionData.ltp > 0 &&
                optionData.ltp <= bbLower
            ) {
                this.triggerTrade(optionData);
            }
        });
    }
}

module.exports = S_R_BB_Strategy;
