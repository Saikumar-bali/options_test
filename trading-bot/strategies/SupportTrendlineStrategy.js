// Enhanced SupportTrendlineStrategy.js
const moment = require('moment-timezone');
const EventEmitter = require('events');
const { ATR } = require('../indicators/ATR');
const { RSI } = require('../indicators/RSI');
const { findATMOptions, getHistoricalDataParams } = require('../utils/helpers');
const { getCandleTime, isNewCandle } = require('../utils/time_helpers');
// RANSAC-based trendline finder
const { findSupportTrendline } = require('../indicators/Trendline');

class SupportTrendlineStrategy extends EventEmitter {
    constructor(masterController, config, instrumentLoader, telegramService, positionManager, dataFetcher) {
        super();

        if (!config || !config.underlying || !config.token || !config.exchange) {
            console.error(`❌ [${config?.underlying || 'Unknown'}] Invalid config for SupportTrendlineStrategy.`);
            this.isActive = false;
            return;
        }

        this.masterController = masterController;
        this.config = config;
        this.instrumentLoader = instrumentLoader;
        this.telegramService = telegramService;
        this.positionManager = positionManager;
        this.dataFetcher = dataFetcher;

        // Merge defaults for trendline params
        this.params = config.support_trendline_params || {};
        this.params.tolerancePercent = this.params.tolerancePercent ?? 0.1;
        this.params.minTouches = this.params.minTouches ?? 3;
        this.params.maxIterations = this.params.maxIterations ?? 5000;

        this.candleIntervalMinutes = 15;

        this.underlying = {
            symbol: config.underlying,
            token: Number(config.token),
            exch_seg: config.exchange,
            ltp: 0,
        };

        this.strategyName = `SupportTrendline_${this.underlying.symbol}`;
        this.isUpdating = false;
        this.lastCandleTime = null;
        this.currentCandle = {};
        this.historicalData = [];
        this.currentAtrValue = 0;
        this.currentRsiValue = 0;
        this.rayConfig = null;

        this.isActive = true;
        console.log(`✅ [${this.underlying.symbol}] Support Trendline Strategy initialized (Auto-Detect Mode).`);
    }

    /** RANSAC-based detection wrapper. */
    async runDetection(candles) {
        try {
            if (!Array.isArray(candles) || candles.length < 50) {
                console.warn(`[${this.underlying.symbol}] runDetection: insufficient candles (${candles?.length}).`);
                return null;
            }

            const result = findSupportTrendline(
                candles,
                this.params.tolerancePercent,
                this.params.minTouches,
                this.params.maxIterations
            );

            if (!result) {
                console.log(`🔎 [${this.underlying.symbol}] RANSAC did not find a trendline.`);
                return null;
            }

            const p1 = result.point1 || (result.points && result.points[0]);
            const p2 = result.point2 || (result.points && result.points[result.points.length - 1]);

            if (!p1 || !p2 || typeof result.slope === 'undefined') {
                console.warn(`[${this.underlying.symbol}] RANSAC returned incomplete result:`, result);
                return null;
            }

            const ray = {
                t1: p1.timestamp ?? candles[p1.index]?.timestamp,
                p1: Number(p1.price ?? p1.y ?? candles[p1.index]?.low ?? candles[p1.index]?.close),
                bar1: Number(p1.index),
                t1_str: moment(p1.timestamp ?? candles[p1.index]?.timestamp).format('YYYY-MM-DD HH:mm'),
                p2: Number(p2.price ?? p2.y ?? candles[p2.index]?.low ?? candles[p2.index]?.close),
                bar2: Number(p2.index),
                t2_str: moment(p2.timestamp ?? candles[p2.index]?.timestamp).format('YYYY-MM-DD HH:mm'),
                slope: Number(result.slope),
                intercept: Number(
                    result.intercept ??
                    ((p1.price ?? candles[p1.index].low) - result.slope * p1.index)
                ),
                touches: result.touches ?? (result.points ? result.points.length : 2),
                touchPoints: result.points ?? [p1, p2],
                raw: result,
            };

            this.rayConfig = ray;

            console.log(`\n📏 [${this.underlying.symbol}] === TRENDLINE DETECTED (RANSAC) ===`);
            console.log(`\t#1 (price, bar):\t ${ray.p1.toFixed(2)}\t| Bar: ${ray.bar1} (${ray.t1_str})`);
            console.log(`\t#2 (price, bar):\t ${ray.p2.toFixed(2)}\t| Bar: ${ray.bar2} (${ray.t2_str})`);
            console.log(`\tSlope: ${ray.slope.toFixed(6)} pts/bar`);
            console.log(`\tDuration: ${ray.bar2 - ray.bar1} bars`);
            console.log(`\tTouch Points: ${ray.touches}`);
            console.log(`\t--------------------------------------------------`);

            await this.printTrendlineResults(ray, candles);

            const telegramMsg = this.formatTelegramMessage(ray, candles);
            await this.telegramService.sendMessage(telegramMsg);

            return ray;
        } catch (err) {
            console.error(`[${this.underlying.symbol}] runDetection error:`, err);
            return null;
        }
    }

