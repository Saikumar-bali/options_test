// File: /universal_websocket/index.js (Upgraded as provided)

const { SmartAPI } = require("smartapi-javascript");
const WebSocket = require('ws');
const { Buffer } = require("buffer");
const speakeasy = require("speakeasy");
const path = require('path');
const moment = require("moment-timezone");

// This line is correct in main.js, but keeping it here as a fallback doesn't hurt.
if(!process.env.SMART_API_KEY) {
    require("dotenv").config({ path: path.join(__dirname, '../.env') });
}


const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class MasterController {
    constructor() {
        console.log("🚀 Initializing MasterController (v2 - Direct WS)...");
        this.apiKey = process.env.SMART_API_KEY;
        this.clientCode = process.env.SMART_CLIENT_CODE;
        this.password = process.env.SMART_PASSWORD;
        this.totpSecret = process.env.TOTP_SECRET;

        this.smartApiInstance = null;
        this.jwtToken = null;
        this.feedToken = null;

        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 60000; // Increased max delay
        this.heartbeatInterval = null;
        this.reconnectTimer = null;
        this.lastConnectionAttempt = 0;

        this.strategies = [];
        this.apiCallQueue = [];
        this.isApiCallInProgress = false;
        this.apiCallDelay = 1000; // Adjusted delay

        // console.log(`DEBUG: Initial SMART_CLIENT_CODE: ${this.clientCode}`);
        // console.log(`DEBUG: Initial SMART_API_KEY: ${this.apiKey}`);
    }

    registerStrategy(strategyInstance) {
        this.strategies.push(strategyInstance);
        console.log(`✅ Registered strategy: ${strategyInstance.constructor.name}`);
        // If WS is already connected, try subscribing new tokens
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.subscribeToTokens();
        }
    }

    generateTotp() {
        if (!this.totpSecret) throw new Error("TOTP_SECRET missing.");
        const token = speakeasy.totp({
            secret: this.totpSecret,
            encoding: "base32",
            step: 30
        });
        console.log(`🔐 TOTP generated: ${token}`);
        return token;
    }

    async generateSession() {
        try {
            this.smartApiInstance = new SmartAPI({ api_key: this.apiKey });
            const totp_token = this.generateTotp();
            // console.log(`DEBUG: Attempting session generation with CLIENT_CODE: ${this.clientCode}`);

            const sessionResponse = await this.enqueueApiCall(
                'generateSession',
                [this.clientCode, this.password, totp_token]
            );

            if (sessionResponse && sessionResponse.status === true && sessionResponse.data?.jwtToken && sessionResponse.data?.feedToken) {
                this.jwtToken = sessionResponse.data.jwtToken;
                this.feedToken = sessionResponse.data.feedToken;
                this.smartApiInstance.setAccessToken(sessionResponse.data.jwtToken); // Set access token
                console.log("✅ Session generated successfully & AccessToken set.");
            } else {
                const msg = (sessionResponse?.message || 'Unknown Reason') + ` (Code: ${sessionResponse?.errorCode || 'N/A'})`;
                console.error("🔴 Failed to generate session:", JSON.stringify(sessionResponse));
                throw new Error(`Session generation failed: ${msg}`);
            }
        } catch (error) {
            console.error("❌ Error during session generation:", error.message);
            throw error;
        }
    }

    async connectWebSocket() {
        if (this.lastConnectionAttempt && Date.now() - this.lastConnectionAttempt < 10000) {
            console.log("⏳ Respecting rate limit - waiting before reconnect");
            await delay(10000);
        }

        console.log("🔄 Connecting to AngelOne WebSocket (Direct)...");
        this.lastConnectionAttempt = Date.now();

        if (!this.jwtToken || !this.feedToken) {
            console.log("⚠️ Tokens missing, fetching now...");
            await this.generateSession(); // Ensure tokens are fresh
            if (!this.jwtToken || !this.feedToken) {
                console.error("🔴 Cannot connect WebSocket: Token generation failed.");
                this.scheduleReconnect(); // Try again later
                return;
            }
        }

        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
        }

        this.ws = new WebSocket("wss://smartapisocket.angelone.in/smart-stream", {
            headers: {
                Authorization: this.jwtToken,
                "x-api-key": this.apiKey,
                "x-client-code": this.clientCode,
                "x-feed-token": this.feedToken,
                "User-Agent": "NodeJSBot/1.0",
                "x-request-id": `conn_${Date.now()}`
            }
        });

        this.ws.on("open", () => this.handleOpen());
        this.ws.on("message", (data) => this.handleMessage(data));
        this.ws.on("error", (error) => this.handleError(error));
        this.ws.on("close", (code, reason) => this.handleClose(code, reason));
    }

    handleOpen() {
        console.log("✅ WebSocket Connected!");
        this.reconnectAttempts = 0; // Reset attempts on successful connection
        clearTimeout(this.reconnectTimer); // Clear any pending reconnect
        this.startHeartbeat();
        this.subscribeToTokens(); // Subscribe for all registered strategies
        // Notify strategies about connection (optional)
        this.strategies.forEach(s => {
            if (typeof s.onWebSocketConnect === 'function') {
                s.onWebSocketConnect();
            }
        });
    }

    handleMessage(data) {
        if (data.toString() === "pong") {
            // console.log("💓 Received heartbeat response"); // Can be noisy
            return;
        }

        if (typeof data === "string") {
            console.log("📨 Received text message:", data);
            // Handle text/JSON acknowledgements if needed
        } else {
            this.handleBinaryData(Buffer.from(data));
        }
    }

    handleBinaryData(buffer) {
        try {
            const subscriptionMode = buffer.readInt8(0);
            const exchangeType = buffer.readInt8(1);
            const token = buffer.toString("utf8", 2, 27).replace(/\0/g, "");

            if (subscriptionMode === 1) { // LTP Mode
                const ltpData = {
                    subscriptionMode,
                    exchangeType,
                    token,
                    last_price: buffer.readInt32LE(43) / 100, // Corrected field name
                    // Add other fields if needed (sequence, timestamp)
                };
                this.distributeTick(ltpData); // Distribute parsed data
            }
            // Add parsing for other modes if needed
        } catch (error) {
            console.error("❌ Error parsing binary data:", error);
        }
    }

    distributeTick(tickData) {
        // console.log("Distributing tick:", tickData); // Optional: log for debug
        this.strategies.forEach(strategy => {
            if(typeof strategy.processData === 'function') {
                strategy.processData(tickData);
            }
        });
    }

    handleError(error) {
        console.error("🔴 WebSocket Error:", error.message);
        // Don't schedule reconnect here, 'close' event will handle it
    }

    handleClose(code, reason) {
        console.warn(`⚠️ WebSocket Closed (code: ${code}, reason: ${reason || 'none'})`);
        this.stopHeartbeat();
        this.ws = null; // Ensure ws is null
        this.scheduleReconnect();
    }

    startHeartbeat() {
        this.stopHeartbeat(); // Ensure no multiple intervals
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send("ping");
            } else {
                console.warn("💓 Heartbeat: WebSocket not open, skipping ping.");
            }
        }, 30000);
    }

    stopHeartbeat() {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    }

    scheduleReconnect() {
        this.stopHeartbeat();
        if (this.reconnectAttempts >= 10) {
            console.error("🔴 Max reconnect attempts reached. Giving up.");
            return;
        }

        const baseDelay = Math.min(5000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
        const jitter = Math.random() * 5000;
        const delayMs = baseDelay + jitter;

        this.reconnectAttempts++;
        console.log(`⏳ Reconnecting WebSocket in ${(delayMs / 1000).toFixed(1)} seconds (attempt ${this.reconnectAttempts})...`);

        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), delayMs);
    }

    subscribeToTokens() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error("⚠️ Cannot subscribe - WebSocket not open");
            return;
        }

        let allTokens = new Map(); // Use a map to prevent duplicates
        this.strategies.forEach(strategy => {
            // **FIX:** The strategy object does not have a 'stocks' property. It has a 'getTokensToTrack' method.
            if (typeof strategy.getTokensToTrack === 'function') {
                strategy.getTokensToTrack().forEach(stock => {
                    if (stock && stock.token) {
                        allTokens.set(stock.token, stock);
                    }
                });
            }
        });

        if (allTokens.size === 0) {
            console.log("ℹ️ No tokens across strategies to subscribe.");
            return;
        }

        const stocksToSubscribe = Array.from(allTokens.values());

        const exchangeGroups = stocksToSubscribe.reduce((acc, stock) => {
            const exchType = { 'NFO': 2, 'NSE': 1, 'BSE': 3 }[stock.exch_seg] || 2;
            if (!acc[exchType]) acc[exchType] = [];
            acc[exchType].push(stock.token.toString());
            return acc;
        }, {});

        const subscriptionRequest = {
            correlationID: `master_sub_${Date.now()}`,
            action: 1, // Subscribe
            params: {
                mode: 1, // LTP Mode
                tokenList: Object.entries(exchangeGroups).map(([exchangeType, tokens]) => ({
                    exchangeType: parseInt(exchangeType),
                    tokens: [...new Set(tokens)]
                }))
            }
        };

        // console.log(`📩 Sending subscription request for ${stocksToSubscribe.length} tokens:`, JSON.stringify(subscriptionRequest, null, 2));
        console.log(`📩 Sending subscription request for ${stocksToSubscribe.length} tokens:`);
        this.ws.send(JSON.stringify(subscriptionRequest));
    }
    
    unsubscribeFromTokens(tokensToUnsubscribe) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error("⚠️ Cannot unsubscribe - WebSocket not open");
            return;
        }
         if (!tokensToUnsubscribe || tokensToUnsubscribe.length === 0) {
            console.log("ℹ️ No tokens to unsubscribe.");
            return;
        }

        const exchangeGroups = tokensToUnsubscribe.reduce((acc, stock) => {
            const exchType = { 'NFO': 2, 'NSE': 1, 'BSE': 3 }[stock.exch_seg] || 2;
            if (!acc[exchType]) acc[exchType] = [];
            acc[exchType].push(stock.token.toString());
            return acc;
        }, {});

        const unsubscriptionRequest = {
            correlationID: `master_unsub_${Date.now()}`,
            action: 0, // Unsubscribe
            params: {
                mode: 1, // LTP Mode
                tokenList: Object.entries(exchangeGroups).map(([exchangeType, tokens]) => ({
                    exchangeType: parseInt(exchangeType),
                    tokens: [...new Set(tokens)]
                }))
            }
        };

        console.log(`📩 Sending unsubscription request for ${tokensToUnsubscribe.length} tokens:`, JSON.stringify(unsubscriptionRequest, null, 2));
        this.ws.send(JSON.stringify(unsubscriptionRequest));
    }


    async enqueueApiCall(methodName, args) {
        return new Promise((resolve, reject) => {
            this.apiCallQueue.push({ methodName, args, resolve, reject });
            this.processApiCallQueue();
        });
    }

    async processApiCallQueue() {
        if (this.isApiCallInProgress || this.apiCallQueue.length === 0) return;
        this.isApiCallInProgress = true;
        const { methodName, args, resolve, reject } = this.apiCallQueue.shift();
        try {
            if (!this.smartApiInstance) throw new Error("SmartAPI instance not ready.");
            const apiCall = this.smartApiInstance[methodName];
            if (typeof apiCall === 'function') {
                const result = await apiCall(...args);
                resolve(result);
            } else {
                reject(new Error(`API method ${methodName} not found.`));
            }
        } catch (error) {
            console.error(`❌ API Queue Error (${methodName}):`, error.message);
            reject(error);
        } finally {
            this.isApiCallInProgress = false;
            setTimeout(() => this.processApiCallQueue(), this.apiCallDelay);
        }
    }
    async getHistoricalData(params) {
        // console.log("Fetching historical data with params:", params);
        return this.enqueueApiCall('getCandleData', [params]);
    }
    
    async placeOrder(params) {
        console.log("Placing order with params:", params);
        return this.enqueueApiCall('placeOrder', [params]);
    }

    async initialize() {
        try {
            await this.generateSession();
            await this.connectWebSocket();
            this.processApiCallQueue(); // Start processing queue
            console.log("✅ MasterController Initialization complete.");
        } catch (error) {
            console.error("❌ MasterController initialization failed:", error.message);
            throw error; // Re-throw for main script to catch
        }
    }

    disconnectWebSocket() {
        this.stopHeartbeat();
        clearTimeout(this.reconnectTimer);
        this.reconnectAttempts = 100; // Prevent further reconnects
        if (this.ws) {
            this.ws.removeAllListeners();
            if (this.ws.readyState !== WebSocket.CLOSED) {
                this.ws.close();
            }
            console.log("🔌 WebSocket disconnected manually via MasterController.");
        }
    }
}

module.exports = MasterController;
