import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import {
  getCIKFromTicker,
  getFinancials,
  getCompanyTickers,
  searchCompanies,
} from './edgar.js';
import { getEdgarPeriodicFinancials, ttmFromQuarters } from './historical.js';
import { getCompanySummary } from './summary.js';
import { getCompanySummaryGemini, getCompanyDeepDive } from './gemini.js';
import {
  getStockPrice,
  getYahooFinancials,
  getPriceHistory,
  getPeriodicFinancials,
  getCompanyProfile,
  getAnalystEstimates,
  getYahooSharesIssued,
  yahooStatus,
} from './price.js';
import { withCache, TTL } from './cache.js';

// Keep the process alive through a stray async error from a flaky upstream
// (SEC/Yahoo). Crashing would restart the instance and produce exactly the
// intermittent edge "Not Found" 404s we're trying to avoid — log and continue.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack || reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err?.message || err);
});

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');

// SERVER_PORT keeps local dev off the preview tool's PORT (Vite). In production
// (Render/etc.) neither is set except PORT, which the platform assigns.
const PORT = Number(process.env.SERVER_PORT) || Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

// Optional Basic-Auth gate for a private audience. Enabled only when AUTH_PASS
// is set (env var on the host). The health check is always exempt so the
// platform's uptime probe isn't blocked.
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';
if (AUTH_PASS) {
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      if ((!AUTH_USER || user === AUTH_USER) && pass === AUTH_PASS) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="EquityVal"');
    return res.status(401).send('Authentication required');
  });
}

// Health check doubles as a deploy-version probe: RENDER_GIT_COMMIT is set by
// Render for each build, so `commit` tells you exactly which build is live.
const BUILD_COMMIT = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'dev';
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    commit: BUILD_COMMIT,
    node: process.version,
    // Yahoo's crumb-authenticated path is frequently blocked on datacenter IPs.
    // When it is down, prices still work but beta, analyst targets and the TTM
    // figures the DCF prefers silently fall back to EDGAR annuals — so report it.
    yahoo: yahooStatus,
  })
);

