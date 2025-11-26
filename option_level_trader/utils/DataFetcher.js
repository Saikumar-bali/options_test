// File: /trading-bot/utils/LightningDataFetcher.js
const QuantumRequestOptimizer = require('./QuantumRequestOptimizer');
const moment = require('moment-timezone');

class DataFetcher {
    constructor(masterController) {
        this.masterController = masterController;
        this.quantumOptimizer = new QuantumRequestOptimizer(masterController);
        this.cache = new Map();
        this.requestStats = { total: 0, cached: 0, batched: 0 };
    }

    async getHistoricalData(params, useCache = true) {
        // FIX: Cache key must include time range to prevent serving stale data for different times
        const cacheKey = this.createCacheKey(params);

        if (useCache && this.cache.has(cacheKey)) {
            this.requestStats.cached++;
            this.requestStats.total++;
            return this.cache.get(cacheKey);
        }

        const request = { params, useCache };
        this.requestStats.total++;
        this.requestStats.batched++;

        const [result] = await this.quantumOptimizer.quantumBatchRequest([request]);

        if (result && result.success) {
            if (useCache) this.cache.set(cacheKey, result.data);
            return result.data;
        }

        console.error(`[LightningDataFetcher] ❌ Failed to fetch data for ${params.symboltoken}. Reason: ${result?.error}`);
        if (this.cache.has(cacheKey)) {
            console.warn(`[LightningDataFetcher] ⚠️ Serving stale data from cache for ${params.symboltoken} due to fetch failure.`);
            this.requestStats.cached++;
            return this.cache.get(cacheKey);
        }
        return null;
    }

    isRecentRequest(params) {
        try {
            if (params.todate) {
                const toDate = moment(params.todate, 'YYYY-MM-DD HH:mm');
                const now = moment().tz('Asia/Kolkata');
                const diffHours = now.diff(toDate, 'hours');
                return Math.abs(diffHours) <= 2;
            }
            return false;
        } catch (error) {
            console.log('⚠️ Error checking recency of request:', error);
            return true;
        }
    }

    createCacheKey(params) {
        // CRITICAL FIX: Include dates in the key!
        // Old: return `${params.exchange}_${params.symboltoken}_${params.interval}`;
        return `${params.exchange}_${params.symboltoken}_${params.interval}_${params.fromdate}_${params.todate}`;
    }

    async batchHistoricalData(requests) {
        return await this.quantumOptimizer.quantumBatchRequest(requests);
    }

    async prefetchAllStrategyData(strategies) {
        return await this.quantumOptimizer.prefetchStrategyData(strategies);
    }

    getStats() {
        const total = this.requestStats.total || 1;
        const hitRate = (this.requestStats.cached / total * 100).toFixed(1);
        const efficiency = ((this.requestStats.cached + this.requestStats.batched) / total * 100).toFixed(1);
        return { ...this.requestStats, hitRate: `${hitRate}%`, efficiency: `${efficiency}%` };
    }
}

module.exports = DataFetcher;