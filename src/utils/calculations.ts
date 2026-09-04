import { DCFAssumptions, DCFResult, FCFYResult, UncertaintyLevel } from '../types';

/** Bounds on the data-derived growth-phase rate. A trailing FCF CAGR is a noisy
 *  estimator — free cash flow is lumpy, so a single heavy-capex year at either
 *  endpoint can swing it wildly. Left unbounded it produced 89%/yr for NVDA and
 *  −18%/yr for KO, neither of which is a defensible multi-year assumption. */
export const GROWTH_BOUNDS = { min: -0.05, max: 0.25 };
/** Steady phase is a fade toward terminal, so it is bounded more tightly still. */
export const STEADY_BOUNDS = { min: -0.02, max: 0.12 };
/** Used when no positive-to-positive FCF window exists (was 15%, near the top of
 *  the observed range; 8% sits close to the large-cap median). */
export const FALLBACK_GROWTH = 0.08;

/**
 * Compute data-driven default DCF assumptions from a company's FCF history.
 *
 * Rules:
 *  - growthRate  = 3-year FCF CAGR (falls back to whatever years are available),
 *                  clamped to GROWTH_BOUNDS. Falls back to FALLBACK_GROWTH if no
 *                  valid positive-to-positive window is found.
 *  - growthYears = 6 if growthRate < 10%, 5 if 10–20%, 4 if > 20%
 *  - steadyRate  = midpoint of growthRate and terminal, clamped to STEADY_BOUNDS
 *  - terminalGrowth = 3% (fixed)
 *  - All other fields kept from the supplied base assumptions.
 */
export function computeDefaultAssumptions(
  fcfHistory: { fy: number; fcf: number }[],
  base: DCFAssumptions,
): DCFAssumptions {
  let growthRate = FALLBACK_GROWTH;

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
      growthRate = clampRange(raw, GROWTH_BOUNDS.min, GROWTH_BOUNDS.max);
    }
  }

  const growthYears: number =
    growthRate < 0.10 ? 6 :
    growthRate <= 0.20 ? 5 : 4;

  const terminalGrowth = 0.03;
  // Steady phase fades from the growth rate toward terminal.
  const steadyRate = clampRange(
    (growthRate + terminalGrowth) / 2,
    STEADY_BOUNDS.min,
    STEADY_BOUNDS.max
  );

  return {
    ...base,
    growthRate,
    growthYears,
    steadyRate,
    terminalGrowth,
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
    phase1PV: 0,
    phase2PV: 0,
    terminalPV: 0,
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

  // Split the discounted FCFE into the growth phase (yrs 1..growthYears) and the
  // steady phase (yrs growthYears+1..10) — the first two additive terms of the
  // closed-form DCF. Uses the actual override-adjusted cash flows, so the three
  // terms plus excess cash always sum to NPV.
  let phase1PV = 0;
  let phase2PV = 0;
  for (let y = 1; y <= 10; y++) {
    const disc = yearlyFCFE[y - 1] / Math.pow(1 + discountRate, y);
    if (y <= growthYears) phase1PV += disc;
    else phase2PV += disc;
  }
  const terminalPV = terminalValue / Math.pow(1 + discountRate, 10);
  const npv = phase1PV + phase2PV + terminalPV + excessCash;
  const tvRatio = npv > 0 ? terminalPV / npv : null;

  let dcfPrice: number | null = null;
  let dcfPriceMOS: number | null = null;
  if (shares != null && shares > 0) {
    dcfPrice = npv / shares;
    dcfPriceMOS = dcfPrice * (1 - mos);
  }

  return {
    yearlyFCFE,
    terminalValue,
    npv,
    excessCash,
    dcfPrice,
    dcfPriceMOS,
    tvRatio,
    phase1PV,
    phase2PV,
    terminalPV,
  };
}

/**
 * Closed-form present value of the 3-stage DCF, expressed per unit of forward
 * FCFE (year-1 cash flow = 1). Returns the three additive terms of
 *
 *   D = Phase1 PV + Phase2 PV + Terminal PV
 *
 * with n1 growth years at rate g, n2 steady years at m, and Gordon terminal at
 * t, discounted at R. Equivalent to summing calculateDCF's geometric cash flows
 * analytically (verified in the test-suite). Not used at runtime — the discrete
 * engine is authoritative because it also carries per-year overrides and excess
 * cash — but kept as documentation and a regression oracle. Undefined at the
 * singular points g=R, m=R, or t=R.
 */
