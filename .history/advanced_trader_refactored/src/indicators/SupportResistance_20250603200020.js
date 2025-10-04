// File: /src/indicators/SupportResistance.js

class SupportResistance {
    static detectLevels(candles, sensitivity, strengthThreshold) {
        if (!candles || candles.length < 3) { // Need at least 3 candles for a 3-point pivot
            return [];
        }

        const levels = [];
        // <mark style="background-color: red; color: white;">
        // Changed loop to accommodate 3-point pivot (1 candle on each side)
        // </mark>
        for (let i = 1; i < candles.length - 1; i++) {
            const prev1 = candles[i - 1];
            const candle = candles[i];
            const next1 = candles[i + 1];

            let isPivotHigh = false;
            let isPivotLow = false;

            // Check for 3-point pivot high (resistance)
            if (candle.high > prev1.high && candle.high > next1.high) {
                isPivotHigh = true;
            }

            // Check for 3-point pivot low (support)
            if (candle.low < prev1.low && candle.low < next1.low) {
                isPivotLow = true;
            }

            if (isPivotHigh) {
                levels.push({ level: candle.high, type: 'resistance', strength: 1, timestamp: candle.timestamp });
            }
            if (isPivotLow) {
                levels.push({ level: candle.low, type: 'support', strength: 1, timestamp: candle.timestamp });
            }
        }
        
        // Group nearby levels and reinforce strength
        return this.groupLevels(levels, sensitivity, strengthThreshold);
    }

    static groupLevels(levels, sensitivity, strengthThreshold) {
        if (levels.length === 0) return [];

        levels.sort((a, b) => a.level - b.level);

        const grouped = [];
        let currentGroup = [levels[0]];

        for (let i = 1; i < levels.length; i++) {
            if (Math.abs(levels[i].level - currentGroup[0].level) <= sensitivity && levels[i].type === currentGroup[0].type) {
                currentGroup.push(levels[i]);
            } else {
                const avgLevel = currentGroup.reduce((sum, l) => sum + l.level, 0) / currentGroup.length;
                const totalStrength = currentGroup.reduce((sum, l) => sum + l.strength, 0);
                if (totalStrength >= strengthThreshold) {
                    grouped.push({ level: parseFloat(avgLevel.toFixed(2)), type: currentGroup[0].type, strength: totalStrength });
                }
                currentGroup = [levels[i]];
            }
        }
        // Process the last group
        const avgLevel = currentGroup.reduce((sum, l) => sum + l.level, 0) / currentGroup.length;
        const totalStrength = currentGroup.reduce((sum, l) => sum + l.strength, 0);
        if (totalStrength >= strengthThreshold) {
             grouped.push({ level: parseFloat(avgLevel.toFixed(2)), type: currentGroup[0].type, strength: totalStrength });
        }
        
        // Further consolidation: Merge very close support/resistance zones of the same type
        if (grouped.length < 2) return grouped;
        grouped.sort((a,b) => a.level - b.level);
        const finalGrouped = [grouped[0]];
        for(let i = 1; i < grouped.length; i++){
            let lastFinalLevel = finalGrouped[finalGrouped.length-1];
            if(grouped[i].type === lastFinalLevel.type && Math.abs(grouped[i].level - lastFinalLevel.level) <= sensitivity * 2) { // Slightly larger sensitivity for merging already grouped levels
                // Merge: update level to be average, sum strengths
                lastFinalLevel.level = parseFloat(((lastFinalLevel.level * lastFinalLevel.strength + grouped[i].level * grouped[i].strength) / (lastFinalLevel.strength + grouped[i].strength)).toFixed(2));
                lastFinalLevel.strength += grouped[i].strength;
            } else {
                finalGrouped.push(grouped[i]);
            }
        }
        return finalGrouped;
    }
}

module.exports = SupportResistance;