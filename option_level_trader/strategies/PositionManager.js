// File: /option_level_trader/strategies/PositionManager.js
const EventEmitter = require('events');
const moment = require('moment-timezone');
const { STRATEGY_CONFIG } = require('../config/trade_config.js');

class PositionManager extends EventEmitter {
    constructor(masterController, telegramService) {
        super();
        this.masterController = masterController;
        this.telegramService = telegramService;
        this.openPositions = [];
        this.pendingOrders = []; 
        this.candleIntervalMinutes = 15; // Set timeframe for candle logic (15 min)

        this.tradeConfig = {
            stopLossPercent: 0.20,
            takeProfitPercent: 1.00,
        };
    }

    getLotSize(instrument) {
        let lotsize = Number(instrument.lotsize) || Number(instrument.lot_size);
        if (!lotsize || isNaN(lotsize)) {
            const underlyingName = instrument.name; 
            const config = STRATEGY_CONFIG.find(c => c.underlying === underlyingName);
            if (config && config.lot_size) {
                lotsize = Number(config.lot_size);
            }
        }
        return lotsize || 1;
    }

    isMCX(instrument) {
        const seg = instrument.exch_seg || instrument.exchange;
        return seg === 'MCX' || seg === 'MCXFO';
    }

    // Helper to get candle start time based on interval
    getCurrentCandleTime(time = moment()) {
        const t = moment(time).tz("Asia/Kolkata");
        const remainder = t.minutes() % this.candleIntervalMinutes;
        return t.clone().subtract(remainder, 'minutes').startOf('minute');
    }

    // --- PENDING ORDER LOGIC ---
    addPendingOrder(orderData) {
        const now = moment().tz("Asia/Kolkata");
        const isCommodity = this.isMCX(orderData.instrument);

        // Equity Time Guard: 3:15 PM
        if (!isCommodity && (now.hours() > 15 || (now.hours() === 15 && now.minutes() >= 15))) {
            console.log(`[PositionManager] ⛔ Rejected Equity Order (After 3:15 PM): ${orderData.instrument.symbol}`);
            return;
        }

        // MCX Time Guard: 11:15 PM
        if (isCommodity && (now.hours() > 23 || (now.hours() === 23 && now.minutes() >= 15))) {
            console.log(`[PositionManager] ⛔ Rejected MCX Order (After 11:15 PM): ${orderData.instrument.symbol}`);
            return;
        }

        if (this.pendingOrders.some(p => Number(p.instrument.token) === Number(orderData.instrument.token))) {
            return;
        }

        const order = {
            ...orderData,
            status: 'PENDING',
            createdTime: moment().tz("Asia/Kolkata"),
            ltp: orderData.entryPrice
        };

        this.pendingOrders.push(order);
        this.masterController.subscribeToTokens();
        
        console.log(`[PositionManager] Pending Order Added: ${order.instrument.symbol} @ ${order.entryPrice}`);
    }

    // Updated to accept filter
    cancelPendingOrders(targetExchanges = []) {
        if (this.pendingOrders.length === 0) return;
        
        const initialCount = this.pendingOrders.length;
        
        // Filter out orders that match the target exchanges
        // If targetExchanges is empty, cancel ALL (legacy behavior or full shutdown)
        if (targetExchanges.length > 0) {
            this.pendingOrders = this.pendingOrders.filter(p => {
                const seg = p.instrument.exch_seg || p.instrument.exchange;
                // Keep the order if it is NOT in the target list
                return !targetExchanges.includes(seg);
            });
        } else {
            this.pendingOrders = [];
        }
        
        const cancelledCount = initialCount - this.pendingOrders.length;
        if (cancelledCount > 0) {
            console.log(`[PositionManager] 🚫 Cancelled ${cancelledCount} pending orders.`);
        }
    }

    checkPendingOrders(tick) {
        const numericTickToken = Number(tick.token);
        
        for (let i = this.pendingOrders.length - 1; i >= 0; i--) {
            const order = this.pendingOrders[i];
            
            if (Number(order.instrument.token) === numericTickToken) {
                const ltp = tick.last_price;
                order.ltp = ltp;

                if (ltp <= order.entryPrice) {
                    if (ltp > order.stopLoss) {
                        console.log(`[PositionManager] ⚡ Limit Order Filled for ${order.instrument.symbol} at ${ltp}`);
                        this.addOpenPosition(order); 
                        this.pendingOrders.splice(i, 1);
                    } else {
                        console.log(`[PositionManager] Order Skipped (Gap Down below SL) for ${order.instrument.symbol} LTP: ${ltp} SL: ${order.stopLoss}`);
                    }
                }
            }
        }
    }