export function closedFormDCF(
  g: number,
  m: number,
  t: number,
  R: number,
  n1 = 5,
  n2 = 5
): { phase1: number; phase2: number; terminal: number; total: number } {
  const phase1 = (1 - Math.pow((1 + g) / (1 + R), n1)) / (R - g);
  const phase2 =
    (Math.pow(1 + g, n1 - 1) / Math.pow(1 + R, n1)) *
    ((1 + m) / (R - m)) *
    (1 - Math.pow((1 + m) / (1 + R), n2));
  const terminal =
    (Math.pow(1 + g, n1 - 1) * Math.pow(1 + m, n2) * (1 + t)) /
    ((R - t) * Math.pow(1 + R, n1 + n2));
  return { phase1, phase2, terminal, total: phase1 + phase2 + terminal };
}

/** Default share of terminal value discarded when setting the FCFY hurdle. */
export const DEFAULT_TERMINAL_HAIRCUT = 0.5;

/**
 * Forward FCF Yield model — expressed as a yield hurdle rather than a rival price.
 *
 * The required yield is derived exactly from the DCF, not fitted:
 *
 *   F = FCFE₁ / (S₁ + S₂ + S_T)
 *
 * where S₁/S₂/S_T are the growth-phase, steady-phase and terminal present values.
 * At terminalHaircut = 0 this reproduces the DCF price exactly (ex excess cash),
 * so the two models can no longer silently disagree. The haircut then discards a
 * stated fraction of S_T, making FCFY a deliberately stricter hurdle — "what would
 * I pay if I only part-credit the perpetuity?" — with the conservatism as a visible,
 * tunable assumption instead of hardcoded constants.
 *
 * This replaces an earlier piecewise-linear fit whose intercepts sat above the
 * discount rate; measured against the DCF it ran 1.5–2.6x low with a discontinuity
 * at the band boundaries. See the Methodology tab for the comparison.
 */
export function calculateFCFY(
  fcfe0: number | null,
  shares: number | null,
  assumptions: DCFAssumptions,
  marketCap?: number | null
): FCFYResult {
  const { growthYears, growthRate, steadyRate, uncertainty } = assumptions;
  const mos = getMOS(uncertainty);
  const haircut = Math.max(
    0,
    Math.min(1, assumptions.terminalHaircut ?? DEFAULT_TERMINAL_HAIRCUT)
  );

  const blendedGrowth = (growthYears * growthRate + (10 - growthYears) * steadyRate) / 10;

  // Required yield is the DCF's own implied forward yield — F = FCFE₁/(S₁+S₂+S_T)
  // — evaluated on a unit basis (FCFE₀ = 1, no cash, no per-year overrides) so it
  // is scale-free. Running it through the discrete engine rather than the closed
  // form keeps every edge case consistent with the DCF (terminal zeroed when
  // t ≥ R, g = R, the adaptive growth-phase length).
  const unit = calculateDCF(1, 0, 0, 1, {
    ...assumptions,
    capexOverrides: undefined,
    netBorrowingOverrides: undefined,
  });
  const fcfe1Unit = 1 + growthRate;
  const s1 = unit.phase1PV;
  const s2 = unit.phase2PV;
  const sT = unit.terminalPV;
  const baseSum = s1 + s2 + sT;
  // Conservatism: discard part of the terminal term, the least reliable piece.
  const adjSum = s1 + s2 + sT * (1 - haircut);

  const baseYield = baseSum > 0 ? fcfe1Unit / baseSum : NaN;
  const requiredYield = adjSum > 0 ? fcfe1Unit / adjSum : NaN;

  const fcfeY1 = fcfe0 != null ? fcfe0 * (1 + growthRate) : null;
  let fcfyPrice: number | null = null;
  let fcfyPriceMOS: number | null = null;
  if (
    fcfeY1 != null &&
    shares != null &&
    shares > 0 &&
    requiredYield > 0 &&
    Number.isFinite(requiredYield)
  ) {
    fcfyPrice = fcfeY1 / requiredYield / shares;
    fcfyPriceMOS = fcfyPrice * (1 - mos);
  }

  const actualYield =
    fcfeY1 != null && marketCap != null && marketCap > 0 ? fcfeY1 / marketCap : null;
  const clearsHurdle =
    actualYield != null && Number.isFinite(requiredYield) ? actualYield >= requiredYield : null;

  return {
    requiredYield,
    baseYield,
    terminalHaircut: haircut,
    terms: { phase1: s1, phase2: s2, terminal: sT },
    terminalShare: baseSum > 0 ? sT / baseSum : null,
    actualYield,
    clearsHurdle,
    blendedGrowth,
    fcfyPrice,
    fcfyPriceMOS,
  };
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
