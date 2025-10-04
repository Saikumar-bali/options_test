// File: /trading-bot/strategies/SupportTrendlineStrategy.js

const moment = require('moment-timezone');
const EventEmitter = require('events');
const { findSupportTrendline } = require('../indicators/Trendline');
const { ATR } = require('../indicators/ATR');
const { RSI } = require('../indicators/RSI');
const { findATMOptions, getHistoricalDataParams } = require('../utils/helpers');
const { getCandleTime, isNewCandle } = require('../utils/time_helpers');

class SupportTrendlineStrategy extends EventEmitter {
    constructor(masterController, config, instrumentLoader, telegramService, positionManager, dataFetcher) {
        super();
        
        if (!config || !config.underlying || !config.token || !config.exchange) {
            console.error(`❌ [${config.underlying || 'Unknown'}] Invalid config for SupportTrendlineStrategy.`);
            this.isActive = false;
            return;
        }

        this.masterController = masterController;
        this.config = config;
        this.instrumentLoader = instrumentLoader;
        this.telegramService = telegramService;
        this.positionManager = positionManager;
        this.dataFetcher = dataFetcher;
        this.params = config.support_trendline_params || {};
        this.candleIntervalMinutes = 15;

        this.underlying = {
            symbol: config.underlying,
            token: config.token,
            exch_seg: config.exchange,
            ltp: 0
        };

        this.strategyName = `SupportTrendline_${this.underlying.symbol}`;
        this.isUpdating = false;
        this.lastCandleTime = null;
        this.currentCandle = {};
        this.historicalData = [];
        this.trendline = null;
        this.atr = new ATR(this.params.atr_period || 14);
        this.rsi = new RSI(this.params.rsi_period || 14);

        this.isActive = true;
        console.log(`✅ [${this.underlying.symbol}] Support Trendline Strategy initialized.`);
    }

    async start() {
        if (!this.isActive) return;
        console.log(`▶️ [${this.underlying.symbol}] Starting Support Trendline Strategy.`);
        await this.updateTrendlineAndIndicators();
        this.emit('started', this.getTrendlineAndLTP());
    }

    onTick(tick) {
        if (!this.isActive || this.isUpdating || !tick || !tick.ltp) return;
        
        this.underlying.ltp = tick.ltp;
        const candleTime = getCandleTime(tick.timestamp, this.candleIntervalMinutes);

        if (!this.lastCandleTime) {
            this.lastCandleTime = candleTime;
            this.currentCandle = { O: tick.ltp, H: tick.ltp, L: tick.ltp, C: tick.ltp, T: candleTime };
            return;
        }

        if (isNewCandle(this.lastCandleTime, candleTime, this.candleIntervalMinutes)) {
            // Finalize the previous candle before starting a new one
            this.checkEntryConditions(this.currentCandle, tick.timestamp, true);
            this.lastCandleTime = candleTime;
            this.currentCandle = { O: tick.ltp, H: tick.ltp, L: tick.ltp, C: tick.ltp, T: candleTime };
            this.onNewCandle();
        } else {
            this.currentCandle.H = Math.max(this.currentCandle.H, tick.ltp);
            this.currentCandle.L = Math.min(this.currentCandle.L, tick.ltp);
            this.currentCandle.C = tick.ltp;
            this.checkEntryConditions(this.currentCandle, tick.timestamp, false);
        }
    }
    
    async onNewCandle() {
        console.log(`[${this.underlying.symbol}] New ${this.candleIntervalMinutes}-min candle formed. Updating trendline and indicators.`);
        this.isUpdating = true;
        try {
            await this.updateTrendlineAndIndicators();
            this.emit('levelsUpdated', this.getTrendlineAndLTP());
        } catch (error) {
            console.error(`[${this.underlying.symbol}] Error on new candle update:`, error);
        } finally {
            this.isUpdating = false;
        }
    }

