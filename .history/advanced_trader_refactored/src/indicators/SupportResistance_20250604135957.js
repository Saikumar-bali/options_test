// File: /src/indicators/SupportResistance.js

class SupportResistance {
    /**
     * Detects significant support and resistance zones from a series of candles.
     * @param {Array} candles - An array of candle objects { high, low }.
     * @param {number} sensitivityPercent - How close levels must be to be grouped into a zone (e.g., 0.5 for 0.5%).
     * @param {number} strengthThreshold - The minimum number of touches required to consider a zone significant.
     * @returns {Array} An array of significant S/R zone objects { level, type, strength }.
     */
    static detectLevels(candles, sensitivityPercent = 0.5, strengthThreshold = 2) {
        if (!candles || candles.length < 5) return [];

        const potentialLevels = [];
        // 1. Identify all minor pivot points
        for (let i = 2; i < candles.length - 2; i++) {
            const isSupport = candles[i].low < candles[i - 1].low && candles[i].low < candles[i - 2].low &&
                              candles[i].low < candles[i + 1].low && candles[i].low < candles[i + 2].low;
            
            const isResistance = candles[i].high > candles[i - 1].high && candles[i].high > candles[i - 2].high &&
                                 candles[i].high > candles[i + 1].high && candles[i].high > candles[i + 2].high;

            if (isSupport) {
                potentialLevels.push({ level: candles[i].low, type: 'support' });
            }
            if (isResistance) {
                potentialLevels.push({ level: candles[i].high, type: 'resistance' });
            }
        }
        
        // 2. Group these points into zones
        const zones = this.groupLevels(potentialLevels, sensitivityPercent);

        // 3. Filter for zones that meet the strength threshold
        const significantZones = zones.filter(zone => zone.strength >= strengthThreshold);
        
        return significantZones;
    }

    /**
     * Helper function to group close-by levels into a single zone.
     */
    static groupLevels(levels, sensitivityPercent) {
        if (levels.length === 0) return [];
        
        levels.sort((a, b) => a.level - b.level);
        
        const grouped = [];
        let currentGroup = [levels[0]];

        for (let i = 1; i < levels.length; i++) {
            const sensitivity = currentGroup[0].level * (sensitivityPercent / 100);
            
            // If the current level is close to the first level of the current group, add it.
            if ((levels[i].level - currentGroup[0].level) <= sensitivity) {
                currentGroup.push(levels[i]);
            } else {
                // Finalize the old group
                const avgLevel = currentGroup.reduce((sum, l) => sum + l.level, 0) / currentGroup.length;
                const strength = currentGroup.length;
                const type = currentGroup.every(l => l.type === 'resistance') ? 'resistance' : 'support'; // Simple type assignment
                grouped.push({ level: avgLevel, strength, type });
                
                // Start a new group
                currentGroup = [levels[i]];
            }
        }
        
        // Finalize the last group
        const avgLevel = currentGroup.reduce((sum, l) => sum + l.level, 0) / currentGroup.length;
        const strength = currentGroup.length;
        const type = currentGroup.every(l => l.type === 'resistance') ? 'resistance' : 'support';
        grouped.push({ level: avgLevel, strength: strength, type: type });
        
        return grouped;
    }
}

module.exports = SupportResistance;