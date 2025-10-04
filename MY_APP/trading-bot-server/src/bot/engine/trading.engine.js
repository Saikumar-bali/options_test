const dbPool = require('../../config/db.config'); // Use the centralized DB pool

class TradingEngine {
    constructor(angelOneService) {
        if (!angelOneService) {
            throw new Error("TradingEngine requires an instance of AngelOneService.");
        }
        this.angelOne = angelOneService;
        this.levels = new Map();
        console.log("📈 Trading Engine initialized.");
    }

    async loadLevels() {
        console.log("📚 Loading S/R levels from database...");
        try {
            const [rows] = await dbPool.query(
                `SELECT id, symbol, price_level, level_type, option_contract, option_action
                 FROM support_resistance
                 WHERE is_active = TRUE`
            );
            this.levels.clear();
            for (const row of rows) {
                if (!this.levels.has(row.symbol)) {
                    this.levels.set(row.symbol, []);
                }
                this.levels.get(row.symbol).push({
                    id: row.id, // Keep the ID for deactivation
                    price: parseFloat(row.price_level),
                    type: row.level_type,
                    contract: row.option_contract,
                    action: row.option_action
                });
            }
            console.log(`✅ Loaded ${rows.length} active levels for ${this.levels.size} symbols.`);
        } catch (error) {
            console.error("❌ Failed to load S/R levels:", error);
        }
    }

    /**
     * Deactivates a level in the database and removes it from memory.
     * @param {number} levelId - The ID of the level to deactivate.
     * @param {string} symbol - The symbol the level belongs to.
     */
    async deactivateLevel(levelId, symbol) {
        try {
            await this.dbPool.execute("UPDATE support_resistance SET is_active = FALSE WHERE id = ?", [levelId]);
            console.log(`✅ Deactivated level ID: ${levelId} for ${symbol}.`);

            // Remove from in-memory map to prevent re-triggering
            const symbolLevels = this.levels.get(symbol);
            if (symbolLevels) {
                const updatedLevels = symbolLevels.filter(level => level.id !== levelId);
                this.levels.set(symbol, updatedLevels);
            }
        } catch (error) {
            console.error(`❌ Failed to deactivate level ID ${levelId}:`, error);
        }
    }

    /**
     * Processes a real-time market data tick.
     * @param {object} tickData - e.g., { symbol: 'NIFTY 50', ltp: 23500.50 }
     */
    async processTick(tickData) {
        const { symbol, ltp } = tickData;
        const symbolLevels = this.levels.get(symbol);

        if (!symbolLevels || symbolLevels.length === 0) {
            return; // No active levels for this symbol
        }

        for (const level of symbolLevels) {
            let signalTriggered = false;

            // Resistance Breach -> BUY signal
            if (level.type === 'resistance' && ltp > level.price) {
                console.log(`📈 BUY SIGNAL on ${symbol}! Price ${ltp} breached resistance at ${level.price}`);
                signalTriggered = true;
            }
            // Support Breach -> SELL signal
            else if (level.type === 'support' && ltp < level.price) {
                console.log(`🚨 SELL SIGNAL on ${symbol}! Price ${ltp} breached support at ${level.price}`);
                signalTriggered = true;
            }

            if (signalTriggered) {
                // If a contract is associated with the level, place the trade
                if (level.contract && level.action) {
                    // NOTE: You need a way to map the contract name (e.g., 'NIFTY_CE_25000') to a symbol token.
                    // This often requires fetching the instrument list from the broker.
                    // For this example, we'll use a placeholder token.
                    const tradeDetails = {
                        tradingsymbol: level.contract,
                        symboltoken: 'PLACEHOLDER_TOKEN', // ⚠️ You must replace this with a real token
                        transactiontype: level.action.toUpperCase(),
                        quantity: 1 // Default to 1 lot, adjust as needed
                    };
                    await this.angelOne.placeOrder(tradeDetails);
                }
                // Deactivate the level to prevent it from firing again
                await this.deactivateLevel(level.id, symbol);
            }
        }
    }
}

module.exports = TradingEngine;