import { Sparkline } from './Sparkline';
import { formatCurrency, currencySymbol } from '../utils/formatting';
import { clampTaxRate } from '../utils/calculations';

// The subset of QuarterRow fields the trends need (annual rows).
export interface AnnualRow {
  asOfDate: string;
  quarterlyTotalRevenue: number | null;
  quarterlyGrossProfit: number | null;
  quarterlyOperatingIncome: number | null;
  quarterlyNetIncome: number | null;
  quarterlyFreeCashFlow: number | null;
  quarterlySharesOutstanding: number | null;
  quarterlyStockholdersEquity: number | null;
  quarterlyTotalDebt: number | null;
  quarterlyCashCashEquivalentsAndShortTermInvestments: number | null;
}

interface Props {
  annualRows: AnnualRow[]; // newest-first
  taxRate: number | null;
  currency: string;
}

type Fmt = 'money' | 'pct' | 'ratio' | 'shares';

interface Metric {
  label: string;
  fmt: Fmt;
  // higher-is-better → the CAGR/Δ badge is green when up (shares is inverted)
  upGood: boolean;
  value: (r: AnnualRow, taxRate: number) => number | null;
}

const METRICS: Metric[] = [
  { label: 'Revenue', fmt: 'money', upGood: true, value: (r) => r.quarterlyTotalRevenue },
  {
    label: 'Gross Margin',
    fmt: 'pct',
    upGood: true,
    value: (r) =>
      r.quarterlyGrossProfit != null && r.quarterlyTotalRevenue
        ? r.quarterlyGrossProfit / r.quarterlyTotalRevenue
        : null,
  },
  {
    label: 'Operating Margin',
    fmt: 'pct',
    upGood: true,
    value: (r) =>
      r.quarterlyOperatingIncome != null && r.quarterlyTotalRevenue
        ? r.quarterlyOperatingIncome / r.quarterlyTotalRevenue
        : null,
  },
  {
    label: 'FCF / Share',
    fmt: 'ratio',
    upGood: true,
    value: (r) =>
      r.quarterlyFreeCashFlow != null && r.quarterlySharesOutstanding
        ? r.quarterlyFreeCashFlow / r.quarterlySharesOutstanding
        : null,
  },
  {
    label: 'ROIC',
    fmt: 'pct',
    upGood: true,
    value: (r, taxRate) => {
      const op = r.quarterlyOperatingIncome;
      const eq = r.quarterlyStockholdersEquity;
      const debt = r.quarterlyTotalDebt;
      const cash = r.quarterlyCashCashEquivalentsAndShortTermInvestments;
      if (op == null || eq == null || debt == null || cash == null) return null;
      const ic = eq + debt - cash;
      return ic > 0 ? (op * (1 - taxRate)) / ic : null;
    },
  },
  {
    // Shares outstanding — falling is good (buybacks); rising is dilution.
    label: 'Shares Out',
    fmt: 'shares',
    upGood: false,
    value: (r) => r.quarterlySharesOutstanding,
  },
];

function fmtVal(v: number | null, fmt: Fmt, currency: string): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (fmt === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (fmt === 'shares') return v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`;
  if (fmt === 'ratio') return `${currencySymbol(currency)}${v.toFixed(2)}`;
  return formatCurrency(v, currency, true);
}

function MiniPanel({
  metric,
  rows,
  taxRate,
  currency,
}: {
  metric: Metric;
  rows: AnnualRow[];
  taxRate: number;
  currency: string;
}) {
  // Oldest → newest values for the sparkline.
  const series = [...rows]
    .reverse()
    .map((r) => metric.value(r, taxRate))
    .filter((v): v is number => v != null && !Number.isNaN(v));

  const latest = series.length ? series[series.length - 1] : null;
  const first = series.length ? series[0] : null;

  // CAGR for money/ratio/shares; simple delta (pp) for margins/ROIC.
  let badge: string | null = null;
  let badgeUp: boolean | null = null;
  if (first != null && latest != null && series.length >= 2) {
    const years = series.length - 1;
    if (metric.fmt === 'pct') {
      const delta = latest - first;
      badge = `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`;
      badgeUp = metric.upGood ? delta >= 0 : delta <= 0;
    } else if (first > 0 && latest > 0) {
      const cagr = Math.pow(latest / first, 1 / years) - 1;
      badge = `${cagr >= 0 ? '+' : ''}${(cagr * 100).toFixed(1)}%/yr`;
      badgeUp = metric.upGood ? cagr >= 0 : cagr <= 0;
    }
  }

  return (
    <div className="bg-gray-950/50 border border-gray-800 rounded-lg px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
          {metric.label}
        </span>
        {badge && (
          <span
            className={`text-[10px] font-mono ${
              badgeUp == null ? 'text-gray-500' : badgeUp ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="font-mono font-semibold text-sm text-gray-100">
          {fmtVal(latest, metric.fmt, currency)}
        </span>
        <Sparkline values={series} stroke="#64748B" width={88} height={22} />
      </div>
    </div>
  );
}

/**
 * Decade-scale small multiples — how a compounder actually gets judged: revenue,
 * margins, FCF/share, ROIC, and share count (buybacks vs dilution) over ~10–15
 * fiscal years. Built entirely from annual EDGAR data already fetched.
 */
export function TenYearTrends({ annualRows, taxRate, currency }: Props) {
  const rows = annualRows.filter((r) => r.quarterlyTotalRevenue != null).slice(0, 15);
  if (rows.length < 4) return null;
  const tax = clampTaxRate(taxRate);
  const yearsCovered = rows.length;

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100">Long-Term Trends</h3>
        <div className="text-[11px] text-gray-500">{yearsCovered} fiscal years · badge = CAGR / Δ</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {METRICS.map((m) => (
          <MiniPanel key={m.label} metric={m} rows={rows} taxRate={tax} currency={currency} />
        ))}
      </div>
    </div>
  );
}
