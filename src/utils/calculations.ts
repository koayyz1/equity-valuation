import { DCFAssumptions, DCFResult, FCFYResult, UncertaintyLevel } from '../types';

/**
 * Compute data-driven default DCF assumptions from a company's FCF history.
 *
 * Rules:
 *  - growthRate  = 3-year FCF CAGR (falls back to whatever years are available)
 *                  Falls back to 15% if no valid positive-to-positive window found.
 *  - growthYears = 6 if growthRate < 10%, 5 if 10–20%, 4 if > 20%
 *  - steadyRate  = simple average of growthRate and 3%
 *  - terminalGrowth = 3% (fixed)
 *  - All other fields kept from the supplied base assumptions.
 */
export function computeDefaultAssumptions(
  fcfHistory: { fy: number; fcf: number }[],
  base: DCFAssumptions,
): DCFAssumptions {
  let growthRate = 0.15; // fallback

  if (fcfHistory && fcfHistory.length >= 2) {
    const sorted = [...fcfHistory].sort((a, b) => b.fy - a.fy);
    const latest = sorted[0];

    // Prefer an entry ~3 years back; settle for anything older if needed
    const target =
      sorted.find((e) => latest.fy - e.fy >= 3) ??
      sorted[sorted.length - 1];

    const years = latest.fy - target.fy;
    if (years > 0 && latest.fcf > 0 && target.fcf > 0) {
      const raw = Math.pow(latest.fcf / target.fcf, 1 / years) - 1;
      // Clamp to a sensible range (−50% → +200%)
      growthRate = Math.max(-0.5, Math.min(2.0, raw));
    }
  }

  const growthYears: number =
    growthRate < 0.10 ? 6 :
    growthRate <= 0.20 ? 5 : 4;

  const steadyRate = (growthRate + 0.03) / 2;

  return {
    ...base,
    growthRate,
    growthYears,
    steadyRate,
    terminalGrowth: 0.03,
  };
}

/** Clamp a tax rate into [0, 1]; fall back to the US statutory 21% when missing. */
export function clampTaxRate(taxRate: number | null | undefined, fallback = 0.21): number {
  if (taxRate == null) return fallback;
  return Math.max(0, Math.min(1, taxRate));
}

export interface WACCInputs {
  beta: number | null;
  marketCap: number | null;
  totalDebt: number | null;
  interestExpense: number | null;
  taxRate: number | null;
  riskFreeRate?: number;
  equityRiskPremium?: number;
}

/**
 * Weighted Average Cost of Capital.
 *   WACC = Ke·(E/V) + Kd·(1−t)·(D/V)
 *   Ke   = riskFree + beta·ERP            (CAPM)
 *   Kd   = |interest| / debt              (falls back to 5%)
 * Returns null when beta or a positive market cap is unavailable.
 */
export function computeWACC({
  beta,
  marketCap,
  totalDebt,
  interestExpense,
  taxRate,
  riskFreeRate = 0.0425,
  equityRiskPremium = 0.055,
}: WACCInputs): number | null {
  if (beta == null || marketCap == null || marketCap <= 0) return null;
  const debt = totalDebt ?? 0;
  const Ke = riskFreeRate + beta * equityRiskPremium;
  const Kd = interestExpense != null && debt > 0 ? Math.abs(interestExpense) / debt : 0.05;
  const t = taxRate != null && taxRate > 0 ? taxRate : 0.21;
  const V = marketCap + debt;
  return Ke * (marketCap / V) + Kd * (1 - t) * (debt / V);
}

export interface ROCEInputs {
  ebit: number | null;
  taxRate: number | null;
  investedCapital: number | null;
  cash: number | null;
  revenue: number | null;
  excessCashRatio?: number;
}

/**
 * Return on Capital Employed = NOPAT / (Invested Capital + Excess Cash).
 * Excess cash uses the same working-capital rule as the DCF (default 2% of revenue).
 */
export function computeROCE({
  ebit,
  taxRate,
  investedCapital,
  cash,
  revenue,
  excessCashRatio = 0.02,
}: ROCEInputs): number | null {
  const nopat = ebit != null ? ebit * (1 - clampTaxRate(taxRate)) : null;
  const excessCash =
    cash != null && revenue != null ? Math.max(0, cash - excessCashRatio * revenue) : 0;
  const denom = investedCapital != null ? investedCapital + excessCash : null;
  return nopat != null && denom != null && denom > 0 ? nopat / denom : null;
}

/** Earnings yield = Net Income / Market Cap (null when inputs are missing/invalid). */
export function computeEarningsYield(
  netIncome: number | null,
  marketCap: number | null
): number | null {
  return netIncome != null && marketCap != null && marketCap > 0 ? netIncome / marketCap : null;
}

