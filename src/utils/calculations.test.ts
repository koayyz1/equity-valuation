import { describe, it, expect } from 'vitest';
import {
  calculateDCF,
  growthPath,
  calculateFCFY,
  reverseDCFGrowth,
  scenarioAssumptions,
  computeDefaultAssumptions,
  GROWTH_BOUNDS,
  DEFAULT_GROWTH_DECAY,
  FALLBACK_GROWTH,
  computeWACC,
  computeROCE,
  computeEarningsYield,
  computeAverageROIC,
  clampTaxRate,
  getMOS,
} from './calculations';
import { DCFAssumptions } from '../types';

// A reusable base assumption set; override per-test as needed.
function makeAssumptions(overrides: Partial<DCFAssumptions> = {}): DCFAssumptions {
  return {
    growthRate: 0.1,
    growthDecay: DEFAULT_GROWTH_DECAY,
    terminalGrowth: 0.02,
    discountRate: 0.1,
    uncertainty: 2,
    excessCashRatio: 0.02,
    capexOverrides: [null, null, null, null, null],
    netBorrowingOverrides: [null, null, null, null, null],
    ...overrides,
  };
}

describe('clampTaxRate', () => {
  it('falls back to 21% when null/undefined', () => {
    expect(clampTaxRate(null)).toBe(0.21);
    expect(clampTaxRate(undefined)).toBe(0.21);
    expect(clampTaxRate(null, 0.3)).toBe(0.3);
  });
  it('clamps into [0, 1]', () => {
    expect(clampTaxRate(1.5)).toBe(1);
    expect(clampTaxRate(-0.5)).toBe(0);
    expect(clampTaxRate(0.27)).toBe(0.27);
  });
});

describe('getMOS', () => {
  it('maps uncertainty levels to haircuts', () => {
    expect(getMOS(1)).toBe(0.05);
    expect(getMOS(2)).toBe(0.1);
    expect(getMOS(3)).toBe(0.15);
    expect(getMOS(4)).toBe(0.2);
  });
});

describe('calculateDCF', () => {
  it('reconstructs a flat perpetuity exactly', () => {
    // Flat FCFE of 100, 0% growth, 0% terminal, 10% discount → perpetuity = 100/0.1 = 1000.
    const a = makeAssumptions({ growthRate: 0, terminalGrowth: 0, discountRate: 0.1 });
    const r = calculateDCF(100, 0, 0, 100, a);
    expect(r.npv).toBeCloseTo(1000, 6);
    expect(r.dcfPrice).toBeCloseTo(10, 6); // 1000 / 100 shares
  });

  it('applies the MOS haircut to the intrinsic price', () => {
    const a = makeAssumptions({ uncertainty: 2 }); // 10% MOS
    const r = calculateDCF(100, 0, 0, 100, a);
    expect(r.dcfPrice).not.toBeNull();
    expect(r.dcfPriceMOS!).toBeCloseTo(r.dcfPrice! * 0.9, 9);
  });

  it('zeros the terminal value when terminal growth ≥ discount rate', () => {
    const a = makeAssumptions({ terminalGrowth: 0.1, discountRate: 0.1 });
    const r = calculateDCF(100, 0, 0, 100, a);
    expect(r.terminalValue).toBe(0);
  });

  it('adds excess cash to NPV beyond the working-capital reserve', () => {
    const a = makeAssumptions();
    const noCash = calculateDCF(100, 0, 1000, 100, a);
    const withCash = calculateDCF(100, 1000, 1000, 100, a);
    // Excess cash = 1000 − 2%·1000 = 980.
    expect(withCash.npv - noCash.npv).toBeCloseTo(980, 6);
  });

  it('is monotonically increasing in the growth rate', () => {
    const low = calculateDCF(100, 0, 0, 100, makeAssumptions({ growthRate: 0.05 }));
    const high = calculateDCF(100, 0, 0, 100, makeAssumptions({ growthRate: 0.15 }));
    expect(high.dcfPrice!).toBeGreaterThan(low.dcfPrice!);
  });

  it('returns nulls when FCFE is missing', () => {
    const r = calculateDCF(null, 0, 0, 100, makeAssumptions());
    expect(r.dcfPrice).toBeNull();
    expect(r.npv).toBe(0);
  });

  it('returns a null price when shares are missing', () => {
    const r = calculateDCF(100, 0, 0, null, makeAssumptions());
    expect(r.dcfPrice).toBeNull();
    expect(r.npv).toBeGreaterThan(0);
  });

  it('splits NPV into three additive PV terms that sum to NPV', () => {
    const a = makeAssumptions({ growthRate: 0.15, terminalGrowth: 0.03, discountRate: 0.09 });
    const r = calculateDCF(100, 1000, 1000, 100, a);
    expect(r.phase1PV + r.phase2PV + r.terminalPV + r.excessCash).toBeCloseTo(r.npv, 6);
    expect(r.terminalPV).toBeCloseTo(r.tvRatio! * r.npv, 6);
    expect(r.phase1PV).toBeGreaterThan(0);
    expect(r.phase2PV).toBeGreaterThan(0);
  });
});

