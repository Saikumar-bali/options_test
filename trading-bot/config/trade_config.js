// File: /trading-bot/config/trade_config.js

// --- Define strategy templates with expiry preferences ---
const STRATEGY_TEMPLATES = [
    {
        enabled: true,
        underlying: 'NIFTY',
        strategy: 'SUPPORT_RETEST',
        instrumentType: 'Index',
        token: '99926000',
        lot_size: 50,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        underlying: 'NIFTY',
        strategy: 'RESISTANCE_RETEST',
        instrumentType: 'Index',
        token: '99926000',
        lot_size: 50,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        lot_size: 15,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        lot_size: 15,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        lot_size: 75,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        lot_size: 75,
        options: { expiry_type: 'WEEKLY', atm_strikes: 1 },
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
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
        historical_data: { timeframe: 'FIFTEEN_MINUTE', days: 10},
        support_resistance: { reactionLookback: 5, levelsToReturn: 8 },
        resistance_retest_params: { candle_interval: 'FIFTEEN_MINUTE' },
        atrSettings: { enabled: true, period: 8, slMultiplier: 2, trailingMultiplier: 0.5, riskRewardRatio: 5 },
        rsiSettings: { enabled: false, period: 8, threshold: 30 }
    },
];

// Process the templates to inject dynamic values
const STRATEGY_CONFIG = STRATEGY_TEMPLATES.map(config => ({
    ...config,
    exchange: config.exchange || 'NSE',
    instrumentType: config.instrumentType || 'Stock',
    options: {
        enabled: true,
        ...config.options,
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
