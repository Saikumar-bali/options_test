// File: /trading-bot/utils/expiry_helper.js
const moment = require('moment');

/**
 * Calculates the correct weekly or monthly expiry date for each strategy based on its configuration.
 * This function reads all available option expiries from the instrument file and selects the appropriate one.
 * @param {object} instrumentLoader - An instance of the instrument loader class.
 * @param {Array<object>} strategyConfig - The array of strategy configurations.
 */
async function calculateDynamicExpiries(instrumentLoader, strategyConfig) {
    console.log('\n[Expiry] Calculating dynamic expiries using instrument file...');

    for (const config of strategyConfig) {
        if (!config.enabled || !config.options.enabled) continue;

        try {
            // Get all instruments for the underlying first
            const allInstruments = instrumentLoader.getInstrumentsByUnderlying(config.underlying);
            if (!allInstruments || allInstruments.length === 0) {
                console.warn(`  ⚠️ No instruments found for ${config.underlying}, skipping.`);
                continue;
            }

            // *** FIX APPLIED HERE ***
            // Filter the instruments to only include those from the exchange specified in the config
            const instruments = allInstruments.filter(inst => inst.exch_seg === config.exchange);

            if (!instruments || instruments.length === 0) {
                console.warn(`  ⚠️ No instruments found for ${config.underlying} on the specified exchange '${config.exchange}'.`);
                continue;
            }

            const expiryMap = new Map();
            instruments.forEach(opt => {
                if (!opt.expiry) return;
                const expiryDate = moment(opt.expiry, 'DDMMMYYYY');
                if (!expiryDate.isValid()) return;
                const key = expiryDate.format('YYYYMMDD');
                if (!expiryMap.has(key)) {
                    expiryMap.set(key, { date: expiryDate, options: [] });
                }
                expiryMap.get(key).options.push(opt);
            });

            const sortedExpiries = [...expiryMap.values()]
                .filter(exp => exp.date.isSameOrAfter(moment().startOf('day')))
                .sort((a, b) => a.date.valueOf() - b.date.valueOf());

            if (sortedExpiries.length === 0) {
                throw new Error('No future expiries available');
            }

            const expiryPreference = config.options.expiry_type || 'MONTHLY';
            let selectedExpiry;

            if (expiryPreference === 'WEEKLY') {
                let foundWeekly = null;

                for (const candidate of sortedExpiries) {
                    const month = candidate.date.month();
                    const year = candidate.date.year();

                    const expiriesInCandidateMonth = sortedExpiries.filter(e => e.date.month() === month && e.date.year() === year);
                    const lastDayInCandidateMonth = expiriesInCandidateMonth[expiriesInCandidateMonth.length - 1];

                    const isMonthly = candidate.date.isSame(lastDayInCandidateMonth.date);

                    if (!isMonthly) {
                        foundWeekly = candidate;
                        break;
                    }
                }
                
                if (foundWeekly) {
                    selectedExpiry = foundWeekly.date;
                } else {
                    console.log(`  [Expiry Warning] No weekly contract found for ${config.underlying}. Falling back to nearest available expiry.`);
                    selectedExpiry = sortedExpiries[0].date;
                }

            } else { // This handles 'MONTHLY' preference
                let targetMonth = moment().startOf('month');
                let monthExpiries = [];

                for (let i = 0; i < 12; i++) {
                    const monthKey = targetMonth.month();
                    const yearKey = targetMonth.year();
                    
                    const potentialExpiries = sortedExpiries.filter(exp =>
                        exp.date.month() === monthKey && exp.date.year() === yearKey
                    );

                    if (potentialExpiries.length > 0) {
                        monthExpiries = potentialExpiries;
                        break; 
                    }
                    targetMonth.add(1, 'month');
                }

                if (monthExpiries.length > 0) {
                    // The last expiry in a given month is the monthly expiry
                    selectedExpiry = monthExpiries[monthExpiries.length - 1].date;
                } else {
                    // Fallback if no expiries are found for the current or upcoming months
                    selectedExpiry = sortedExpiries[sortedExpiries.length - 1].date;
                }
            }

            if (!selectedExpiry) {
                 throw new Error('Could not determine a valid expiry date');
            }

            config.options.expiry_date = selectedExpiry.format('YYYY-MM-DD');
            console.log(`  ✅ ${config.underlying.padEnd(15)} [${config.exchange}]: ${config.options.expiry_date} (${expiryPreference})`);

        } catch (error) {
            console.error(`  ❌ ${config.underlying.padEnd(15)} [${config.exchange}]: Failed to calculate expiry - ${error.message}`);
        }
    }
}

// The functions below are not used by the dynamic calculation but can be kept for other potential uses.
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getNextWeeklyExpiry(targetDay) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentDay = today.getDay();
    let daysUntilTarget = (targetDay - currentDay + 7) % 7;
    if (daysUntilTarget === 0) {
        daysUntilTarget = 7;
    }
    const expiryDate = new Date(today);
    expiryDate.setDate(today.getDate() + daysUntilTarget);
    return expiryDate;
}

function getMonthlyExpiry(dateInMonth) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastDayOfMonth = new Date(dateInMonth.getFullYear(), dateInMonth.getMonth() + 1, 0);
    const dayOfWeek = lastDayOfMonth.getDay();
    const daysToSubtract = (dayOfWeek + 3) % 7;
    lastDayOfMonth.setDate(lastDayOfMonth.getDate() - daysToSubtract);

    if (lastDayOfMonth < today) {
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        return getMonthlyExpiry(nextMonth);
    }
    return lastDayOfMonth;
}

function getExpiryDate(config) {
    const { underlying, instrumentType, options } = config;
    const expiryType = options.expiry_type || 'MONTHLY';

    let expiryDate;
    if (expiryType === 'WEEKLY' && instrumentType === 'Index') {
        if (underlying === 'NIFTY' || underlying === 'BANKNIFTY') {
            expiryDate = getNextWeeklyExpiry(4);
        } else if (underlying === 'SENSEX') {
            expiryDate = getNextWeeklyExpiry(5);
        } else {
            expiryDate = getMonthlyExpiry(new Date());
        }
    } else {
        expiryDate = getMonthlyExpiry(new Date());
    }
    return formatDate(expiryDate);
}

module.exports = { getExpiryDate, calculateDynamicExpiries };
