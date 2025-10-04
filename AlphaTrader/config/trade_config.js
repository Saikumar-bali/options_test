// File: /trading-bot/config/trade_config.js

const STRATEGY_DEFINITIONS = {
    "S_R_BB": {
        strategyFile: 'S_R_BB_Strategy.js',
        parameters: [
            { timeframe: 'FIVE_MINUTE', s_r_days: 15, bb_period: 20 },
        ],
        defaults: {
            bollinger_bands: { period: 20, stdDev: 2 },
            support_resistance: { reactionLookback: 10, levelsToReturn: 5 },
        }
    },
    "MACD_Crossover": {
        strategyFile: 'MACD_Strategy.js',
        parameters: [
            { timeframe: 'FIFTEEN_MINUTE', fast: 12, slow: 26, signal: 9 },
        ],
        defaults: {}
    }
};

const TRADING_UNIVERSE = [
    {
        underlying: 'NIFTY',
        token: '99926000',
        exchange: 'NSE',
        lot_size: 50,
        strategy_types: ["S_R_BB"], 
        options: {
            enabled: true,
            expiry_date: '2025-06-26',
            atm_strikes: 1,
        },
        order_params: {
            variety: 'NORMAL',
            producttype: 'INTRADAY',
        }
    },
    {
        underlying: 'BANKNIFTY',
        token: '99926009',
        exchange: 'NSE',
        lot_size: 15,
        strategy_types: ["S_R_BB"],
        options: {
            enabled: true,
            expiry_date: '2025-06-26',
            atm_strikes: 1,
        },
        order_params: {
            variety: 'NORMAL',
            producttype: 'INTRADAY',
        }
    }
];

module.exports = { STRATEGY_DEFINITIONS, TRADING_UNIVERSE };