describe('growthPath (fade)', () => {
  it('starts at the full growth rate and converges toward terminal', () => {
    const p = growthPath(0.9, 0.03, 0.7);
    expect(p).toHaveLength(10);
    expect(p[0]).toBeCloseTo(0.9, 12); // year 1 is never capped
    expect(p[9]).toBeGreaterThan(0.03);
    expect(p[9]).toBeLessThan(0.09); // most of the excess has decayed by year 10
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeLessThan(p[i - 1]);
  });

  it('decay = 1 never fades; decay = 0 drops to terminal after year 1', () => {
    expect(growthPath(0.2, 0.03, 1)).toEqual(new Array(10).fill(0.2));
    const none = growthPath(0.2, 0.03, 0);
    expect(none[0]).toBeCloseTo(0.2, 12);
    expect(none.slice(1)).toEqual(new Array(9).fill(0.03));
  });

  it('preserves ordering between companies — a faster grower stays ahead', () => {
    // The old hard clamp collapsed 89% and 31% growers onto an identical path.
    const fast = growthPath(0.89, 0.03, 0.7).reduce((a, g) => a * (1 + g), 1);
    const mid = growthPath(0.31, 0.03, 0.7).reduce((a, g) => a * (1 + g), 1);
    expect(fast).toBeGreaterThan(mid * 2);
  });
});

describe('calculateDCF with a fading path', () => {
  it('reproduces constant-growth compounding when decay = 1', () => {
    // decay=1 disables the fade, so year 10 FCFE must be fcfe0·(1+g)^10 exactly.
    const a = makeAssumptions({ growthRate: 0.12, growthDecay: 1, excessCashRatio: 0 });
    const r = calculateDCF(100, 0, 0, 100, a);
    expect(r.yearlyFCFE[9]).toBeCloseTo(100 * Math.pow(1.12, 10), 6);
  });

  it('is monotonic in growth persistence', () => {
    const at = (d: number) =>
      calculateDCF(100, 0, 0, 100, makeAssumptions({ growthRate: 0.3, growthDecay: d })).dcfPrice!;
    expect(at(0.9)).toBeGreaterThan(at(0.7));
    expect(at(0.7)).toBeGreaterThan(at(0.3));
  });

  it('has no discontinuity as growth crosses the old phase-length thresholds', () => {
    // The retired growthYears rule stepped 6→5→4 at 10% and 20%, which could make
    // value FALL as growth rose. Value must now be strictly increasing in growth.
    const at = (g: number) =>
      calculateDCF(100, 0, 0, 100, makeAssumptions({ growthRate: g })).dcfPrice!;
    for (const edge of [0.10, 0.20]) {
      expect(at(edge + 0.001)).toBeGreaterThan(at(edge - 0.001));
    }
  });

  it('splits PV at a fixed year that does not move with growth', () => {
    const lo = calculateDCF(100, 0, 0, 100, makeAssumptions({ growthRate: 0.05 }));
    const hi = calculateDCF(100, 0, 0, 100, makeAssumptions({ growthRate: 0.30 }));
    for (const r of [lo, hi]) {
      expect(r.phase1PV + r.phase2PV + r.terminalPV + r.excessCash).toBeCloseTo(r.npv, 6);
    }
  });
});