    /** Enhanced automatic trendline detection: RANSAC first, fallback to swing-lows. */
    async calculateAutoTrendline(candles) {
        console.log(`🔍 [${this.underlying.symbol}] Scanning ${candles.length} candles for trendlines...`);

        if (!Array.isArray(candles) || candles.length < 50) {
            const msg = `⚠️ [${this.underlying.symbol}] Not enough data (${candles?.length || 0} candles). Need at least 50.`;
            console.log(msg);
            await this.telegramService.sendMessage(msg);
            return;
        }

        try {
            const ransacTrend = await this.runDetection(candles);
            if (ransacTrend) {
                return;
            }

            const swingLows = this.findSignificantSwingLows(candles);
            console.log(`📊 [${this.underlying.symbol}] Found ${swingLows.length} swing lows`);

            if (swingLows.length < 3) {
                const msg = `⚠️ [${this.underlying.symbol}] Found only ${swingLows.length} swing lows. Need at least 3.`;
                console.log(msg);
                return;
            }

            let bestTrendline = null;
            let bestScore = -Infinity;
            const tolerance = (this.params.tolerancePercent / 100) || 0.001;

            for (let i = 0; i < swingLows.length - 1; i++) {
                for (let j = i + 1; j < swingLows.length; j++) {
                    const p1 = swingLows[i];
                    const p2 = swingLows[j];
                    const barsApart = p2.index - p1.index;
                    if (barsApart < 40 || barsApart > 200) continue;

                    const slope = (p2.price - p1.price) / barsApart;
                    if (slope <= 0 || slope > 5) continue;

                    const intercept = p1.price - slope * p1.index;

                    const validation = this.validateTrendline(
                        candles, swingLows, p1, p2, slope, intercept, tolerance
                    );

                    // Check expected range if given in config
                    let isInExpectedRange = true;
                    if (this.params.expected_range) {
                        const r = this.params.expected_range;
                        isInExpectedRange =
                            (p1.price >= r.min1 && p1.price <= r.max1 &&
                             p2.price >= r.min2 && p2.price <= r.max2);
                    }

                    if (validation.isValid && validation.score > bestScore && isInExpectedRange) {
                        bestScore = validation.score;
                        bestTrendline = {
                            t1: p1.timestamp,
                            p1: p1.price,
                            slope,
                            intercept,
                            t1_str: moment(p1.timestamp).format('YYYY-MM-DD HH:mm'),
                            p2: p2.price,
                            bar1: p1.index,
                            bar2: p2.index,
                            p2_str: moment(p2.timestamp).format('YYYY-MM-DD HH:mm'),
                            touches: validation.touches,
                            score: validation.score.toFixed(2),
                            touchPoints: validation.touchPoints,
                        };
                    }
                }
            }

            if (bestTrendline) {
                this.rayConfig = bestTrendline;
                await this.printTrendlineResults(bestTrendline, candles);
                const telegramMsg = this.formatTelegramMessage(bestTrendline, candles);
                await this.telegramService.sendMessage(telegramMsg);
            } else {
                console.log(`❌ [${this.underlying.symbol}] No valid rising support trendline found (swing-low method).`);
                await this.findAlternativeTrendline(candles, swingLows);
            }
        } catch (error) {
            console.error(`[${this.underlying.symbol}] Error in trendline detection:`, error);
        }
    }

