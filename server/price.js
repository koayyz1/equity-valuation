// Yahoo Finance unofficial JSON proxy.
import { lookupGicsCode } from './gics.js';
import { fetchRetry } from './cache.js';

const YF_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_TIMESERIES_BASE =
  'https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries';

const YF_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
};

// ---------- Yahoo crumb/cookie authentication ----------
let yfCrumb = null;
let yfCookie = null;
let yfCrumbTime = 0;
const CRUMB_TTL_MS = 10 * 60 * 1000; // 10 min

async function ensureCrumb() {
  const now = Date.now();
  if (yfCrumb && yfCookie && now - yfCrumbTime < CRUMB_TTL_MS) return;

  const initRes = await fetch('https://fc.yahoo.com/', {
    headers: YF_HEADERS,
    redirect: 'manual',
  });
  const rawCookies = initRes.headers.getSetCookie?.() || [];
  let cookieJar = rawCookies;
  if (!cookieJar.length) {
    const raw = initRes.headers.get('set-cookie');
    cookieJar = raw ? raw.split(/,(?=\s*[A-Za-z0-9_]+=)/) : [];
  }
  yfCookie = cookieJar.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');

  const crumbRes = await fetch(
    'https://query2.finance.yahoo.com/v1/test/getcrumb',
    { headers: { ...YF_HEADERS, Cookie: yfCookie } }
  );
  if (!crumbRes.ok) throw new Error(`Crumb fetch failed: ${crumbRes.status}`);
  yfCrumb = await crumbRes.text();
  yfCrumbTime = now;
}

// Fetch a crumb-authenticated Yahoo endpoint. `buildUrl` is a function (not a
// string) so the crumb can be re-read after a 401-triggered refresh. Returns the
// raw Response; callers check `.ok` and parse. Centralizes the ensureCrumb +
// single-retry boilerplate that was previously duplicated across every call site.
async function fetchYahoo(buildUrl) {
  await ensureCrumb();
  let res = await fetchRetry(buildUrl(), { headers: { ...YF_HEADERS, Cookie: yfCookie } });
  if (res.status === 401) {
    yfCrumbTime = 0;
    await ensureCrumb();
    res = await fetchRetry(buildUrl(), { headers: { ...YF_HEADERS, Cookie: yfCookie } });
  }
  return res;
}

// Shared quoteSummary fetch. The profile, estimates, and financials(beta) paths
// each used to issue their own quoteSummary call with overlapping modules
// (defaultKeyStatistics was fetched 3× per ticker). This fetches the union of
// modules once and caches the parsed result[0] per ticker for a short window so
// all three consumers share a single upstream round trip.
const QS_MODULES =
  'assetProfile,summaryProfile,defaultKeyStatistics,quoteType,earningsTrend,summaryDetail,price,financialData,calendarEvents';
const qsCache = new Map(); // ticker -> { t, result }
const qsInflight = new Map(); // ticker -> Promise
const QS_TTL_MS = 60 * 1000;

