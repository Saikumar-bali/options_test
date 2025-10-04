// market-data.js

const WebSocket = require('ws'); // Use the standard 'ws' library directly

/**
 * Handles the WebSocket connection for live market data using a direct 'ws' implementation.
 */
class MarketDataService {
    constructor(session, tradingEngine) {
        if (!session || !session.jwtToken || !session.feedToken || !session.clientCode) {
            throw new Error("MarketDataService requires a valid session object with tokens and client code.");
        }
        // We also need the API key for the headers
        if (!process.env.SMART_API_KEY) {
            throw new Error("SMART_API_KEY is missing from .env file.");
        }

        this.session = session;
        this.apiKey = process.env.SMART_API_KEY;
        this.ws = null;
        this.heartbeatInterval = null;
        this.tradingEngine = tradingEngine;
    }

    /**
     * Connects to the Angel One Smart Stream WebSocket.
     */
    connect() {
        console.log("📡 Initializing direct WebSocket connection to Angel One Smart Stream...");

        const url = "wss://smartapisocket.angelone.in/smart-stream";
        const headers = {
            'Authorization': `Bearer ${this.session.jwtToken}`,
            'x-api-key': this.apiKey,
            'x-client-code': this.session.clientCode,
            'x-feed-token': this.session.feedToken
        };

        // Instantiate the WebSocket with the correct URL and authorization headers
        this.ws = new WebSocket(url, { headers });

        this.ws.on('open', () => {
            console.log("✅ WebSocket connected successfully!");
            this.startHeartbeat();

            // Example subscription: NIFTY 50 index
            const subscriptionRequest = {
                correlationID: "nifty50_sub",
                action: 1, // 1 for Subscribe
                params: {
                    mode: 1, // 1 for LTP
                    tokenList: [{
                        exchangeType: 1, // 1 for NSE
                        tokens: ["26000"] // Token for NIFTY 50
                    }]
                }
            };
            this.ws.send(JSON.stringify(subscriptionRequest));
            console.log(`📩 Sent subscription request for NIFTY 50.`);
        });

        this.ws.on('message', (data) => {
            // The Smart Stream API sends data as a Buffer
            // YOU MUST IMPLEMENT THE BINARY PARSER as per the Angel One docs.
            // For this example, we will simulate a parsed object.
            const message = data.toString();
            if (message === 'pong') {
                console.log('💓 Heartbeat pong received.');
                return;
            }
            // console.log("📈 Raw Data received:", message);

            // --- SIMULATED PARSING ---
            // Replace this with your actual binary data parsing logic.
            const parsedTick = this.parseTickData(data);
            if (parsedTick) {
                // Pass the parsed tick to the trading engine
                this.tradingEngine.processTick(parsedTick);
            }
        });

        this.ws.on('error', (error) => {
            console.error("❌ WebSocket Error:", error.message);
            this.stopHeartbeat();
        });

        this.ws.on('close', (code, reason) => {
            console.log(`🔌 WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
            this.stopHeartbeat();
            // You can add reconnection logic here if needed.
        });
    }

     parseTickData(binaryData) {
        // In a real scenario, you would interpret the bytes according to Angel One's documentation
        // to extract token, LTP, etc.
        // For now, let's just simulate a tick for NIFTY 50 (token 26000) for demonstration.
        // Let's assume the message is a simple string "26000:23500.50"
        try {
            const message = binaryData.toString();
            const parts = message.split(":");
            if (parts.length === 2 && parts[0] === '26000') {
                 return { symbol: 'NIFTY 50', ltp: parseFloat(parts[1]) };
            }
        } catch(e) {
            // Not in the format we expect, ignore for this example
        }
        return null;
    }
    
    /**
     * Sends a ping every 30 seconds to keep the connection alive.
     */
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send('ping');
                console.log('💓 Heartbeat ping sent.');
            }
        }, 30000);
    }

    /**
     * Clears the heartbeat interval.
     */
    stopHeartbeat() {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    }

    /**
     * Disconnects the WebSocket.
     */
    disconnect() {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
        }
    }
}

module.exports = MarketDataService;
