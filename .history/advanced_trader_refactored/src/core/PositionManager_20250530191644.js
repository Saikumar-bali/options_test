// File: /advanced_trader_refactored/src/core/PositionManager.js
const fs = require('fs');
const path = require('path');
const moment = require("moment-timezone");

class PositionManager {
    constructor(strategy) {
        this.strategy = strategy;
        this.logger = strategy.logger;
        this.config = strategy.config;
        this.activePositions = new Map();
    }

    getPosition(token) {
        return this.activePositions.get(token);
    }

    getAllPositions() {
        return Array.from(this.activePositions.values());
    }
    
    getOpenPositionCount() {
        return this.activePositions.size;
    }

    addPosition(position) {
        this.activePositions.set(position.token, position);
        this.savePositions();
    }

    removePosition(token) {
        this.activePositions.delete(token);
        this.savePositions();
    }

    savePositions() {
        try {
            const dataToSave = this.getAllPositions().map(p => ({
                ...p,
                buyTime: p.buyTime ? p.buyTime.toISOString() : null,
                expiry: p.expiry ? (moment.isMoment(p.expiry) ? p.expiry.toISOString() : p.expiry) : null,
            }));
            const filePath = path.join(__dirname, '../../logs', this.config.logFiles.positions);
            fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));
            this.logger.debug("Positions saved.");
        } catch (e) {
            this.logger.error("❌ Error saving positions:", e.message, e);
        }
    }

  loadPositions() {
        try {
            const filePath = path.join(__dirname, '../../logs', this.config.logFiles.positions);
            if (!fs.existsSync(filePath)) return;

            // FIX: Check if the file is empty before parsing
            const fileContent = fs.readFileSync(filePath, 'utf8').trim();
            if (fileContent.length === 0) {
                this.logger.info("Positions file is empty, starting fresh.");
                return;
            }

            const data = JSON.parse(fileContent);
            const stocks = this.strategy.stocks;

            data.forEach(p => {
                if (!p.token) {
                    this.logger.warn("Skipping position load - missing token:", p);
                    return;
                }
                const stockInfo = stocks.find(s => s.token === p.token);
                this.activePositions.set(p.token, {
                    ...p,
                    buyTime: moment(p.buyTime),
                    expiry: p.expiry ? moment(p.expiry) : null,
                    buyPrice: parseFloat(p.buyPrice),
                    quantity: parseInt(p.quantity),
                    slPrice: parseFloat(p.slPrice),
                    tpPrice: parseFloat(p.tpPrice),
                    symbol: p.symbol || stockInfo?.symbol,
                    exch_seg: p.exch_seg || stockInfo?.exch_seg,
                    option_type: p.option_type || stockInfo?.option_type,
                });
            });
            this.logger.info(`✅ Loaded ${this.activePositions.size} positions from file.`);
        } catch (error) {
            this.logger.error('❌ Error loading positions:', error.message, error);
            this.activePositions.clear();
        }
    }
}

module.exports = PositionManager;
