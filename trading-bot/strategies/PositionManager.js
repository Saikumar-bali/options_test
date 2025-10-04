// File: /trading-bot/strategies/PositionManager.js

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const EventEmitter = require('events');

// Define the path for our state file, inside the data directory
const POSITIONS_FILE_PATH = path.resolve(__dirname, '../data/open_positions.json');

class PositionManager extends EventEmitter {
    constructor(masterController, telegramService) {
        super();
        this.masterController = masterController;
        this.telegramService = telegramService;

        // Fallback configuration for strategies where ATR is disabled or fails
        this.fallbackTradeConfig = {
            stopLossPercent: 0.20,
            takeProfitPercent: 1.00, // 1:5 RR based on 20% SL
        };

        this.openPositions = [];
        this.loadPositionsFromFile();
    }

    loadPositionsFromFile() {
        try {
            if (fs.existsSync(POSITIONS_FILE_PATH)) {
                const fileContent = fs.readFileSync(POSITIONS_FILE_PATH, 'utf8');
                if (fileContent) {
                    const savedPositions = JSON.parse(fileContent);
                    this.openPositions = savedPositions.map(p => ({
                        ...p,
                        entryTime: moment(p.entryTime)
                    }));
                    console.log(`[PositionManager] Successfully loaded ${this.openPositions.length} open position(s) from file.`);
                    if (this.openPositions.length > 0) {
                        this.telegramService.sendMessage(`📈 *Bot Restarted*\nLoaded ${this.openPositions.length} previously open position(s). Resuming management.`);
                    }
                }
            } else {
                console.log('[PositionManager] No saved positions file found. Starting fresh.');
            }
        } catch (error) {
            console.error('[PositionManager] CRITICAL: Error loading positions from file:', error);
            this.openPositions = [];
            this.telegramService.sendMessage('⚠️ *Warning:* Could not load saved positions file. It might be corrupted. Starting with no open positions.');
        }
    }

    savePositionsToFile() {
        try {
            const dataToSave = JSON.stringify(this.openPositions, null, 2);
            fs.writeFileSync(POSITIONS_FILE_PATH, dataToSave, 'utf8');
            console.log(`[PositionManager] State saved. ${this.openPositions.length} open position(s) are now persisted.`);
        } catch (error) {
            console.error('[PositionManager] CRITICAL: Error saving positions to file:', error);
            this.telegramService.sendMessage('🔥 *CRITICAL ERROR:* Failed to save open positions to file. State will be lost on the next restart!');
        }
    }