    // --- OPEN POSITION LOGIC ---
    addOpenPosition(positionData) {
        const now = moment().tz("Asia/Kolkata");
        const isCommodity = this.isMCX(positionData.instrument);

        // Equity Time Guard: 3:15 PM
        if (!isCommodity && (now.hours() > 15 || (now.hours() === 15 && now.minutes() >= 15))) {
            console.log(`[PositionManager] ⛔ Rejected New Equity Position (After 3:15 PM): ${positionData.instrument.symbol}`);
            return;
        }
        // MCX Time Guard: 11:15 PM
        if (isCommodity && (now.hours() > 23 || (now.hours() === 23 && now.minutes() >= 15))) {
            console.log(`[PositionManager] ⛔ Rejected New MCX Position (After 11:15 PM): ${positionData.instrument.symbol}`);
            return;
        }

        if (this.openPositions.some(p => Number(p.instrument.token) === Number(positionData.instrument.token))) return;

        const { entryPrice, tradeType, instrument, targets, quantity } = positionData;

        let finalStopLoss = positionData.stopLoss || (entryPrice * (1 - this.tradeConfig.stopLossPercent));
        let finalTargets = targets && targets.length > 0 ? targets : [positionData.target || (entryPrice * (1 + this.tradeConfig.takeProfitPercent))];
        let initialQuantity = quantity || 1;

        const position = {
            ...positionData,
            status: 'OPEN',
            stopLoss: finalStopLoss,
            targets: finalTargets,
            initialQuantity: initialQuantity,
            currentQuantity: initialQuantity,
            entryTime: moment().tz("Asia/Kolkata"),
            ltp: entryPrice,
            targetsHitCount: 0,
            // New fields for Candle SL Logic
            consecutiveClosesBelowEntry: 0,
            lastCandleStartTime: this.getCurrentCandleTime(moment()),
        };

        this.openPositions.push(position);

        let targetMsg = '';
        position.targets.forEach((t, i) => targetMsg += `\n*Target ${i+1}:* ${t.toFixed(2)}`);

        const lotsize = this.getLotSize(instrument);

        const message = `🚀 *TRADE EXECUTED (${tradeType})*\n\n` +
            `*Symbol:* ${instrument.symbol}\n` +
            `*Qty:* ${initialQuantity} Lots (${initialQuantity * lotsize} Qty)\n` +
            `*Fill Price:* ${entryPrice.toFixed(2)}\n` +
            `*Stop-Loss:* ${finalStopLoss.toFixed(2)}` +
            targetMsg;

        console.log(`[PositionManager] ${message.replace(/\*/g, '')}`);
        this.telegramService.sendMessage(message);

        this.masterController.subscribeToTokens();
    }

    processData(tick) {
        this.checkPendingOrders(tick); // Check pending fills
        this.checkOpenPositions(tick); // Check exits
    }

    getTokensToTrack() {
        const pendingTokens = this.pendingOrders.map(p => p.instrument);
        const openTokens = this.openPositions.map(p => p.instrument);
        return [...pendingTokens, ...openTokens];
    }

    checkOpenPositions(tick) {
        const numericTickToken = Number(tick.token);
        for (let i = this.openPositions.length - 1; i >= 0; i--) {
            const position = this.openPositions[i];
            
            if (Number(position.instrument.token) === numericTickToken) {
                // --- NEW STOPLOSS CONDITION: 2 Consecutive Candles Close Below Entry ---
                const tickTime = moment(tick.last_trade_time).tz("Asia/Kolkata");
                const currentCandleStart = this.getCurrentCandleTime(tickTime);

                // Initialize if missing (e.g., from older state or first tick)
                if (!position.lastCandleStartTime) {
                    position.lastCandleStartTime = currentCandleStart;
                }

                // If timestamp indicates a new candle has started
                if (!currentCandleStart.isSame(position.lastCandleStartTime)) {
                    // The previous candle has just closed. 
                    // We use the last known LTP (position.ltp) as the proxy for the Close Price.
                    const closingPrice = position.ltp; 

                    // Check if Close is below Entry
                    if (closingPrice < position.entryPrice) {
                        position.consecutiveClosesBelowEntry++;
                        console.log(`[${position.instrument.symbol}] ⚠️ Candle Closed ${closingPrice.toFixed(2)} < Entry ${position.entryPrice.toFixed(2)}. Count: ${position.consecutiveClosesBelowEntry}/2`);

                        // Trigger Exit if 2 consecutive candles
                        if (position.consecutiveClosesBelowEntry >= 2) {
                            this.executeSell(position, position.currentQuantity, tick.last_price, 'SL Hit: 2 Consecutive Candles Closed Below Entry');
                            this.openPositions.splice(i, 1);
                            continue; // Stop processing this position
                        }
                    } else {
                        // Reset if a candle closes above entry
                        if (position.consecutiveClosesBelowEntry > 0) {
                            console.log(`[${position.instrument.symbol}] ℹ️ Candle Closed ABOVE Entry. Count reset.`);
                        }
                        position.consecutiveClosesBelowEntry = 0;
                    }

                    // Update the tracker for the new candle
                    position.lastCandleStartTime = currentCandleStart;
                }
                // --- END NEW CONDITION ---

                const ltp = tick.last_price;
                position.ltp = ltp;

                // 1. Check Stop Loss (Regular)
                if (ltp <= position.stopLoss) {
                    this.executeSell(position, position.currentQuantity, ltp, 'Stop-Loss Hit');
                    this.openPositions.splice(i, 1);
                    continue;
                } 

                // 2. Check Targets
                const currentTargetIndex = position.targetsHitCount;
                if (currentTargetIndex < position.targets.length) {
                    const nextTargetPrice = position.targets[currentTargetIndex];
                    
                    if (ltp >= nextTargetPrice) {
                        position.targetsHitCount++;
                        
                        // Partial Exit Logic
                        if (currentTargetIndex === 0 && position.targets.length > 1) {
                            const qtyToClose = Math.floor(position.initialQuantity / 2);
                            
                            if (qtyToClose > 0 && qtyToClose < position.currentQuantity) {
                                this.executeSell(position, qtyToClose, ltp, `Target 1 Hit (${nextTargetPrice.toFixed(2)})`);
                                position.currentQuantity -= qtyToClose;

                                // Move SL to Cost
                                position.stopLoss = position.entryPrice; 
                                const msg = `🎯 *Target 1 Hit!* Booked ${qtyToClose} lots.\n🛡️ *Stop-Loss moved to Cost:* ${position.stopLoss.toFixed(2)}`;
                                console.log(`[${position.instrument.symbol}] ${msg.replace(/\*/g, '')}`);
                                this.telegramService.sendMessage(msg);
                            }
                        } else if (currentTargetIndex === position.targets.length - 1) {
                            this.executeSell(position, position.currentQuantity, ltp, `Final Target Hit (${nextTargetPrice.toFixed(2)})`);
                            this.openPositions.splice(i, 1);
                        }
                    }
                }
            }
        }
    }

