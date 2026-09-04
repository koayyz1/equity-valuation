import { describe, it, expect } from 'vitest';
import { computeMaintenanceCapex, resolveEarningsBase } from './ownerEarnings';

const base = {
  capex: -100, da: 60, intangibleAmortization: 10, ppe: 500, revenue: 1000, priorRevenue: 900,
};

describe('computeMaintenanceCapex', () => {
  it('strips intangible amortisation from the D&A run-rate', () => {
    // Acquired intangibles amortise but need no cash replacement.
    expect(computeMaintenanceCapex(base).daMethod).toBe(50); // 60 − 10
  });

  it('infers growth capex from PP&E intensity times revenue growth', () => {
    // 500/1000 × (1000 − 900) = 50 of growth ⇒ 50 maintenance.
    expect(computeMaintenanceCapex(base).intensityMethod).toBe(50);
  });

  it('never claims maintenance exceeded what was actually spent', () => {
    const m = computeMaintenanceCapex({ ...base, capex: -20, da: 60, intangibleAmortization: 0 });
    expect(m.daMethod).toBe(20);
  });

  it('flags a wide spread between the two estimates', () => {
    const narrow = computeMaintenanceCapex(base);
    expect(narrow.wide).toBe(false);
    // Heavy revenue growth ⇒ intensity method sees mostly growth capex.
    const wide = computeMaintenanceCapex({ ...base, priorRevenue: 500 });
    expect(wide.wide).toBe(true);
    expect(wide.low).toBeLessThan(wide.high!);
  });

  it('reports capex/D&A on the ex-intangibles basis', () => {
    expect(computeMaintenanceCapex(base).capexToDa).toBeCloseTo(100 / 50, 9);
  });

  it('degrades to a single method when inputs are missing', () => {
    const m = computeMaintenanceCapex({ ...base, ppe: null });
    expect(m.intensityMethod).toBeNull();
    expect(m.mid).toBe(m.daMethod);
  });
});

describe('resolveEarningsBase', () => {
  const maintenance = computeMaintenanceCapex(base);
  const inputs = { fcfe: 42, cfo: 300, maintenance };

  it('passes FCFE straight through on the fcfe basis', () => {
    expect(resolveEarningsBase('fcfe', inputs)).toBe(42);
  });

  it('is CFO minus maintenance capex on the owner-earnings basis', () => {
    expect(resolveEarningsBase('ownerEarnings', inputs)).toBe(250); // 300 − 50
  });

  it('does not penalise growth capex the way FCFE does', () => {
    // Same company, heavy growth spend: FCFE subtracts all 100, owner earnings
    // only the 50 needed to hold position.
    const fcfeLike = 300 - 100;
    expect(resolveEarningsBase('ownerEarnings', inputs)!).toBeGreaterThan(fcfeLike);
  });

  it('maps the low variant to the most conservative maintenance figure', () => {
    const wide = computeMaintenanceCapex({ ...base, priorRevenue: 500 });
    const i = { fcfe: 42, cfo: 300, maintenance: wide };
    const lo = resolveEarningsBase('ownerEarnings', i, 'low')!;
    const hi = resolveEarningsBase('ownerEarnings', i, 'high')!;
    expect(lo).toBeLessThan(hi); // low value ⇒ higher maintenance charge
  });

  it('falls back to FCFE when CFO or the estimate is unavailable', () => {
    expect(resolveEarningsBase('ownerEarnings', { ...inputs, cfo: null })).toBe(42);
    const none = computeMaintenanceCapex({ ...base, da: null, ppe: null });
    expect(resolveEarningsBase('ownerEarnings', { ...inputs, maintenance: none })).toBe(42);
  });
});
