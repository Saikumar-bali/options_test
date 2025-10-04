// File: /main.js
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

    const masterController = new MasterController();
    let strategyInstance;

    try {
        // This part is correct
        await masterController.initialize();
        strategyInstance = new AdvancedOptionsTrader(masterController, config);
        // --- THIS IS THE FIX ---
        // This missing line starts the entire process: pre-market analysis, subscriptions, etc.
        await strategyInstance.initialize();
        // ----------------------

        console.log(`Main runner: ${config.strategyName} strategy is initialized and running. Waiting for events...`);

    } catch (error) {
        console.error("❌ Main application startup failed:", error.message, error.stack);
        if (strategyInstance && strategyInstance.logger) {
            strategyInstance.logger.error("❌ Main application startup failed:", error.message, error);
            if (strategyInstance.telegramService) {
                strategyInstance.telegramService.sendAlert(`☠️ FATAL ERROR during startup: ${error.message}`);
            }
        }
        process.exit(1);
    }

    // Graceful shutdown
    const shutdown = async (signal) => {
        console.log(`\n${signal} received. Shutting down ${config.strategyName}...`);
        if (strategyInstance) {
            await strategyInstance.shutdown(signal);
        }
        // It's good practice to also cleanup the masterController if it has a method for it
        if (masterController && typeof masterController.cleanup === 'function') {
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
             if (strategyInstance.telegramService) {
                strategyInstance.telegramService.sendAlert(`💥 UNCAUGHT EXCEPTION: ${error.message}`);
            }
        }
        shutdown('uncaughtException').then(() => process.exit(1));
    });
}

main();