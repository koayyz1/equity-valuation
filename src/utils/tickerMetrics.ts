import { DCFAssumptions } from '../types';
import { calculateDCF, computeDefaultAssumptions } from './calculations';
import { fetchJson as robustFetchJson } from './fetchJson';

/** A single ticker's headline metrics, used by the Peers and Screener tables. */
export interface TickerMetrics {
  ticker: string;
  name: string | null;
  currency: string;
  price: number | null;
  marketCap: number | null;
  pe: number | null;
  peg: number | null;
  roic: number | null;
  fcfCAGR: number | null;
  earningsYield: number | null;
  fcfeYield: number | null;
  epsGrowthNext: number | null;
  intrinsicMOS: number | null;
  upside: number | null;
}

// Base assumptions used to derive each ticker's data-driven default DCF.
// Mirrors App.tsx's baseAssumptions.
const BASE: DCFAssumptions = {
  growthYears: 5,
  growthRate: 0.15,
  steadyRate: 0.09,
  terminalGrowth: 0.03,
  discountRate: 0.11,
  uncertainty: 2,
  excessCashRatio: 0.02,
  capexOverrides: [null, null, null, null, null],
  netBorrowingOverrides: [null, null, null, null, null],
};

/**
 * Screener/watchlist variant: the shared fetchJson retries the transient edge
 * failures (plain-text "Not Found", 5xx) that show up exactly when this module
 * fans out dozens of concurrent requests. Callers here want a null on failure
 * rather than a throw, so swallow after the retries are exhausted.
 */
const fetchJson = (url: string) => robustFetchJson<any>(url).catch(() => null);

/**
 * Fetch one ticker's headline metrics (price, valuation ratios, returns, and a
 * DCF run on data-driven defaults). Resilient: any failed sub-request leaves the
 * corresponding fields null rather than throwing.
 */
export async function fetchTickerMetrics(ticker: string): Promise<TickerMetrics> {
  const t = ticker.toUpperCase();
  const company = await fetchJson(`/api/company/${encodeURIComponent(t)}`);
  const [price, estimates, fin] = await Promise.all([
    fetchJson(`/api/price/${encodeURIComponent(t)}`),
    fetchJson(`/api/estimates/${encodeURIComponent(t)}`),
    company?.cik
      ? fetchJson(`/api/financials/${company.cik}?ticker=${encodeURIComponent(t)}`)
      : Promise.resolve(null),
  ]);

  const priceVal: number | null = price?.price ?? null;
  const shares: number | null = fin?.shares ?? price?.sharesOutstanding ?? null;
  const marketCap: number | null =
    price?.marketCap ?? (priceVal != null && shares != null ? priceVal * shares : null);
  const currency: string = fin?.currency ?? price?.currency ?? 'USD';

  const pe = estimates?.forwardPE ?? estimates?.trailingPE ?? null;
  const peg = estimates?.pegRatio ?? null;
  const roic = fin?.roic ?? null;
  const fcfCAGR = fin?.fcfCAGR ?? null;
  const earningsYield =
    estimates?.earningsYield ??
    (fin?.netIncome != null && marketCap ? fin.netIncome / marketCap : null);
  const fcfeYield = fin?.fcfe != null && marketCap ? fin.fcfe / marketCap : null;
  const epsGrowthNext = estimates?.epsGrowthNextYear ?? null;

  let intrinsicMOS: number | null = null;
  if (fin && fin.fcfe != null && shares) {
    const def = computeDefaultAssumptions(fin.fcfHistory ?? [], BASE);
    const res = calculateDCF(fin.fcfe, fin.cash ?? null, fin.revenue ?? null, shares, def, {
      capex: fin.capex ?? null,
      netBorrowing: fin.netBorrowing ?? null,
    });
    intrinsicMOS = res.dcfPriceMOS;
  }
  const upside =
    intrinsicMOS != null && priceVal ? (intrinsicMOS - priceVal) / priceVal : null;

  return {
    ticker: t,
    name: company?.name ?? price?.longName ?? null,
    currency,
    price: priceVal,
    marketCap,
    pe,
    peg,
    roic,
    fcfCAGR,
    earningsYield,
    fcfeYield,
    epsGrowthNext,
    intrinsicMOS,
    upside,
  };
}

/**
 * Run `worker` over `items` with bounded concurrency, invoking `onResult` as each
 * settles. Keeps upstream load polite while still parallelizing the I/O.
 */
export async function runPool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  onResult: (item: T, result: R | null) => void,
  shouldStop?: () => boolean
): Promise<void> {
  let i = 0;
  async function next(): Promise<void> {
    if (shouldStop?.()) return;
    const idx = i++;
    if (idx >= items.length) return;
    try {
      onResult(items[idx], await worker(items[idx]));
    } catch {
      onResult(items[idx], null);
    }
    if (shouldStop?.()) return;
    return next();
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => next())
  );
}