    async checkEntryConditions(candle, timestamp, isCandleClosing) {
        if (!this.trendline || !this.historicalData.length) return;
        if (this.positionManager.isPositionOpenForStrategy(this.strategyName)) return;

        const currentCandleIndex = this.historicalData.length;

        // Calculate the expected trendline price at the current candle's index
        const trendlinePrice = this.trendline.slope * currentCandleIndex + this.trendline.intercept;
        
        const buffer = trendlinePrice * (this.params.level_buffer_percent / 100);
        const upperZone = trendlinePrice + buffer;
        
        const rsiValue = this.rsi.getValue();
        const maxRsi = this.params.rsi_max_entry || 60;
        
        // Entry condition: price dips to the trendline and shows signs of a bounce.
        // We check on candle close to confirm the bounce.
        const isPriceTouching = candle.L <= upperZone;
        const isPriceBouncing = candle.C > trendlinePrice;
        const isRsiValid = rsiValue < maxRsi;

        if (isCandleClosing && isPriceTouching && isPriceBouncing && isRsiValid) {
            console.log(`📈 [${this.underlying.symbol}] ENTRY CONDITION MET at ${moment(timestamp).tz("Asia/Kolkata").format()}`);
            console.log(`   - Trendline Price: ${trendlinePrice.toFixed(2)} | Candle Low: ${candle.L} | Candle Close: ${candle.C}`);
            console.log(`   - RSI: ${rsiValue.toFixed(2)} (below ${maxRsi})`);
            
            const atrValue = this.atr.getValue();
            if (atrValue) {
                this.executeTrade('CE', atrValue);
            } else {
                console.warn(`[${this.underlying.symbol}] ATR not available. Cannot execute trade.`);
            }
        }
    }
    
    async executeTrade(optionType, atrValue) {
        if (this.positionManager.isPositionOpenForStrategy(this.strategyName)) {
            console.log(`[${this.underlying.symbol}] Position already open for this strategy. Skipping new trade.`);
            return;
        }

        try {
            const atmOptions = await findATMOptions(this.underlying, this.instrumentLoader);
            const selectedOption = atmOptions ? atmOptions[optionType] : null;

            if (selectedOption) {
                this.positionManager.executeBuy(
                    selectedOption,
                    this.strategyName,
                    'LONG',
                    this.config.lots,
                    { atr: atrValue, underlyingPrice: this.underlying.ltp }
                );
            } else {
                console.error(`[${this.underlying.symbol}] Could not find ATM ${optionType} option.`);
            }
        } catch (error) {
            console.error(`[${this.underlying.symbol}] Error executing trade:`, error);
        }
    }

    async updateTrendlineAndIndicators() {
        this.isUpdating = true;
        try {
            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(this.params.history_days || 5, 'days');
            const params = getHistoricalDataParams(this.underlying, '15_MINUTE', fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));

            if (params) {
                params.symbol = this.underlying.symbol;
                params.exchange = this.underlying.exch_seg;
            }

            const history = await this.dataFetcher.getHistoricalData(params);
            
            if (history && history.data && history.data.length > 0) {
                const candles = history.data.map(d => ({ timestamp: d[0], open: d[1], high: d[2], low: d[3], close: d[4] }));
                this.historicalData = candles;
                
                // Update Indicators
                const closes = candles.map(c => c.close);
                this.rsi.update(closes);
                this.atr.update(candles);
                
                // Update Trendline
                const trendlineParams = {
                    minTouches: this.params.trendline_min_touches || 3,
                    tolerancePercent: this.params.trendline_tolerance_percent || 0.10,
                };
                this.trendline = findSupportTrendline(candles, trendlineParams);

                if(this.trendline){
                    console.log(`[${this.underlying.symbol}] Support trendline updated. Touches: ${this.trendline.touches}. Last point index: ${this.trendline.points[this.trendline.points.length-1].index}`);
                } else {
                    console.log(`[${this.underlying.symbol}] No valid support trendline found.`);
                }
                
                this.underlying.ltp = candles[candles.length - 1].close;
            }
        } catch (err) {
            console.error(`[${this.underlying.symbol}] Failed to update trendline:`, err);
        } finally {
            this.isUpdating = false;
        }
    }

    getTrendlineAndLTP() {
        if (!this.trendline) {
            return { ltp: this.underlying.ltp, trendline: null };
        }
        
        // Project the trendline to the current candle index for visualization
        const projectedIndex = this.historicalData.length;
        const projectedPrice = this.trendline.slope * projectedIndex + this.trendline.intercept;

        return {
            ltp: this.underlying.ltp,
            trendline: {
                ...this.trendline,
                projectedPrice: projectedPrice.toFixed(2)
            }
        };
    }
}

module.exports = SupportTrendlineStrategy;
