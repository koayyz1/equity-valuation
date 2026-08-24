import { TAG_CHAINS, ANNUAL_FORMS, USER_AGENT, RATE_LIMIT_MS } from './constants.js';
import { fetchRetry } from './cache.js';

const EDGAR_BASE = 'https://data.sec.gov';
const SEC_BASE = 'https://www.sec.gov';

// ---------- Rate-limited fetch ----------
// Token-bucket by *start time*: requests may run concurrently, but each is
// scheduled to begin no sooner than RATE_LIMIT_MS after the previous start.
// This keeps us under SEC's 10 req/s cap while letting in-flight requests
// overlap — the old queue serialized on completion (~1-2 req/s) and stalled the
// whole line behind a single slow/retrying companyfacts download.
let lastStart = -RATE_LIMIT_MS;

async function rateLimitedFetch(url, options = {}) {
  const now = Date.now();
  const start = Math.max(now, lastStart + RATE_LIMIT_MS);
  lastStart = start;
  const wait = start - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return fetchRetry(url, {
    ...options,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      ...(options?.headers || {}),
    },
  });
}

// ---------- Ticker cache ----------
let tickerCache = null;
let tickerCacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getCompanyTickers() {
  const now = Date.now();
  if (tickerCache && now - tickerCacheTime < CACHE_TTL_MS) return tickerCache;

  const res = await rateLimitedFetch(`${SEC_BASE}/files/company_tickers.json`);
  if (!res.ok) throw new Error(`Failed to fetch company tickers: ${res.status}`);
  tickerCache = await res.json();
  tickerCacheTime = now;
  return tickerCache;
}

export async function getCIKFromTicker(ticker) {
  const tickers = await getCompanyTickers();
  const upper = String(ticker).toUpperCase();
  for (const key in tickers) {
    const entry = tickers[key];
    if (entry.ticker === upper) {
      return {
        cik: String(entry.cik_str).padStart(10, '0'),
        cikRaw: entry.cik_str,
        ticker: entry.ticker,
        name: entry.title,
      };
    }
  }
  throw new Error(`Ticker "${ticker}" not found in SEC EDGAR. It may be OTC/foreign — use manual input.`);
}

export async function searchCompanies(query) {
  const tickers = await getCompanyTickers();
  const upper = String(query).toUpperCase();
  const results = [];
  for (const key in tickers) {
    const entry = tickers[key];
    if (
      entry.ticker.startsWith(upper) ||
      entry.title.toUpperCase().includes(upper)
    ) {
      results.push({
        ticker: entry.ticker,
        name: entry.title,
        cik: String(entry.cik_str).padStart(10, '0'),
      });
      if (results.length >= 15) break;
    }
  }
  // Sort: exact ticker match first, then prefix matches, then name matches
  results.sort((a, b) => {
    if (a.ticker === upper) return -1;
    if (b.ticker === upper) return 1;
    const aStarts = a.ticker.startsWith(upper);
    const bStarts = b.ticker.startsWith(upper);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return 0;
  });
  return results;
}

// ---------- Company facts (shared cache) ----------
// The companyfacts JSON is multi-MB. A single ticker load previously downloaded
// it up to 4× concurrently (financials + 3 quarterly variants across two
// modules). This one cache — with TTL, in-flight dedup, and bounded size — is
// shared by edgar.js and historical.js so it's fetched at most once per window.
const factsCache = new Map(); // padded CIK -> { t, data }
const factsInflight = new Map(); // padded CIK -> Promise
const FACTS_TTL_MS = 30 * 60 * 1000;
const FACTS_MAX = 24; // cap heap — each entry is a parsed multi-MB payload