    findSignificantSwingLows(candles) {
        const swingLows = [];
        const windowSizes = [3, 5, 7];

        for (const windowSize of windowSizes) {
            for (let i = windowSize; i < candles.length - windowSize; i++) {
                const currentLow = candles[i].low;
                let isSwingLow = true;

                for (let j = 1; j <= windowSize; j++) {
                    if (candles[i - j].low < currentLow || candles[i + j].low < currentLow) {
                        isSwingLow = false;
                        break;
                    }
                }

                if (isSwingLow) {
                    const isDuplicate = swingLows.some(s =>
                        Math.abs(s.index - i) < 10
                    );
                    if (!isDuplicate) {
                        swingLows.push({
                            index: i,
                            price: currentLow,
                            timestamp: candles[i].timestamp,
                            windowSize: windowSize,
                        });
                    }
                }
            }
        }

        return swingLows.sort((a, b) => a.index - b.index);
    }

    validateTrendline(candles, swingLows, p1, p2, slope, intercept, tolerance) {
        let touches = 2;
        let totalDeviation = 0;
        const touchPoints = [p1, p2];

        for (const swing of swingLows) {
            if (swing.index === p1.index || swing.index === p2.index) continue;
            if (swing.index > p1.index && swing.index < p2.index) {
                const expected = slope * swing.index + intercept;
                const deviation = Math.abs(swing.price - expected) / expected;
                if (deviation <= tolerance) {
                    touches++;
                    totalDeviation += deviation;
                    touchPoints.push(swing);
                }
            }
        }

        let isValid = true;
        let significantBreaks = 0;

        for (let i = p1.index + 1; i < p2.index; i++) {
            const expected = slope * i + intercept;
            const breakAmount = (expected - candles[i].low) / expected;
            if (breakAmount > tolerance * 2) {
                significantBreaks++;
                if (significantBreaks > 2 || breakAmount > tolerance * 4) {
                    isValid = false;
                    break;
                }
            }
        }

        const duration = p2.index - p1.index;
        const avgDeviation = touches > 2 ? totalDeviation / (touches - 2) : 0;
        const score = touches * 50 + duration * 0.2 - avgDeviation * 10000 - significantBreaks * 20;

        return { isValid, touches, score, touchPoints, avgDeviation, significantBreaks };
    }

    async printTrendlineResults(trendline, candles) {
        const currentBarIndex = candles.length - 1;
        const projected = trendline.p1 + trendline.slope * (currentBarIndex - trendline.bar1);
        const lastCandle = candles[candles.length - 1];
        const distancePct = ((lastCandle.close - projected) / projected) * 100;

        console.log(`\n📏 [${this.underlying.symbol}] === TRENDLINE RESULTS ===`);
        console.log(`   #1: ${trendline.p1.toFixed(2)} @ Bar ${trendline.bar1} (${trendline.t1_str})`);
        console.log(`   #2: ${trendline.p2.toFixed(2)} @ Bar ${trendline.bar2} (${trendline.p2_str})`);
        console.log(`   Slope: ${trendline.slope.toFixed(6)} pts/bar`);
        console.log(`   Duration: ${trendline.bar2 - trendline.bar1} bars`);
        console.log(`   Touch Points: ${trendline.touches}`);
        console.log(`   Quality Score: ${trendline.score ?? 'N/A'}`);
        console.log(`   ─────────────────────────────────────────`);
        console.log(`   🎯 Projected Support (now): ${projected.toFixed(2)}`);
        console.log(`   📊 Last Close: ${lastCandle.close.toFixed(2)}`);
        console.log(`   📉 Distance to Trendline: ${distancePct.toFixed(2)}%`);
        if (trendline.touchPoints && trendline.touchPoints.length > 0) {
            console.log(`   📍 Touch Points:`);
            trendline.touchPoints.forEach((pt, idx) => {
                const price = Number(pt.price ?? pt.y ?? candles[pt.index]?.low ?? 0);
                console.log(`       ${idx + 1}. ${price.toFixed(2)} @ Bar ${pt.index}`);
            });
        }
        console.log(`   ─────────────────────────────────────────\n`);
    }