export interface ROICPeriod {
  operatingIncome: number | null;
  equity: number | null;
  debt: number | null;
  cash: number | null;
}

/**
 * Average single-period ROIC across periods, where each period's ROIC is
 * NOPAT / (Equity + Debt − Cash). Periods with a non-positive capital base are
 * skipped; returns null unless at least `minPeriods` valid periods remain.
 */
export function computeAverageROIC(
  periods: ROICPeriod[],
  taxRate: number | null,
  minPeriods = 3
): number | null {
  const t = clampTaxRate(taxRate);
  const roics: number[] = [];
  for (const p of periods) {
    if (p.operatingIncome != null && p.equity != null && p.debt != null && p.cash != null) {
      const ic = p.equity + p.debt - p.cash;
      if (ic > 0) roics.push((p.operatingIncome * (1 - t)) / ic);
    }
  }
  return roics.length >= minPeriods
    ? roics.reduce((a, b) => a + b, 0) / roics.length
    : null;
}

const MOS_MAP: Record<UncertaintyLevel, number> = {
  1: 0.05,
  2: 0.10,
  3: 0.15,
  4: 0.20,
};

export function getMOS(level: UncertaintyLevel): number {
  return MOS_MAP[level] ?? 0.3;
}

export const UNCERTAINTY_LABELS: Record<UncertaintyLevel, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Very High',
};

/**
 * 10-year, 3-phase DCF.
 *   Y1..growthYears    -> growthRate
 *   (growthYears+1)..10 -> steadyRate
 *   Terminal via Gordon Growth
 *
 * Optional year-by-year CapEx and Net Borrowing overrides (Y1..Y5) adjust the
 * projected FCFE away from the pure growth-rate path by the delta from the
 * base-year component.
 */
export function calculateDCF(
  fcfe0: number | null,
  cash: number | null,
  revenue: number | null,
  shares: number | null,
  assumptions: DCFAssumptions,
  baseComponents?: { capex: number | null; netBorrowing: number | null }
): DCFResult {
  const {
    growthYears,
    growthRate,
    steadyRate,
    terminalGrowth,
    discountRate,
    uncertainty,
    excessCashRatio,
    capexOverrides,
    netBorrowingOverrides,
  } = assumptions;

  const mos = getMOS(uncertainty);
  const empty: DCFResult = {
    yearlyFCFE: [],
    terminalValue: 0,
    npv: 0,
    excessCash: 0,
    dcfPrice: null,
    dcfPriceMOS: null,
    tvRatio: null,
  };

  if (fcfe0 == null) return empty;

  const excessCash =
    cash != null && revenue != null ? Math.max(0, cash - excessCashRatio * revenue) : 0;

  const baseCapex = baseComponents?.capex ?? 0;
  const baseNB = baseComponents?.netBorrowing ?? 0;

  const yearlyFCFE: number[] = [];
  let prev = fcfe0;
  for (let y = 1; y <= 10; y++) {
    const rate = y <= growthYears ? growthRate : steadyRate;
    let fcfe = prev * (1 + rate);

    // Apply year-by-year overrides for years 1..5 only.
    if (y <= 5) {
      const capexOv = capexOverrides?.[y - 1];
      const nbOv = netBorrowingOverrides?.[y - 1];
      if (capexOv != null) fcfe += capexOv - baseCapex;
      if (nbOv != null) fcfe += nbOv - baseNB;
    }

    yearlyFCFE.push(fcfe);
    prev = fcfe;
  }

  const fcfeY10 = yearlyFCFE[9];
  const terminalValue =
    terminalGrowth >= discountRate
      ? 0
      : (fcfeY10 * (1 + terminalGrowth)) / (discountRate - terminalGrowth);

  let npvFCFE = 0;
  for (let y = 1; y <= 10; y++) {
    npvFCFE += yearlyFCFE[y - 1] / Math.pow(1 + discountRate, y);
  }
  const npvTV = terminalValue / Math.pow(1 + discountRate, 10);
  const npv = npvFCFE + npvTV + excessCash;
  const tvRatio = npv > 0 ? npvTV / npv : null;

  let dcfPrice: number | null = null;
  let dcfPriceMOS: number | null = null;
  if (shares != null && shares > 0) {
    dcfPrice = npv / shares;
    dcfPriceMOS = dcfPrice * (1 - mos);
  }

  return { yearlyFCFE, terminalValue, npv, excessCash, dcfPrice, dcfPriceMOS, tvRatio };
}

