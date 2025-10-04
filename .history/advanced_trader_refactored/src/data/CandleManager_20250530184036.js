// File: /advanced_trader_refactored/src/data/CandleManager.js
const moment = require("moment-timezone");

class CandleManager {
    constructor(strategy) {
        this.strategy = strategy;
        this.logger = strategy.logger;
        this.config = strategy.config.tradingParameters;
        this.currentCandles = new Map();
        this.candleInterval = null;
    }

    getLtp(token) {
        return this.currentCandles.get(token)?.close;
    }

    scheduleCandleUpdates() {
        const now = moment.tz("Asia/Kolkata");
        const minutesPastInterval = now.minute() % this.config.candleIntervalMinutes;
        const initialDelay = (this.config.candleIntervalMinutes - minutesPastInterval) * 60 * 1000 - (now.second() * 1000) - now.millisecond();
        
        this.logger.info(`⏳ Scheduling 15-min candle cycle. First in ${moment.duration(initialDelay).humanize()}.`);
        this.initializeNewCandles();

        setTimeout(() => {
            this.performCandleUpdateCycle();
            this.candleInterval = setInterval(
                () => this.performCandleUpdateCycle(), 
                this.config.candleIntervalMinutes * 60 * 1000
            );
        }, initialDelay > 0 ? initialDelay : 0);
    }
    
    updateCurrentCandle(token, ltp) {
        const candle = this.currentCandles.get(token);
        if (candle) {
            if (candle.open === null) candle.open = ltp;
            candle.high = Math.max(candle.high, ltp);
            candle.low = Math.min(candle.low, ltp);
            candle.close = ltp;
        }
    }

    performCandleUpdateCycle() {
        this.logger.info(`🕯️ Finalizing 15-min candles at ${moment.tz("Asia/Kolkata").format("HH:mm:ss")}`);
        this.finalizeCurrentCandles();
        this.initializeNewCandles();
        this.strategy.stocks.forEach(stock => this.strategy.indicatorCalculator.calculateAll(stock));
        this.logger.info("✅ Indicators recalculated for new candle cycle.");
    }

    initializeNewCandles() {
        const startTime = moment.tz("Asia/Kolkata").startOf('minute').subtract(moment().minute() % this.config.candleIntervalMinutes, 'minutes');
        this.strategy.stocks.forEach(stock => {
            const lastLTP = this.getLtp(stock.token);
            this.currentCandles.set(stock.token, {
                open: lastLTP || null, high: lastLTP || -Infinity, low: lastLTP || Infinity, close: lastLTP || null,
                startTime: startTime.valueOf(), volume: 0
            });
        });
    }

    finalizeCurrentCandles() {
        const finalizedTime = moment.tz("Asia/Kolkata").startOf('minute').subtract(this.config.candleIntervalMinutes, 'minutes');
        this.strategy.stocks.forEach(stock => {
            const currentCandle = this.currentCandles.get(stock.token);
            if (currentCandle && currentCandle.open !== null) {
                const completeCandle = {
                    timestamp: finalizedTime.valueOf(),
                    open: currentCandle.open, high: currentCandle.high,
                    low: currentCandle.low, close: currentCandle.close,
                    volume: currentCandle.volume || 0
                };
                if (!stock.candles) stock.candles = [];
                stock.candles.push(completeCandle);
                if (stock.candles.length > this.config.maxCandlesToKeep) {
                    stock.candles.shift();
                }
            }
        });
    }
    
    cleanup() {
        if (this.candleInterval) clearInterval(this.candleInterval);
    }
}

module.exports = CandleManager;