    formatTelegramMessage(trendline, candles) {
        const currentBarIndex = candles.length - 1;
        const projected = trendline.p1 + trendline.slope * (currentBarIndex - trendline.bar1);
        const lastCandle = candles[candles.length - 1];
        const distancePct = ((lastCandle.close - projected) / projected) * 100;

        return `
📈 *AUTOMATIC TRENDLINE DETECTED - ${this.underlying.symbol}*

*Point 1:* ${trendline.p1.toFixed(2)} (Bar ${trendline.bar1})  
*Time:* ${trendline.t1_str}  
*Point 2:* ${trendline.p2.toFixed(2)} (Bar ${trendline.bar2})  
*Time:* ${trendline.p2_str}

*Slope:* ${trendline.slope.toFixed(6)} pts/bar  
*Duration:* ${trendline.bar2 - trendline.bar1} bars  
*Touch Points:* ${trendline.touches}  
*Quality Score:* ${trendline.score ?? 'N/A'}

🎯 *Current Projected Support:* ${projected.toFixed(2)}  
💰 *Current LTP:* ${lastCandle.close.toFixed(2)}  
📊 *Distance to Trendline:* ${distancePct.toFixed(2)}%

_Ready for bounce entries!_
        `;
    }

    async findAlternativeTrendline(candles, swingLows) {
        console.log(`🔍 [${this.underlying.symbol}] Trying alternative trendline detection...`);
        for (let i = swingLows.length - 3; i >= 0; i--) {
            for (let j = swingLows.length - 1; j > i; j--) {
                const p1 = swingLows[i];
                const p2 = swingLows[j];
                const barsApart = p2.index - p1.index;
                if (barsApart < 30) continue;

                const slope = (p2.price - p1.price) / barsApart;
                if (slope <= 0) continue;

                const intercept = p1.price - slope * p1.index;

                this.rayConfig = {
                    t1: p1.timestamp,
                    p1: p1.price,
                    slope,
                    intercept,
                    t1_str: moment(p1.timestamp).format('YYYY-MM-DD HH:mm'),
                    p2: p2.price,
                    bar1: p1.index,
                    bar2: p2.index,
                    p2_str: moment(p2.timestamp).format('YYYY-MM-DD HH:mm'),
                    touches: 2,
                    score: 100,
                    touchPoints: [p1, p2],
                };

                console.log(`✅ [${this.underlying.symbol}] Using alternative trendline detection`);
                await this.printTrendlineResults(this.rayConfig, candles);
                return;
            }
        }
        console.log(`❌ [${this.underlying.symbol}] Alternative detection also failed.`);
    }

    /** Get projected price using bar-index projection. */
    getProjectedPrice(forBarIndex) {
        if (!this.rayConfig) return null;

        let currentBarIndex;
        if (typeof forBarIndex === 'number') {
            currentBarIndex = forBarIndex;
        } else {
            currentBarIndex = this.historicalData?.length ? this.historicalData.length - 1 : null;
        }

        if (currentBarIndex === null) return null;

        return this.rayConfig.p1 + (this.rayConfig.slope * (currentBarIndex - this.rayConfig.bar1));
    }

