// File: /advanced_trader_refactored/src/data/DataHandler.js
const fs = require('fs');
const path = require('path');
const moment = require("moment-timezone");
const { getOptionType, delay } = require('../indicators/utils');

class DataHandler {
    constructor(strategy) {
        this.strategy = strategy;
        this.logger = strategy.logger;
        this.config = strategy.config;
        this.masterController = strategy.masterController;
    }

    loadStocks() {
        try {
            const filePath = path.join(__dirname, '../../logs', this.config.logFiles.updatedStocks);
            if (!fs.existsSync(filePath)) {
                this.logger.warn(`⚠️ ${filePath} not found. Starting with empty stocks list.`);
                return [];
            }
            const stocksData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return stocksData.map(s => ({
                ...s,
                option_type: s.option_type || getOptionType(s.symbol),
                candles: [], bb: null, rsi: null, atr: null,
            }));
        } catch (e) {
            this.logger.error(`❌ Error reading ${this.config.logFiles.updatedStocks}:`, e);
            return [];
        }
    }

    async fetchAllHistoricalData() {
        this.logger.info(`⏳ Fetching historical data for ${this.strategy.stocks.length} contracts...`);
        for (const stock of this.strategy.stocks) {
            try {
                const params = {
                    exchange: stock.exch_seg,
                    symboltoken: stock.token,
                    interval: "FIFTEEN_MINUTE",
                    fromdate: moment().subtract(this.config.tradingParameters.historicalDataDays, 'days').format('YYYY-MM-DD HH:mm'),
                    todate: moment().format('YYYY-MM-DD HH:mm')
                };
                const history = await this.masterController.enqueueApiCall('getCandleData', [params]);
                if (history && history.data) {
                    stock.candles = history.data.map(c => ({
                        timestamp: moment(c[0]).valueOf(),
                        open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
                    })).slice(-this.config.tradingParameters.maxCandlesToKeep);
                } else {
                    this.logger.warn(`⚠️ No historical data for ${stock.symbol}.`);
                    stock.candles = [];
                }
                await delay(this.config.fetchDelayMs);
            } catch (error) {
                this.logger.error(`❌ History fetch failed for ${stock.symbol}:`, error.message);
                stock.candles = [];
            }
        }
        this.logger.info("✅ Historical data fetch complete.");
    }
}

module.exports = DataHandler;