// File: /src/indicators/SupportResistance.js

class SupportResistance {
    /**
     * **FINAL VERSION**
     * A more robust S/R detection using a "window" to find true pivots, preventing misses from minor fluctuations.
     * It then ranks these pivots by the power of the subsequent price reaction.
     */
    static detectLevels(candles, params = { reactionLookback: 5, levelsToReturn: 5, pivotWindow: 2 }) {
        const initialState = { supports: [], resistances: [] };
        if (!candles || candles.length < (params.pivotWindow * 2 + 1)) {
            return initialState;
        }

        const supports = [];
        const resistances = [];
        const window = params.pivotWindow;

        for (let i = window; i < candles.length - Math.max(window, params.reactionLookback); i++) {
            
            let isSupport = true;
            let isResistance = true;

            // Check the window on both sides to confirm a true pivot
            for (let j = 1; j <= window; j++) {
                if (candles[i].low > candles[i - j].low || candles[i].low > candles[i + j].low) {
                    isSupport = false;
                }
                if (candles[i].high < candles[i - j].high || candles[i].high < candles[i + j].high) {
                    isResistance = false;
                }
            }
            
            if (isSupport) {
                let reactionHigh = candles[i].low;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionHigh = Math.max(reactionHigh, candles[i + j].high);
                }
                const reactionSize = reactionHigh - candles[i].low;
                supports.push({ level: candles[i].low, type: 'support', reaction: reactionSize });
            }

            if (isResistance) {
                let reactionLow = candles[i].high;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionLow = Math.min(reactionLow, candles[i + j].low);
                }
                const reactionSize = candles[i].high - reactionLow;
                resistances.push({ level: candles[i].high, type: 'resistance', reaction: reactionSize });
            }
        }
        
        supports.sort((a, b) => b.reaction - a.reaction);
        resistances.sort((a, b) => b.reaction - a.reaction);

        const topSupports = this.getUniqueTopLevels(supports, params.levelsToReturn);
        const topResistances = this.getUniqueTopLevels(resistances, params.levelsToReturn);
        
        return { supports: topSupports, resistances: topResistances };
    }

    static getUniqueTopLevels(levels, count) {
        const uniqueLevels = [];
        for (const level of levels) {
            if (uniqueLevels.length >= count) break;
            const isTooClose = uniqueLevels.some(uniqueLevel => Math.abs(uniqueLevel.level - level.level) / level.level < 0.005);
            if (!isTooClose) {
                uniqueLevels.push(level);
            }
        }
        return uniqueLevels;
    }
}
module.exports = SupportResistance;