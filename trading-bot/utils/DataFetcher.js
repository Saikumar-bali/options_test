// File: /trading-bot/utils/DataFetcher.js

const { getHistoricalDataParams } = require('../utils/helpers');
const moment = require('moment-timezone');

/**
 * A utility class to handle fetching historical data with built-in retry and fallback logic.
 * This centralizes data requests and makes them more robust against temporary network
 * or API issues, especially for illiquid option contracts.
 */
class DataFetcher {
    /**
     * @param {object} masterController - The main controller instance used to make API calls.
     */
    constructor(masterController) {
        this.masterController = masterController;
        // Simple in-memory cache to avoid re-fetching the same data in a short time frame.
        this.cache = new Map();
        this.cacheTTL = 60 * 1000; // Cache data for 60 seconds
    }

    /**
     * Sleeps for a specified duration.
     * @param {number} ms - The number of milliseconds to wait.
     * @returns {Promise<void>}
     */
    _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Internal helper to perform the fetch request with a retry mechanism.
     * @param {object} params - The parameters for the historical data API call.
     * @param {number} retries - The number of times to retry on failure.
     * @param {number} initialDelay - The initial delay between retries in milliseconds.
     * @returns {Promise<object|null>} The historical data response or null if all retries fail.
     */
    async _fetchWithRetries(params, retries, initialDelay) {
        for (let i = 0; i < retries; i++) {
            try {
                const history = await this.masterController.getHistoricalData(params);

                // If the API call was successful (even with empty data), we consider it a valid response.
                if (history?.status) {
                    return history;
                }

                // If status is false or the request failed, we retry.
                const delay = initialDelay * Math.pow(2, i); // Exponential backoff
                console.warn(`[DataFetcher] Attempt ${i + 1} failed for ${params.symbol}. Retrying in ${delay / 1000}s...`);
                await this._wait(delay);

            } catch (error) {
                const delay = initialDelay * Math.pow(2, i);
                console.error(`[DataFetcher] CRITICAL: Attempt ${i + 1} threw an error for ${params.symbol}.`, error.message);
                if (i < retries - 1) {
                    await this._wait(delay);
                }
            }
        }
        return null; // All retries failed
    }

    /**
     * Fetches historical data with retry and an intelligent fallback for options.
     * @param {object} params - The parameters for the historical data API call.
     * @param {number} retries - The number of times to retry on failure.
     * @param {number} initialDelay - The initial delay between retries in milliseconds.
     * @returns {Promise<object|null>} The historical data response or null if all attempts fail.
     */
    async getHistoricalData(params, retries = 3, initialDelay = 1000) {
        const cacheKey = JSON.stringify(params);
        
        // Check cache first to avoid redundant API calls
        if (this.cache.has(cacheKey)) {
            const cachedEntry = this.cache.get(cacheKey);
            if (Date.now() - cachedEntry.timestamp < this.cacheTTL) {
                return cachedEntry.data;
            }
        }

        // --- 1. Primary attempt with original parameters ---
        let history = await this._fetchWithRetries(params, retries, initialDelay);

        // --- 2. Enhanced Fallback logic for options that return no data ---
        const isOption = params.symbol && (params.symbol.includes('CE') || params.symbol.includes('PE'));
        
        // If the primary attempt for an option was successful but returned no data points...
        if (isOption && history?.status && (!history.data || history.data.length === 0)) {
            console.warn(`[DataFetcher] Initial fetch for option ${params.symbol} with interval '${params.interval}' returned no data. Initiating fallback sequence.`);

            // Define a sequence of fallback configurations
            const fallbackConfigs = [
                { interval: 'FIVE_MINUTE', days: 45, label: '5-Minute' },
                { interval: 'SIXTY_MINUTE', days: 120, label: '60-Minute' },
                { interval: 'DAY', days: 365, label: 'Daily' }
            ];

            for (const config of fallbackConfigs) {
                // Don't re-try the same interval as the original request
                if (params.interval === config.interval) continue;

                // CHANGE: Added a delay *between* each fallback attempt to prevent request storms.
                console.log(`[DataFetcher] Waiting 2 seconds before next fallback attempt...`);
                await this._wait(2000); 

                console.log(`[DataFetcher] Fallback attempt: Using '${config.label}' interval with a ${config.days}-day lookback for ${params.symbol}.`);

                const toDate = moment().tz("Asia/Kolkata");
                const fromDate = toDate.clone().subtract(config.days, 'days');

                // CHANGE: Corrected parameters to avoid redundant date fields from logs.
                // The API expects 'fromdate' and 'todate'.
                const fallbackParams = {
                    ...params,
                    interval: config.interval,
                    fromdate: fromDate.format('YYYY-MM-DD HH:mm'),
                    todate: toDate.format('YYYY-MM-DD HH:mm'),
                };
                // Remove the old keys if they exist to keep the request clean
                delete fallbackParams.from_date;
                delete fallbackParams.to_date;
                
                history = await this._fetchWithRetries(fallbackParams, retries, initialDelay);

                // If this fallback was successful and returned data, we can stop the sequence.
                if (history?.status && history.data && history.data.length > 0) {
                    console.log(`[DataFetcher] Fallback successful. Fetched ${history.data.length} candles for ${params.symbol} using '${config.label}' interval.`);
                    break; // Exit the loop on success
                } else {
                    console.warn(`[DataFetcher] Fallback with '${config.label}' interval also failed to retrieve data for ${params.symbol}.`);
                }
            }
        }


        // After all attempts, if history is still null or the status is false, log a final error.
        if (!history?.status) {
             console.error(`[DataFetcher] FINAL: All attempts failed to fetch historical data for ${params.exchange}:${params.symbol}.`);
             return null;
        }

        // Cache and return the final result (which could still be a successful response with an empty dataset)
        this.cache.set(cacheKey, { timestamp: Date.now(), data: history });
        return history;
    }
}

module.exports = DataFetcher;

