// File: D:/master_controller/advanced_strategy/oi_manager.js

const { delay } = require('./utils.js');

class OIManager {
    constructor(config, stocks, logger) {
        this.config = config || { enabled: false };
        this.stocks = stocks;
        this.logger = logger;
        // Store current OI, previous OI, and the calculated change
        this.oiData = new Map(); // token -> { currentOI: number, previousOI: number, changeInOI: number, interpretation: string }
        this.updateIntervalId = null; // Added: Store interval ID for updates

        if (this.config.enabled) {
            this.logger.info("📈 OI Manager Enabled. Starting updates...");
            this.scheduleUpdates();
        } else {
            this.logger.info("📉 OI Manager Disabled.");
        }
    }

    async fetchOIData(stock) {
        this.logger.debug(`[OI] Simulating OI fetch for ${stock.symbol}...`);
        await delay(50); // Simulate network delay

        const existingData = this.oiData.get(stock.token) || { currentOI: 0, previousOI: 0, changeInOI: 0 };
        const newRawOI = Math.floor(Math.random() * 10000) + 50000; // Placeholder: new raw OI

        const previousOI = existingData.currentOI; // OI from last fetch becomes previous
        const currentOI = newRawOI;
        const changeInOI = currentOI - previousOI;

        let interpretation = 'NEUTRAL';
        if (changeInOI > (previousOI * 0.05)) { // Example: >5% change
            interpretation = 'BUILDUP';
        } else if (changeInOI < -(previousOI * 0.05)) {
            interpretation = 'UNWINDING';
        }

        return {
            token: stock.token,
            currentOI: currentOI,
            previousOI: previousOI, // Store for next cycle's "previous"
            changeInOI: changeInOI,
            interpretation: interpretation,
            timestamp: Date.now()
        };
    }

    async updateAllOI() {
        this.logger.info('[OI] Updating all OI data...');
        for (const stock of this.stocks) {
            if (stock.option_type) { // Assuming we only track OI for options
                try {
                    const newData = await this.fetchOIData(stock);
                    this.oiData.set(stock.token, newData);
                    this.logger.debug(`[OI] Updated OI for ${stock.symbol}: OI=${newData.currentOI}, Change=${newData.changeInOI}, Interpret=${newData.interpretation}`);
                } catch (error) {
                    this.logger.error(`[OI] Failed to fetch/update OI for ${stock.symbol}`, error);
                }
            }
        }
    }

    scheduleUpdates() {
        this.updateAllOI(); // Initial fetch
        if (this.config.updateIntervalMinutes > 0) {
            // Store interval ID for later cleanup
            this.updateIntervalId = setInterval(
                () => this.updateAllOI(), 
                this.config.updateIntervalMinutes * 60 * 1000
            );
        }
    }

    stopUpdates() { // Added: Method to stop scheduled updates
        if (this.updateIntervalId) {
            clearInterval(this.updateIntervalId);
            this.updateIntervalId = null;
            this.logger.info("⏹️ OI Manager updates stopped.");
        }
    }

    getOISignal(token) { // This method might need rethinking if getTradeSignal is primary
        if (!this.config.enabled || !this.oiData.has(token)) {
            return 'NOT_AVAILABLE';
        }
        return this.oiData.get(token).interpretation; // e.g., 'BUILDUP', 'UNWINDING'
    }

    getTradeSignal(token, optionType) {
        const oiInfo = this.oiData.get(token);
        if (!this.config.enabled || !oiInfo) {
            return 'NEUTRAL_MARKET'; // Default to neutral if no data or disabled
        }

        // Example refined logic using changeInOI and interpretation
        // This needs significant tuning based on actual OI theory and your strategy
        const { interpretation, changeInOI, currentOI } = oiInfo;
        let signal = 'NEUTRAL_MARKET';

        if (optionType === 'CE') {
            // Bullish for underlying (good for CE buy)
            if (interpretation === 'UNWINDING' && changeInOI < 0) signal = 'BULLISH_MARKET'; // Call short covering
            if (interpretation === 'BUILDUP' && changeInOI > 0 && /* price is also up - needs price context */ false) {
                // This would be Call Long Buildup, not simple "BUILDUP"
            }

            // Bearish for underlying (bad for CE buy)
            if (interpretation === 'BUILDUP' && changeInOI > 0 /* && price down/stagnant */) signal = 'BEARISH_MARKET'; // Call writing
            
        } else if (optionType === 'PE') {
            // Bullish for underlying (bad for PE buy)
            if (interpretation === 'BUILDUP' && changeInOI > 0 /* && price up/stagnant */) signal = 'BULLISH_MARKET'; // Put writing

            // Bearish for underlying (good for PE buy)
            if (interpretation === 'UNWINDING' && changeInOI < 0) signal = 'BEARISH_MARKET'; // Put short covering
        }
        
        this.logger.debug(`[OI Signal] Token: ${token}, OptType: ${optionType}, Interpret: ${interpretation}, Change: ${changeInOI}, Signal: ${signal}`);
        return signal; // 'BULLISH_MARKET', 'BEARISH_MARKET', 'NEUTRAL_MARKET'
    }
}

module.exports = OIManager;