async function getQuoteSummary(ticker) {
  const key = ticker.toUpperCase();
  const hit = qsCache.get(key);
  if (hit && Date.now() - hit.t < QS_TTL_MS) return hit.result;

  const pending = qsInflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    const res = await fetchYahoo(() =>
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=${QS_MODULES}&crumb=${encodeURIComponent(yfCrumb)}`
    );
    if (!res.ok) throw new Error(`quoteSummary ${res.status}`);
    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0] || {};
    qsCache.set(key, { t: Date.now(), result });
    return result;
  })();
  qsInflight.set(key, p);
  try {
    return await p;
  } finally {
    qsInflight.delete(key);
  }
}

// ---------- Price (chart endpoint — no auth needed) ----------
export async function getStockPrice(ticker) {
  try {
    const url = `${YF_CHART_BASE}/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
    const res = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No chart data in response');

    const meta = result.meta || {};
    const price = meta.regularMarketPrice ?? meta.previousClose ?? null;
    const currency = meta.currency || 'USD';
    let marketCap = meta.marketCap ?? null;
    let sharesOutstanding = meta.sharesOutstanding ?? null;
    if (marketCap == null && sharesOutstanding != null && price != null) {
      marketCap = sharesOutstanding * price;
    } else if (sharesOutstanding == null && marketCap != null && price != null) {
      sharesOutstanding = Math.round(marketCap / price);
    }

    // Fallback: some tickers (e.g. BRK-B) return no marketCap/shares from the chart
    // endpoint. Use quoteSummary to get the correct figures with crumb auth.
    if ((marketCap == null || sharesOutstanding == null) && price != null) {
      try {
        const qsRes = await fetchYahoo(() =>
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
          `?modules=defaultKeyStatistics,summaryDetail&crumb=${encodeURIComponent(yfCrumb)}`
        );
        if (qsRes.ok) {
          const qsData = await qsRes.json();
          const ks = qsData?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
          const sd = qsData?.quoteSummary?.result?.[0]?.summaryDetail;
          if (marketCap == null) {
            marketCap = sd?.marketCap?.raw ?? ks?.enterpriseValue?.raw ?? null;
          }
          if (sharesOutstanding == null && marketCap != null && price != null) {
            sharesOutstanding = Math.round(marketCap / price);
          }
        }
      } catch (_) { /* fallback optional */ }
    }

    return {
      price,
      marketCap,
      currency,
      sharesOutstanding,
      exchange: meta.exchangeName || null,
      longName: meta.longName || meta.shortName || null,
      beta: meta.beta ?? null,
    };
  } catch (err) {
    return {
      price: null,
      marketCap: null,
      currency: 'USD',
      sharesOutstanding: null,
      error: err.message,
    };
  }
}

// ---------- Historical price series (chart endpoint) ----------

// Map friendly range keys to Yahoo's range/interval pairs.
// 24H -> intraday 5-minute bars over 1 day.
const RANGE_MAP = {
  '1D':  { range: '1d',  interval: '5m'  },
  '5D':  { range: '5d',  interval: '15m' },
  '1M':  { range: '1mo', interval: '1d'  },
  '6M':  { range: '6mo', interval: '1d'  },
  'YTD': { range: 'ytd', interval: '1d'  },
  '1Y':  { range: '1y',  interval: '1d'  },
  '5Y':  { range: '5y',  interval: '1wk' },
  'MAX': { range: 'max', interval: '1mo' },
};