    async initialize() {
        console.log(`🔄 [${this.underlying.symbol}] Initializing Support Trendline Strategy...`);
        await this.updateTrendlineAndIndicators();
    }

    async updateTrendlineAndIndicators() {
        if (this.isUpdating) return;
        this.isUpdating = true;
        console.log(`📊 [${this.underlying.symbol}] Fetching historical data for trendline detection...`);

        try {
            await this.updateUnderlyingLTP();

            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(this.params.history_days || 30, 'days');
            console.log(`📅 [${this.underlying.symbol}] Date range: ${fromDate.format('YYYY-MM-DD HH:mm')} to ${toDate.format('YYYY-MM-DD HH:mm')}`);

            const params = getHistoricalDataParams(
                this.underlying,
                'FIFTEEN_MINUTE',
                fromDate.format('YYYY-MM-DD HH:mm'),
                toDate.format('YYYY-MM-DD HH:mm')
            );
            console.log(`🔧 [${this.underlying.symbol}] Generated params:`, JSON.stringify(params, null, 2));

            if (!params) {
                console.error(`❌ [${this.underlying.symbol}] getHistoricalDataParams returned null!`);
                await this.telegramService.sendMessage(`❌ [${this.underlying.symbol}] Historical data params generation failed`);
                return;
            }

            const history = await this.dataFetcher.getHistoricalData(params);
            console.log(`📦 [${this.underlying.symbol}] Raw history received: ${history ? (history.data ? history.data.length + ' candles' : 'no data property') : 'no response'}`);

            if (history && history.data) {
                console.log(`✅ [${this.underlying.symbol}] Received ${history.data.length} candles`);
                if (history.data.length === 0) {
                    console.error(`❌ [${this.underlying.symbol}] History data array is empty!`);
                    await this.telegramService.sendMessage(`❌ [${this.underlying.symbol}] No candle data received (empty array)`);
                    return;
                }

                const candles = history.data
                    .map((d, index) => {
                        if (!d || d.length < 5) {
                            console.error(`❌ [${this.underlying.symbol}] Invalid candle data at index ${index}:`, d);
                            return null;
                        }
                        return {
                            timestamp: d[0],
                            open: parseFloat(d[1]),
                            high: parseFloat(d[2]),
                            low: parseFloat(d[3]),
                            close: parseFloat(d[4]),
                            index: index,
                        };
                    })
                    .filter(c => c !== null);

                console.log(`🕯️ [${this.underlying.symbol}] Processed ${candles.length} valid candles`);

                if (candles.length === 0) {
                    console.error(`❌ [${this.underlying.symbol}] No valid candles after processing!`);
                    await this.telegramService.sendMessage(`❌ [${this.underlying.symbol}] No valid candles after data processing`);
                    return;
                }

                this.historicalData = candles;

                // Calculate Indicators
                try {
                    const atrPeriod = this.params.atr_period || 14;
                    console.log(`📊 [${this.underlying.symbol}] Calculating ATR (period ${atrPeriod})...`);
                    const atrSeries = ATR(atrPeriod, candles);
                    if (atrSeries && atrSeries.length > 0) {
                        this.currentAtrValue = atrSeries[atrSeries.length - 1];
                        console.log(`📊 [${this.underlying.symbol}] ATR: ${this.currentAtrValue.toFixed(2)}`);
                    } else {
                        console.warn(`⚠️ [${this.underlying.symbol}] ATR calculation gave empty series`);
                    }

                    const rsiPeriod = this.params.rsi_period || 14;
                    console.log(`📊 [${this.underlying.symbol}] Calculating RSI (period ${rsiPeriod})...`);
                    const closes = candles.map(c => c.close);
                    const rsiSeries = RSI(rsiPeriod, closes);
                    if (rsiSeries && rsiSeries.length > 0) {
                        this.currentRsiValue = rsiSeries[rsiSeries.length - 1];
                        console.log(`📊 [${this.underlying.symbol}] RSI: ${this.currentRsiValue.toFixed(2)}`);
                    } else {
                        console.warn(`⚠️ [${this.underlying.symbol}] RSI calculation gave empty series`);
                    }
                } catch (indicatorError) {
                    console.error(`[${this.underlying.symbol}] Indicator calculation error:`, indicatorError);
                }

                // Run auto detection
                console.log(`🔍 [${this.underlying.symbol}] Starting automatic trendline detection...`);
                await this.calculateAutoTrendline(candles);

                const lastCandle = candles[candles.length - 1];
                const candleMoment = moment(lastCandle.timestamp).tz("Asia/Kolkata");
                this.lastCandleTime = getCandleTime(candleMoment, this.candleIntervalMinutes);

                console.log(`✅ [${this.underlying.symbol}] Trendline detection completed`);
            } else {
                console.error(`❌ [${this.underlying.symbol}] No historical data received - history:`, history);
                await this.telegramService.sendMessage(`❌ [${this.underlying.symbol}] No historical data received from API`);
            }
        } catch (err) {
            console.error(`[${this.underlying.symbol}] Failed to update history/indicators:`, err);
            console.error(`[${this.underlying.symbol}] Stack:`, err?.stack);
            await this.telegramService.sendMessage(`❌ [${this.underlying.symbol}] Trendline update error: ${err?.message ?? err}`);
        } finally {
            this.isUpdating = false;
        }
    }