    addOpenPosition(positionData) {
        if (this.openPositions.some(p => p.instrument.token === positionData.instrument.token)) {
            console.log(`[PositionManager] Attempted to add an already open position for ${positionData.instrument.symbol}. Ignoring.`);
            return;
        }

        const { entryPrice, atrValue, atrSettings, tradeType } = positionData;
        const lotsToTrade = 2; // As per the new requirement, we always trade 2 lots.
        
        console.log(`[PositionManager] Now managing new ${lotsToTrade}-lot position: ${positionData.instrument.symbol} at entry ${entryPrice.toFixed(2)}`);

        let stopLossPrice, takeProfitPrice, takeProfitPrice2 = null;
        let notificationMessage = '';

        if (atrSettings && atrSettings.enabled && atrValue > 0) {
            // --- NEW ATR-based SL/TP logic ---
            console.log(`[PositionManager] Using ATR value ${atrValue.toFixed(2)} for SL/TP calculation.`);
            const stopLossOffset = atrValue;
            const takeProfitOffset1 = atrValue * 2; // Target 1 is 2 * ATR
            const takeProfitOffset2 = atrValue * 5; // Target 2 is 5 * ATR

            stopLossPrice = entryPrice - stopLossOffset;
            takeProfitPrice = entryPrice + takeProfitOffset1;  // This is Target 1
            takeProfitPrice2 = entryPrice + takeProfitOffset2; // This is Target 2

            const targetsMessage = `*Target 1:* ${takeProfitPrice.toFixed(2)} (${takeProfitOffset1.toFixed(2)} pts)\n*Target 2:* ${takeProfitPrice2.toFixed(2)} (${takeProfitOffset2.toFixed(2)} pts)`;
            notificationMessage = `🚀 *Trade Executed & Managed (${tradeType} x${lotsToTrade} lots)*\n\n*Symbol:* \`${positionData.instrument.symbol}\`\n*Entry Price:* ${entryPrice.toFixed(2)}\n*ATR Value:* ${atrValue.toFixed(2)}\n*Stop-Loss:* ${stopLossPrice.toFixed(2)} (${stopLossOffset.toFixed(2)} pts)\n${targetsMessage}`;

        } else {
            // --- FALLBACK to percentage-based SL/TP ---
            console.warn(`[PositionManager] ATR value is zero or disabled for ${positionData.instrument.symbol}. Reverting to fallback percentage-based SL/TP.`);
            const sl_percent = this.fallbackTradeConfig.stopLossPercent;
            const tp_percent = sl_percent * (atrSettings.riskRewardRatio || 5); 

            stopLossPrice = entryPrice * (1 - sl_percent);
            takeProfitPrice = entryPrice * (1 + tp_percent);
            notificationMessage = `🚀 *Trade Executed & Managed (${tradeType} x${lotsToTrade} lots)*\n\n*Symbol:* \`${positionData.instrument.symbol}\`\n*Entry Price:* ${entryPrice.toFixed(2)}\n*Stop-Loss:* ${stopLossPrice.toFixed(2)} (Fallback %)\n*Take-Profit:* ${takeProfitPrice.toFixed(2)} (Fallback %)`;
        }

        const position = {
            ...positionData,
            status: 'OPEN',
            exitPrice: null,
            stopLoss: stopLossPrice,
            takeProfit: takeProfitPrice,
            takeProfit2: takeProfitPrice2,
            entryTime: moment().tz("Asia/Kolkata"),
            initialLots: lotsToTrade,
            lots: lotsToTrade,
            ltp: entryPrice, // Initialize LTP with the entry price
        };

        this.openPositions.push(position);
        this.savePositionsToFile();
        // MODIFIED: Send this specific message to the alert bot
        this.telegramService.sendAlertMessage(notificationMessage);
    }

    processData(tick) {
        this.checkOpenPositions(tick);
    }

    getTokensToTrack() {
        return this.openPositions.map(p => p.instrument);
    }

    checkOpenPositions(tick) {
        const numericTickToken = Number(tick.token);
        for (let i = this.openPositions.length - 1; i >= 0; i--) {
            const position = this.openPositions[i];
            if (position.instrument.token === numericTickToken) {
                const ltp = tick.last_price;
                position.ltp = ltp; // Update the position's LTP with the latest tick price

                // --- Exit Conditions ---
                // Check for Stop-Loss first, as it has priority
                if (ltp <= position.stopLoss) {
                    this.executeSell(position, ltp, 'Stop-Loss Hit');
                    this.openPositions.splice(i, 1);
                    this.savePositionsToFile();
                    continue; // Move to the next position
                }

                // Check for Target 1 Hit (and we are still at full size)
                if (position.takeProfit && position.lots === position.initialLots && ltp >= position.takeProfit) {
                    this.executePartialSell(position, ltp, 'Target 1 Hit');
                    // The position remains in the array, but modified, so we don't splice here.
                }
                // Check for Target 2 Hit (after T1 was already hit)
                else if (position.takeProfit && position.lots < position.initialLots && ltp >= position.takeProfit) {
                    this.executeSell(position, ltp, 'Target 2 Hit');
                    this.openPositions.splice(i, 1);
                    this.savePositionsToFile();
                }
            }
        }
    }
    
