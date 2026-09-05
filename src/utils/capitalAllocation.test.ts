import { describe, it, expect } from 'vitest';
import { computeCapitalAllocation, AllocationRow } from './capitalAllocation';

const row = (over: Partial<AllocationRow> = {}): AllocationRow => ({
  asOfDate: '2024-12-31',
  quarterlyOperatingCashFlow: 1000,
  quarterlyCapitalExpenditure: -300,
  quarterlyAcquisitions: -100,
  quarterlyBuybacks: -200,
  quarterlyDividendsPaid: 150,
  quarterlyOperatingIncome: 800,
  quarterlyStockholdersEquity: 2000,
  quarterlyTotalDebt: 500,
  quarterlyCashCashEquivalentsAndShortTermInvestments: 300,
  quarterlySharesOutstanding: 1000,
  ...over,
});

describe('computeCapitalAllocation', () => {
  it('sums uses as positive magnitudes regardless of reported sign', () => {
    // Buybacks arrive negative, dividends positive — both are uses of cash.
    const a = computeCapitalAllocation([row(), row(), row()], 0.25);
    const by = Object.fromEntries(a.uses.map((u) => [u.key, u.value]));
    expect(by.capex).toBe(900);
    expect(by.acq).toBe(300);
    expect(by.buyback).toBe(600);
    expect(by.div).toBe(450);
  });

  it('treats a missing lumpy line as zero, not unknown', () => {
    // Acquisitions are absent in years with no deals.
    const a = computeCapitalAllocation(
      [row({ quarterlyAcquisitions: null }), row(), row({ quarterlyAcquisitions: null })],
      0.25
    );
    expect(a.uses.find((u) => u.key === 'acq')!.value).toBe(100);
  });

  it('separates reinvestment from cash returned', () => {
    const a = computeCapitalAllocation([row(), row(), row()], 0.25);
    // (900 + 300) / 3000 reinvested; (600 + 450) / 3000 returned.
    expect(a.reinvestedShare!).toBeCloseTo(1200 / 3000, 9);
    expect(a.returnedShare!).toBeCloseTo(1050 / 3000, 9);
  });

  it('computes incremental ROIC as ΔNOPAT over ΔInvested capital', () => {
    const newest = row({ quarterlyOperatingIncome: 800, quarterlyStockholdersEquity: 2000 });
    const oldest = row({
      asOfDate: '2020-12-31',
      quarterlyOperatingIncome: 400,
      quarterlyStockholdersEquity: 1000,
    });
    const a = computeCapitalAllocation([newest, row(), oldest], 0.25);
    // ΔNOPAT = (800 − 400) × 0.75 = 300; ΔIC = (2000+500−300) − (1000+500−300) = 1000
    expect(a.nopatDelta).toBeCloseTo(300, 9);
    expect(a.icDelta).toBeCloseTo(1000, 9);
    expect(a.incrementalROIC).toBeCloseTo(0.3, 9);
  });

  it('withholds incremental ROIC when the capital base shrank', () => {
    // A shrinking base flips the ratio's sign for reasons unrelated to returns.
    const newest = row({ quarterlyStockholdersEquity: 800 });
    const oldest = row({ asOfDate: '2020-12-31', quarterlyStockholdersEquity: 2000 });
    const a = computeCapitalAllocation([newest, row(), oldest], 0.25);
    expect(a.icDelta!).toBeLessThan(0);
    expect(a.incrementalROIC).toBeNull();
  });

  it('reports share count change, negative when buying back', () => {
    const a = computeCapitalAllocation(
      [row({ quarterlySharesOutstanding: 800 }), row(), row({ quarterlySharesOutstanding: 1000 })],
      0.25
    );
    expect(a.shareChange!).toBeCloseTo(-0.2, 9);
  });

  it('needs at least three years to say anything', () => {
    expect(computeCapitalAllocation([row(), row()], 0.25).complete).toBe(false);
  });

  it('requires every year of CFO before quoting a total', () => {
    const a = computeCapitalAllocation(
      [row({ quarterlyOperatingCashFlow: null }), row(), row()],
      0.25
    );
    expect(a.cfoTotal).toBeNull();
    expect(a.uses.every((u) => u.share === null)).toBe(true);
  });
});

describe('share-count reliability', () => {
  const r = (shares: number, over: Partial<AllocationRow> = {}): AllocationRow => ({
    asOfDate: '2024-12-31', quarterlyOperatingCashFlow: 1000,
    quarterlyCapitalExpenditure: -300, quarterlyAcquisitions: null,
    quarterlyBuybacks: -200, quarterlyDividendsPaid: 150,
    quarterlyOperatingIncome: 800, quarterlyStockholdersEquity: 2000,
    quarterlyTotalDebt: 500, quarterlyCashCashEquivalentsAndShortTermInvestments: 300,
    quarterlySharesOutstanding: shares, ...over,
  });

  it('suppresses the figure when the series spans a split', () => {
    // A 20:1 split makes a decade of buybacks read as enormous dilution.
    const a = computeCapitalAllocation([r(20000), r(20000), r(1000)], 0.25);
    expect(a.shareDataUnreliable).toBe(true);
    expect(a.shareChange).toBeNull();
  });

  it('still reports ordinary buyback-driven shrinkage', () => {
    const a = computeCapitalAllocation([r(900), r(950), r(1000)], 0.25);
    expect(a.shareDataUnreliable).toBe(false);
    expect(a.shareChange!).toBeCloseTo(-0.1, 9);
  });
});
