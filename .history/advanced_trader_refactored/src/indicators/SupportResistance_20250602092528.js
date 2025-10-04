class SupportResistance {
    /**
     * A simple pivot-based S/R level detection.
     * A pivot high is a candle with lower highs on both sides.
     * A pivot low is a candle with higher lows on both sides.
     */
    static detectLevels(candles, sensitivity, strengthThreshold) {
        if (candles.length < 3) return [];

        const levels = [];
        // Start from index 1 to length-2 to have at least one neighbor on each side
        for (let i = 1; i < candles.length - 1; i++) {
            const candle = candles[i];
            const prev = candles[i - 1];
            const next = candles[i + 1];

            // Pivot High (Resistance) - high must be greater than immediate neighbors
            if (candle.high > prev.high && candle.high > next.high) {
                levels.push({ level: candle.high, type: 'resistance' });
            }
            // Pivot Low (Support) - low must be lower than immediate neighbors
            if (candle.low < prev.low && candle.low < next.low) {
                levels.push({ level: candle.low, type: 'support' });
            }
        }

        console.log(`[SR] Found ${levels.length} raw levels before grouping`);
        // Group nearby levels to determine strength
        const groupedLevels = this.groupLevels(levels, sensitivity);
        console.log(`[SR] Grouped into ${groupedLevels.length} levels after filtering`);
        
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
        if (currentGroup.length > 0) {
            const avgLevel = currentGroup.reduce((sum, l) => sum + l.level, 0) / currentGroup.length;
            const type = currentGroup.every(l => l.type === 'resistance') ? 'resistance' : 'support';
            grouped.push({ level: avgLevel, strength: currentGroup.length, type });
        }

        return grouped;
    }
}

module.exports = SupportResistance;