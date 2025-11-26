// File: /trading-bot/utils/LightningDataFetcher.js
const QuantumRequestOptimizer = require('./QuantumRequestOptimizer');
const moment = require('moment-timezone');

class DataFetcher {
    constructor(masterController) {
        this.masterController = masterController;
        this.quantumOptimizer = new QuantumRequestOptimizer(masterController);
        this.cache = new Map();
        this.requestStats = {
            total: 0,
            cached: 0,
            batched: 0
        };
    }

    async getHistoricalData(params, useCache = true) {
        // ⚠️ CRITICAL FIX: The logic that disabled caching for recent data
        // was the source of the 1-minute strategy delay. It has been REMOVED.
        // const isRecentData = this.isRecentRequest(params);
        // if (isRecentData) {
        //     useCache = false; // <<< THIS WAS THE BUG
        // }
        
        const cacheKey = this.createCacheKey(params);
        
        // Ultra-fast cache check
        // The strategy will pass `useCache = true` for initial load
        // and `useCache = false` for 1-minute updates.
        // When `useCache` is false, it will skip this and go to QuantumOptimizer,
        // which is smart enough to fetch *only the new candle* (delta)
        // instead of the full 10-day history.
        if (useCache && this.cache.has(cacheKey)) {
            this.requestStats.cached++;
            this.requestStats.total++;
            return this.cache.get(cacheKey);
        }
        
        // Single request - use quantum optimizer for potential batching
        const request = { params, useCache }; // Pass useCache hint to optimizer
        
        this.requestStats.total++;
        this.requestStats.batched++;

        // The QuantumRequestOptimizer will now handle caching correctly.
        // If useCache is false, it will force a fetch, but it will
        // be a *smart* fetch of only the latest data, not the whole history.
        const [result] = await this.quantumOptimizer.quantumBatchRequest([request]);
        
        if (result && result.success) {
            // QuantumOptimizer now manages its own internal cache.
            // We can also hold a local cache for high-speed access.
            if (useCache) { // Only update local cache if intended
                this.cache.set(cacheKey, result.data);
            }
            return result.data;
        } else {
            console.error(`[LightningDataFetcher] ❌ Failed to fetch data for ${params.symboltoken}. Reason: ${result?.error}`);
            // Fallback to local cache if fetch fails
            if (this.cache.has(cacheKey)) {
                console.warn(`[LightningDataFetcher] ⚠️ Serving stale data from cache for ${params.symboltoken} due to fetch failure.`);
                this.requestStats.cached++; // Count as a cache hit (stale)
                return this.cache.get(cacheKey);
            }
            return null; // No data and no cache
        }
    }

    // This function checks if the 'todate' is within the last 2 hours.
    // This was the source of the performance bug for the 1-min strategy.
    // We keep it here but it's no longer called from getHistoricalData.
    isRecentRequest(params) {
        try {
            if (params.todate) {
                const toDate = moment(params.todate, 'YYYY-MM-DD HH:mm');
                const now = moment().tz("Asia/Kolkata");
                const diffHours = now.diff(toDate, 'hours');
                
                // If the end date is within 2 hours of now, it's "recent"
                return Math.abs(diffHours) <= 2;
            }
            
            return false;
        } catch (error) {
            console.log('⚠️ Error checking recency of request:', error);
            return true; // When in doubt, (old logic: don't cache)
        }
    }

    createCacheKey(params) {
        // ⚠️ IMPROVED: Include full date range in cache key
        // This key is problematic for the 1-min strategy as `todate` changes.
        // The *second* createCacheKey function (which is the one JS will use) is correct.
        return `${params.exchange}_${params.symboltoken}_${params.interval}_${params.fromdate}_${params.todate}`;
    }

    async batchHistoricalData(requests) {
        return await this.quantumOptimizer.quantumBatchRequest(requests);
    }

fs
    async prefetchAllStrategyData(strategies) {
        return await this.quantumOptimizer.prefetchStrategyData(strategies);
    }

    createCacheKey(params) {
        // Simplified key for speed. This is the correct key for this strategy.
        // This function overwrites the one above it.
        return `${params.exchange}_${params.symboltoken}_${params.interval}`;
    }

    getStats() {
        const total = this.requestStats.total || 1; // Avoid divide by zero
        const hitRate = (this.requestStats.cached / total * 100).toFixed(1);
        const efficiency = ((this.requestStats.cached + this.requestStats.batched) / total * 100).toFixed(1);

        return {
            ...this.requestStats,
            hitRate: `${hitRate}%`,
            efficiency: `${efficiency}%`
        };
    }
}

module.exports = DataFetcher;