describe('calculateFCFY', () => {
  // With no haircut the hurdle IS the DCF, so the two models must agree exactly
  // (ex excess cash). This is the property the old piecewise fit violated.
  it('reproduces the DCF price exactly at zero terminal haircut', () => {
    for (const g of [0.04, 0.12, 0.25]) {
      const a = makeAssumptions({
        growthRate: g,
        terminalGrowth: 0.03,
        discountRate: 0.11,
        terminalHaircut: 0,
        excessCashRatio: 0,
      });
      const dcf = calculateDCF(100, 0, 0, 100, a);
      const fcfy = calculateFCFY(100, 100, a);
      expect(fcfy.fcfyPrice!).toBeCloseTo(dcf.dcfPrice!, 6);
      expect(fcfy.requiredYield).toBeCloseTo(fcfy.baseYield, 9);
    }
  });

  it('splits the required yield into the three PV terms', () => {
    const a = makeAssumptions({ growthRate: 0.12, terminalHaircut: 0 });
    const r = calculateFCFY(100, 100, a);
    const { phase1, phase2, terminal } = r.terms;
    // F = FCFE₁ / (S₁+S₂+S_T), per unit of FCFE₀
    expect(r.baseYield).toBeCloseTo(1.12 / (phase1 + phase2 + terminal), 9);
    expect(r.terminalShare!).toBeCloseTo(terminal / (phase1 + phase2 + terminal), 9);
  });

  it('raises the hurdle monotonically as the terminal haircut increases', () => {
    const mk = (h: number) => calculateFCFY(100, 100, makeAssumptions({ terminalHaircut: h }));
    const [a, b, c] = [mk(0), mk(0.5), mk(1)];
    expect(b.requiredYield).toBeGreaterThan(a.requiredYield);
    expect(c.requiredYield).toBeGreaterThan(b.requiredYield);
    // A stricter hurdle means a lower fair price.
    expect(b.fcfyPrice!).toBeLessThan(a.fcfyPrice!);
    expect(c.fcfyPrice!).toBeLessThan(b.fcfyPrice!);
    // Haircut only touches the terminal term; the base yield is unchanged.
    expect(b.baseYield).toBeCloseTo(a.baseYield, 9);
  });

  it('compares the actual yield against the hurdle when a market cap is given', () => {
    const a = makeAssumptions({ terminalHaircut: 0.5 });
    const r = calculateFCFY(100, 100, a, 2000);
    expect(r.actualYield!).toBeCloseTo(110 / 2000, 9); // FCFE₁ = 100·(1+0.10)
    // No market cap -> no actual yield, but the hurdle still computes.
    expect(calculateFCFY(100, 100, a).actualYield).toBeNull();
  });
});

describe('reverseDCFGrowth', () => {
  it('round-trips: the implied growth reproduces the price it was derived from', () => {
    const a = makeAssumptions({ growthRate: 0.12 });
    const forward = calculateDCF(100, 0, 0, 100, a);
    const implied = reverseDCFGrowth(100, 0, 0, 100, a, forward.dcfPrice);
    expect(implied!).toBeCloseTo(0.12, 4);
  });

  it('returns null for an unreachable (too-high) target price', () => {
    const a = makeAssumptions();
    const implied = reverseDCFGrowth(100, 0, 0, 100, a, 1e9);
    expect(implied).toBeNull();
  });

  it('returns null when inputs are missing', () => {
    expect(reverseDCFGrowth(null, 0, 0, 100, makeAssumptions(), 10)).toBeNull();
    expect(reverseDCFGrowth(100, 0, 0, null, makeAssumptions(), 10)).toBeNull();
    expect(reverseDCFGrowth(100, 0, 0, 100, makeAssumptions(), null)).toBeNull();
  });
});

describe('scenarioAssumptions', () => {
  it('orders discount and growth rates bear < base < bull appropriately', () => {
    const { bear, base, bull } = scenarioAssumptions(makeAssumptions());
    expect(bear.discountRate).toBeGreaterThan(base.discountRate);
    expect(bull.discountRate).toBeLessThan(base.discountRate);
    expect(bear.growthRate).toBeLessThan(bull.growthRate);
    expect(bear.uncertainty).toBeGreaterThanOrEqual(base.uncertainty);
    expect(bull.uncertainty).toBeLessThanOrEqual(base.uncertainty);
  });

  it('clamps to the slider ranges', () => {
    const { bear, bull } = scenarioAssumptions(makeAssumptions({ growthRate: 0.02, discountRate: 0.06 }));
    expect(bear.growthRate).toBeGreaterThanOrEqual(0);
    expect(bull.discountRate).toBeGreaterThanOrEqual(0.05);
  });
});

