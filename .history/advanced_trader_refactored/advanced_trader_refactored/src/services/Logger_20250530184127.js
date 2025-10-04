// File: /advanced_trader_refactored/src/services/Logger.js
const fs = require('fs');
const path = require('path');
const moment = require("moment-timezone");

class Logger {
    constructor(config) {
        this.config = config;
        this.logDir = path.join(__dirname, '../../logs');
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir);
        }

        this.tradeLogStream = fs.createWriteStream(path.join(this.logDir, config.logFiles.tradeLogCsv), { flags: 'a' });
        this.errorLogStream = fs.createWriteStream(path.join(this.logDir, config.logFiles.errorLog), { flags: 'a' });

        this.ensureTradeLogHeader();
    }

    ensureTradeLogHeader() {
        const filePath = path.join(this.logDir, this.config.logFiles.tradeLogCsv);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            this.tradeLogStream.write("Timestamp,Token,Symbol,Action,Price,Quantity,SL,TP,PNL,Reason,DailyPNL\n");
        }
    }
    
    log(level, ...args) {
        const timestamp = moment.tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm:ss');
        const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
        const logMessage = `${timestamp} [${level.toUpperCase()}] ${message}`;
        
        console.log(logMessage);
        if (level === 'error' || level === 'warn') {
            this.errorLogStream.write(logMessage + '\n');
        }
    }

    info(...args) { this.log('info', ...args); }
    warn(...args) { this.log('warn', ...args); }
    error(...args) { this.log('error', ...args); }
    debug(...args) { if (this.config.debugMode) this.log('debug', ...args); }
    
    logTrade(tradeData) {
        const timestamp = moment.tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm:ss');
        const pnl = tradeData.pnl !== undefined ? tradeData.pnl.toFixed(2) : 'N/A';
        const sl = tradeData.sl !== undefined ? tradeData.sl.toFixed(2) : 'N/A';
        const tp = tradeData.tp !== undefined ? tradeData.tp.toFixed(2) : 'N/A';
        
        const line = [
            timestamp, tradeData.token, tradeData.symbol, tradeData.action,
            tradeData.price.toFixed(2), tradeData.quantity, sl, tp, pnl,
            tradeData.reason, tradeData.dailyPnl.toFixed(2)
        ].join(',');

        this.tradeLogStream.write(line + '\n');
    }
    
    close() {
        this.tradeLogStream.end();
        this.errorLogStream.end();
    }
}

module.exports = Logger;