    executePartialSell(position, exitPrice, reason) {
        const lotsToSell = 1;
        const remainingLots = position.lots - lotsToSell;
        console.log(`[PositionManager] EXECUTING PARTIAL SELL for ${position.instrument.symbol} at ${exitPrice}. Reason: ${reason}. Remaining lots: ${remainingLots}`);
        
        const pnl = (exitPrice - position.entryPrice) * position.instrument.lotsize * lotsToSell;

        // Emit a trade completed event for the closed portion
        this.emit('tradeCompleted', {
            strategy: `${position.strategyName}-Managed`,
            symbol: position.instrument.symbol,
            entryPrice: position.entryPrice,
            exitPrice: exitPrice,
            pnl: pnl,
            exitReason: reason,
            timestamp: moment().tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm:ss'),
        });

        // Send notification for the partial profit booking
        const partialProfitMessage = `💰 *Partial Profit Booked (${position.tradeType})*\n\n*Symbol:* \`${position.instrument.symbol}\`\n*Exit Price:* ${exitPrice.toFixed(2)}\n*Reason:* ${reason}\n*P&L on 1 lot:* \`₹${pnl.toFixed(2)}\``;
        this.telegramService.sendMessage(partialProfitMessage);

        // --- Modify the live position ---
        position.lots = remainingLots;
        
        // Move Stop-Loss to cost
        const newStopLoss = position.entryPrice; 
        position.stopLoss = newStopLoss;
        
        // Update the takeProfit to the next target
        position.takeProfit = position.takeProfit2;
        position.takeProfit2 = null; // Clear T2 so this logic doesn't run again

        // Send an update message about the modified position
        const updateMessage = `ℹ️ *Position Update for ${position.instrument.symbol}*\n\n*Remaining Lots:* ${remainingLots}\n*New Stop-Loss:* ${newStopLoss.toFixed(2)} (Cost)\n*New Target:* ${position.takeProfit ? position.takeProfit.toFixed(2) : 'None'}`;
        this.telegramService.sendMessage(updateMessage);
        
        // Save the modified state of the position
        this.savePositionsToFile();
    }


    executeSell(position, exitPrice, reason) {
        const pnl = (exitPrice - position.entryPrice) * position.instrument.lotsize * position.lots; // PnL on remaining lots
        console.log(`[PositionManager] EXECUTING FINAL SELL for ${position.lots} lot(s) of ${position.instrument.symbol} at ${exitPrice}. Reason: ${reason}`);
        
        const tradeDataObject = {
            strategy: `${position.strategyName}-Managed`,
            symbol: position.instrument.symbol,
            entryPrice: position.entryPrice,
            exitPrice: exitPrice,
            pnl: pnl,
            exitReason: reason,
            timestamp: moment().tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm:ss'),
        };

        this.emit('tradeCompleted', tradeDataObject);

        const message = `✅ *Trade Closed (${position.tradeType})*\n\n*Symbol:* \`${position.instrument.symbol}\`\n*Exit Price:* ${exitPrice.toFixed(2)}\n*Reason:* ${reason}\n*P&L on final ${position.lots} lot(s):* \`₹${pnl.toFixed(2)}\``;
        this.telegramService.sendMessage(message);
        
        console.log(`[PositionManager] Triggering subscription refresh to remove ${position.instrument.symbol}`);
        this.masterController.subscribeToTokens();
    }
    
    closeAllPositions(reason = 'End-of-day square-off') {
        if (this.openPositions.length === 0) {
            console.log('[PositionManager] Close all positions triggered, but no positions are open.');
            return;
        }

        console.log(`[PositionManager] Closing all ${this.openPositions.length} open position(s). Reason: ${reason}`);
        this.telegramService.sendMessage(`⏰ *Squaring Off All Positions*\nReason: ${reason}`);

        // Iterate backwards because we are removing items from the array
        for (let i = this.openPositions.length - 1; i >= 0; i--) {
            const position = this.openPositions[i];
            // Use the last known LTP to close the position.
            const exitPrice = position.ltp > 0 ? position.ltp : position.entryPrice; // Fallback to entry price if ltp is missing
            this.executeSell(position, exitPrice, reason);
            this.openPositions.splice(i, 1);
        }
        
        this.savePositionsToFile();
    }

    /**
     * NEW: Gathers details for all currently open positions, including live P&L.
     * @returns {Array<Object>} An array of objects representing live positions.
     */
    getLivePositions() {
        if (this.openPositions.length === 0) {
            return [];
        }

        return this.openPositions.map(pos => {
            const pnl = (pos.ltp - pos.entryPrice) * pos.instrument.lotsize * pos.lots;
            return {
                symbol: pos.instrument.symbol,
                strategy: pos.strategyName,
                tradeType: pos.tradeType,
                lots: pos.lots,
                entryPrice: parseFloat(pos.entryPrice.toFixed(2)),
                ltp: pos.ltp,
                pnl: parseFloat(pnl.toFixed(2)),
                stopLoss: parseFloat(pos.stopLoss.toFixed(2)),
                target: pos.takeProfit ? parseFloat(pos.takeProfit.toFixed(2)) : null
            };
        });
    }
}

module.exports = PositionManager;
