// MasterController.js
const { SmartAPI, WebSocketV2 } = require("smartapi-javascript") // Ensure this is the correct library name
const speakeasy = require("speakeasy");
require("dotenv").config(); // Loads .env from project root by default

class MasterController {
    constructor() {
        this.apiKey = process.env.SMART_API_KEY;
        this.clientCode = process.env.SMART_CLIENT_CODE;
        this.password = process.env.SMART_PASSWORD;
        this.totpSecret = process.env.TOTP_SECRET;

        this.ws = null;
        this.strategies = [];
        this.apiQueue = [];
        this.apiCallInterval = 1010; // More conservative rate: ~1 call per second
        this.maxRetries = 5; // Max retries per API call
        this.subscriptionTimer = null; // Timer for debouncing subscriptions

        this.jwtToken = null;
        this.feedToken = null;
        this.smartApiInstance = null;

        if (!this.apiKey || !this.clientCode || !this.password || !this.totpSecret) {
            console.error("❌ Missing critical environment variables. Exiting.");
            process.exit(1);
        }
    }

    generateTotp() {
        try {
            return speakeasy.totp({
                secret: this.totpSecret,
                encoding: "base32",
                step: 30,
            });
        } catch (error) {
            console.error("❌ Error generating TOTP:", error.message);
            throw error;
        }
    }

    async getSessionAndTokens() {
        try {
            const totp = this.generateTotp();
            const authApi = new SmartAPI({ api_key: this.apiKey });
            const sessionResponse = await authApi.generateSession(this.clientCode, this.password, totp);

            if (!sessionResponse?.status || !sessionResponse.data?.jwtToken || !sessionResponse.data?.feedToken) {
                const errorMsg = `Session generation failed: ${sessionResponse?.message || 'No message'}`;
                console.error("❌", errorMsg, "Details:", sessionResponse?.data);
                throw new Error(errorMsg);
            }

            this.jwtToken = sessionResponse.data.jwtToken;
            this.feedToken = sessionResponse.data.feedToken;
            this.smartApiInstance = authApi;

            console.log("✅ Auth Successful.");
        } catch (error) {
            console.error("❌ Session and Token Retrieval Failure:", error.message);
            throw error;
        }
    }

    async connectWebSocket() {
        if (!this.feedToken || !this.apiKey || !this.clientCode || !this.jwtToken) {
            const msg = "❌ Cannot connect WebSocket: Missing tokens. Ensure getSessionAndTokens() was successful.";
            console.error(msg);
            throw new Error(msg);
        }
        
        const wsInitParams = {
            jwttoken: this.jwtToken,
            apikey: this.apiKey,
            clientcode: this.clientCode,
            feedtype: this.feedToken,
        };

        this.ws = new WebSocketV2(wsInitParams);

        this.ws.on("connect", () => {
            console.log("🔌 WebSocket connected successfully.");
            this.subscribeAllTokens(); // Subscribe to all tokens on successful connection
        });
        this.ws.on("tick", (data) => this.distributeTick(data));
        this.ws.on("error", (error) => console.error("⚠️ WebSocket error:", JSON.stringify(error, null, 2)));
        this.ws.on("close", () => {
            console.warn("⚠️ WebSocket connection closed. Attempting to reconnect...");
            setTimeout(() => this.connectWebSocket().catch(err => console.error("❌ Reconnect attempt failed:", err.message)), 5000);
        });

        try {
            await this.ws.connect();
        } catch (error) {
            console.error("❌ WebSocket ws.connect() call failed:", error.message);
            throw error;
        }
    }

    distributeTick(ticks) {
        const dataArray = Array.isArray(ticks) ? ticks : [ticks];
        dataArray.forEach(tickData => {
            if (!tickData) return;
            const token = tickData.tk || tickData.token || tickData.instrument_token;
            if (!token) return;
            this.strategies.forEach((strategy) => {
                if (strategy.stocks.has(String(token))) {
                    strategy.processData(tickData);
                }
            });
        });
    }

