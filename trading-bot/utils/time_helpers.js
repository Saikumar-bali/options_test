// File: /trading-bot/utils/time_helpers.js

const moment = require('moment-timezone');

/**
 * Calculates the start time of the current candle based on the interval.
 * @param {moment.Moment} now - The current time (moment object).
 * @param {number} intervalMinutes - The candle interval in minutes (e.g., 15).
 * @returns {moment.Moment} - The start time of the current candle.
 */
function getCandleTime(now, intervalMinutes) {
    const currentMinute = now.minute();
    const minutesIntoInterval = currentMinute % intervalMinutes;
    // Clone the 'now' object to avoid mutating it
    return now.clone().subtract(minutesIntoInterval, 'minutes').second(0).millisecond(0);
}

/**
 * Checks if a new candle has started.
 * @param {moment.Moment} currentCandleTime - The calculated start time of the current candle.
 * @param {moment.Moment | null} lastCandleTime - The stored start time of the last known candle.
 * @returns {boolean} - True if a new candle has begun.
 */
function isNewCandle(currentCandleTime, lastCandleTime) {
    // If lastCandleTime is null (on startup), it's a new candle.
    // Otherwise, check if the current candle time is after the last one.
    return !lastCandleTime || currentCandleTime.isAfter(lastCandleTime);
}

module.exports = {
    getCandleTime,
    isNewCandle
};
