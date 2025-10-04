// File: D:\master_controller\advanced_strategy\sr_levels.js

const _ = require('lodash');

class SupportResistance {
  static detectLevels(candles, sensitivity = 2) {
    const levels = [];
    const mergedLevels = [];

    // 1. Identify potential levels using fractal method
    for (let i = 3; i < candles.length - 3; i++) {
      // Support detection
      if (
        candles[i].low < candles[i - 1].low &&
        candles[i].low < candles[i - 2].low &&
        candles[i].low < candles[i + 1].low &&
        candles[i].low < candles[i + 2].low
      ) {
        levels.push({
          level: candles[i].low,
          type: 'support',
          strength: 1,
          timestamp: candles[i].timestamp
        });
      }
      
      // Resistance detection
      if (
        candles[i].high > candles[i - 1].high &&
        candles[i].high > candles[i - 2].high &&
        candles[i].high > candles[i + 1].high &&
        candles[i].high > candles[i + 2].high
      ) {
        levels.push({
          level: candles[i].high,
          type: 'resistance',
          strength: 1,
          timestamp: candles[i].timestamp
        });
      }
    }

    // 2. Merge nearby levels
    levels.sort((a, b) => a.level - b.level);
    
    for (const level of levels) {
      const existing = mergedLevels.find(
        ml => Math.abs(ml.level - level.level) <= sensitivity
      );
      
      if (existing) {
        existing.strength++;
        existing.level = (existing.level + level.level) / 2;
      } else {
        mergedLevels.push({...level});
      }
    }

    // 3. Filter significant levels
    return mergedLevels.filter(ml => ml.strength > 1);
  }
}

module.exports = SupportResistance;