import { describe, it, expect } from 'vitest';
import {
  calculateDCF,
  closedFormDCF,
  calculateFCFY,
  reverseDCFGrowth,
  scenarioAssumptions,
  computeDefaultAssumptions,
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
    growthYears: 5,
    growthRate: 0.1,
    steadyRate: 0.05,
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
    const a = makeAssumptions({ growthRate: 0, steadyRate: 0, terminalGrowth: 0, discountRate: 0.1 });
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
    const a = makeAssumptions({ growthRate: 0.15, steadyRate: 0.08, terminalGrowth: 0.03, discountRate: 0.09 });
    const r = calculateDCF(100, 1000, 1000, 100, a);
    expect(r.phase1PV + r.phase2PV + r.terminalPV + r.excessCash).toBeCloseTo(r.npv, 6);
    expect(r.terminalPV).toBeCloseTo(r.tvRatio! * r.npv, 6);
    expect(r.phase1PV).toBeGreaterThan(0);
    expect(r.phase2PV).toBeGreaterThan(0);
  });
});

describe('closedFormDCF (regression oracle for the 3-stage engine)', () => {
  // The analytic closed form must equal the discrete engine per-term, for every
  // phase length the adaptive rule can pick (n1 = 4, 5, 6). n1 = 5 is the exact
  // form the model documents. Cash flows use the forward-FCFE₁ base, so the
  // closed form (per unit of FCFE₁) scales by fcfe0·(1+g).
  const cases = [
    { g: 0.30, m: 0.165, t: 0.03, R: 0.10, n1: 4 },
    { g: 0.15, m: 0.09, t: 0.03, R: 0.11, n1: 5 },
    { g: 0.06, m: 0.045, t: 0.02, R: 0.08, n1: 6 },
  ];
  for (const c of cases) {
    it(`matches the discrete engine per-term for n1=${c.n1}`, () => {
      const fcfe0 = 100;
      const a = makeAssumptions({
        growthYears: c.n1,
        growthRate: c.g,
        steadyRate: c.m,
        terminalGrowth: c.t,
        discountRate: c.R,
        excessCashRatio: 0,
      });
      // No excess cash, no overrides → pure geometric path.
      const r = calculateDCF(fcfe0, 0, 0, fcfe0, a);
      const cf = closedFormDCF(c.g, c.m, c.t, c.R, c.n1, 10 - c.n1);
      const scale = fcfe0 * (1 + c.g); // forward FCFE₁
      expect(r.phase1PV).toBeCloseTo(cf.phase1 * scale, 4);
      expect(r.phase2PV).toBeCloseTo(cf.phase2 * scale, 4);
      expect(r.terminalPV).toBeCloseTo(cf.terminal * scale, 4);
      expect(r.npv).toBeCloseTo(cf.total * scale, 4);
    });
  }
});

describe('calculateFCFY', () => {
  // With no haircut the hurdle IS the DCF, so the two models must agree exactly
  // (ex excess cash). This is the property the old piecewise fit violated.
  it('reproduces the DCF price exactly at zero terminal haircut', () => {
    for (const g of [0.04, 0.12, 0.25]) {
      const a = makeAssumptions({
        growthRate: g,
        steadyRate: (g + 0.03) / 2,
        terminalGrowth: 0.03,
        discountRate: 0.11,
        growthYears: g < 0.1 ? 6 : g <= 0.2 ? 5 : 4,
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
    const a = makeAssumptions({ growthRate: 0.12, steadyRate: 0.075, terminalHaircut: 0 });
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
    expect(def.growthYears).toBe(5); // 10% → 5 years
    expect(def.steadyRate).toBeCloseTo((0.1 + 0.03) / 2, 6);
    expect(def.terminalGrowth).toBe(0.03);
  });

  it('falls back to 15% growth without a valid window', () => {
    const def = computeDefaultAssumptions([], makeAssumptions());
    expect(def.growthRate).toBe(0.15);
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