    executeSell(position, qty, exitPrice, reason) {
        const lotsize = this.getLotSize(position.instrument);
        const pnl = (exitPrice - position.entryPrice) * lotsize * qty;
        
        const tradeDataObject = {
            strategy: `${position.strategyName}-Managed`,
            symbol: position.instrument.symbol,
            entryPrice: position.entryPrice,
            exitPrice: exitPrice,
            quantity: qty,
            pnl: pnl,
            exitReason: reason,
            timestamp: moment().tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm:ss'),
        };

        this.emit('tradeCompleted', tradeDataObject);

        const message = 
            `✅ *Trade Closed / Partial (${position.tradeType})*\n\n` +
            `*Symbol:* ${position.instrument.symbol}\n` +
            `*Qty Closed:* ${qty} Lots\n` +
            `*Exit Price:* ${exitPrice.toFixed(2)}\n` +
            `*Reason:* ${reason}\n` +
            `*P&L:* ₹${pnl.toFixed(2)}`;

        console.log(`[PositionManager] ${message.replace(/\*/g, '')}`);
        this.telegramService.sendMessage(message);
        this.masterController.subscribeToTokens();
    }

    // Updated to accept filter
    closePositions(reason = 'Square-off', targetExchanges = []) {
        if (this.openPositions.length === 0) return;
        
        console.log(`[PositionManager] Closing positions. Reason: ${reason}. Exchanges: ${targetExchanges.join(',') || 'ALL'}`);
        
        for (let i = this.openPositions.length - 1; i >= 0; i--) {
            const position = this.openPositions[i];
            const seg = position.instrument.exch_seg || position.instrument.exchange;

            // If targetExchanges is empty, close everything. 
            // If targetExchanges HAS values, only close if seg matches.
            if (targetExchanges.length === 0 || targetExchanges.includes(seg)) {
                this.executeSell(position, position.currentQuantity, position.ltp, reason);
                this.openPositions.splice(i, 1);
            }
        }
    }

    getLivePnLSummary() {
        if (this.openPositions.length === 0) return "No open positions.";
        let totalPnL = 0;
        let msg = "*Live P&L Summary:*\n";
        
        this.openPositions.forEach(p => {
            const ltp = Number(p.ltp) || 0;
            const entry = Number(p.entryPrice) || 0;
            const qty = Number(p.currentQuantity) || 0;
            const lotsize = this.getLotSize(p.instrument);

            const pnl = (ltp - entry) * lotsize * qty;

            if (isNaN(pnl)) {
                console.error(`[PnL Error] NaN detected! Symbol:${p.instrument.symbol}, LTP:${ltp}, Entry:${entry}, Lot:${lotsize}, Qty:${qty}`);
            }

            totalPnL += pnl;
            msg += `\n*${p.instrument.symbol}*\nQty: ${qty} Lots (${qty * lotsize})\nLTP: ${ltp.toFixed(2)}\nP&L: ₹${pnl.toFixed(2)}\n`;
        });
        msg += `\n*Total Unrealized P&L:* ₹${totalPnL.toFixed(2)}`;
        return msg;
    }
}

module.exports = PositionManager;