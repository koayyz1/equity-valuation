import { PortfolioPosition } from '../types';

export interface PricePoint {
  t: number; // ms epoch
  c: number; // close
}

export interface ReturnsInput {
  positions: PortfolioPosition[];
  currentPrice: Record<string, number | null>; // ticker -> latest price
  histories: Record<string, PricePoint[]>; // ticker -> chronological closes
}

export interface ReturnsResult {
  twrr: number | null; // annualized time-weighted return
  mwrr: number | null; // annualized money-weighted return (XIRR)
  years: number | null; // holding span used
}

const MS_YEAR = 365.25 * 86400000;

function purchaseTime(p: PortfolioPosition): number {
  if (p.purchaseDate) {
    const t = Date.parse(p.purchaseDate);
    if (!Number.isNaN(t)) return t;
  }
  return p.addedAt;
}

// Nearest close on/before `ms`; falls back to the earliest point if `ms`
// predates the series.
function priceAt(series: PricePoint[], ms: number): number | null {
  if (!series.length) return null;
  let best: number | null = null;
  for (const p of series) {
    if (p.t <= ms) best = p.c;
    else break;
  }
  return best ?? series[0].c;
}

// Value a set of holdings at time `ms`. `end` uses live prices instead of history.
function valueAt(
  holdings: PortfolioPosition[],
  ms: number,
  input: ReturnsInput,
  end: boolean
): number | null {
  let total = 0;
  for (const h of holdings) {
    let px: number | null;
    if (end) {
      px = input.currentPrice[h.ticker] ?? priceAt(input.histories[h.ticker] ?? [], ms);
    } else {
      px = priceAt(input.histories[h.ticker] ?? [], ms) ?? h.costBasis;
    }
    if (px == null) return null;
    total += px * h.shares;
  }
  return total;
}

/**
 * Time-weighted return (annualized): break the timeline at each purchase date,
 * value the pre-existing holdings across each sub-period at market prices, and
 * chain (1 + rᵢ). Neutralizes the size/timing of contributions.
 */
function computeTWRR(input: ReturnsInput): number | null {
  const now = Date.now();
  const positions = input.positions;
  if (!positions.length) return null;

  // Unique boundary dates: each distinct purchase time, plus now.
  const times = Array.from(new Set(positions.map(purchaseTime))).sort((a, b) => a - b);
  const first = times[0];
  if (first >= now) return null;
  const boundaries = [...times.filter((t) => t < now), now];

  let chain = 1;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const b0 = boundaries[i];
    const b1 = boundaries[i + 1];
    const held = positions.filter((p) => purchaseTime(p) <= b0);
    if (!held.length) continue;
    const vStart = valueAt(held, b0, input, false);
    const vEnd = valueAt(held, b1, input, b1 === now);
    if (vStart == null || vEnd == null || vStart <= 0) return null;
    chain *= vEnd / vStart;
  }

  const years = (now - first) / MS_YEAR;
  if (years <= 0) return null;
  return Math.pow(chain, 1 / years) - 1;
}

// XIRR via bracketed bisection. Returns the annualized money-weighted rate.
function xirr(cashflows: { t: number; amount: number }[]): number | null {
  if (cashflows.length < 2) return null;
  const t0 = Math.min(...cashflows.map((c) => c.t));
  const npv = (rate: number) =>
    cashflows.reduce((s, c) => s + c.amount / Math.pow(1 + rate, (c.t - t0) / MS_YEAR), 0);

  let lo = -0.9999;
  let hi = 1;
  let flo = npv(lo);
  let fhi = npv(hi);
  // Expand the upper bound for very high IRRs until the sign flips.
  let guard = 0;
  while (flo * fhi > 0 && hi < 10000 && guard < 60) {
    hi *= 2;
    fhi = npv(hi);
    guard++;
  }
  if (flo * fhi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid);
    if (Math.abs(fmid) < 1e-7) return mid;
    if (flo * fmid < 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

function computeMWRR(input: ReturnsInput): number | null {
  const now = Date.now();
  const flows: { t: number; amount: number }[] = [];
  let terminalValue = 0;
  let anyValued = false;
  for (const p of input.positions) {
    flows.push({ t: purchaseTime(p), amount: -(p.shares * p.costBasis) });
    const px = input.currentPrice[p.ticker];
    if (px != null) {
      terminalValue += px * p.shares;
      anyValued = true;
    }
  }
  if (!anyValued) return null;
  flows.push({ t: now, amount: terminalValue });
  return xirr(flows);
}

export function computePortfolioReturns(input: ReturnsInput): ReturnsResult {
  if (!input.positions.length) return { twrr: null, mwrr: null, years: null };
  const now = Date.now();
  const first = Math.min(...input.positions.map(purchaseTime));
  const years = first < now ? (now - first) / MS_YEAR : null;
  return {
    twrr: computeTWRR(input),
    mwrr: computeMWRR(input),
    years,
  };
}
