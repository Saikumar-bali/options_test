// File: /advanced_trader_refactored/src/indicators/SupportResistance.js

class SupportResistance {
    /**
     * A simple pivot-based S/R level detection.
     * A pivot high is a candle with lower highs on both sides.
     * A pivot low is a candle with higher lows on both sides.
     */
    static detectLevels(candles, sensitivity, strengthThreshold) {
        if (candles.length < 5) return [];

        const levels = [];
        // Iterate through candles, excluding the first two and last two
        for (let i = 2; i < candles.length - 2; i++) {
            const candle = candles[i];
            const prev2 = candles[i - 2];
            const prev1 = candles[i - 1];
            const next1 = candles[i + 1];
            const next2 = candles[i + 2];

            // Pivot High (Resistance)
            if (candle.high > prev1.high && candle.high > prev2.high && candle.high > next1.high && candle.high > next2.high) {
                levels.push({ level: candle.high, type: 'resistance' });
            }
            // Pivot Low (Support)
            if (candle.low < prev1.low && candle.low < prev2.low && candle.low < next1.low && candle.low < next2.low) {
                levels.push({ level: candle.low, type: 'support' });
            }
        }

        // Group nearby levels to determine strength
        const groupedLevels = this.groupLevels(levels, sensitivity);
        
        return groupedLevels.filter(l => l.strength >= strengthThreshold);
    }
    
    static groupLevels(levels, sensitivity) {
        if (levels.length === 0) return [];
        
        levels.sort((a, b) => a.level - b.level);
        
        const grouped = [];
        let currentGroup = [levels[0]];

        for (let i = 1; i < levels.length; i++) {
            const lastLevelInGroup = currentGroup[currentGroup.length - 1].level;
            // Check if current level is close to the last one
            if ((levels[i].level - lastLevelInGroup) <= sensitivity) {
                currentGroup.push(levels[i]);
            } else {
                // Finalize the old group
                const avgLevel = currentGroup.reduce((sum, l) => sum + l.level, 0) / currentGroup.length;
                const type = currentGroup.every(l => l.type === 'resistance') ? 'resistance' : 'support';
                grouped.push({ level: avgLevel, strength: currentGroup.length, type });
                // Start a new group
                currentGroup = [levels[i]];
            }
        }
        
        // Finalize the last group
        const avgLevel = currentGroup.reduce((sum, l) => sum + l.level, 0) / currentGroup.length;
        const type = currentGroup.every(l => l.type === 'resistance') ? 'resistance' : 'support';
        grouped.push({ level: avgLevel, strength: currentGroup.length, type });

        return grouped;
    }
}

module.exports = SupportResistance;