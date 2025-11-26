// File: /trading-bot/config/trade_config.js

// --- Define strategy templates with expiry preferences ---
const STRATEGY_TEMPLATES = [
    {
        enabled: true,
        underlying: 'NIFTY',
        strategy: 'SUPPORT_RETEST',
        instrumentType: 'Index',
        token: '99926000',
        lot_size: 75,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 10, levelsToReturn: 5 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30,
        }
    },
    {
        enabled: true,
        underlying: 'NIFTY',
        strategy: 'RESISTANCE_RETEST',
        instrumentType: 'Index',
        token: '99926000',
        lot_size: 75,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        }
    },
    {
        enabled: true,
        underlying: 'SENSEX',
        strategy: 'SUPPORT_RETEST',
        exchange: 'BSE',
        instrumentType: 'Index',
        token: '99919000',
        lot_size: 20,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30, // Corrected from 70
        }
    },
    {
        enabled: true,
        underlying: 'SENSEX',
        strategy: 'RESISTANCE_RETEST',
        exchange: 'BSE',
        instrumentType: 'Index',
        token: '99919000',
        lot_size: 20,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30, // Corrected from 70
        }
    },
    {
        enabled: true,
        underlying: 'BANKNIFTY',
        strategy: 'SUPPORT_RETEST',
        instrumentType: 'Index',
        token: '99926009',
        lot_size: 35,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30, // Corrected from 70
        }
    },
    {
        enabled: true,
        underlying: 'BANKNIFTY',
        strategy: 'RESISTANCE_RETEST',
        instrumentType: 'Index',
        token: '99926009',
        lot_size: 35,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30, // Corrected from 70
        }
    },
    // --- NEW: NIFTYMIDCAPSELECT Index ---
    {
        enabled: true,
        underlying: 'MIDCPNIFTY',
        strategy: 'SUPPORT_RETEST',
        instrumentType: 'Index',
        token: '99926074', // Placeholder token, please verify
        lot_size: 140,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30,
        }
    },
    {
        enabled: true,
        underlying: 'MIDCPNIFTY',
        strategy: 'RESISTANCE_RETEST',
        instrumentType: 'Index',
        token: '99926074', // Placeholder token, please verify
        lot_size: 140,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30,
        }
    },

    // --- STOCK STRATEGIES (RSI < 30 for both CE and PE) ---
    {
        enabled: true,
        underlying: 'TCS',
        token: '11536',
        lot_size: 175,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30,
        }
    },
    {
        enabled: true,
        underlying: 'TCS',
        token: '11536',
        lot_size: 175,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30, // Corrected from 70
        }
    },
    {
        enabled: true,
        underlying: 'INFY',
        token: '1594',
        lot_size: 400,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30,
        }
    },
    {
        enabled: true,
        underlying: 'HDFCBANK',
        token: '1333',
        lot_size: 550,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 }, // Standardized
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30,
        }
    },
    {
        enabled: true,
        underlying: 'HDFCBANK',
        token: '1333',
        lot_size: 550,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 }, // Standardized
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30, // Corrected from 70
        }
    },
    {
        enabled: true,
        underlying: 'ICICIBANK',
        token: '4963',
        lot_size: 700,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 }, // Standardized
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30,
        }
    },
    {
        enabled: true,
        underlying: 'ICICIBANK',
        token: '4963',
        lot_size: 700,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 }, // Standardized
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30, // Corrected from 70
        }
    },
    {
        enabled: true,
        underlying: 'AXISBANK',
        token: '5900',
        lot_size: 700,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 }, // Standardized
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30,
        }
    },
    {
        enabled: true,
        underlying: 'AXISBANK',
        token: '5900',
        lot_size: 700,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 }, // Standardized
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30, // Corrected from 70
        }
    },
    {
        enabled: true,
        underlying: 'RELIANCE',
        token: '2885',
        lot_size: 250,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 }, // Standardized
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30,
        }
    },
    {
        enabled: true,
        underlying: 'RELIANCE',
        token: '2885',
        lot_size: 250,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 }, // Standardized
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: {
            enabled: true,
            period: 8,
            slMultiplier: 2,
            trailingMultiplier: 0.5,
            riskRewardRatio: 5,
        },
        rsiSettings: {
            enabled: false,
            period: 8,
            threshold: 30, // Corrected from 70
        }
    },
    // --- NEW STOCKS ---
    {
        enabled: true,
        underlying: 'SBIN',
        token: '3045',
        lot_size: 1500,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'SBIN',
        token: '3045',
        lot_size: 1500,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'BHARTIARTL',
        token: '10604',
        lot_size: 951,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'BHARTIARTL',
        token: '10604',
        lot_size: 951,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'HINDUNILVR',
        token: '1394',
        lot_size: 300,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'HINDUNILVR',
        token: '1394',
        lot_size: 300,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'BAJFINANCE',
        token: '317',
        lot_size: 125,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'BAJFINANCE',
        token: '317',
        lot_size: 125,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'ITC',
        token: '1660',
        lot_size: 1600,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'ITC',
        token: '1660',
        lot_size: 1600,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'LT',
        token: '11483',
        lot_size: 150,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'LT',
        token: '11483',
        lot_size: 150,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'M&M',
        token: '2031',
        lot_size: 350,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'M&M',
        token: '2031',
        lot_size: 350,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'SUNPHARMA',
        token: '3351',
        lot_size: 425,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'SUNPHARMA',
        token: '3351',
        lot_size: 425,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'ONGC',
        token: '2475',
        lot_size: 2700,
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'ONGC',
        token: '2475',
        lot_size: 2700,
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    // --- COMMODITIES: Crude Oil ---
    {
        enabled: true,
        underlying: 'CRUDEOIL',
        exchange: 'MCX',
        instrumentType: 'COMDTY',
        token: '462523', // Front-month CRUDEOIL FUT token (from instrument master)
        lot_size: 100, // MCX lot size for Crude Oil FUT
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'CRUDEOIL',
        exchange: 'MCX',
        instrumentType: 'COMDTY',
        token: '462523', // Front-month CRUDEOIL FUT token (from instrument master)
        lot_size: 100, // MCX lot size for Crude Oil FUT
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    // --- COMMODITIES: Natural Gas ---
    {
        enabled: true,
        underlying: 'NATURALGAS',
        exchange: 'MCX',
        instrumentType: 'COMDTY',
        token: '458147', // Front-month NATURALGAS FUT token (24NOV2025 from instrument master)
        lot_size: 1250, // MCX lot size for Natural Gas FUT
        strategy: 'SUPPORT_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        support_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
    {
        enabled: true,
        underlying: 'NATURALGAS',
        exchange: 'MCX',
        instrumentType: 'COMDTY',
        token: '458147', // Front-month NATURALGAS FUT token (24NOV2025 from instrument master)
        lot_size: 1250, // MCX lot size for Natural Gas FUT
        strategy: 'RESISTANCE_RETEST',
        options: { expiry_type: 'MONTHLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10 },
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
];

// Process the templates to inject dynamic values
// Default fallback settings when option history is missing. These are
// used by OptionsLevelStrategy to decide whether to derive option S/R
// from the underlying and how to filter mapped levels.
const FALLBACK_DEFAULTS = {
    use_underlying_fallback: true,
    // Minimum option LTP to consider mapping (helps avoid noisy low-priced options)
    minOptionLTP: 0.5,
    // Guards to avoid wildly scaled mapped levels
    minUnderlyingToOptionRatio: 0.2,
    maxUnderlyingToOptionRatio: 5,
    // Maximum allowed multiplier between mapped level and option LTP
    maxMultiplier: 20,
    // Maximum percent deviation allowed between mapped level and option LTP (for sanity)
    maxDeviationPct: 1000
};

const STRATEGY_CONFIG = STRATEGY_TEMPLATES.map(config => ({
    ...config,
    exchange: config.exchange || 'NSE',
    instrumentType: config.instrumentType || 'Stock',
    options: {
        enabled: true,
        ...config.options,
    },
    support_resistance: {
        // Keep existing support_resistance settings but ensure fallback settings exist
        ...(config.support_resistance || {}),
        fallback: {
            ...FALLBACK_DEFAULTS,
            // allow per-template override
            ...((config.support_resistance && config.support_resistance.fallback) || {})
        }
    }
}));

// Log all dynamic expiry PREFERENCES for verification
console.log('\n[Config] Verifying expiry preferences for all enabled strategies...');
STRATEGY_CONFIG.forEach(config => {
    if (config.enabled) {
        const underlying = config.underlying.padEnd(18);
        const strategy = config.strategy.padEnd(18);
        const expiryPref = config.options.expiry_type || 'MONTHLY'; // Default to monthly if not specified
        console.log(`  -> ${underlying} (${strategy}): ${expiryPref}`);
    }
});
console.log(''); // Add a blank line for readability

module.exports = { STRATEGY_CONFIG };
