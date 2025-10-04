// File: /trading-bot/indicators/Trendline.js

/**
 * Identifies swing lows in a series of candles.
 * A swing low is a candle whose low is the lowest in a given window of candles.
 * @param {Array<Object>} candles - Array of candle objects { open, high, low, close }.
 * @param {number} windowSize - The number of candles to the left and right to check.
 * @returns {Array<Object>} An array of swing low points { index, price }.
 */
function findSwingLows(candles, windowSize = 5) {
    const swingLows = [];
    if (candles.length < (windowSize * 2) + 1) {
        return [];
    }

    for (let i = windowSize; i < candles.length - windowSize; i++) {
        const currentLow = candles[i].low;
        let isSwingLow = true;
        for (let j = 1; j <= windowSize; j++) {
            if (candles[i - j].low < currentLow || candles[i + j].low < currentLow) {
                isSwingLow = false;
                break;
            }
        }
        if (isSwingLow) {
            swingLows.push({ index: i, price: currentLow });
        }
    }
    return swingLows;
}

/**
 * Finds the most recent, valid support trendline from a series of candles.
 * A valid trendline is defined by at least 3 touchpoints from swing lows, has a positive slope,
 * and the price does not significantly break below it between its defining points.
 * @param {Array<Object>} candles - Array of candle objects.
 * @param {Object} params - Configuration parameters.
 * @param {number} params.minTouches - Minimum number of touches to be a valid trendline.
 * @param {number} params.tolerancePercent - The percentage tolerance for a point to be considered on the line.
 * @returns {Object|null} The trendline object { slope, intercept, points, touches } or null if none found.
 */
function findSupportTrendline(candles, params = {}) {
    const { minTouches = 3, tolerancePercent = 0.10 } = params; // Default 0.10% tolerance
    const swingLows = findSwingLows(candles, 5);

    if (swingLows.length < 2) { // Need at least 2 points to form a line
        return null;
    }

    let bestTrendline = null;
    
    // Iterate through all combinations of two swing lows to form a candidate line
    for (let i = 0; i < swingLows.length; i++) {
        for (let j = i + 1; j < swingLows.length; j++) {
            const p1 = swingLows[i];
            const p2 = swingLows[j];

            if (p1.index === p2.index) continue;

            // Calculate slope (m) and intercept (c) for y = mx + c
            const slope = (p2.price - p1.price) / (p2.index - p1.index);
            
            // We are looking for a RISING support trendline
            if (slope <= 0) continue;

            const intercept = p1.price - slope * p1.index;
            
            const currentPoints = [];
            let touches = 0;

            // Check how many swing lows touch this candidate line
            for (const p3 of swingLows) {
                const expectedPrice = slope * p3.index + intercept;
                const tolerance = expectedPrice * (tolerancePercent / 100);

                if (Math.abs(p3.price - expectedPrice) <= tolerance) {
                    touches++;
                    currentPoints.push(p3);
                }
            }
            
            if (touches >= minTouches) {
                // Validation Step: Ensure price doesn't significantly break below the line
                const sortedPoints = currentPoints.sort((a, b) => a.index - b.index);
                const firstPoint = sortedPoints[0];
                const lastPoint = sortedPoints[sortedPoints.length - 1];
                let isLineValid = true;

                for (let k = firstPoint.index + 1; k < lastPoint.index; k++) {
                    const trendlinePrice = slope * k + intercept;
                    // Allow a slightly larger tolerance for minor breaches within the trendline formation
                    const breachTolerance = trendlinePrice * ((tolerancePercent * 1.5) / 100); 
                    if (candles[k].low < trendlinePrice - breachTolerance) {
                        isLineValid = false;
                        break;
                    }
                }

                if (isLineValid) {
                    // We prefer the most recent trendline. A trendline is considered more recent 
                    // if its last defining point is more recent.
                    if (!bestTrendline || lastPoint.index > bestTrendline.points[bestTrendline.points.length - 1].index) {
                         bestTrendline = {
                            slope,
                            intercept,
                            points: sortedPoints,
                            touches
                        };
                    }
                }
            }
        }
    }
    
    return bestTrendline;
}

module.exports = { findSupportTrendline };