    startApiQueueProcessor() {
        const processQueue = async () => {
            if (this.apiQueue.length > 0) {
                const request = this.apiQueue[0]; // Peek at the request

                if (request.delayUntil && request.delayUntil > Date.now()) {
                    // It's not time yet, wait and re-check
                    setTimeout(processQueue, 100);
                    return;
                }

                this.apiQueue.shift(); // Now remove it from the queue

                try {
                    console.log(`🚀 Executing API call: ${request.method} (Attempt ${request.retries + 1})`);
                    const response = await this.smartApiInstance[request.method](...request.params);
                    
                    if (response && response.status === false) {
                        const apiError = new Error(response.message || `API returned status: false`);
                        apiError.errorcode = response.errorcode;
                        throw apiError;
                    }
                    if (typeof response === 'string' && response.toLowerCase().includes('access denied')) {
                        throw new Error(response);
                    }
                    // CHANGE: Handle cases where the response is an object but not a successful one
                    if (typeof response === 'object' && response !== null && response.status !== true) {
                        throw new Error(`API returned an unexpected object: ${JSON.stringify(response)}`);
                    }

                    request.resolve(response);

                } catch (error) {
                    // CHANGE: Enhanced logging to correctly display error object details
                    const errorMessage = typeof error === 'object' && error !== null ? error.message : String(error);
                    console.warn(`[API] Attempt ${request.retries + 1} for ${request.method} failed: ${errorMessage}`);

                    request.retries += 1;

                    if (request.retries < this.maxRetries) {
                        let delay = 1000 * Math.pow(2, request.retries);
                        if (errorMessage && errorMessage.toLowerCase().includes('access denied')) {
                            console.error(`[API] Rate limit hit! Applying extra 10s penalty.`);
                            delay += 10000;
                        }
                        request.delayUntil = Date.now() + delay;
                        this.apiQueue.unshift(request); // Put it back at the front
                    } else {
                        console.error(`[API] FINAL: All ${this.maxRetries} attempts failed for ${request.method}.`);
                        request.reject(error);
                    }
                }
            }
            // Schedule the next check regardless of queue status
            setTimeout(processQueue, this.apiCallInterval);
        };
        processQueue();
    }

    enqueueApiCall(method, params = []) {
        return new Promise((resolve, reject) => {
            this.apiQueue.push({
                method,
                params,
                resolve,
                reject,
                retries: 0,
                delayUntil: 0
            });
            console.log(`📥 API call enqueued: ${method}. Queue size: ${this.apiQueue.length}`);
        });
    }
    
    getHistoricalData(params) {
        return this.enqueueApiCall('getCandleData', [params]);
    }

    subscribeAllTokens() {
        if (!this.ws || !this.ws.fetchData || typeof this.ws.isConnected !== 'function' || !this.ws.isConnected()) {
            console.warn(`⚠️ WebSocket not ready. Cannot subscribe tokens. Will attempt on (re)connect.`);
            return;
        }

        const allTokensByExchange = {};

        this.strategies.forEach(strategy => {
            if (typeof strategy.getTokensToTrack === 'function') {
                strategy.getTokensToTrack().forEach(instrument => {
                    if (instrument && instrument.token && instrument.exch_seg) {
                        const exchangeType = { 'NSE': 1, 'NFO': 2, 'BSE': 3 }[instrument.exch_seg] || 1;
                        if (!allTokensByExchange[exchangeType]) {
                            allTokensByExchange[exchangeType] = new Set();
                        }
                        allTokensByExchange[exchangeType].add(String(instrument.token));
                    }
                });
            }
        });

        if (Object.keys(allTokensByExchange).length === 0) {
            console.log("ℹ️ No tokens to subscribe across all strategies.");
            return;
        }

        const tokenList = Object.entries(allTokensByExchange).map(([exchangeType, tokens]) => ({
            exchangeType: parseInt(exchangeType),
            tokens: [...tokens]
        }));

        const subscriptionRequest = {
            correlationID: `master_sub_${Date.now()}`,
            action: 1, // Subscribe
            params: {
                mode: 1, // LTP mode
                tokenList: tokenList
            }
        };

        try {
            console.log(`📩 Sending one master subscription request for all tokens...`, JSON.stringify(subscriptionRequest, null, 2));
            this.ws.fetchData(subscriptionRequest);
        } catch (subError) {
            console.error(`❌ Error sending master subscription:`, subError.message);
        }
    }

    registerStrategy(strategy) {
        this.strategies.push(strategy);
        this.requestSubscriptionUpdate();
    }
    
    requestSubscriptionUpdate() {
        if (this.subscriptionTimer) {
            clearTimeout(this.subscriptionTimer);
        }
        this.subscriptionTimer = setTimeout(() => {
            if (this.ws && typeof this.ws.isConnected === 'function' && this.ws.isConnected()) {
                this.subscribeAllTokens();
            }
        }, 500);
    }

    async initialize() {
        try {
            console.log("🚀 Initializing MasterController...");
            await this.getSessionAndTokens();
            await this.connectWebSocket();
            this.startApiQueueProcessor();
            console.log("✅ MasterController Initialization complete.");
        } catch (error) {
            console.error("❌ MasterController Initialization failed:", error.message);
            process.exit(1);
        }
    }
}

module.exports = MasterController;