// Ticker -> CIK + company name
app.get('/api/company/:ticker', async (req, res) => {
  try {
    const company = await getCIKFromTicker(req.params.ticker);
    res.json(company);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Normalized financial data by CIK.
// Optional ?ticker=XYZ to also pull Yahoo Finance supplementary data.
app.get('/api/financials/:cik', async (req, res) => {
  try {
    const ticker = req.query.ticker || null;
    const cacheKey = `financials:${req.params.cik}:${ticker || ''}`;

    const merged = await withCache(cacheKey, TTL.FUNDAMENTALS, async () => {
    // Fetch EDGAR annual, EDGAR quarterly (for TTM) and Yahoo in parallel.
    const [edgar, edgarQuarters, yahoo] = await Promise.all([
      getFinancials(req.params.cik),
      getEdgarPeriodicFinancials(req.params.cik, 'quarterly', 8).catch(() => null),
      // DISABLE_YAHOO forces the EDGAR-only path. Production is frequently there
      // involuntarily (Yahoo rate-limits datacenter IPs), so being able to
      // reproduce it deliberately is what keeps that path honest.
      ticker && !process.env.DISABLE_YAHOO
        ? getYahooFinancials(ticker)
        : Promise.resolve(null),
    ]);

    const merged = { ...edgar };
    merged.yahooOk = !!yahoo;

    // ── TTM from EDGAR quarterly, applied first ──────────────────────────────
    // TTM is the right baseline for the DCF: it captures the current run-rate
    // rather than a fiscal year that may be most of a year stale. Deriving it
    // from EDGAR rather than Yahoo means the valuation no longer depends on a
    // path that is routinely rate-limited on datacenter IPs — previously that
    // failure silently swapped in EDGAR *annual* figures, so the same company
    // valued differently in production than locally with no visible cause.
    const ttm = ttmFromQuarters(edgarQuarters?.quarters);
    merged.ttmOk = !!ttm.complete;
    merged.ttmAsOf = ttm.asOf;
    const applyTtm = (field, value) => {
      if (value == null) return;
      merged[field] = value;
      merged._sources = { ...(merged._sources || {}), [field]: 'edgar' };
    };
    if (ttm.complete) {
      applyTtm('revenue', ttm.revenue);
      applyTtm('netIncome', ttm.netIncome);
      applyTtm('cfo', ttm.cfo);
      applyTtm('capex', ttm.capex);
      applyTtm('da', ttm.da);
      applyTtm('cash', ttm.cash);
      applyTtm('totalDebt', ttm.totalDebt);
      applyTtm('stockholdersEquity', ttm.stockholdersEquity);
      applyTtm('netBorrowing', ttm.netBorrowing);
    }

    // ── Yahoo, as a supplement ───────────────────────────────────────────────
    // Only fills what EDGAR TTM could not supply, plus the fields EDGAR has no
    // equivalent for (beta, goodwill). Keeping EDGAR authoritative is what makes
    // the numbers reproducible whether or not Yahoo answers.
    if (yahoo) {
      merged._yahoo = yahoo; // pass raw Yahoo data for debugging

      // Fills a field only where EDGAR TTM did not already supply it. Yahoo's
      // TTM still beats an EDGAR *annual* figure, so it applies whenever the
      // quarterly TTM was incomplete.
      const supplied = new Set(Object.keys(merged._sources || {}));
      const fill = (field, ...candidates) => {
        if (supplied.has(field)) return;
        const value = candidates.find((v) => v != null);
        if (value == null) return;
        merged[field] = value;
        merged._sources = { ...(merged._sources || {}), [field]: 'yahoo' };
      };

      fill('revenue', yahoo.ttmRevenue, yahoo.annualRevenue);
      fill('netIncome', yahoo.ttmNetIncome);
      fill('cfo', yahoo.ttmCFO);
      fill('capex', yahoo.ttmCapex, yahoo.capitalExpenditures);
      fill('cash', yahoo.cashAndShortTermInvestments);
      fill('netBorrowing', yahoo.netBorrowings);
      fill('totalDebt', yahoo.totalDebt);
      fill('stockholdersEquity', yahoo.stockholdersEquity);

      // D&A deliberately stays with EDGAR: Yahoo's includes content
      // amortization, which grossly inflates it for media companies (NFLX).

      // No EDGAR equivalent — always take these from Yahoo when present.
      if (yahoo.goodwill != null) merged.goodwill = yahoo.goodwill;
      if (yahoo.beta != null) merged.beta = yahoo.beta;

    }

    // ── Derived fields ───────────────────────────────────────────────────────
    // Recomputed from whatever the merge settled on. This must sit OUTSIDE the
    // Yahoo block: it previously ran only when Yahoo answered, so with Yahoo
    // down the FCFE the DCF consumes was never rebuilt from the merged inputs.
    // Recompute derived fields that depend on the merged values
    merged.ebitda =
      merged.ebit != null && merged.da != null ? merged.ebit + merged.da : null;

    // FCF = CFO + CapEx (CapEx already negative).
    if (merged.cfo != null && merged.capex != null) {
      merged.fcf = merged.cfo + merged.capex;
    }

    // FCFE = FCF + Net Borrowing
    merged.fcfe =
      merged.cfo != null && merged.capex != null
        ? merged.cfo + merged.capex + (merged.netBorrowing ?? 0)
        : null;

    // NOPAT, Invested Capital, ROIC recompute
    // Use clamped tax rate (0–1) to handle companies with tax benefits.
    // Fall back to 21% US statutory rate when EDGAR lacks tax data.
    const rawTaxRate = merged.taxRate;
    const clampedTaxRate =
      rawTaxRate != null ? Math.max(0, Math.min(1, rawTaxRate)) : 0.21;
    const ebit = merged.ebit;
    merged.nopat =
      ebit != null ? ebit * (1 - clampedTaxRate) : null;

    // Invested Capital = Equity + Debt - Cash - Goodwill
    // Deducting goodwill aligns with StockAnalysis.com's IC methodology.
    // Guard: only deduct goodwill if IC stays positive — negative IC is
    // meaningless for ROIC (e.g. MSCI with buyback-driven negative equity).
    const equity = merged.stockholdersEquity;
    const debt = merged.totalDebt ?? 0;
    const cashVal = merged.cash;
    const goodwillVal = merged.goodwill ?? 0;
    if (equity != null && cashVal != null) {
      const icBase = equity + debt - cashVal;
      // Only deduct goodwill when equity is positive AND the result stays positive.
      // Skip deduction for negative-equity companies (e.g. buyback-driven leveraged
      // balance sheets like MSCI) to avoid artificially tiny denominators.
      const canDeduct = equity >= 0 && goodwillVal > 0 && (icBase - goodwillVal) > 0;
      merged.investedCapital = canDeduct ? icBase - goodwillVal : (icBase > 0 ? icBase : null);
    } else if (
      merged.totalAssets != null &&
      cashVal != null &&
      merged.currentLiabilities != null
    ) {
      // Fallback: TotalAssets - Cash - CurrentLiabilities - Goodwill
      const icBase = merged.totalAssets - cashVal - merged.currentLiabilities;
      const canDeduct = goodwillVal > 0 && (icBase - goodwillVal) > 0;
      merged.investedCapital = canDeduct ? icBase - goodwillVal : (icBase > 0 ? icBase : null);
    }

    merged.roic =
      merged.nopat != null &&
      merged.investedCapital != null &&
      merged.investedCapital !== 0
        ? merged.nopat / merged.investedCapital
        : null;

    // Yahoo-only refinement: a longer FCF history than EDGAR exposes.
    if (yahoo?.fcfHistory?.length >= 6) {
      const sorted = [...yahoo.fcfHistory].sort((a, b) => b.fy - a.fy);
      const latest = sorted[0];
      const target = sorted.find((e) => latest.fy - e.fy >= 5);
      if (target && target.value > 0 && latest.value > 0) {
        const years = latest.fy - target.fy;
        merged.fcfCAGR = Math.pow(latest.value / target.value, 1 / years) - 1;
        merged.fcfHistory = sorted.map((e) => ({ fy: e.fy, fcf: e.value }));
      }
    }

    // Provenance is accumulated during the merge above rather than re-derived
    // here — an independently-written copy of the merge conditions drifts the
    // moment the merge changes, which is how it previously came to claim 'yahoo'
    // for fields Yahoo had not supplied.
    merged._sources = { da: 'edgar', ...(merged._sources || {}) };
    merged._asOf = {
      edgarFiling: edgar.filingDate ?? null,
      edgarTtm: ttm.asOf ?? null,
      yahooTtm: yahoo?.ttmAsOf ?? null,
      yahooCash: yahoo?.cashAsOf ?? null,
    };

    merged.wacc = null; // computed on frontend with price data
    return merged;
    });

    res.json(merged);
  } catch (err) {
    console.error('[financials]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Live price from Yahoo Finance
app.get('/api/price/:ticker', async (req, res) => {
  try {
    const data = await withCache(`price:${req.params.ticker}`, TTL.PRICE, () =>
      getStockPrice(req.params.ticker)
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Historical price series. Query param ?range=1D|5D|1M|6M|YTD|1Y|5Y|MAX
app.get('/api/history/:ticker', async (req, res) => {
  try {
    const range = String(req.query.range || '1Y').toUpperCase();
    const data = await withCache(`history:${req.params.ticker}:${range}`, TTL.HISTORY, () =>
      getPriceHistory(req.params.ticker, range)
    );
    res.json(data);
  } catch (err) {
    console.error('[history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Periodic financials (quarterly or annual). ?period=quarterly|annual&n=8
// Tries EDGAR first (US filers, returns full history) then falls back to Yahoo.
app.get('/api/quarterly/:ticker', async (req, res) => {
  try {
    const n = Math.min(20, Math.max(1, Number(req.query.n) || 8));
    const period = req.query.period === 'annual' ? 'annual' : 'quarterly';
    const cacheKey = `quarterly:${req.params.ticker}:${period}:${n}`;

    const payload = await withCache(cacheKey, TTL.FUNDAMENTALS, async () => {
      // Kick off the Yahoo shares overlay up front — it's independent of the
      // (slow, multi-MB) EDGAR companyfacts fetch, so run them concurrently.
      const sharesPromise = getYahooSharesIssued(req.params.ticker).catch(() => ({}));

      // Try EDGAR for US filers
      let edgarData = null;
      try {
        const company = await getCIKFromTicker(req.params.ticker);
        if (company?.cik) {
          edgarData = await getEdgarPeriodicFinancials(company.cik, period, n);
        }
      } catch {
        edgarData = null;
      }

      if (edgarData?.quarters?.length >= 4) {
        // Overlay Yahoo's balance-sheet shares-issued figures onto EDGAR data.
        // EDGAR's CommonStockSharesIssued can differ from what Yahoo Finance shows;
        // fetching directly from Yahoo guarantees the number matches their balance sheet.
        const yahooShares = await sharesPromise;
        for (const q of edgarData.quarters) {
          const v = yahooShares[q.asOfDate];
          if (v != null) q.quarterlySharesOutstanding = v;
        }
        return {
          ticker: req.params.ticker.toUpperCase(),
          period,
          source: 'edgar',
          quarters: edgarData.quarters,
        };
      }

      // Fallback: Yahoo
      const data = await getPeriodicFinancials(req.params.ticker, n, period);
      return { ...data, source: 'yahoo' };
    });

    res.json(payload);
  } catch (err) {
    console.error('[quarterly]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Analyst estimates (PEG, EPS growth next year, long-term growth)
app.get('/api/estimates/:ticker', async (req, res) => {
  try {
    const data = await withCache(`estimates:${req.params.ticker}`, TTL.FUNDAMENTALS, () =>
      getAnalystEstimates(req.params.ticker)
    );
    res.json(data);
  } catch (err) {
    console.error('[estimates]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Company profile (description, sector, employees, website)
app.get('/api/profile/:ticker', async (req, res) => {
  try {
    const data = await withCache(`profile:${req.params.ticker}`, TTL.FUNDAMENTALS, () =>
      getCompanyProfile(req.params.ticker)
    );
    res.json(data);
  } catch (err) {
    console.error('[profile]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Claude-generated summary of the last 3 months of major moves.
app.get('/api/summary/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker;
    let companyName = null;
    try {
      const company = await getCIKFromTicker(ticker);
      companyName = company?.name || company?.title || null;
    } catch {
      companyName = null;
    }
    const data = await getCompanySummary(ticker, companyName);
    res.json(data);
  } catch (err) {
    console.error('[summary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Gemini-generated summary (free tier with Google Search grounding).
app.get('/api/summary-gemini/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker;
    let companyName = null;
    try {
      const company = await getCIKFromTicker(ticker);
      companyName = company?.name || company?.title || null;
    } catch {
      companyName = null;
    }
    const data = await getCompanySummaryGemini(ticker, companyName);
    res.json(data);
  } catch (err) {
    console.error('[summary-gemini]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Deep-dive research via Gemini (section = overview | segments | proscons)
app.get('/api/deepdive/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker;
    const section = String(req.query.section || 'overview');
    const force = req.query.force === 'true';
    let companyName = null;
    try {
      const company = await getCIKFromTicker(ticker);
      companyName = company?.name || company?.title || null;
    } catch { companyName = null; }
    const data = await getCompanyDeepDive(ticker, section, companyName, force);
    res.json(data);
  } catch (err) {
    console.error('[deepdive]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Autocomplete search
app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const results = await searchCompanies(q);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full ticker list (cached)
app.get('/api/tickers', async (_req, res) => {
  try {
    const tickers = await getCompanyTickers();
    res.json(
      Object.values(tickers).map((e) => ({
        ticker: e.ticker,
        name: e.title,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Serve the built frontend (production) ──
// When a Vite build exists (dist/), serve it and hand every non-API route back
// to the SPA. This makes the whole app one same-origin service — the frontend's
// relative /api calls just work, no CORS. In local dev there's no dist/, so this
// is inert and the Vite dev server + proxy handle the UI.
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
  console.log('[server] serving static build from dist/');
}

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