export async function getCompanyFacts(cikRaw) {
  const padded = String(cikRaw).padStart(10, '0');
  const hit = factsCache.get(padded);
  if (hit && Date.now() - hit.t < FACTS_TTL_MS) return hit.data;

  const pending = factsInflight.get(padded);
  if (pending) return pending;

  const p = (async () => {
    const res = await rateLimitedFetch(`${EDGAR_BASE}/api/xbrl/companyfacts/CIK${padded}.json`);
    if (!res.ok) throw new Error(`Failed to fetch company facts: ${res.status}`);
    const data = await res.json();
    // Evict expired, then cap size by dropping the oldest entry.
    const now = Date.now();
    for (const [k, v] of factsCache) if (now - v.t >= FACTS_TTL_MS) factsCache.delete(k);
    if (factsCache.size >= FACTS_MAX) {
      let oldestKey = null;
      let oldestT = Infinity;
      for (const [k, v] of factsCache) if (v.t < oldestT) { oldestT = v.t; oldestKey = k; }
      if (oldestKey) factsCache.delete(oldestKey);
    }
    factsCache.set(padded, { t: now, data });
    return data;
  })();
  factsInflight.set(padded, p);
  try {
    return await p;
  } finally {
    factsInflight.delete(padded);
  }
}

// ---------- Extraction helpers ----------

// Pick a unit array. Prefer USD, then any currency-like key, then first.
function pickUnit(units) {
  if (!units) return null;
  const keys = Object.keys(units);
  if (!keys.length) return null;
  if (units.USD) return { unit: 'USD', data: units.USD };
  // Prefer a 3-letter currency code
  const currencyKey = keys.find((k) => /^[A-Z]{3}$/.test(k));
  if (currencyKey) return { unit: currencyKey, data: units[currencyKey] };
  return { unit: keys[0], data: units[keys[0]] };
}

function pickSharesUnit(units) {
  if (!units) return null;
  if (units.shares) return { unit: 'shares', data: units.shares };
  const keys = Object.keys(units);
  return keys.length ? { unit: keys[0], data: units[keys[0]] } : null;
}

// Deduplicate by `end` period, keeping the latest `filed` (handles amendments).
function latestByPeriod(entries) {
  const byEnd = new Map();
  for (const e of entries) {
    const prev = byEnd.get(e.end);
    if (!prev || new Date(e.filed) > new Date(prev.filed)) {
      byEnd.set(e.end, e);
    }
  }
  return [...byEnd.values()];
}

// Filter to consolidated (non-dimensional) entries.
function filterConsolidated(entries) {
  // Segment/dimensional facts come with a dimensional key like `frame: CY2023Q4I_us-gaap_StatementBusinessSegmentsAxis_...`
  // Safest signal: entries reported at the consolidated level generally have no dimensional qualifier.
  // The companyfacts endpoint strips most of these, but we add a cheap guard.
  return entries.filter((e) => !e.dim && !e.dimension);
}

// Extract the most recent annual (period-flow) value across ALL tag variants.
// Compares the newest `end` date from each tag — the tag with the freshest data wins.
// This handles companies that migrate between XBRL tags across fiscal years.
function extractAnnual(facts, chain) {
  let best = null;
  for (const { taxonomy, tag } of chain) {
    const tx = facts[taxonomy];
    if (!tx || !tx[tag]) continue;
    const picked = pickUnit(tx[tag].units);
    if (!picked) continue;
    const { unit, data } = picked;
    const annual = filterConsolidated(data)
      .filter((e) => ANNUAL_FORMS.includes(e.form) && e.fp === 'FY');
    const dedup = latestByPeriod(annual).sort(
      (a, b) => new Date(b.end) - new Date(a.end)
    );
    if (dedup.length) {
      const candidate = dedup[0];
      if (!best || new Date(candidate.end) > new Date(best.entry.end)) {
        best = { value: candidate.val, unit, entry: candidate, tag, taxonomy };
      }
    }
  }
  return best;
}

// Extract most recent instant (balance-sheet) value across ALL tag variants.
function extractInstant(facts, chain, preferShares = false) {
  let best = null;
  for (const { taxonomy, tag } of chain) {
    const tx = facts[taxonomy];
    if (!tx || !tx[tag]) continue;
    const picked = preferShares ? pickSharesUnit(tx[tag].units) : pickUnit(tx[tag].units);
    if (!picked) continue;
    const { unit, data } = picked;
    const dedup = latestByPeriod(filterConsolidated(data)).sort(
      (a, b) => new Date(b.end) - new Date(a.end) || new Date(b.filed) - new Date(a.filed)
    );
    if (dedup.length) {
      const candidate = dedup[0];
      if (!best || new Date(candidate.end) > new Date(best.entry.end)) {
        best = { value: candidate.val, unit, entry: candidate, tag, taxonomy };
      }
    }
  }
  return best;
}

