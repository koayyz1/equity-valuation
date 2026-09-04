import { describe, it, expect } from 'vitest';
import { buildPeriodsFromFacts } from './historical.js';

/**
 * EDGAR companyfacts shape:
 *   facts[taxonomy][tag].units[unit] = [{ start, end, val, form, filed }]
 *
 * Two reporting styles matter here, and conflating them is the classic way this
 * pipeline breaks:
 *   - income-statement items (revenue, net income, EPS) arrive as DISCRETE
 *     quarters — each entry spans its own ~3 months;
 *   - cash-flow items (CFO, CapEx, working capital, SBC, debt) arrive
 *     YEAR-TO-DATE — every entry starts at the fiscal-year start, so they must
 *     be differenced. Those metrics carry `ytd: true` in METRIC_DEF.
 */
const FILED = '2024-11-01';
const Q_ENDS = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31'];
const FY_START = '2024-01-01';
const Q_STARTS = ['2024-01-01', '2024-04-01', '2024-07-01', '2024-10-01'];

/** Discrete quarterly entries — income-statement style. */
const discrete = (vals, filed = FILED) => ({
  units: {
    USD: vals.map((val, i) => ({ start: Q_STARTS[i], end: Q_ENDS[i], val, filed })),
  },
});

/** Cumulative year-to-date entries — cash-flow-statement style. */
const ytd = (cumulative, fyStart = FY_START, ends = Q_ENDS, filed = FILED) => ({
  units: {
    USD: cumulative.map((val, i) => ({ start: fyStart, end: ends[i], val, filed })),
  },
});

/** Point-in-time balances — balance-sheet style (no start date). */
const balance = (val, ends = Q_ENDS) => ({
  units: { USD: ends.map((end) => ({ end, val, filed: FILED })) },
});

/** Revenue is enough to make the four period dates selectable. */
const REVENUE = { RevenueFromContractWithCustomerExcludingAssessedTax: discrete([100, 110, 120, 130]) };
const facts = (extra = {}) => ({ 'us-gaap': { ...REVENUE, ...extra } });
const rowAt = (out, date) => out.quarters.find((r) => r.asOfDate === date);

describe('reporting styles', () => {
  it('reads income-statement items as discrete quarters', () => {
    const out = buildPeriodsFromFacts(facts(), 'quarterly', 4);
    expect(rowAt(out, '2024-03-31').quarterlyTotalRevenue).toBeCloseTo(100, 6);
    expect(rowAt(out, '2024-12-31').quarterlyTotalRevenue).toBeCloseTo(130, 6);
  });

  it('differences cumulative YTD cash-flow items into single quarters', () => {
    // CFO reported YTD as 40 / 80 / 120 / 160 → quarters of 40 each.
    const out = buildPeriodsFromFacts(
      facts({ NetCashProvidedByUsedInOperatingActivities: ytd([40, 85, 135, 200]) }),
      'quarterly',
      4
    );
    expect(rowAt(out, '2024-03-31').quarterlyOperatingCashFlow).toBeCloseTo(40, 6);
    expect(rowAt(out, '2024-06-30').quarterlyOperatingCashFlow).toBeCloseTo(45, 6);
    expect(rowAt(out, '2024-09-30').quarterlyOperatingCashFlow).toBeCloseTo(50, 6);
    expect(rowAt(out, '2024-12-31').quarterlyOperatingCashFlow).toBeCloseTo(65, 6);
  });

  it('does not difference a YTD series across a fiscal-year boundary', () => {
    // Q1 of the new year is its own YTD value, not (YTD − last year's total).
    const prevEnds = ['2023-03-31', '2023-06-30', '2023-09-30', '2023-12-31'];
    const out = buildPeriodsFromFacts(
      {
        'us-gaap': {
          ...REVENUE,
          NetCashProvidedByUsedInOperatingActivities: {
            units: {
              USD: [
                ...ytd([30, 70, 110, 150], '2023-01-01', prevEnds, '2023-11-01').units.USD,
                ...ytd([40, 85, 135, 200]).units.USD,
              ],
            },
          },
        },
      },
      'quarterly',
      8
    );
    expect(rowAt(out, '2024-03-31').quarterlyOperatingCashFlow).toBeCloseTo(40, 6);
  });
});

describe('sign conventions', () => {
  // These are the conventions that had to be hand-verified against reported CFO.
  it('flips CapEx negative from the positive-magnitude tag', () => {
    const out = buildPeriodsFromFacts(
      facts({ PaymentsToAcquirePropertyPlantAndEquipment: ytd([10, 20, 30, 40]) }),
      'quarterly',
      4
    );
    for (const r of out.quarters) expect(r.quarterlyCapitalExpenditure).toBeLessThan(0);
    expect(rowAt(out, '2024-06-30').quarterlyCapitalExpenditure).toBeCloseTo(-10, 6);
  });

  it('negates receivables and inventory builds — a rising balance uses cash', () => {
    const out = buildPeriodsFromFacts(
      facts({
        IncreaseDecreaseInAccountsReceivable: ytd([5, 9, 14, 20]),
        IncreaseDecreaseInInventories: ytd([2, 5, 7, 10]),
      }),
      'quarterly',
      4
    );
    expect(rowAt(out, '2024-03-31').quarterlyChangeReceivables).toBeCloseTo(-5, 6);
    expect(rowAt(out, '2024-03-31').quarterlyChangeInventory).toBeCloseTo(-2, 6);
  });

  it('leaves payables positive — a rising balance is a source of cash', () => {
    const out = buildPeriodsFromFacts(
      facts({ IncreaseDecreaseInAccountsPayable: ytd([3, 7, 11, 15]) }),
      'quarterly',
      4
    );
    expect(rowAt(out, '2024-03-31').quarterlyChangePayables).toBeCloseTo(3, 6);
  });

  it('negates debt repayments and leaves issuance positive', () => {
    const out = buildPeriodsFromFacts(
      facts({
        ProceedsFromIssuanceOfDebt: ytd([50, 50, 50, 50]),
        RepaymentsOfDebt: ytd([8, 16, 24, 32]),
      }),
      'quarterly',
      4
    );
    expect(rowAt(out, '2024-03-31').quarterlyDebtIssued).toBeCloseTo(50, 6);
    expect(rowAt(out, '2024-03-31').quarterlyDebtRepaid).toBeCloseTo(-8, 6);
  });
});

