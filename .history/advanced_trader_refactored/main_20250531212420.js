// File: /advanced_trader_refactored/main.js
const fs = require('fs');
const path = require('path');
const MasterController = require('../universal websocket/index.js'); // Adjust path as needed
const AdvancedOptionsTrader = require('./src/AdvancedOptionsTrader.js');

async function main() {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(path.join(__dirname, 'strategy_config.json'), 'utf-8'));
    } catch (e) {
        console.error("❌ FATAL: Could not load strategy_config.json.", e);
        process.exit(1);
    }

    const masterController = new MasterController(); // Assuming MC handles its own config
    let strategyInstance;

    try {
        await masterController.initialize();
        strategyInstance = new AdvancedOptionsTrader(masterController, config);
        console.log(`Main runner: ${config.strategyName} strategy instantiated. Waiting for events...`);
    } catch (error) {
        console.error("❌ Main application startup failed:", error.message, error.stack);
        if (strategyInstance && strategyInstance.logger) {
            strategyInstance.logger.error("❌ Main application startup failed:", error.message, error);
            strategyInstance.telegramService.sendAlert(`☠️ FATAL ERROR during startup: ${error.message}`);
        }
        process.exit(1);
    }

    // Graceful shutdown
    const shutdown = async (signal) => {
        console.log(`\n${signal} received. Shutting down ${config.strategyName}...`);
        if (strategyInstance) {
            await strategyInstance.shutdown(signal);
        }
        if (masterController) {
            masterController.cleanup();
        }
        console.log("Exiting.");
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        if (strategyInstance) {
            strategyInstance.logger.error('UNCAUGHT EXCEPTION:', error.message, error);
            strategyInstance.telegramService.sendAlert(`💥 UNCAUGHT EXCEPTION: ${error.message}`);
        }
        process.exit(1);
    });
}

main();