// Extract up to N years of annual history across ALL tag variants.
// Merges data from all matching tags, keeping the freshest value per fiscal year.
function extractHistory(facts, chain, years = 5) {
  const byFY = new Map();
  for (const { taxonomy, tag } of chain) {
    const tx = facts[taxonomy];
    if (!tx || !tx[tag]) continue;
    const picked = pickUnit(tx[tag].units);
    if (!picked) continue;
    const annual = filterConsolidated(picked.data)
      .filter((e) => ANNUAL_FORMS.includes(e.form) && e.fp === 'FY');
    for (const e of annual) {
      const prev = byFY.get(e.fy);
      // Keep the entry with the most recent end date (or latest filed if same end).
      if (
        !prev ||
        new Date(e.end) > new Date(prev.end) ||
        (e.end === prev.end && new Date(e.filed) > new Date(prev.filed))
      ) {
        byFY.set(e.fy, e);
      }
    }
  }
  const sorted = [...byFY.values()].sort((a, b) => b.fy - a.fy).slice(0, years);
  return sorted.map((e) => ({ fy: e.fy, value: e.val, end: e.end }));
}

// ---------- Main normalizer ----------
export async function getFinancials(cikRaw) {
  const full = await getCompanyFacts(cikRaw);
  const facts = full.facts || {};

  const revenue = extractAnnual(facts, TAG_CHAINS.revenue);
  const netIncome = extractAnnual(facts, TAG_CHAINS.netIncome);
  const cfo = extractAnnual(facts, TAG_CHAINS.cfo);
  const da = extractAnnual(facts, TAG_CHAINS.da);
  const capexRaw = extractAnnual(facts, TAG_CHAINS.capex);
  const ebit = extractAnnual(facts, TAG_CHAINS.ebit);
  const interestExpense = extractAnnual(facts, TAG_CHAINS.interestExpense);
  const tax = extractAnnual(facts, TAG_CHAINS.tax);
  const dividends = extractAnnual(facts, TAG_CHAINS.dividends);
  const newDebt = extractAnnual(facts, TAG_CHAINS.newDebt);
  const debtRepayment = extractAnnual(facts, TAG_CHAINS.debtRepayment);

  const cash = extractInstant(facts, TAG_CHAINS.cash);
  const totalAssets = extractInstant(facts, TAG_CHAINS.totalAssets);
  const currentLiabilities = extractInstant(facts, TAG_CHAINS.currentLiabilities);
  const shares = extractInstant(facts, TAG_CHAINS.shares, true);

  const historicalCFO = extractHistory(facts, TAG_CHAINS.cfo, 6);
  const historicalCapEx = extractHistory(facts, TAG_CHAINS.capex, 6);

  const v = (x) => (x ? x.value : null);

  const revenueVal = v(revenue);
  const netIncomeVal = v(netIncome);
  const cfoVal = v(cfo);
  const daVal = v(da);
  // EDGAR reports CapEx as positive outflow; standardize to negative
  const capexVal = capexRaw?.value != null ? -Math.abs(capexRaw.value) : null;
  const cashVal = v(cash);
  const ebitVal = v(ebit);
  const interestVal = v(interestExpense);
  const taxVal = v(tax);
  const dividendsVal = v(dividends);
  const newDebtVal = v(newDebt);
  const debtRepaymentVal = v(debtRepayment);
  const sharesVal = v(shares);
  const totalAssetsVal = v(totalAssets);
  const currentLiabilitiesVal = v(currentLiabilities);

  // Computed
  const ebitdaVal = ebitVal != null && daVal != null ? ebitVal + daVal : null;
  const netBorrowingVal =
    newDebtVal != null || debtRepaymentVal != null
      ? (newDebtVal ?? 0) - (debtRepaymentVal ?? 0)
      : null;
  const fcfeVal =
    cfoVal != null && capexVal != null
      ? cfoVal + capexVal + (netBorrowingVal ?? 0)
      : null;

  // Payout ratio: if dividends missing/zero and NI present, payout = 0
  let payoutRatioVal = null;
  if (netIncomeVal != null && netIncomeVal !== 0) {
    if (dividendsVal == null) payoutRatioVal = 0;
    else payoutRatioVal = Math.abs(dividendsVal) / netIncomeVal;
  }

  const preTaxIncome =
    ebitVal != null && interestVal != null ? ebitVal - interestVal : null;
  const taxRateVal =
    taxVal != null && preTaxIncome != null && preTaxIncome !== 0
      ? taxVal / preTaxIncome
      : null;
  const nopatVal =
    ebitVal != null && taxRateVal != null ? ebitVal * (1 - taxRateVal) : null;
  const investedCapitalVal =
    totalAssetsVal != null && cashVal != null && currentLiabilitiesVal != null
      ? totalAssetsVal - cashVal - currentLiabilitiesVal
      : null;
  const roicVal =
    nopatVal != null && investedCapitalVal != null && investedCapitalVal !== 0
      ? nopatVal / investedCapitalVal
      : null;

  // FCF CAGR (5Y)
  let fcfCAGR = null;
  const cfoByFY = Object.fromEntries(historicalCFO.map((e) => [e.fy, e.value]));
  const capexByFY = Object.fromEntries(historicalCapEx.map((e) => [e.fy, e.value]));
  const commonFYs = Object.keys(cfoByFY)
    .map(Number)
    .filter((fy) => capexByFY[fy] != null)
    .sort((a, b) => b - a);

  const fcfSeries = commonFYs.map((fy) => ({
    fy,
    fcf: cfoByFY[fy] - Math.abs(capexByFY[fy] || 0),
  }));

  if (fcfSeries.length >= 2) {
    const latest = fcfSeries[0];
    const oldest = fcfSeries[fcfSeries.length - 1];
    const years = latest.fy - oldest.fy;
    if (years > 0 && latest.fcf > 0 && oldest.fcf > 0) {
      fcfCAGR = Math.pow(latest.fcf / oldest.fcf, 1 / years) - 1;
    }
  }

  // Currency/unit
  const currency =
    revenue?.unit ||
    netIncome?.unit ||
    cfo?.unit ||
    'USD';

  // Filing date — most recent of key facts
  const filingDate =
    [revenue, cfo, netIncome, ebit]
      .filter(Boolean)
      .map((x) => x.entry.filed)
      .sort()
      .pop() || null;

  return {
    entityName: full.entityName || null,
    cik: full.cik || null,
    filingDate,
    currency,
    // Raw
    revenue: revenueVal,
    netIncome: netIncomeVal,
    cfo: cfoVal,
    da: daVal,
    capex: capexVal,
    cash: cashVal,
    ebit: ebitVal,
    interestExpense: interestVal,
    tax: taxVal,
    dividends: dividendsVal,
    newDebt: newDebtVal,
    debtRepayment: debtRepaymentVal,
    shares: sharesVal,
    totalAssets: totalAssetsVal,
    currentLiabilities: currentLiabilitiesVal,
    totalDebt: null, // populated from Yahoo
    stockholdersEquity: null, // populated from Yahoo
    goodwill: null, // populated from Yahoo
    beta: null, // populated from Yahoo
    // Computed
    ebitda: ebitdaVal,
    netBorrowing: netBorrowingVal,
    fcfe: fcfeVal,
    payoutRatio: payoutRatioVal,
    taxRate: taxRateVal,
    nopat: nopatVal,
    investedCapital: investedCapitalVal,
    roic: roicVal,
    wacc: null, // computed on frontend with price data
    fcfCAGR,
    fcfHistory: fcfSeries,
    // Tags actually used (for debug UI)
    _tags: {
      revenue: revenue?.tag,
      netIncome: netIncome?.tag,
      cfo: cfo?.tag,
      capex: capexRaw?.tag,
      ebit: ebit?.tag,
      shares: shares?.tag,
    },
  };
}