describe('tag chains', () => {
  it('falls back down the chain when the preferred tag is absent', () => {
    // `Revenues` is the second entry in the revenue chain.
    const out = buildPeriodsFromFacts(
      { 'us-gaap': { Revenues: discrete([100, 110, 120, 130]) } },
      'quarterly',
      4
    );
    expect(rowAt(out, '2024-03-31').quarterlyTotalRevenue).toBeCloseTo(100, 6);
  });

  it('prefers the first matching tag over a later one', () => {
    const out = buildPeriodsFromFacts(
      { 'us-gaap': { ...REVENUE, Revenues: discrete([999, 999, 999, 999]) } },
      'quarterly',
      4
    );
    expect(rowAt(out, '2024-03-31').quarterlyTotalRevenue).toBeCloseTo(100, 6);
  });

  it('returns null for a metric with no matching tag rather than throwing', () => {
    const out = buildPeriodsFromFacts(facts(), 'quarterly', 4);
    expect(out.quarters[0].quarterlyStockComp).toBeNull();
    expect(out.quarters[0].quarterlyDebtIssued).toBeNull();
  });

  it('ignores dimensional (segment-level) entries', () => {
    // Segment breakdowns carry a `dim`; only consolidated figures should count.
    const out = buildPeriodsFromFacts(
      {
        'us-gaap': {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [
                ...REVENUE.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD,
                { start: Q_STARTS[0], end: Q_ENDS[0], val: 9999, filed: FILED, dim: 'Segment' },
              ],
            },
          },
        },
      },
      'quarterly',
      4
    );
    expect(rowAt(out, '2024-03-31').quarterlyTotalRevenue).toBeCloseTo(100, 6);
  });
});

describe('derived fields', () => {
  it('derives free cash flow as CFO + CapEx (CapEx already negative)', () => {
    const out = buildPeriodsFromFacts(
      facts({
        NetCashProvidedByUsedInOperatingActivities: ytd([40, 80, 120, 160]),
        PaymentsToAcquirePropertyPlantAndEquipment: ytd([10, 20, 30, 40]),
      }),
      'quarterly',
      4
    );
    const r = rowAt(out, '2024-03-31');
    expect(r.quarterlyOperatingCashFlow).toBeCloseTo(40, 6);
    expect(r.quarterlyCapitalExpenditure).toBeCloseTo(-10, 6);
    expect(r.quarterlyFreeCashFlow).toBeCloseTo(30, 6);
  });

  it('sums long- and short-term debt into total debt', () => {
    const out = buildPeriodsFromFacts(
      facts({ LongTermDebt: balance(100), DebtCurrent: balance(25) }),
      'quarterly',
      4
    );
    expect(rowAt(out, '2024-03-31').quarterlyTotalDebt).toBeCloseTo(125, 6);
  });

  it('returns rows newest-first and honours the requested count', () => {
    const out = buildPeriodsFromFacts(facts(), 'quarterly', 2);
    expect(out.quarters).toHaveLength(2);
    expect(out.quarters[0].asOfDate).toBe('2024-12-31');
    expect(out.quarters[1].asOfDate).toBe('2024-09-30');
  });

  it('survives an empty facts object', () => {
    const out = buildPeriodsFromFacts({}, 'quarterly', 4);
    expect(out.source).toBe('edgar');
    expect(out.quarters).toEqual([]);
  });
});

describe('CFO bridge', () => {
  it('named components reconcile to reported CFO', () => {
    // The FCFE Drivers panel depends on this identity holding for any filer:
    //   net income + D&A + SBC + ΔWC + other = CFO
    const out = buildPeriodsFromFacts(
      facts({
        NetCashProvidedByUsedInOperatingActivities: ytd([40, 80, 120, 160]),
        NetIncomeLoss: discrete([30, 30, 30, 30]),
        DepreciationDepletionAndAmortization: ytd([8, 16, 24, 32]),
        ShareBasedCompensation: ytd([4, 8, 12, 16]),
        IncreaseDecreaseInAccountsReceivable: ytd([5, 10, 15, 20]),
        IncreaseDecreaseInAccountsPayable: ytd([3, 6, 9, 12]),
      }),
      'quarterly',
      4
    );
    const r = rowAt(out, '2024-03-31');
    const named =
      r.quarterlyNetIncome +
      r.quarterlyDepreciationAmortization +
      r.quarterlyStockComp +
      r.quarterlyChangeReceivables +
      r.quarterlyChangePayables;
    // 30 + 8 + 4 − 5 + 3 = 40 = reported CFO, so the residual is zero here.
    expect(named).toBeCloseTo(r.quarterlyOperatingCashFlow, 6);
  });
});