    processData(tick) {
        if (!this.isActive || this.isUpdating) return;

        const numericToken = Number(tick.token);
        if (numericToken === this.underlying.token) {
            this.underlying.ltp = tick.last_price;
            const now = moment(tick.last_trade_time).tz("Asia/Kolkata");
            const currentCandleTime = getCandleTime(now, this.candleIntervalMinutes);

            if (!this.lastCandleTime) {
                this.lastCandleTime = currentCandleTime;
            }

            if (isNewCandle(currentCandleTime, this.lastCandleTime)) {
                const closingCandle = {
                    L: this.currentCandle.L ?? this.underlying.ltp,
                    H: this.currentCandle.H ?? this.underlying.ltp,
                    C: this.currentCandle.C ?? this.underlying.ltp,
                    timestamp: this.lastCandleTime,
                };
                this.checkEntryConditions(closingCandle, true);

                this.lastCandleTime = currentCandleTime;
                this.currentCandle = { O: this.underlying.ltp, H: this.underlying.ltp, L: this.underlying.ltp, C: this.underlying.ltp };

                // 25% chance to update trendline on every new candle
                if (Math.random() < 0.25) {
                    this.updateTrendlineAndIndicators();
                }
            } else {
                if (!this.currentCandle.O) {
                    this.currentCandle = { O: this.underlying.ltp, H: this.underlying.ltp, L: this.underlying.ltp, C: this.underlying.ltp };
                }
                this.currentCandle.H = Math.max(this.currentCandle.H || 0, this.underlying.ltp);
                this.currentCandle.L = Math.min(this.currentCandle.L || Infinity, this.underlying.ltp);
                this.currentCandle.C = this.underlying.ltp;
            }
        }
    }

