import { DCFAssumptions, DCFResult, FCFYResult, UncertaintyLevel } from '../types';

/**
 * Sanity bound on the data-derived growth rate. This is an *artifact guard*, not
 * a view on how fast a company may grow: a trailing FCF CAGR divides by a
 * possibly tiny base year, so a heavy-capex year can produce a nonsense figure.
 * Genuine hypergrowth passes through untouched — the fade below is what keeps
 * high rates from compounding absurdly, so this no longer has to do that job and
 * is deliberately wide. (An earlier ±25% clamp flattened NVDA, META and COST to
 * an identical projection, destroying real differences between them.)
 */
export const GROWTH_BOUNDS = { min: -0.5, max: 1.0 };
/** Used when no positive-to-positive FCF window exists. */
export const FALLBACK_GROWTH = 0.08;
/**
 * Default growth persistence. 0.70 means each year retains 70% of the previous
 * year's excess over terminal, so a 30% grower runs 30 → 22 → 16 → 12 → 9 …
 * → terminal. Sustained multi-year growth persistence is empirically rare, so
 * this fades meaningfully; it is exposed as an assumption rather than fixed.
 */
export const DEFAULT_GROWTH_DECAY = 0.7;
/** Projection horizon, and the fixed year at which the PV split is reported.
 *  The split is presentational only — it does not affect value, so unlike the
 *  old adaptive growthYears it cannot create a discontinuity. */
export const PROJECTION_YEARS = 10;
export const PHASE_SPLIT_YEAR = 5;

/**
 * Per-year growth rates fading geometrically from `growthRate` toward
 * `terminalGrowth`:  gₖ = t + (g − t) × decay^(k−1).
 * Year 1 is exactly `growthRate` — nothing is capped.
 */
export function growthPath(
  growthRate: number,
  terminalGrowth: number,
  growthDecay: number,
  years: number = PROJECTION_YEARS
): number[] {
  const decay = clampRange(growthDecay, 0, 1);
  const path: number[] = [];
  for (let k = 1; k <= years; k++) {
    path.push(terminalGrowth + (growthRate - terminalGrowth) * Math.pow(decay, k - 1));
  }
  return path;
}

/**
 * Compute data-driven default DCF assumptions from a company's FCF history.
 *
 * Rules:
 *  - growthRate  = 3-year FCF CAGR (falls back to whatever years are available),
 *                  bounded only against data artifacts (GROWTH_BOUNDS). Falls
 *                  back to FALLBACK_GROWTH if no positive-to-positive window
 *                  exists.
 *  - terminalGrowth = 3% (fixed); growth fades toward it at growthDecay.
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

  return {
    ...base,
    growthRate,
    terminalGrowth: 0.03,
    growthDecay: base.growthDecay ?? DEFAULT_GROWTH_DECAY,
  };
}

/**
 * Cash above the working-capital reserve, i.e. the portion that could in
 * principle be distributed today. Shared by the DCF and ROCE so the two cannot
 * drift apart on what counts as "excess".
 */
export function computeExcessCash(
  cash: number | null,
  revenue: number | null,
  excessCashRatio = 0.02
): number {
  return cash != null && revenue != null ? Math.max(0, cash - excessCashRatio * revenue) : 0;
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
  const excessCash = computeExcessCash(cash, revenue, excessCashRatio);
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
 * 10-year DCF with a fading growth path.
 *   Yₖ FCFE grows at  gₖ = t + (growthRate − t) × growthDecay^(k−1)
 *   Terminal via Gordon Growth on year 10
 *
 * Year 1 receives the full growth rate — nothing is capped — and the rate then
 * converges toward terminal. This replaced a two-phase step (flat growthRate for
 * N years, then flat steadyRate) that could only be tamed by capping growth or
 * shortening the phase, both of which distorted genuine high growers.
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
    growthRate,
    terminalGrowth,
    discountRate,
    uncertainty,
    excessCashRatio,
    capexOverrides,
    netBorrowingOverrides,
  } = assumptions;
  const growthDecay = assumptions.growthDecay ?? DEFAULT_GROWTH_DECAY;

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

  const excessCash = computeExcessCash(cash, revenue, excessCashRatio);

  const baseCapex = baseComponents?.capex ?? 0;
  const baseNB = baseComponents?.netBorrowing ?? 0;

  // Growth fades geometrically from growthRate toward terminal — year 1 gets the
  // full rate, and each later year retains growthDecay of the prior excess.
  const path = growthPath(growthRate, terminalGrowth, growthDecay);

  const yearlyFCFE: number[] = [];
  let prev = fcfe0;
  for (let y = 1; y <= PROJECTION_YEARS; y++) {
    const rate = path[y - 1];
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

  // Split the discounted FCFE at a fixed year for reporting. The boundary is
  // presentational only — value is unaffected by where it sits, so unlike the
  // old adaptive growthYears it cannot make value jump as growth crosses a
  // threshold. Uses the override-adjusted cash flows, so the three terms plus
  // excess cash always sum to NPV.
  let phase1PV = 0;
  let phase2PV = 0;
  for (let y = 1; y <= PROJECTION_YEARS; y++) {
    const disc = yearlyFCFE[y - 1] / Math.pow(1 + discountRate, y);
    if (y <= PHASE_SPLIT_YEAR) phase1PV += disc;
    else phase2PV += disc;
  }
  const terminalPV = terminalValue / Math.pow(1 + discountRate, PROJECTION_YEARS);
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
  const { growthRate, uncertainty } = assumptions;
  const mos = getMOS(uncertainty);
  const haircut = Math.max(
    0,
    Math.min(1, assumptions.terminalHaircut ?? DEFAULT_TERMINAL_HAIRCUT)
  );

  // Required yield is the DCF's own implied forward yield — F = FCFE₁/(S₁+S₂+S_T)
  // — evaluated on a unit basis (FCFE₀ = 1, no cash, no per-year overrides) so it
  // is scale-free. Running it through the discrete engine rather than a closed
  // form keeps every edge case consistent with the DCF (terminal zeroed when
  // t ≥ R, the fading growth path) and means a fade has no closed form to drift
  // from. Note this makes every calculateFCFY call a calculateDCF call: the
  // watchlist therefore runs four projections per row (base, bear, bull, and
  // this one). At ten iterations each, computed once per fetch rather than per
  // render, that is deliberately not worth optimising away.
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
  const decay = base.growthDecay ?? DEFAULT_GROWTH_DECAY;
  // Scenarios now also flex growth *persistence*, which is often the bigger swing
  // factor than the year-1 rate: a bear case fades faster, a bull case holds on.
  const bear: DCFAssumptions = {
    ...base,
    growthRate: clampRange(base.growthRate - 0.05, 0, 1.0),
    growthDecay: clampRange(decay - 0.1, 0, 1),
    terminalGrowth: clampRange(base.terminalGrowth - 0.01, 0, 0.05),
    discountRate: clampRange(base.discountRate + 0.015, 0.05, 0.2),
    uncertainty: Math.min(4, base.uncertainty + 1) as UncertaintyLevel,
  };
  const bull: DCFAssumptions = {
    ...base,
    growthRate: clampRange(base.growthRate + 0.05, 0, 1.0),
    growthDecay: clampRange(decay + 0.1, 0, 1),
    terminalGrowth: clampRange(base.terminalGrowth + 0.005, 0, 0.05),
    discountRate: clampRange(base.discountRate - 0.01, 0.05, 0.2),
    uncertainty: Math.max(1, base.uncertainty - 1) as UncertaintyLevel,
  };
  return { bear, base: { ...base }, bull };
}
