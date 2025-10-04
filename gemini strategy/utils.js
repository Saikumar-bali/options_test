// File: D:\master_controller\advanced_strategy\utils.js

/**
 * Determines if an option symbol is a Call (CE) or Put (PE).
 * @param {string} symbol - The option symbol.
 * @returns {string | null} 'CE', 'PE', or null.
 */
const getOptionType = (symbol) => {
    if (symbol.toUpperCase().includes("CE")) return "CE";
    if (symbol.toUpperCase().includes("PE")) return "PE";
    return null;
};

/**
 * Creates a promise that resolves after a specified delay.
 * @param {number} ms - The delay in milliseconds.
 * @returns {Promise<void>} A promise that resolves after the delay.
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    getOptionType,
    delay
};