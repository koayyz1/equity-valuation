/**
 * Capital allocation over a decade, and the return on incrementally invested
 * capital.
 *
 * This answers the question an owner actually asks about management: over the
 * years this business generated cash, where did it go, and what did it buy?
 * Average ROIC describes decisions already embedded in the asset base;
 * incremental ROIC — ΔNOPAT ÷ ΔInvested Capital — is what the *next* retained
 * dollar earns, and is the compounding question.
 */

/** Minimal shape of an annual row; matches the EDGAR periodic response. */
export interface AllocationRow {
  asOfDate: string;
  quarterlyOperatingCashFlow: number | null;
  quarterlyCapitalExpenditure: number | null;
  quarterlyAcquisitions: number | null;
  quarterlyBuybacks: number | null;
  quarterlyDividendsPaid: number | null;
  quarterlyOperatingIncome: number | null;
  quarterlyStockholdersEquity: number | null;
  quarterlyTotalDebt: number | null;
  quarterlyCashCashEquivalentsAndShortTermInvestments: number | null;
  quarterlySharesOutstanding: number | null;
}

export interface AllocationUse {
  key: string;
  label: string;
  /** Positive magnitude of cash deployed. */
  value: number;
  /** Share of cumulative operating cash flow. */
  share: number | null;
  reinvestment: boolean;
}

export interface CapitalAllocationResult {
  years: number;
  from: string | null;
  to: string | null;
  cfoTotal: number | null;
  uses: AllocationUse[];
  totalDeployed: number | null;
  /** Cash generated but not deployed into any of the tracked uses. */
  retained: number | null;
  reinvestedShare: number | null;
  returnedShare: number | null;
  nopatDelta: number | null;
  icDelta: number | null;
  /** ΔNOPAT ÷ ΔInvested Capital — null when capital shrank (meaningless then). */
  incrementalROIC: number | null;
  shareChange: number | null;
  /** True when the share series spans a stock split, making the raw counts
   *  incomparable. EDGAR reports shares as-filed, not split-adjusted. */
  shareDataUnreliable: boolean;
  complete: boolean;
}

const abs = (v: number | null | undefined) => (v == null ? 0 : Math.abs(v));
const investedCapital = (r: AllocationRow): number | null => {
  const e = r.quarterlyStockholdersEquity;
  const d = r.quarterlyTotalDebt;
  const c = r.quarterlyCashCashEquivalentsAndShortTermInvestments;
  if (e == null || c == null) return null;
  const ic = e + (d ?? 0) - c;
  return ic > 0 ? ic : null;
};

export function computeCapitalAllocation(
  annualRows: AllocationRow[],
  taxRate: number | null,
  maxYears = 10
): CapitalAllocationResult {
  const rows = (annualRows || []).slice(0, maxYears);
  const empty: CapitalAllocationResult = {
    years: 0, from: null, to: null, cfoTotal: null, uses: [], totalDeployed: null,
    retained: null, reinvestedShare: null, returnedShare: null,
    nopatDelta: null, icDelta: null, incrementalROIC: null, shareChange: null,
    shareDataUnreliable: false, complete: false,
  };
  if (rows.length < 3) return empty;

  const newest = rows[0];
  const oldest = rows[rows.length - 1];

  // Lumpy lines (acquisitions especially) are absent in years with no activity,
  // so a missing value means zero rather than unknown.
  const total = (f: keyof AllocationRow) =>
    rows.reduce((a, r) => a + abs(r[f] as number | null), 0);

  const cfoTotal = rows.every((r) => r.quarterlyOperatingCashFlow != null)
    ? rows.reduce((a, r) => a + (r.quarterlyOperatingCashFlow as number), 0)
    : null;

  const raw = [
    { key: 'capex', label: 'Capital expenditure', value: total('quarterlyCapitalExpenditure'), reinvestment: true },
    { key: 'acq', label: 'Acquisitions', value: total('quarterlyAcquisitions'), reinvestment: true },
    { key: 'buyback', label: 'Buybacks', value: total('quarterlyBuybacks'), reinvestment: false },
    { key: 'div', label: 'Dividends', value: total('quarterlyDividendsPaid'), reinvestment: false },
  ].filter((u) => u.value > 0);

  const uses: AllocationUse[] = raw.map((u) => ({
    ...u,
    share: cfoTotal && cfoTotal > 0 ? u.value / cfoTotal : null,
  }));
  const totalDeployed = uses.reduce((a, u) => a + u.value, 0);
  const reinvested = uses.filter((u) => u.reinvestment).reduce((a, u) => a + u.value, 0);
  const returned = uses.filter((u) => !u.reinvestment).reduce((a, u) => a + u.value, 0);

  // Outcomes: what the deployed capital produced.
  const t = taxRate != null ? Math.max(0, Math.min(1, taxRate)) : 0.21;
  const nopat = (r: AllocationRow) =>
    r.quarterlyOperatingIncome != null ? r.quarterlyOperatingIncome * (1 - t) : null;
  const nopatEnd = nopat(newest);
  const nopatStart = nopat(oldest);
  const nopatDelta = nopatEnd != null && nopatStart != null ? nopatEnd - nopatStart : null;

  const icEnd = investedCapital(newest);
  const icStart = investedCapital(oldest);
  const icDelta = icEnd != null && icStart != null ? icEnd - icStart : null;

  // Only meaningful when the capital base actually grew; a shrinking base makes
  // the ratio flip sign for reasons that have nothing to do with returns.
  const incrementalROIC =
    nopatDelta != null && icDelta != null && icDelta > 0 ? nopatDelta / icDelta : null;

  // Share counts come from filings as-reported, so a stock split shows up as a
  // step change and would otherwise read as massive issuance — GOOGL's 20:1
  // split made a decade of buybacks look like +1649% dilution. Organic issuance
  // never jumps 50% year over year, so treat that as a split and decline to
  // quote a figure rather than quoting a wrong one.
  const shareSeries = rows
    .map((r) => r.quarterlySharesOutstanding)
    .filter((v): v is number => v != null && v > 0);
  let shareDataUnreliable = false;
  for (let i = 1; i < shareSeries.length; i++) {
    const ratio = shareSeries[i - 1] / shareSeries[i]; // newer ÷ older
    if (ratio >= 1.5 || ratio <= 1 / 1.5) shareDataUnreliable = true;
  }
  const shEnd = newest.quarterlySharesOutstanding;
  const shStart = oldest.quarterlySharesOutstanding;
  const shareChange =
    !shareDataUnreliable && shEnd != null && shStart != null && shStart > 0
      ? shEnd / shStart - 1
      : null;

  return {
    years: rows.length,
    from: oldest.asOfDate,
    to: newest.asOfDate,
    cfoTotal,
    uses,
    totalDeployed,
    retained: cfoTotal != null ? cfoTotal - totalDeployed : null,
    reinvestedShare: cfoTotal && cfoTotal > 0 ? reinvested / cfoTotal : null,
    returnedShare: cfoTotal && cfoTotal > 0 ? returned / cfoTotal : null,
    nopatDelta,
    icDelta,
    incrementalROIC,
    shareChange,
    shareDataUnreliable,
    complete: cfoTotal != null && uses.length > 0,
  };
}
