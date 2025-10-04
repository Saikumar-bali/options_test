// File: /trading-bot/indicators/SupportResistance.js

const fs = require('fs');
const path = require('path');

/**
 * @description This module provides functionality to detect support and resistance levels from historical candle data.
 * The logic identifies significant pivot points, groups them into price zones, and counts the number of reactions at each zone.
 * It then filters for levels with multiple reactions to find the strongest S/R zones.
 */
class SupportResistance {
    /**
     * Detects support and resistance levels from a series of candles, prioritizing levels with multiple reactions.
     *
     * @param {Array<object>} candles - An array of candle objects. Each object must have { high, low }.
     * @param {number} ltp - The last traded price, used as a reference to classify levels.
     * @param {object} config - Configuration for level detection.
     * @param {number} config.reactionLookback - The number of candles to look back and forward to confirm a pivot point.
     * @param {number} config.levelsToReturn - The maximum number of support and resistance levels to return.
     * @returns {{supports: Array<object>, resistances: Array<object>}} - An object containing arrays of detected support and resistance levels.
     */
    static detectLevels(candles, ltp, config) {
        if (!candles || candles.length === 0 || !ltp || !config) {
            console.error("[SupportResistance] Invalid input provided for level detection.");
            return { supports: [], resistances: [] };
        }

        const { reactionLookback, levelsToReturn } = config;
        const pivots = [];

        // 1. Identify all significant pivot highs and lows (UPDATED LOGIC)
        for (let i = reactionLookback; i < candles.length - reactionLookback; i++) {
            const currentHigh = candles[i].high;
            const currentLow = candles[i].low;

            let isPivotHigh = true;
            let isPivotLow = true;

            // Look left and right of the current candle (UPDATED: removed break statements)
            for (let j = 1; j <= reactionLookback; j++) {
                // Check for pivot high (must be the highest in the lookback window)
                if (candles[i - j].high > currentHigh || candles[i + j].high > currentHigh) {
                    isPivotHigh = false;
                }
                // Check for pivot low (must be the lowest in the lookback window)
                if (candles[i - j].low < currentLow || candles[i + j].low < currentLow) {
                    isPivotLow = false;
                }
            }

            if (isPivotHigh) {
                pivots.push(currentHigh);
            }
            if (isPivotLow) {
                pivots.push(currentLow);
            }
        }

        if (pivots.length === 0) return { supports: [], resistances: [] };
        
        // 2. Group close pivots into zones and count reactions
        pivots.sort((a, b) => a - b);
        const levelZones = [];
        if (pivots.length > 0) {
            let currentZone = { levels: [pivots[0]], reactions: 1 };
            for (let i = 1; i < pivots.length; i++) {
                const avgLevelInZone = currentZone.levels.reduce((a, b) => a + b, 0) / currentZone.levels.length;
                // Group levels if they are within 0.75% of the current zone's average
                if ((pivots[i] - avgLevelInZone) / avgLevelInZone < 0.0075) {
                    currentZone.levels.push(pivots[i]);
                    currentZone.reactions++;
                } else {
                    levelZones.push(currentZone);
                    currentZone = { levels: [pivots[i]], reactions: 1 };
                }
            }
            levelZones.push(currentZone);
        }

        // 3. Filter for zones with 2 or more reactions and calculate the average level for each strong zone
        const strongLevels = levelZones
            .filter(zone => zone.reactions >= 2)
            .map(zone => ({
                level: zone.levels.reduce((a, b) => a + b, 0) / zone.levels.length,
                reactions: zone.reactions,
            }));

        // 4. Classify strong levels into support and resistance based on the current LTP
        const supports = [];
        const resistances = [];

        strongLevels.forEach(lvl => {
            if (lvl.level > ltp) {
                resistances.push({
                    ...lvl,
                    type: 'resistance',
                    distance: Math.abs(lvl.level - ltp)
                });
            } else {
                supports.push({
                    ...lvl,
                    type: 'support',
                    distance: Math.abs(lvl.level - ltp)
                });
            }
        });

        // 5. Sort levels by their distance to the LTP (closest first)
        supports.sort((a, b) => a.distance - b.distance);
        resistances.sort((a, b) => a.distance - b.distance);

        // 6. Return the requested number of levels
        return {
            supports: supports.slice(0, levelsToReturn),
            resistances: resistances.slice(0, levelsToReturn),
        };
    }
}

module.exports = SupportResistance;
