const math = require('mathjs'); // Optional, standard JS works fine if this isn't installed

class SupportResistance {
    /**
     * Detects Support and Resistance levels using Pivot Points.
     * CAPTURES SINGLE TOUCH LEVELS (Strength 1) to ensure no visual levels are missed.
     * Fixes "Resistance-Turned-Support" by comparing Level vs LTP.
     * * @param {Array} candles - Array of candle objects or arrays [time, open, high, low, close]
     * @param {Number} ltp - Current Last Traded Price
     * @param {Object} config - Configuration object { reactionLookback, levelsToReturn }
     */
    static detectLevels(candles, ltp, config) {
        // 1. Normalize Candle Data
        const normalizedCandles = candles.map(c => ({
            high: Array.isArray(c) ? c[2] : c.high,
            low: Array.isArray(c) ? c[3] : c.low,
            close: Array.isArray(c) ? c[4] : c.close,
        }));

        const lookback = config.reactionLookback || 5;
        const maxLevels = config.levelsToReturn || 6;
        const mergeThresholdPercent = 0.2; // Merge levels within 0.2%

        let pivots = [];

        // 2. Identify Pivot Highs and Pivot Lows
        for (let i = lookback; i < normalizedCandles.length - lookback; i++) {
            const current = normalizedCandles[i];
            
            // Check for Pivot High (Resistance candidate)
            let isHigh = true;
            for (let j = 1; j <= lookback; j++) {
                if (normalizedCandles[i - j].high > current.high || normalizedCandles[i + j].high > current.high) {
                    isHigh = false;
                    break;
                }
            }

            // Check for Pivot Low (Support candidate)
            let isLow = true;
            for (let j = 1; j <= lookback; j++) {
                if (normalizedCandles[i - j].low < current.low || normalizedCandles[i + j].low < current.low) {
                    isLow = false;
                    break;
                }
            }

            // Capture ALL pivots, even if they are single spikes
            if (isHigh) pivots.push({ price: current.high, strength: 1, origin: 'High' });
            if (isLow) pivots.push({ price: current.low, strength: 1, origin: 'Low' });
        }

        // 3. Merge Nearby Levels
        let mergedLevels = [];
        pivots.sort((a, b) => a.price - b.price);

        for (let i = 0; i < pivots.length; i++) {
            if (mergedLevels.length === 0) {
                mergedLevels.push(pivots[i]);
                continue;
            }

            const last = mergedLevels[mergedLevels.length - 1];
            const current = pivots[i];
            const diffPercent = ((current.price - last.price) / last.price) * 100;

            if (diffPercent <= mergeThresholdPercent) {
                // Merge and increase strength
                last.price = (last.price * last.strength + current.price) / (last.strength + 1);
                last.strength += 1; 
            } else {
                mergedLevels.push(current);
            }
        }

        // 4. Classify based on LTP (The Fix)
        let supports = [];
        let resistances = [];

        mergedLevels.forEach(level => {
            if (level.price < ltp) {
                supports.push({ level: level.price, strength: level.strength });
            } else {
                resistances.push({ level: level.price, strength: level.strength });
            }
        });

        // 5. Sort by proximity to LTP
        supports.sort((a, b) => b.level - a.level);      // Descending (Closest below)
        resistances.sort((a, b) => a.level - b.level);   // Ascending (Closest above)

        return {
            supports: supports.slice(0, maxLevels),
            resistances: resistances.slice(0, maxLevels)
        };
    }
}

module.exports = SupportResistance;