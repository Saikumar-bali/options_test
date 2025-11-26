// File: /trading-bot/utils/QuantumRequestOptimizer.js
class QuantumRequestOptimizer {
    constructor(masterController) {
        this.masterController = masterController;
        this.batchQueue = new Map();
        this.processing = false;
        this.lastBatchTime = 0;
        this.batchWindow = 100;
        this.maxBatchSize = 10;
        
        this.prefetchCache = new Map();
        this.symbolPatterns = new Map();
        
        this.activeConnections = 0;
        this.maxConnections = 3;
    }

    async quantumBatchRequest(requests) {
        if (requests.length === 0) return [];
        
        const batched = this.groupRequests(requests);
        const results = [];
        
        for (const [batchKey, batchRequests] of batched) {
            if (batchRequests.length === 1) {
                results.push(await this.executeSingle(batchRequests[0]));
            } else {
                results.push(...await this.executeBatch(batchRequests));
            }
        }
        
        return results;
    }

    groupRequests(requests) {
        const groups = new Map();
        
        requests.forEach(req => {
            const key = this.createBatchKey(req);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(req);
        });
        
        return groups;
    }

    createBatchKey(request) {
        const { endpoint, interval, timeRange } = this.analyzeRequest(request);
        return `${endpoint}_${interval}_${timeRange}`;
    }

    analyzeRequest(request) {
        const params = request.params;
        let endpoint = 'historical';
        let interval = params.interval || 'UNKNOWN';
        
        const fromDate = new Date(params.fromdate);
        const toDate = new Date(params.todate);
        const diffHours = (toDate - fromDate) / (1000 * 60 * 60);
        
        let timeRange = 'SHORT';
        if (diffHours > 24 * 7) timeRange = 'LONG';
        else if (diffHours > 24) timeRange = 'MEDIUM';
        
        return { endpoint, interval, timeRange };
    }

    async executeBatch(requests) {
        const batchResults = [];
        const chunks = this.chunkArray(requests, this.maxConnections);
        
        for (const chunk of chunks) {
            const chunkPromises = chunk.map(req => 
                this.executeWithRetry(req).catch(error => ({
                    success: false,
                    error,
                    symbol: req.params.symbol
                }))
            );
            
            const chunkResults = await Promise.all(chunkPromises);
            batchResults.push(...chunkResults);
            
            if (chunks.length > 1) {
                await this.delay(50);
            }
        }
        
        return batchResults;
    }

    async executeSingle(request) {
        return await this.executeWithRetry(request);
    }

    async executeWithRetry(request, retries = 2) {
        try {
            const result = await this.masterController.getHistoricalData(request.params);
            return { success: true, data: result, symbol: request.params.symbol };
        } catch (error) {
            if (retries > 0 && error.message?.includes('exceeding access rate')) {
                await this.delay(200 * (3 - retries));
                return this.executeWithRetry(request, retries - 1);
            }
            throw error;
        }
    }

    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async prefetchStrategyData(strategies) {
        console.log('🚀 Prefetching strategy data with quantum optimization...');
        
        const allRequests = [];
        const now = new Date();
        
        strategies.forEach(strategy => {
            if (!strategy.config) return;
            
            const { historical_data, underlying, token, exchange } = strategy.config;
            if (!historical_data) return;
            
            const fromDate = new Date(now.getTime() - (historical_data.days * 24 * 60 * 60 * 1000));
            const toDate = now;
            
            const request = {
                params: {
                    exchange: exchange,
                    symboltoken: token,
                    interval: historical_data.timeframe,
                    fromdate: fromDate.toISOString().split('T')[0] + ' 09:00',
                    todate: toDate.toISOString().split('T')[0] + ' 16:00',
                    symbol: underlying
                }
            };
            
            allRequests.push(request);
        });
        
        const startTime = Date.now();
        const results = await this.quantumBatchRequest(allRequests);
        const duration = Date.now() - startTime;
        
        console.log(`✅ Prefetched ${results.length} symbols in ${duration}ms`);
        
        return results;
    }
}

module.exports = QuantumRequestOptimizer;