    async checkEntryConditions(candle, isCandleClosing) {
        if (!this.rayConfig) return;

        const isPosOpen = this.positionManager?.isPositionOpenForStrategy
            ? this.positionManager.isPositionOpenForStrategy(this.strategyName)
            : (this.positionManager?.hasOpenPosition
                ? this.positionManager.hasOpenPosition(this.strategyName)
                : false);

        if (isPosOpen) {
            return;
        }

        const currentBarIndex = this.historicalData?.length ? this.historicalData.length - 1 : null;
        if (currentBarIndex === null) return;

        const rayPrice = this.getProjectedPrice(currentBarIndex);
        if (!rayPrice) return;

        const bufferPercent = this.params.manual_trendline?.buffer_percent ?? 0.15;
        const bufferPrice = rayPrice * (bufferPercent / 100);
        const upperZone = rayPrice + bufferPrice;

        const hasTouchedLine = candle.L <= upperZone;
        const isBouncing = candle.C > rayPrice;
        const maxRsi = this.params.rsi_max_entry || 55;
        const isRsiValid = this.currentRsiValue < maxRsi;

        if (isCandleClosing && hasTouchedLine && isBouncing && isRsiValid) {
            console.log(`🚀 [${this.underlying.symbol}] AUTO-TRENDLINE BOUNCE!`);
            console.log(`   Line Level: ${rayPrice.toFixed(2)} | Low: ${candle.L} | Close: ${candle.C}`);

            const telegramMsg = `
🎯 *TRENDLINE BOUNCE ENTRY - ${this.underlying.symbol}*

*Trendline Level:* ${rayPrice.toFixed(2)}  
*Candle Low:* ${candle.L.toFixed(2)}  
*Candle Close:* ${candle.C.toFixed(2)}  
*RSI:* ${this.currentRsiValue.toFixed(2)}

*Executing CE Buy...*
            `;
            await this.telegramService.sendMessage(telegramMsg);

            if (this.currentAtrValue > 0) {
                await this.executeTrade('CE', this.currentAtrValue);
            }
        }
    }

    async executeTrade(optionType, atrValue) {
        try {
            const atmOptions = await findATMOptions(
                this.instrumentLoader.instruments,
                this.underlying.symbol,
                this.underlying.ltp,
                this.config.options.expiry_date,
                this.config.exchange
            );
            const selected = atmOptions ? atmOptions.find(o => o.symbol.endsWith(optionType)) : null;

            if (selected) {
                selected.token = Number(selected.token);
                selected.lotsize = Number(selected.lotsize);

                this.positionManager.addOpenPosition({
                    instrument: selected,
                    entryPrice: 0,
                    tradeType: optionType,
                    strategyName: this.strategyName,
                    atrValue: atrValue,
                    atrSettings: this.config.atrSettings,
                    isTrendlineTrade: true,
                });
                this.masterController.subscribeToTokens();
            } else {
                console.warn(`[${this.underlying.symbol}] No ATM ${optionType} option found.`);
            }
        } catch (error) {
            console.error(`[${this.underlying.symbol}] Error executing trade:`, error);
            await this.telegramService.sendMessage(`❌ [${this.underlying.symbol}] Trade execution error: ${error?.message ?? error}`);
        }
    }

    async updateUnderlyingLTP() {
        try {
            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(15, 'minutes');
            const params = getHistoricalDataParams(
                this.underlying,
                'ONE_MINUTE',
                fromDate.format('YYYY-MM-DD HH:mm'),
                toDate.format('YYYY-MM-DD HH:mm')
            );
            if (params) {
                params.symbol = this.underlying.symbol;
                params.exchange = this.underlying.exch_seg;
            }

            const history = await this.dataFetcher.getHistoricalData(params);
            if (history?.data?.length > 0) {
                this.underlying.ltp = history.data[history.data.length - 1][4];
                console.log(`💰 [${this.underlying.symbol}] LTP Updated: ${this.underlying.ltp}`);
            }
        } catch (e) {
            console.error(`[${this.underlying.symbol}] LTP update failed:`, e);
        }
    }

    getTrendlineAndLTP() {
        const currentBarIndex = this.historicalData?.length ? this.historicalData.length - 1 : null;
        const proj = currentBarIndex !== null ? this.getProjectedPrice(currentBarIndex) : null;

        return {
            ltp: this.underlying.ltp,
            trendline: this.rayConfig ? {
                isManual: false,
                projectedPrice: proj != null ? proj.toFixed(2) : 'N/A',
                point1: { price: this.rayConfig.p1, bar: this.rayConfig.bar1 },
                point2: { price: this.rayConfig.p2, bar: this.rayConfig.bar2 },
            } : null,
        };
    }
}

module.exports = SupportTrendlineStrategy;