describe('computeDefaultAssumptions', () => {
  it('derives growth from a 3-year FCF CAGR', () => {
    // 100 → 133.1 over 3 years = 10% CAGR.
    const def = computeDefaultAssumptions(
      [
        { fy: 2020, fcf: 100 },
        { fy: 2023, fcf: 133.1 },
      ],
      makeAssumptions()
    );
    expect(def.growthRate).toBeCloseTo(0.1, 4);
    expect(def.growthDecay).toBe(DEFAULT_GROWTH_DECAY);
    expect(def.terminalGrowth).toBe(0.03);
  });

  it('falls back to the default growth rate without a valid window', () => {
    const def = computeDefaultAssumptions([], makeAssumptions());
    expect(def.growthRate).toBe(FALLBACK_GROWTH);
  });

  it('bounds only clearly-artifactual CAGRs, leaving real hypergrowth intact', () => {
    // 10x over 3 years ≈ +115%/yr — beyond the artifact guard.
    const artifact = computeDefaultAssumptions(
      [{ fy: 2021, fcf: 1 }, { fy: 2024, fcf: 1000 }],
      makeAssumptions()
    );
    expect(artifact.growthRate).toBe(GROWTH_BOUNDS.max);
    // 89%/yr — genuine hypergrowth — passes through untouched; the fade, not a
    // clamp, is what stops it compounding absurdly.
    const real = computeDefaultAssumptions(
      [{ fy: 2021, fcf: 100 }, { fy: 2024, fcf: 676 }],
      makeAssumptions()
    );
    expect(real.growthRate).toBeGreaterThan(0.85);
    expect(real.growthRate).toBeLessThan(GROWTH_BOUNDS.max);
  });

  it('clamps a collapsing trailing CAGR to the growth floor', () => {
    const def = computeDefaultAssumptions(
      [{ fy: 2021, fcf: 100 }, { fy: 2024, fcf: 10 }],
      makeAssumptions()
    );
    expect(def.growthRate).toBe(GROWTH_BOUNDS.min);
  });

  it('leaves a reasonable CAGR untouched', () => {
    // 1.1^3 over 3 years = exactly 10%/yr, inside the bounds.
    const def = computeDefaultAssumptions(
      [{ fy: 2021, fcf: 100 }, { fy: 2024, fcf: 133.1 }],
      makeAssumptions()
    );
    expect(def.growthRate).toBeCloseTo(0.1, 6);
  });
});

describe('computeWACC', () => {
  it('reduces to cost of equity with no debt', () => {
    const w = computeWACC({ beta: 1, marketCap: 1000, totalDebt: 0, interestExpense: null, taxRate: 0.21 });
    expect(w!).toBeCloseTo(0.0975, 6); // 0.0425 + 1·0.055
  });

  it('blends equity and after-tax debt cost', () => {
    const w = computeWACC({ beta: 1, marketCap: 800, totalDebt: 200, interestExpense: -10, taxRate: 0.25 });
    // Ke·0.8 + Kd·(1−t)·0.2 = 0.0975·0.8 + 0.05·0.75·0.2 = 0.078 + 0.0075
    expect(w!).toBeCloseTo(0.0855, 6);
  });

  it('returns null without beta or a positive market cap', () => {
    expect(computeWACC({ beta: null, marketCap: 1000, totalDebt: 0, interestExpense: null, taxRate: 0.21 })).toBeNull();
    expect(computeWACC({ beta: 1, marketCap: 0, totalDebt: 0, interestExpense: null, taxRate: 0.21 })).toBeNull();
  });
});

describe('computeROCE', () => {
  it('computes NOPAT over invested capital plus excess cash', () => {
    const roce = computeROCE({ ebit: 100, taxRate: 0.25, investedCapital: 400, cash: 100, revenue: 1000 });
    // NOPAT = 75; excess cash = 100 − 20 = 80; denom = 480 → 0.15625
    expect(roce!).toBeCloseTo(0.15625, 6);
  });
  it('returns null without EBIT or invested capital', () => {
    expect(computeROCE({ ebit: null, taxRate: 0.25, investedCapital: 400, cash: 0, revenue: 0 })).toBeNull();
    expect(computeROCE({ ebit: 100, taxRate: 0.25, investedCapital: null, cash: 0, revenue: 0 })).toBeNull();
  });
});

describe('computeEarningsYield', () => {
  it('is net income over market cap', () => {
    expect(computeEarningsYield(50, 1000)!).toBeCloseTo(0.05, 9);
  });
  it('returns null for invalid inputs', () => {
    expect(computeEarningsYield(null, 1000)).toBeNull();
    expect(computeEarningsYield(50, 0)).toBeNull();
  });
});

describe('computeAverageROIC', () => {
  const period = { operatingIncome: 100, equity: 300, debt: 100, cash: 0 };
  it('averages single-period ROICs once enough periods qualify', () => {
    // ROIC = 100·(1−0.21) / 400 = 0.1975
    const roic = computeAverageROIC([period, period], 0.21, 2);
    expect(roic!).toBeCloseTo(0.1975, 6);
  });
  it('returns null below the minimum period count', () => {
    expect(computeAverageROIC([period, period], 0.21, 3)).toBeNull();
  });
  it('skips periods with a non-positive capital base', () => {
    const bad = { operatingIncome: 100, equity: 0, debt: 0, cash: 100 }; // ic = −100
    expect(computeAverageROIC([bad, bad, bad], 0.21, 1)).toBeNull();
  });
});
