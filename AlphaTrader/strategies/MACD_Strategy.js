// File: /trading-bot/strategies/MACD_Strategy.js

const BaseStrategy = require('./BaseStrategy.js');
const MACDIndicator = require('../indicators/MACD');
const { getHistoricalDataParams } = require('../utils/helpers');

/**
 * An example of a second strategy type: a simple MACD Crossover.
 * This demonstrates how easy it is to add new strategies to the AlphaTrader framework.
 */
class MACD_Strategy extends BaseStrategy {
    constructor(masterController, config, instrumentLoader, telegramService) {
        super(masterController, config, instrumentLoader, telegramService);

        this.underlying = {
            symbol: config.underlying,
            token: config.token,
            ltp: 0,
        };
        this.macd = [];
        this.lastSignal = ''; // 'buy' or 'sell'
    }

    async initialize() {
        await this.calculateMACD();
    }

    getTokensToTrack() {
        // This strategy trades the underlying directly, not options.
        return [{ ...this.underlying, exch_seg: this.config.exchange }];
    }

    processData(tick) {
        if (tick.token === this.underlying.token) {
            // In a real scenario, you would update the last candle and recalculate the MACD
            // For simplicity, we'll just log the price change.
            // console.log(`[${this.strategyId}] New tick for ${this.underlying.symbol}: ${tick.last_price}`);
        }
    }

    async calculateMACD() {
        try {
            const historyParams = getHistoricalDataParams({ token: this.underlying.token, exch_seg: this.config.exchange }, this.config.timeframe, 60); // Fetch more data for MACD
            const history = await this.masterController.getHistoricalData(historyParams);
            
            if (!history || !history.status || !history.data) {
                console.error(`[${this.strategyId}] Could not fetch historical data for MACD.`);
                return;
            }

            const closePrices = history.data.map(c => c[4]);
            this.macd = MACDIndicator.calculate(closePrices, this.config);
            
            console.log(`[${this.strategyId}] MACD calculated. Last value:`, this.macd[this.macd.length - 1]);
            this.checkSignal();

        } catch (error) {
            console.error(`[${this.strategyId}] Error calculating MACD:`, error.message);
        }
    }

    checkSignal() {
        if (this.macd.length < 2) return;

        const last = this.macd[this.macd.length - 1];
        const secondLast = this.macd[this.macd.length - 2];

        // Buy signal: MACD line crosses above the signal line
        if (secondLast.MACD < secondLast.signal && last.MACD > last.signal) {
            if (this.lastSignal !== 'buy') {
                this.lastSignal = 'buy';
                this.triggerTrade('BUY');
            }
        }
        
        // Sell signal: MACD line crosses below the signal line
        if (secondLast.MACD > secondLast.signal && last.MACD < last.signal) {
            if (this.lastSignal !== 'sell') {
                this.lastSignal = 'sell';
                this.triggerTrade('SELL');
            }
        }
    }

    triggerTrade(action) {
        // This is a simplified trade simulation for this example strategy
        console.log(`[${this.strategyId}] SIMULATING ${action} TRADE for ${this.underlying.symbol}`);
        
        const tradeDataObject = {
            symbol: this.underlying.symbol,
            entryPrice: this.underlying.ltp,
            exitPrice: action === 'BUY' ? this.underlying.ltp * 1.005 : this.underlying.ltp * 0.995, // Simulate 0.5% P/L
            profit: action === 'BUY' ? (this.underlying.ltp * 0.005) * this.config.lot_size : (-this.underlying.ltp * 0.005) * this.config.lot_size,
            timestamp: new Date().toISOString(),
        };
        this.logTrade(tradeDataObject); // Use the BaseStrategy method to log
    }
}

module.exports = MACD_Strategy;
