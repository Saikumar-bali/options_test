// File: /trading-bot/indicators/Trendline.js

function findSensitiveSwingLows(candles, windowSize = 2) {
    const swingLows = [];
    if (candles.length < (windowSize * 2) + 1) return [];

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
            swingLows.push({ index: i, price: currentLow, time: candles[i].time });
        }
    }
    return swingLows;
}

/**
 * Advanced Trendline Detection using RANSAC with RECENCY BIAS.
 * Finds the robust line that is most relevant to the CURRENT price action.
 */
function findSupportTrendlineRANSAC(candles, tolerancePercent = 0.1, minTouches = 3, maxIterations = 5000) {
    const sensitiveSwings = findSensitiveSwingLows(candles, 2); 
    const N = sensitiveSwings.length;
    if (N < 2) return null;

    const currentBarIndex = candles.length - 1;
    let bestTrendline = null;
    let bestScore = -Infinity; // We now use a score, not just touch count

    for (let iter = 0; iter < maxIterations; iter++) {
        // Randomly select two points
        let idx1 = Math.floor(Math.random() * N);
        let idx2 = Math.floor(Math.random() * N);
        while (idx2 === idx1) idx2 = Math.floor(Math.random() * N);
        
        const pA = sensitiveSwings[idx1];
        const pB = sensitiveSwings[idx2];
        const p1 = pA.index < pB.index ? pA : pB;
        const p2 = pA.index < pB.index ? pB : pA;

        const indexDiff = p2.index - p1.index;
        
        // Strict Filter: Line must be rising and points must not be identical
        if (p2.price <= p1.price || indexDiff <= 0) continue;

        const slope = (p2.price - p1.price) / indexDiff;
        const intercept = p1.price - slope * p1.index;

        let inliers = [];
        
        for (let k = 0; k < N; k++) {
            const pOther = sensitiveSwings[k];
            const trendlinePrice = slope * pOther.index + intercept;
            const priceDiff = Math.abs(pOther.price - trendlinePrice);
            const maxAllowedDeviation = trendlinePrice * (tolerancePercent / 100);

            if (priceDiff <= maxAllowedDeviation) {
                inliers.push(pOther);
            }
        }

        if (inliers.length >= minTouches) {
            // Validation: Ensure no significant breaches below the line
            const sortedInliers = inliers.sort((a, b) => a.index - b.index);
            const firstPoint = sortedInliers[0];
            const lastPoint = sortedInliers[sortedInliers.length - 1];
            let isLineValid = true;

            for (let k = firstPoint.index + 1; k < lastPoint.index; k++) {
                const trendlinePrice = slope * k + intercept;
                const breachTolerance = trendlinePrice * (tolerancePercent / 100); 
                if (candles[k].low < trendlinePrice - breachTolerance) {
                    isLineValid = false;
                    break;
                }
            }

            if (isLineValid) {
                // --- SMART SCORING ALGORITHM ---
                // 1. Weight by number of touches (Stability)
                // 2. Weight by how close the last point is to "Now" (Recency)
                // 3. Penalize lines that project too far away from current price
                
                const recencyFactor = lastPoint.index / currentBarIndex; // 0.0 to 1.0 (1.0 is very recent)
                const touchScore = Math.pow(inliers.length, 2); // Squared to heavily favor more touches
                
                // Current price projection check
                const currentProjectedPrice = slope * currentBarIndex + intercept;
                const currentClose = candles[currentBarIndex].close || candles[currentBarIndex].low;
                const distPercent = Math.abs((currentClose - currentProjectedPrice) / currentClose);
                
                // If the line is currently > 5% away from price, heavily penalize it
                const relevancePenalty = distPercent > 0.05 ? 0.1 : 1.0;

                // Final Score Calculation
                const totalScore = touchScore * recencyFactor * relevancePenalty;

                if (totalScore > bestScore) {
                    bestScore = totalScore;
                     bestTrendline = {
                        slope,
                        intercept,
                        points: sortedInliers,
                        touches: inliers.length,
                        score: totalScore
                    };
                }
            }
        }
    }
    
    if (bestTrendline) {
        bestTrendline.point1 = bestTrendline.points[0];
        bestTrendline.point2 = bestTrendline.points[bestTrendline.points.length - 1];
    }

    return bestTrendline;
}

module.exports = { findSupportTrendline: findSupportTrendlineRANSAC };