// File: /pre_market_analyzer/data_processing/sr_calculator.js
const moment = require('moment-timezone'); // Ensure moment is available

class SrCalculator {
    static detectLevels(candles, sensitivityValue, strengthThreshold) {
        if (!candles || candles.length < 5) return [];
        const levels = [];

        for (let i = 2; i < candles.length - 2; i++) {
            const c = candles[i];
            if (c.high > candles[i-1].high && c.high > candles[i-2].high && c.high > candles[i+1].high && c.high > candles[i+2].high) {
                levels.push({ level: c.high, type: 'resistance', strength: 1, timestamp: c.timestamp });
            }
            if (c.low < candles[i-1].low && c.low < candles[i-2].low && c.low < candles[i+1].low && c.low < candles[i+2].low) {
                levels.push({ level: c.low, type: 'support', strength: 1, timestamp: c.timestamp });
            }
        }
        return this.groupAndStrengthenLevels(levels, sensitivityValue, strengthThreshold);
    }

    static groupAndStrengthenLevels(levels, sensitivityValue, strengthThreshold) {
        if (levels.length === 0) return [];
        levels.sort((a, b) => a.level - b.level);

        const grouped = [];
        let currentGroup = [levels[0]];

        for (let i = 1; i < levels.length; i++) {
            const priceDiff = Math.abs(levels[i].level - currentGroup[0].level);
            const sensitivityThreshold = currentGroup[0].level * sensitivityValue; // sensitivity as percentage

            if (levels[i].type === currentGroup[0].type && priceDiff <= sensitivityThreshold) {
                currentGroup.push(levels[i]);
            } else {
                this.finalizeGroup(grouped, currentGroup, strengthThreshold);
                currentGroup = [levels[i]];
            }
        }
        this.finalizeGroup(grouped, currentGroup, strengthThreshold);
        return grouped;
    }

    static finalizeGroup(finalList, group, strengthThreshold) {
        if (group.length === 0) return;
        if (group.length >= strengthThreshold) {
            const avgLevel = group.reduce((sum, l) => sum + l.level, 0) / group.length;
            // Get the timestamp of the most recent level in the group
            const latestTimestamp = Math.max(...group.map(l => l.timestamp));
            finalList.push({
                level: parseFloat(avgLevel.toFixed(2)),
                type: group[0].type,
                strength: group.length,
                last_touch_timestamp: latestTimestamp
            });
        }
    }
}
module.exports = SrCalculator;