/**
 * Forward FCF Yield model. Piecewise linear approximation mapping
 * {discount rate R, blended growth g} -> min required FCF yield today.
 *
 *   g <= 8%:       y = (R + 0.03) - 0.40 g
 *   8% < g <= 15%: y = (R + 0.01) - 0.29 g
 *   g > 15%:       y = (R + 0.03) - 0.33 g
 */
export function calculateFCFY(
  fcfe0: number | null,
  shares: number | null,
  assumptions: DCFAssumptions
): FCFYResult {
  const { growthYears, growthRate, steadyRate, discountRate, uncertainty } = assumptions;
  const mos = getMOS(uncertainty);
  const R = discountRate;

  const blendedGrowth =
    (growthYears * growthRate + (10 - growthYears) * steadyRate) / 10;

  let minYield: number;
  if (blendedGrowth <= 0.08) minYield = R + 0.03 - 0.4 * blendedGrowth;
  else if (blendedGrowth <= 0.15) minYield = R + 0.01 - 0.29 * blendedGrowth;
  else minYield = R + 0.03 - 0.33 * blendedGrowth;

  const fcfeY1 = fcfe0 != null ? fcfe0 * (1 + growthRate) : null;
  let fcfyPrice: number | null = null;
  let fcfyPriceMOS: number | null = null;
  if (fcfeY1 != null && shares != null && shares > 0 && minYield > 0) {
    fcfyPrice = fcfeY1 / minYield / shares;
    fcfyPriceMOS = fcfyPrice * (1 - mos);
  }

  return { minYield, blendedGrowth, fcfyPrice, fcfyPriceMOS };
}

/**
 * Reverse DCF: solve for the growth-phase FCFE growth rate that the current
 * market price implies, holding every other assumption (steady rate, terminal
 * growth, discount rate, growth years) fixed.
 *
 * Intrinsic value is monotonically increasing in the growth rate, so we binary
 * search. Returns the implied annual growth rate, or null when the target price
 * is unreachable within the search bounds (−90% … +500%).
 */
export function reverseDCFGrowth(
  fcfe0: number | null,
  cash: number | null,
  revenue: number | null,
  shares: number | null,
  assumptions: DCFAssumptions,
  targetPrice: number | null,
  baseComponents?: { capex: number | null; netBorrowing: number | null }
): number | null {
  if (
    fcfe0 == null ||
    shares == null ||
    shares <= 0 ||
    targetPrice == null ||
    targetPrice <= 0
  ) {
    return null;
  }

  const priceAt = (g: number) =>
    calculateDCF(
      fcfe0,
      cash,
      revenue,
      shares,
      { ...assumptions, growthRate: g },
      baseComponents
    ).dcfPrice;

  let lo = -0.9;
  let hi = 5.0;
  const pLo = priceAt(lo);
  const pHi = priceAt(hi);
  if (pLo == null || pHi == null) return null;

  // Target below even the floor → implied growth is below −90% (treat as floor).
  if (targetPrice <= pLo) return lo;
  // Target above the ceiling → implied growth exceeds +500% (unreachable).
  if (targetPrice >= pHi) return null;

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const pMid = priceAt(mid);
    if (pMid == null) return null;
    if (pMid < targetPrice) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const clampRange = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/**
 * Derive Bear / Base / Bull assumption sets from a base case. Bear lowers growth
 * and terminal rates, raises the discount rate, and widens the margin of safety;
 * Bull does the opposite. Base is returned unchanged. All values are clamped to
 * the same ranges the sliders enforce.
 */
export function scenarioAssumptions(base: DCFAssumptions): {
  bear: DCFAssumptions;
  base: DCFAssumptions;
  bull: DCFAssumptions;
} {
  const bear: DCFAssumptions = {
    ...base,
    growthRate: clampRange(base.growthRate - 0.05, 0, 0.5),
    steadyRate: clampRange(base.steadyRate - 0.03, 0, 0.5),
    terminalGrowth: clampRange(base.terminalGrowth - 0.01, 0, 0.05),
    discountRate: clampRange(base.discountRate + 0.015, 0.05, 0.2),
    uncertainty: Math.min(4, base.uncertainty + 1) as UncertaintyLevel,
  };
  const bull: DCFAssumptions = {
    ...base,
    growthRate: clampRange(base.growthRate + 0.05, 0, 0.5),
    steadyRate: clampRange(base.steadyRate + 0.02, 0, 0.5),
    terminalGrowth: clampRange(base.terminalGrowth + 0.005, 0, 0.05),
    discountRate: clampRange(base.discountRate - 0.01, 0.05, 0.2),
    uncertainty: Math.max(1, base.uncertainty - 1) as UncertaintyLevel,
  };
  return { bear, base: { ...base }, bull };
}