export async function getPriceHistory(ticker, rangeKey = '1Y') {
  const mapped = RANGE_MAP[rangeKey?.toUpperCase()] || RANGE_MAP['1Y'];
  const url =
    `${YF_CHART_BASE}/${encodeURIComponent(ticker)}` +
    `?range=${mapped.range}&interval=${mapped.interval}&includePrePost=false`;
  const res = await fetch(url, { headers: YF_HEADERS });
  if (!res.ok) throw new Error(`Yahoo chart returned ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('No chart data');

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const meta = result.meta || {};

  const series = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    series.push({ t: timestamps[i] * 1000, c });
  }

  return {
    ticker: ticker.toUpperCase(),
    range: rangeKey,
    interval: mapped.interval,
    currency: meta.currency || 'USD',
    price: meta.regularMarketPrice ?? null,
    previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    exchange: meta.exchangeName || null,
    exchangeTimezone: meta.exchangeTimezoneName || meta.timezone || null,
    series,
  };
}

// ---------- Company profile (description, sector, employees, etc.) ----------

export async function getCompanyProfile(ticker) {
  try {
    const result = await getQuoteSummary(ticker);
    if (!result || !Object.keys(result).length) throw new Error('No profile data');

    const ap = result.assetProfile || result.summaryProfile || {};
    const ks = result.defaultKeyStatistics || {};
    const qt = result.quoteType || {};

    // Fiscal year end → "DD Month" (e.g. "25 January").
    let fiscalYearEnd = null;
    const fyeTs = ks.nextFiscalYearEnd?.raw ?? ks.lastFiscalYearEnd?.raw ?? null;
    if (fyeTs) {
      const d = new Date(fyeTs * 1000);
      fiscalYearEnd = d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });
    }

    const industry = ap.industry || null;
    return {
      ticker: ticker.toUpperCase(),
      longName: qt.longName || qt.shortName || null,
      description: ap.longBusinessSummary || null,
      website: ap.website || null,
      sector: ap.sector || null,
      industry,
      gicsSubIndustryCode: lookupGicsCode(industry),
      fullTimeEmployees: ap.fullTimeEmployees ?? null,
      country: ap.country || null,
      city: ap.city || null,
      fiscalYearEnd,
      heldPercentInsiders: ks.heldPercentInsiders?.raw ?? null,
    };
  } catch (err) {
    console.error('[yahoo-profile]', err.message);
    return { ticker: ticker.toUpperCase(), error: err.message };
  }
}

// ---------- Periodic financials (quarterly or annual) ----------

const PERIODIC_FIELD_BASES = [
  'TotalRevenue',
  'GrossProfit',
  'OperatingIncome',
  'NetIncome',
  'BasicEPS',
  'DilutedEPS',
  'OperatingCashFlow',
  'FreeCashFlow',
  'CapitalExpenditure',
  'TotalAssets',
  'TotalDebt',
  'StockholdersEquity',
  'CashCashEquivalentsAndShortTermInvestments',
];

export async function getPeriodicFinancials(ticker, nPeriods = 8, period = 'quarterly') {
  try {
    await ensureCrumb();

    const isAnnual = period === 'annual';
    const prefix = isAnnual ? 'annual' : 'quarterly';
    const fields = PERIODIC_FIELD_BASES.map((f) => prefix + f);

    const now = Math.floor(Date.now() / 1000);
    // For 8 quarters need ~3y; for 8 annuals need ~10y.
    const lookbackYears = isAnnual ? 12 : 3;
    const lookback = now - lookbackYears * 365 * 24 * 3600;

    // The timeseries (financials) and balance-sheet (shares issued) endpoints are
    // independent, so fetch them in parallel rather than one after the other.
    const bsModule = isAnnual ? 'balanceSheetHistory' : 'balanceSheetHistoryQuarterly';
    await ensureCrumb();
    const [res, bsRes] = await Promise.all([
      fetchYahoo(() =>
        `${YF_TIMESERIES_BASE}/${encodeURIComponent(ticker)}` +
        `?type=${fields.join(',')}` +
        `&period1=${lookback}&period2=${now}` +
        `&crumb=${encodeURIComponent(yfCrumb)}`
      ),
      fetchYahoo(() =>
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
        `?modules=${bsModule}&crumb=${encodeURIComponent(yfCrumb)}`
      ).catch(() => null),
    ]);
    if (!res.ok) throw new Error(`${prefix} timeseries returned ${res.status}`);
    const data = await res.json();

    const seriesList = data?.timeseries?.result || [];
    const perField = {};
    const datesSet = new Set();
    for (const series of seriesList) {
      const fieldName = series.meta?.type?.[0];
      if (!fieldName) continue;
      const entries = series[fieldName];
      if (!entries?.length) continue;
      perField[fieldName] = {};
      for (const e of entries) {
        if (!e?.asOfDate) continue;
        perField[fieldName][e.asOfDate] = e.reportedValue?.raw ?? null;
        datesSet.add(e.asOfDate);
      }
    }

    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1)).slice(0, nPeriods);

    // Shares issued from the balance sheet (fetched in parallel above).
    // Yahoo's balance sheet "Shares Issued" = commonStockSharesIssued per period.
    const sharesIssuedByDate = {};
    try {
      if (bsRes?.ok) {
        const bsJson = await bsRes.json();
        const bsKey = isAnnual ? 'balanceSheetStatements' : 'balanceSheetStatementsQuarterly';
        const statements =
          bsJson?.quoteSummary?.result?.[0]?.[bsModule]?.[bsKey] || [];
        for (const stmt of statements) {
          const d = stmt.endDate?.fmt ?? null;
          const v = stmt.commonStockSharesIssued?.raw ?? null;
          if (d && v != null) sharesIssuedByDate[d] = v;
        }
      }
    } catch {
      // shares issued optional — don't fail the whole request
    }

    // Normalize output keys to the legacy `quarterly*` names so the frontend
    // can treat both periodicities uniformly.
    const periods = dates.map((d) => {
      const row = { asOfDate: d };
      for (let i = 0; i < fields.length; i++) {
        const src = fields[i];
        const dst = 'quarterly' + PERIODIC_FIELD_BASES[i];
        row[dst] = perField[src]?.[d] ?? null;
      }
      row.quarterlySharesOutstanding = sharesIssuedByDate[d] ?? null;
      return row;
    });

    return { ticker: ticker.toUpperCase(), period, quarters: periods };
  } catch (err) {
    console.error(`[yahoo-${period}]`, err.message);
    return { ticker: ticker.toUpperCase(), period, quarters: [], error: err.message };
  }
}

// ---------- Yahoo balance-sheet shares issued (standalone) ----------
// Returns { "YYYY-MM-DD": count, ... } for the most recent quarterly periods.
// Used to overlay correct share counts onto EDGAR-sourced quarterly data.
export async function getYahooSharesIssued(ticker) {
  try {
    const res = await fetchYahoo(() =>
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=balanceSheetHistoryQuarterly&crumb=${encodeURIComponent(yfCrumb)}`
    );
    if (!res.ok) return {};
    const json = await res.json();
    const statements =
      json?.quoteSummary?.result?.[0]
        ?.balanceSheetHistoryQuarterly
        ?.balanceSheetStatementsQuarterly || [];
    const out = {};
    for (const stmt of statements) {
      const d = stmt.endDate?.fmt ?? null;          // "YYYY-MM-DD"
      const v = stmt.commonStockSharesIssued?.raw ?? null;
      if (d && v != null) out[d] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// Backwards-compat shim
export const getQuarterlyFinancials = (ticker, n = 8) =>
  getPeriodicFinancials(ticker, n, 'quarterly');

// ---------- Analyst estimates (PEG / EPS growth / 5y ROE) ----------

export async function getAnalystEstimates(ticker) {
  try {
    // Two independent endpoints: quoteSummary (earnings trend, key stats) and the
    // historical timeseries (net income + equity for 5y ROE). Fetch both in parallel.
    const now = Math.floor(Date.now() / 1000);
    const lookback = now - 7 * 365 * 24 * 3600;
    const histFields = ['annualNetIncome', 'annualStockholdersEquity'];

    await ensureCrumb();
    const [result, tsRes] = await Promise.all([
      getQuoteSummary(ticker),
      fetchYahoo(() =>
        `${YF_TIMESERIES_BASE}/${encodeURIComponent(ticker)}` +
        `?type=${histFields.join(',')}` +
        `&period1=${lookback}&period2=${now}` +
        `&crumb=${encodeURIComponent(yfCrumb)}`
      ).catch(() => null),
    ]);

    // 1. earningsTrend for EPS growth (next year + long-term)

    const trends = result.earningsTrend?.trend || [];
    const findTrend = (period) => trends.find((t) => t.period === period) || {};
    const nextYearTrend = findTrend('+1y');
    const ltgTrend = findTrend('+5y');

    const epsGrowthNextYear = nextYearTrend.growth?.raw ?? null;
    // Yahoo's PEG uses a 5y projected EPS growth (long-term growth)
    const epsGrowthLongTerm = ltgTrend.growth?.raw ?? null;

    const pegRatio = result.defaultKeyStatistics?.pegRatio?.raw ?? null;
    const trailingPE = result.summaryDetail?.trailingPE?.raw ?? null;
    const forwardPE = result.summaryDetail?.forwardPE?.raw ?? null;
    const earningsYield =
      trailingPE != null && trailingPE > 0 ? 1 / trailingPE : null;

    // Analyst consensus price targets (financialData module)
    const fd = result.financialData || {};
    const targetMeanPrice = fd.targetMeanPrice?.raw ?? null;
    const targetHighPrice = fd.targetHighPrice?.raw ?? null;
    const targetLowPrice = fd.targetLowPrice?.raw ?? null;
    const numberOfAnalysts = fd.numberOfAnalystOpinions?.raw ?? null;

    // Next earnings date (calendarEvents). Yahoo gives a range; take the first.
    const earningsDates = result.calendarEvents?.earnings?.earningsDate;
    const nextEarningsDate =
      Array.isArray(earningsDates) && earningsDates[0]?.raw
        ? new Date(earningsDates[0].raw * 1000).toISOString().slice(0, 10)
        : null;

    // 2. Historical net income + equity for 5y ROE (tsRes fetched in parallel above)
    let roe5y = null;
    if (tsRes?.ok) {
      const tsJson = await tsRes.json();
      const series = tsJson?.timeseries?.result || [];
      const niMap = {}, eqMap = {};
      for (const s of series) {
        const f = s.meta?.type?.[0];
        const entries = s[f] || [];
        const target = f === 'annualNetIncome' ? niMap : eqMap;
        for (const e of entries) {
          if (e?.asOfDate) target[e.asOfDate] = e.reportedValue?.raw ?? null;
        }
      }
      const dates = Object.keys(niMap)
        .filter((d) => eqMap[d] != null && niMap[d] != null && eqMap[d] > 0)
        .sort()
        .slice(-5);
      if (dates.length >= 3) {
        const roes = dates.map((d) => niMap[d] / eqMap[d]);
        roe5y = roes.reduce((a, b) => a + b, 0) / roes.length;
      }
    }

    return {
      ticker: ticker.toUpperCase(),
      epsGrowthNextYear,
      epsGrowthLongTerm,
      pegRatio,
      trailingPE,
      forwardPE,
      earningsYield,
      roe5y,
      targetMeanPrice,
      targetHighPrice,
      targetLowPrice,
      numberOfAnalysts,
      nextEarningsDate,
    };
  } catch (err) {
    console.error('[yahoo-estimates]', err.message);
    return { ticker: ticker.toUpperCase(), error: err.message };
  }
}

// ---------- Detailed financials (fundamentals-timeseries — needs crumb) ----------

// The fields we want from Yahoo's timeseries. Each maps to a specific financial-statement line.
const YF_FIELDS = [
  'annualTotalRevenue',                                 // Revenue (most recent fiscal year annual)
  'annualCashCashEquivalentsAndShortTermInvestments',   // Cash + ST investments (balance sheet)
  'annualCapitalExpenditure',                           // CapEx (cash flow, negative)
  'annualDepreciationAndAmortization',                  // D&A (cash flow)
  'annualNetIssuancePaymentsOfDebt',                    // Net Borrowing (cash flow)
  'annualIssuanceOfDebt',                               // Gross new debt
  'annualRepaymentOfDebt',                              // Gross debt repayment (negative)
  'annualLongTermDebtPayments',                         // LT debt payments (negative)
  'annualTotalDebt',                                    // Total debt (balance sheet)
  'annualFreeCashFlow',                                 // FCF for historical CAGR
  'annualOperatingCashFlow',                            // CFO for historical FCF calc
  'annualStockholdersEquity',                           // Equity for ROIC IC calc
  'annualGoodwill',                                     // Goodwill for IC calculation (deducted per SA methodology)
  // Quarterly fields — used to compute true TTM (sum of 4 most recent quarters)
  'quarterlyTotalRevenue',
  'quarterlyNetIncome',
  'quarterlyOperatingCashFlow',
  'quarterlyFreeCashFlow',
  'quarterlyCapitalExpenditure',
];

// Sum the 4 most recent non-null entries from a quarterly series.
function sumTtm(seriesList, fieldName) {
  const series = seriesList.find((s) => s.meta?.type?.[0] === fieldName);
  if (!series) return null;
  const entries = (series[fieldName] || [])
    .filter((e) => e?.reportedValue?.raw != null)
    .sort((a, b) => (a.asOfDate > b.asOfDate ? -1 : 1)); // most recent first
  if (entries.length < 4) return null;
  return entries.slice(0, 4).reduce((sum, e) => sum + e.reportedValue.raw, 0);
}

// Most recent asOfDate present in a series (e.g. the latest quarter end).
function latestDate(seriesList, fieldName) {
  const series = seriesList.find((s) => s.meta?.type?.[0] === fieldName);
  if (!series) return null;
  const dates = (series[fieldName] || [])
    .filter((e) => e?.reportedValue?.raw != null && e.asOfDate)
    .map((e) => e.asOfDate)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/**
 * Fetch detailed financials from Yahoo's fundamentals-timeseries API.
 * Returns the most recent annual value for each requested field.
 */
export async function getYahooFinancials(ticker) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const fiveYearsAgo = now - 7 * 365 * 24 * 3600; // 7 years for 5Y CAGR

    // The main financials timeseries and the beta lookup are independent — fetch
    // in parallel. beta comes from the shared quoteSummary cache; swallow its
    // failures without aborting.
    await ensureCrumb();
    const [res, qsResult] = await Promise.all([
      fetchYahoo(() =>
        `${YF_TIMESERIES_BASE}/${encodeURIComponent(ticker)}` +
        `?type=${YF_FIELDS.join(',')}` +
        `&period1=${fiveYearsAgo}&period2=${now}` +
        `&crumb=${encodeURIComponent(yfCrumb)}`
      ),
      getQuoteSummary(ticker).catch(() => null),
    ]);

    if (!res.ok) throw new Error(`timeseries returned ${res.status}`);
    const data = await res.json();

    // Parse: each series has a `meta.type[0]` key and an array of timestamped values.
    const seriesList = data?.timeseries?.result || [];
    const values = {};
    for (const series of seriesList) {
      const fieldName = series.meta?.type?.[0];
      if (!fieldName) continue;
      const entries = series[fieldName];
      if (!entries?.length) continue;
      // Take the most recent entry
      const latest = entries[entries.length - 1];
      values[fieldName] = {
        value: latest.reportedValue?.raw ?? null,
        asOfDate: latest.asOfDate || null,
      };
    }

    // Beta from the shared quoteSummary (chart endpoint doesn't reliably return it).
    const beta = qsResult?.defaultKeyStatistics?.beta?.raw ?? null;

    const v = (key) => values[key]?.value ?? null;

    // Build FCF history from annualFreeCashFlow
    const fcfHistory = [];
    const fcfEntries = seriesList.find((s) => s.meta?.type?.[0] === 'annualFreeCashFlow');
    if (fcfEntries?.annualFreeCashFlow?.length) {
      for (const e of fcfEntries.annualFreeCashFlow) {
        if (e.reportedValue?.raw != null && e.asOfDate) {
          const fy = new Date(e.asOfDate).getFullYear();
          fcfHistory.push({ fy, value: e.reportedValue.raw, asOfDate: e.asOfDate });
        }
      }
    }
    // Sort descending by date
    fcfHistory.sort((a, b) => new Date(b.asOfDate) - new Date(a.asOfDate));

    return {
      annualRevenue: v('annualTotalRevenue'),
      // True TTM = sum of 4 most recent reported quarters.
      // Preferred over annualRevenue for the valuation baseline.
      ttmRevenue: sumTtm(seriesList, 'quarterlyTotalRevenue'),
      ttmNetIncome: sumTtm(seriesList, 'quarterlyNetIncome'),
      ttmCFO: sumTtm(seriesList, 'quarterlyOperatingCashFlow'),
      ttmFCF: sumTtm(seriesList, 'quarterlyFreeCashFlow'),
      ttmCapex: sumTtm(seriesList, 'quarterlyCapitalExpenditure'),
      // As-of dates for the freshness badges on the frontend.
      ttmAsOf: latestDate(seriesList, 'quarterlyTotalRevenue'),
      cashAsOf: values['annualCashCashEquivalentsAndShortTermInvestments']?.asOfDate ?? null,
      cashAndShortTermInvestments: v('annualCashCashEquivalentsAndShortTermInvestments'),
      capitalExpenditures: v('annualCapitalExpenditure'),
      depreciation: v('annualDepreciationAndAmortization'),
      netBorrowings: v('annualNetIssuancePaymentsOfDebt'),
      issuanceOfDebt: v('annualIssuanceOfDebt'),
      repaymentOfDebt: v('annualRepaymentOfDebt'),
      longTermDebtPayments: v('annualLongTermDebtPayments'),
      totalDebt: v('annualTotalDebt'),
      stockholdersEquity: v('annualStockholdersEquity'),
      goodwill: v('annualGoodwill'),
      beta,
      fcfHistory,
    };
  } catch (err) {
    console.error('[yahoo-financials]', err.message);
    return null;
  }
}
