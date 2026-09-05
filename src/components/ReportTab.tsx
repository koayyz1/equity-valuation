import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { Sparkline } from './Sparkline';
import { formatCurrency, formatDate, currencySymbol } from '../utils/formatting';
import {
  computeEarningsYield,
  computeAverageROIC,
  computeROCE,
  calculateDCF,
} from '../utils/calculations';
import { DCFAssumptions, Overrides } from '../types';
import { CompanyLogo } from './CompanyLogo';
import { ValuationBands, computeValuationBands } from './ValuationBands';
import { TenYearTrends } from './TenYearTrends';
import { ShareholderReturns } from './ShareholderReturns';
import { BalanceSheetResilience } from './BalanceSheetResilience';
import { FcfDrivers } from './FcfDrivers';
import { CapitalAllocation } from './CapitalAllocation';
import { IconChart } from './icons';

type RangeKey = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'MAX';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '1D', label: '24H' },
  { key: '5D', label: '5D' },
  { key: '1M', label: '1M' },
  { key: '6M', label: '6M' },
  { key: 'YTD', label: 'YTD' },
  { key: '1Y', label: '1Y' },
  { key: '5Y', label: '5Y' },
  { key: 'MAX', label: 'Max' },
];

interface PricePoint { t: number; c: number; }

interface HistoryResponse {
  ticker: string;
  range: RangeKey;
  interval: string;
  currency: string;
  price: number | null;
  previousClose: number | null;
  exchange: string | null;
  exchangeTimezone: string | null;
  series: PricePoint[];
}

interface QuarterRow {
  asOfDate: string;
  quarterlyTotalRevenue: number | null;
  quarterlyGrossProfit: number | null;
  quarterlyOperatingIncome: number | null;
  quarterlyNetIncome: number | null;
  quarterlyBasicEPS: number | null;
  quarterlyDilutedEPS: number | null;
  quarterlyOperatingCashFlow: number | null;
  quarterlyFreeCashFlow: number | null;
  quarterlyCapitalExpenditure: number | null;
  quarterlyDepreciationAmortization: number | null;
  quarterlyDebtIssued: number | null;
  quarterlyDebtRepaid: number | null;
  quarterlyChangeReceivables: number | null;
  quarterlyChangeInventory: number | null;
  quarterlyChangePayables: number | null;
  quarterlyStockComp: number | null;
  quarterlyDeferredTax: number | null;
  quarterlyIntangibleAmortization: number | null;
  quarterlyAssetDisposals: number | null;
  quarterlyAcquisitions: number | null;
  quarterlyBuybacks: number | null;
  quarterlyPPE: number | null;
  quarterlyDividendsPaid: number | null;
  quarterlyTotalAssets: number | null;
  quarterlyTotalDebt: number | null;
  quarterlyStockholdersEquity: number | null;
  quarterlyCashCashEquivalentsAndShortTermInvestments: number | null;
  quarterlySharesOutstanding: number | null;
}

interface QuarterlyResponse {
  ticker: string;
  period?: 'quarterly' | 'annual';
  quarters: QuarterRow[];
  error?: string;
}

type PeriodMode = 'quarterly' | 'annual' | 'ttm';

interface ProfileResponse {
  ticker: string;
  longName: string | null;
  description: string | null;
  website: string | null;
  sector: string | null;
  industry: string | null;
  gicsSubIndustryCode: string | null;
  fullTimeEmployees: number | null;
  country: string | null;
  city: string | null;
  fiscalYearEnd: string | null;
  error?: string;
}

interface FinancialsResponse {
  shares: number | null;
  netIncome: number | null;
  cfo: number | null;
  cash: number | null;
  revenue: number | null;
  ebit: number | null;
  taxRate: number | null;
  totalDebt: number | null;
  stockholdersEquity: number | null;
  goodwill: number | null;
  investedCapital: number | null;
  roic: number | null;
  fcfCAGR: number | null;
  fcfe: number | null;
  capex: number | null;
  netBorrowing: number | null;
  ebitda: number | null;
  interestExpense: number | null;
  dividends: number | null;
  currency?: string;
  error?: string;
}

interface EstimatesResponse {
  epsGrowthNextYear: number | null;
  epsGrowthLongTerm: number | null;
  pegRatio: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  earningsYield: number | null;
  roe5y: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  numberOfAnalysts: number | null;
  nextEarningsDate: string | null;
  error?: string;
}

interface PriceResponse {
  price: number | null;
  marketCap: number | null;
  currency: string;
  sharesOutstanding: number | null;
  error?: string;
}

// Derived margin: numerator / denominator from the same (possibly aggregated) row.
const marginOf =
  (num: keyof QuarterRow, den: keyof QuarterRow) =>
  (q: QuarterRow): number | null => {
    const n = q[num] as number | null;
    const d = q[den] as number | null;
    return n != null && d != null && !Number.isNaN(n) && !Number.isNaN(d) && d !== 0 ? n / d : null;
  };

// Metric rows. `flow` rows sum across 4 quarters for TTM; `instant` rows
// (balance-sheet items) take the most recent value as TTM; `derived` rows are
// computed at render time from the row's own (aggregated) values via `compute`.
// `dir` marks rows where an increase is colored green in the % diff.
const METRIC_ROWS: {
  label: string;
  field: string;
  kind: 'currency' | 'eps' | 'shares' | 'percent';
  ttm: 'flow' | 'instant' | 'derived';
  dir?: boolean;
  compute?: (q: QuarterRow) => number | null;
}[] = [
  { label: 'Revenue',            field: 'quarterlyTotalRevenue',                               kind: 'currency', ttm: 'flow',    dir: true },
  { label: 'Gross Profit',       field: 'quarterlyGrossProfit',                                kind: 'currency', ttm: 'flow',    dir: true },
  { label: 'Gross Margin',       field: 'grossMargin',                                         kind: 'percent',  ttm: 'derived', compute: marginOf('quarterlyGrossProfit', 'quarterlyTotalRevenue') },
  { label: 'Operating Income',   field: 'quarterlyOperatingIncome',                            kind: 'currency', ttm: 'flow',    dir: true },
  { label: 'Operating Margin',   field: 'operatingMargin',                                     kind: 'percent',  ttm: 'derived', compute: marginOf('quarterlyOperatingIncome', 'quarterlyTotalRevenue') },
  { label: 'Net Income',         field: 'quarterlyNetIncome',                                  kind: 'currency', ttm: 'flow',    dir: true },
  { label: 'Net Margin',         field: 'netMargin',                                           kind: 'percent',  ttm: 'derived', compute: marginOf('quarterlyNetIncome', 'quarterlyTotalRevenue') },
  { label: 'Diluted EPS',        field: 'quarterlyDilutedEPS',                                 kind: 'eps',      ttm: 'flow',    dir: true },
  { label: 'Operating Cash Flow',field: 'quarterlyOperatingCashFlow',                          kind: 'currency', ttm: 'flow',    dir: true },
  { label: 'CapEx',              field: 'quarterlyCapitalExpenditure',                         kind: 'currency', ttm: 'flow'    },
  { label: 'Free Cash Flow',     field: 'quarterlyFreeCashFlow',                               kind: 'currency', ttm: 'flow'    },
  { label: 'Shares Issued',      field: 'quarterlySharesOutstanding',                          kind: 'shares',   ttm: 'instant' },
  { label: 'Total Assets',       field: 'quarterlyTotalAssets',                                kind: 'currency', ttm: 'instant' },
  { label: 'Total Debt',         field: 'quarterlyTotalDebt',                                  kind: 'currency', ttm: 'instant' },
  { label: 'Stockholders Equity',field: 'quarterlyStockholdersEquity',                         kind: 'currency', ttm: 'instant' },
  { label: 'Cash & ST Invest.',  field: 'quarterlyCashCashEquivalentsAndShortTermInvestments', kind: 'currency', ttm: 'instant' },
];

function formatTick(ts: number, range: RangeKey, tz?: string | null): string {
  const d = new Date(ts);
  const tzOpt = tz ? { timeZone: tz } : {};
  if (range === '1D') {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...tzOpt });
  }
  if (range === '5D' || range === '1M' || range === '6M' || range === 'YTD') {
    // Date-only formatter that respects the exchange timezone
    const parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', ...tzOpt })
      .formatToParts(d);
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    return `${day}/${month}`;
  }
  if (range === '1Y') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', ...tzOpt });
  }
  return d.toLocaleDateString('en-US', { year: 'numeric', ...tzOpt });
}

function formatShares(n: number): string {
  return Math.round(n).toLocaleString();
}

// Format a single metric cell value according to its kind.
function formatCell(
  v: number | null,
  kind: 'currency' | 'eps' | 'shares' | 'percent',
  currency: string
): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (kind === 'eps') return `${currencySymbol(currency)}${v.toFixed(2)}`;
  if (kind === 'shares') return formatShares(v);
  if (kind === 'percent') return `${(v * 100).toFixed(1)}%`;
  return formatCurrency(v, currency, true);
}

// Heatmap tint for a sequential % change — background alpha scales with the
// magnitude of the move so big quarters jump out of the table.
// (Literal class names so Tailwind's scanner generates them.)
function pctTint(pct: number | null, directional: boolean): string {
  if (pct == null || !directional || pct === 0) return '';
  const mag = Math.abs(pct);
  if (pct > 0) {
    return mag >= 0.15 ? 'bg-green-500/20' : mag >= 0.05 ? 'bg-green-500/10' : 'bg-green-500/5';
  }
  return mag >= 0.15 ? 'bg-red-500/20' : mag >= 0.05 ? 'bg-red-500/10' : 'bg-red-500/5';
}

// Chronological values for a metric row's sparkline, from newest-first periods.
function trendValues(
  periods: QuarterRow[],
  m: (typeof METRIC_ROWS)[number]
): number[] {
  return [...periods]
    .reverse()
    .map((q) => (m.compute ? m.compute(q) : (q[m.field as keyof QuarterRow] as number | null)))
    .filter((v): v is number => v != null && !Number.isNaN(v));
}

// Sparklines stay neutral — the line's shape carries the trend; coloring every
// row green/red was part of the color-overuse problem. Saturated green/red is
// reserved for judgments (verdicts, MOS upside), not mere direction.
const SPARK_STROKE = '#64748B';

// Build one aggregated row for a 4-quarter window starting at `start`.
// Flow metrics are summed (null unless all 4 quarters are present); instant
// (balance-sheet) metrics take the value at the window's most recent quarter.
// Derived rows (margins) are skipped — they recompute from the aggregated row.
function buildAggRow(quarters: QuarterRow[], start: number, asOfDate: string): QuarterRow {
  const row = { asOfDate } as Record<string, unknown>;
  for (const m of METRIC_ROWS) {
    if (m.compute) continue;
    const field = m.field as keyof QuarterRow;
    if (m.ttm === 'instant') {
      row[m.field] = quarters[start]?.[field] ?? null;
    } else {
      const vals = quarters
        .slice(start, start + 4)
        .map((q) => q[field] as number | null)
        .filter((v): v is number => v != null && !Number.isNaN(v));
      row[m.field] = vals.length === 4 ? vals.reduce((a, b) => a + b, 0) : null;
    }
  }
  return row as unknown as QuarterRow;
}

interface KeyMetrics {
  marketCap: number | null;
  roic5y: number | null;
  roic1y: number | null;
  roce: number | null;
  roe5y: number | null;
  fcfeYield: number | null;
  fcfGrowth: number | null;
  fcfGrowth5y: number | null;
  earningsYield: number | null;
  epsGrowthNext: number | null;
  dividendPerShare: number | null;
  dividendYield: number | null;
  currentPrice: number | null;
  analystTarget: number | null;
  analystCount: number | null;
  myIVMOS: number | null;
}

function KeyMetricsTable({
  metrics,
  currency,
}: {
  metrics: KeyMetrics;
  currency: string;
}) {
  const fmtPct = (v: number | null) =>
    v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(1)}%`;
  const fmtCur = (v: number | null) =>
    v == null || Number.isNaN(v) ? '—' : formatCurrency(v, currency, true);
  const fmtPrice = (v: number | null) =>
    v == null || Number.isNaN(v)
      ? '—'
      : `${currencySymbol(currency)}${v.toFixed(2)}`;
  const fmtDps = (v: number | null) =>
    v == null || Number.isNaN(v) ? '—' : `${currencySymbol(currency)}${v.toFixed(2)}`;

  const pctToPrice = (v: number | null) =>
    v != null && metrics.currentPrice != null && metrics.currentPrice > 0
      ? (v - metrics.currentPrice) / metrics.currentPrice
      : null;
  const fmtSignedPct = (v: number | null) =>
    v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

  // Quality & growth tiles: 12 tiles in a 6-column grid (6×2).
  const qualityRows: { label: string; display: string }[] = [
    { label: 'Market Cap', display: fmtCur(metrics.marketCap) },
    { label: 'ROIC (5Y)', display: fmtPct(metrics.roic5y) },
    { label: 'ROIC (1Y)', display: fmtPct(metrics.roic1y) },
    { label: 'ROCE', display: fmtPct(metrics.roce) },
    { label: 'ROE (5Y)', display: fmtPct(metrics.roe5y) },
    { label: 'FCFE Yield', display: fmtPct(metrics.fcfeYield) },
    { label: 'FCF Growth', display: fmtPct(metrics.fcfGrowth) },
    { label: 'FCF Growth (5Y)', display: fmtPct(metrics.fcfGrowth5y) },
    { label: 'Earnings Yield', display: fmtPct(metrics.earningsYield) },
    { label: 'EPS Growth Next Yr', display: fmtPct(metrics.epsGrowthNext) },
    { label: 'Dividend / Share', display: fmtDps(metrics.dividendPerShare) },
    { label: 'Dividend Yield', display: fmtPct(metrics.dividendYield) },
  ];

  // Fair-value strip: analyst consensus vs your own DCF (Lynch dropped — it's a
  // crude P/E heuristic that misbehaves at low/high growth and the DCF is better).
  const fairValueRows: { label: string; value: number | null }[] = [
    {
      label: metrics.analystCount
        ? `Analyst Target (${metrics.analystCount})`
        : 'Analyst Target',
      value: metrics.analystTarget,
    },
    { label: 'Your DCF (MOS)', value: metrics.myIVMOS },
  ];

  const eyebrow =
    'text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500';

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100">Key Metrics</h3>
        <div className="text-[11px] text-gray-500">TTM · 5Y where indicated</div>
      </div>

      <div className={`${eyebrow} mb-1.5`}>Quality &amp; Growth</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {qualityRows.map((r) => (
          <div
            key={r.label}
            className="bg-gray-950/50 border border-gray-800 rounded-lg px-3 py-2"
          >
            <div className={eyebrow}>{r.label}</div>
            <div className="mt-1 font-mono font-semibold text-sm text-gray-100">
              {r.display}
            </div>
          </div>
        ))}
      </div>

      <div className={`${eyebrow} mt-3 mb-1.5`}>Fair Value</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {fairValueRows.map((r) => {
          const delta = pctToPrice(r.value);
          return (
            <div
              key={r.label}
              className="bg-gray-950/50 border border-gray-800 rounded-lg px-3 py-2 flex items-center justify-between gap-2"
            >
              <div>
                <div className={eyebrow}>{r.label}</div>
                <div className="mt-1 font-mono font-semibold text-base text-gray-100">
                  {fmtPrice(r.value)}
                </div>
              </div>
              {delta != null && (
                <span
                  className={`font-mono text-xs font-semibold px-1.5 py-0.5 rounded border ${
                    delta >= 0
                      ? 'text-green-400 border-green-900 bg-green-950/40'
                      : 'text-red-400 border-red-900 bg-red-950/40'
                  }`}
                  title="Implied move vs current price"
                >
                  {fmtSignedPct(delta)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Section landmark: eyebrow label + rule line. Gives long data pages a pulse.
function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
        {label}
      </span>
      <span className="h-px flex-1 bg-gray-800" />
    </div>
  );
}

interface SummaryResponse {
  ticker: string;
  model: string;
  summary: string;
  generatedAt: string;
  error?: string;
}

function SummaryPanel({
  ticker,
  endpoint,
  title,
  defaultModelLabel,
  missingKeyHint,
}: {
  ticker: string;
  endpoint: string;
  title: string;
  defaultModelLabel: string;
  missingKeyHint: string;
}) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErrMsg(null);
    setLoading(true);
    fetch(`${endpoint}/${encodeURIComponent(ticker)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok || json.error) {
          throw new Error(json.error || `summary ${r.status}`);
        }
        return json as SummaryResponse;
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErrMsg(e.message || 'Failed to load summary'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, endpoint]);

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-violet-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">
          {title} <span className="text-gray-500 font-normal">· last 3 months</span>
        </h3>
        <div className="text-[11px] text-gray-500">
          {data?.model ? `via ${data.model}` : defaultModelLabel}
        </div>
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-3 bg-gray-800 rounded animate-pulse" />
          <div className="h-3 bg-gray-800 rounded animate-pulse w-11/12" />
          <div className="h-3 bg-gray-800 rounded animate-pulse w-10/12" />
          <div className="h-3 bg-gray-800 rounded animate-pulse w-9/12" />
        </div>
      ) : errMsg ? (
        <div className="text-xs text-red-400">
          {/(ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)/.test(errMsg)
            ? missingKeyHint
            : errMsg}
        </div>
      ) : data?.summary ? (
        <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
          {data.summary}
        </div>
      ) : (
        <div className="text-xs text-gray-500">No summary available.</div>
      )}
    </div>
  );
}

function GeminiSummary({ ticker }: { ticker: string }) {
  return (
    <SummaryPanel
      ticker={ticker}
      endpoint="/api/summary-gemini"
      title="Recent Moves (Gemini)"
      defaultModelLabel="via Google Gemini"
      missingKeyHint="Set GEMINI_API_KEY in equity-valuation/.env (then restart the server) to enable this free summary. Get a key at https://aistudio.google.com/apikey"
    />
  );
}


interface ReportTabProps {
  ticker: string | null;
  /** Current Valuation-tab assumptions — used for the "Your DCF (MOS)" metric. */
  assumptions?: DCFAssumptions;
  overrides?: Overrides;
  /** Financials/price already fetched by App — reused instead of refetching. */
  financials?: FinancialsResponse | null;
  priceData?: PriceResponse | null;
  /** SEC CIK for direct EDGAR filing links. */
  cik?: string | null;
}

export function ReportTab({
  ticker,
  assumptions,
  overrides,
  financials,
  priceData,
  cik,
}: ReportTabProps) {
  const [range, setRange] = useState<RangeKey>('1Y');
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [ttmQuarters, setTtmQuarters] = useState<QuarterRow[]>([]);
  const [ttmLoading, setTtmLoading] = useState(false);
  const [bandSeries, setBandSeries] = useState<PricePoint[]>([]);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [estimates, setEstimates] = useState<EstimatesResponse | null>(null);
  const [annualRows, setAnnualRows] = useState<QuarterRow[]>([]);
  const [annualLoading, setAnnualLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overviewExpanded, setOverviewExpanded] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);
  // Default to annual: the decade-scale record is what tells you whether a
  // business has a durable advantage. Quarterly is a drill-down, not the lead.
  const [periodMode, setPeriodMode] = useState<PeriodMode>('annual');

  // Seamless zoom between chart timeframes. On a range change the outgoing and
  // incoming charts are rendered as two layers that scale around the right edge
  // (every range ends at "now"), so shorter→longer reads as a zoom-out and
  // longer→shorter as a zoom-in. Scale factors come from the real time spans.
  const [zoomAnim, setZoomAnim] = useState<{
    prevData: { t: number; c: number }[];
    prevColor: string;
    oldScaleTo: number; // outgoing layer: 1 → this
    newScaleFrom: number; // incoming layer: this → 1
    width: number; // explicit outgoing-chart size (avoids ResponsiveContainer lag)
    height: number;
    run: boolean; // false on the setup frame, true once transitions start
  } | null>(null);
  const prevChartRef = useRef<{
    ticker: string;
    range: RangeKey;
    data: { t: number; c: number }[];
    color: string;
  } | null>(null);
  const zoomTimerRef = useRef<number | null>(null);
  const chartBoxRef = useRef<HTMLDivElement | null>(null);

  const fetchHistory = useCallback(async (t: string, r: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(t)}?range=${r}`);
      if (!res.ok) throw new Error(`history ${res.status}`);
      const json = (await res.json()) as HistoryResponse;
      setHistory(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Quarterly is fetched once at n=20 (endpoint max) and sliced client-side for
  // both the TTM rolling windows and the Quarterly view — the old n=12 quarterly
  // fetch was a strict subset of this, so it's gone.
  const fetchTtm = useCallback(async (t: string) => {
    setTtmLoading(true);
    try {
      const res = await fetch(
        `/api/quarterly/${encodeURIComponent(t)}?n=20&period=quarterly`
      );
      if (!res.ok) throw new Error(`ttm ${res.status}`);
      const json = (await res.json()) as QuarterlyResponse;
      setTtmQuarters(json.quarters || []);
    } catch {
      setTtmQuarters([]);
    } finally {
      setTtmLoading(false);
    }
  }, []);

  // 5Y weekly closes for the valuation-bands computation (independent of the
  // user-selected chart range).
  const fetchBandHistory = useCallback(async (t: string) => {
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(t)}?range=5Y`);
      if (!res.ok) throw new Error(`bands ${res.status}`);
      const json = (await res.json()) as HistoryResponse;
      setBandSeries(json.series || []);
    } catch {
      setBandSeries([]);
    }
  }, []);

  const fetchProfile = useCallback(async (t: string) => {
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(t)}`);
      if (!res.ok) throw new Error(`profile ${res.status}`);
      const json = (await res.json()) as ProfileResponse;
      setProfile(json);
    } catch {
      setProfile(null);
    }
  }, []);

  // Analyst estimates only — price/financials come from App via props (finding 2).
  const fetchEstimates = useCallback(async (t: string) => {
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(t)}`);
      setEstimates(res.ok ? ((await res.json()) as EstimatesResponse) : null);
    } catch {
      setEstimates(null);
    }
  }, []);

  // Annual periodic data, fetched once at n=20 (decade+ for the trends view) and
  // sliced: 8 for the Annual table, 5 for the 5Y ROIC average.
  const fetchAnnual = useCallback(async (t: string) => {
    setAnnualLoading(true);
    try {
      const res = await fetch(
        `/api/quarterly/${encodeURIComponent(t)}?n=20&period=annual`
      );
      if (!res.ok) throw new Error(`annual ${res.status}`);
      const json = (await res.json()) as QuarterlyResponse;
      setAnnualRows(json.quarters || []);
    } catch {
      setAnnualRows([]);
    } finally {
      setAnnualLoading(false);
    }
  }, []);

  // Per-ticker fetches — all independent of periodMode, so toggling TTM /
  // Quarterly / Annual no longer refetches anything (finding 1). Quarterly and
  // annual are each fetched once and sliced client-side (finding 5).
  useEffect(() => {
    if (!ticker) {
      setHistory(null);
      setProfile(null);
      setEstimates(null);
      setTtmQuarters([]);
      setAnnualRows([]);
      setBandSeries([]);
      return;
    }
    setRange('1Y');
    setDescExpanded(false);
    // Clear the old ticker's chart so the skeleton shows and the zoom
    // transition never runs across two different companies.
    setHistory(null);
    fetchTtm(ticker);
    fetchAnnual(ticker);
    fetchBandHistory(ticker);
    fetchProfile(ticker);
    fetchEstimates(ticker);
  }, [ticker, fetchTtm, fetchAnnual, fetchBandHistory, fetchProfile, fetchEstimates]);

  // Fetch history whenever ticker or range changes.
  useEffect(() => {
    if (ticker) fetchHistory(ticker, range);
  }, [range, ticker, fetchHistory]);

  const chartData = useMemo(
    () => (history?.series ?? []).map((p) => ({ t: p.t, c: p.c })),
    [history]
  );

  const priceChange = useMemo(() => {
    if (!history || chartData.length < 2) return null;
    const first = chartData[0].c;
    const last = chartData[chartData.length - 1].c;
    const abs = last - first;
    const pct = first !== 0 ? abs / first : 0;
    return { first, last, abs, pct };
  }, [history, chartData]);

  // Kick off the zoom transition when a different range's data arrives for the
  // same ticker. Runs in useLayoutEffect (before paint) so the initial scaled
  // transform is applied in the same frame the new data commits — otherwise the
  // browser paints the new full-width chart once first, which is the "jump".
  useLayoutEffect(() => {
    if (!history || !ticker) {
      prevChartRef.current = null;
      setZoomAnim(null);
      return;
    }
    const prev = prevChartRef.current;
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (
      prev &&
      prev.ticker === ticker &&
      prev.range !== history.range &&
      prev.data.length >= 2 &&
      chartData.length >= 2 &&
      !reduceMotion
    ) {
      const oldSpan = prev.data[prev.data.length - 1].t - prev.data[0].t;
      const newSpan = chartData[chartData.length - 1].t - chartData[0].t;
      const box = chartBoxRef.current;
      const width = box?.clientWidth ?? 0;
      const height = box?.clientHeight ?? 0;
      if (oldSpan > 0 && newSpan > 0 && width > 0 && height > 0) {
        // Clamp so extreme ratios (24H ↔ MAX) can't produce absurd transforms.
        const clamp = (v: number) => Math.max(0.02, Math.min(50, v));
        setZoomAnim({
          prevData: prev.data,
          prevColor: prev.color,
          oldScaleTo: clamp(oldSpan / newSpan),
          newScaleFrom: clamp(newSpan / oldSpan),
          width,
          height,
          run: false,
        });
        // Double rAF: let the browser commit the initial transforms before the
        // transition properties flip on (classic FLIP).
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setZoomAnim((a) => (a ? { ...a, run: true } : a)))
        );
        if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current);
        zoomTimerRef.current = window.setTimeout(() => setZoomAnim(null), 560);
      }
    }
    const rising =
      chartData.length >= 2 && chartData[chartData.length - 1].c - chartData[0].c >= 0;
    prevChartRef.current = {
      ticker,
      range: history.range,
      data: chartData,
      color: rising ? '#22c55e' : '#ef4444',
    };
  }, [history, chartData, ticker]);

  // Clear any pending zoom timer on unmount.
  useEffect(
    () => () => {
      if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current);
    },
    []
  );

  const currency = history?.currency || priceData?.currency || financials?.currency || 'USD';
  const isPositive = (priceChange?.abs ?? 0) >= 0;
  const lineColor = isPositive ? '#22c55e' : '#ef4444';

  // Sum the last 4 quarters of a flow field; null unless all 4 are present.
  const sumLast4 = (rows: QuarterRow[], offset: number, field: keyof QuarterRow) => {
    if (rows.length < offset + 4) return null;
    const slice = rows.slice(offset, offset + 4);
    const vals = slice.map((q) => q[field] as number | null);
    if (vals.some((v) => v == null || Number.isNaN(v))) return null;
    return vals.reduce<number>((a, b) => a + (b as number), 0);
  };

  // Zero-fill variant for lumpy fields (debt issuance/repayment don't appear in
  // quarters with no activity, so a missing quarter means 0, not "unknown").
  // Null only when the 4-quarter window isn't fully available.
  const sumLast4Zero = (rows: QuarterRow[], offset: number, field: keyof QuarterRow) => {
    if (rows.length < offset + 4) return null;
    return rows.slice(offset, offset + 4).reduce<number>((a, q) => {
      const v = q[field] as number | null;
      return a + (v != null && !Number.isNaN(v) ? v : 0);
    }, 0);
  };

  const keyMetrics = useMemo(() => {
    const price = priceData?.price ?? history?.price ?? null;
    const shares = priceData?.sharesOutstanding ?? financials?.shares ?? null;
    const marketCap =
      priceData?.marketCap ??
      (price != null && shares != null ? price * shares : null);

    const ttmFCF = sumLast4(ttmQuarters, 0, 'quarterlyFreeCashFlow');
    const priorTtmFCF = sumLast4(ttmQuarters, 4, 'quarterlyFreeCashFlow');
    const ttmNetIncome = sumLast4(ttmQuarters, 0, 'quarterlyNetIncome');

    // FCFE Yield = FCFE / Market Cap, using the same FCFE the Valuation tab uses
    // (CFO + CapEx + Net Borrowing) so the two tabs agree.
    const fcfeYield =
      financials?.fcfe != null && marketCap != null && marketCap > 0
        ? financials.fcfe / marketCap
        : null;

    // FCF growth still tracks TTM FCF (CFO + CapEx) year-over-year.
    const fcfGrowth =
      ttmFCF != null && priorTtmFCF != null && priorTtmFCF !== 0
        ? (ttmFCF - priorTtmFCF) / Math.abs(priorTtmFCF)
        : null;

    // ROIC (5Y): average annual NOPAT / IC over the last 5 fiscal years.
    // IC ≈ stockholdersEquity + totalDebt - cash (skip goodwill — we don't have it per period).
    const roic5y = computeAverageROIC(
      annualRows.slice(0, 5).map((r) => ({
        operatingIncome: r.quarterlyOperatingIncome,
        equity: r.quarterlyStockholdersEquity,
        debt: r.quarterlyTotalDebt,
        cash: r.quarterlyCashCashEquivalentsAndShortTermInvestments,
      })),
      financials?.taxRate ?? null
    );

    const earningsYield =
      estimates?.earningsYield ??
      computeEarningsYield(ttmNetIncome, marketCap) ??
      computeEarningsYield(financials?.netIncome ?? null, marketCap);

    // ROCE = NOPAT / (Invested Capital + excess cash).
    const roce = computeROCE({
      ebit: financials?.ebit ?? null,
      taxRate: financials?.taxRate ?? null,
      investedCapital: financials?.investedCapital ?? null,
      cash: financials?.cash ?? null,
      revenue: financials?.revenue ?? null,
    });

    // Dividend per share (latest fiscal year) and dividend yield.
    const latestAnnual = annualRows[0];
    const dividendPerShare =
      latestAnnual?.quarterlyDividendsPaid != null &&
      latestAnnual.quarterlyDividendsPaid > 0 &&
      latestAnnual.quarterlySharesOutstanding
        ? latestAnnual.quarterlyDividendsPaid / latestAnnual.quarterlySharesOutstanding
        : null;
    const dividendYield =
      dividendPerShare != null && price != null && price > 0 ? dividendPerShare / price : null;

    // Your DCF (MOS): run the DCF with the Valuation tab's current assumptions
    // and any user overrides, on this tab's fetched financials.
    let myIVMOS: number | null = null;
    if (financials && assumptions) {
      const ov = overrides ?? {};
      const fcfeIn = ov.fcfe !== undefined ? ov.fcfe : financials.fcfe;
      const cashIn = ov.cash !== undefined ? ov.cash : financials.cash;
      const revenueIn = ov.revenue !== undefined ? ov.revenue : financials.revenue;
      const sharesIn = ov.shares !== undefined ? ov.shares : shares;
      const capexIn = ov.capex !== undefined ? ov.capex : financials.capex;
      const nbIn = ov.netBorrowing !== undefined ? ov.netBorrowing : financials.netBorrowing;
      if (fcfeIn != null && sharesIn != null && sharesIn > 0) {
        myIVMOS = calculateDCF(fcfeIn, cashIn, revenueIn, sharesIn, assumptions, {
          capex: capexIn,
          netBorrowing: nbIn,
        }).dcfPriceMOS;
      }
    }

    return {
      marketCap,
      roic5y,
      roic1y: financials?.roic ?? null,
      roce,
      roe5y: estimates?.roe5y ?? null,
      fcfeYield,
      fcfGrowth,
      fcfGrowth5y: financials?.fcfCAGR ?? null,
      earningsYield,
      epsGrowthNext: estimates?.epsGrowthNextYear ?? null,
      dividendPerShare,
      dividendYield,
      currentPrice: price,
      analystTarget: estimates?.targetMeanPrice ?? null,
      analystCount: estimates?.numberOfAnalysts ?? null,
      myIVMOS,
    };
  }, [priceData, history, financials, estimates, ttmQuarters, annualRows, assumptions, overrides]);

  // TTM free cash flow for the balance-sheet resilience panel.
  const ttmFCF = useMemo(
    () => sumLast4(ttmQuarters, 0, 'quarterlyFreeCashFlow'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ttmQuarters]
  );

  // TTM-vs-prior cash-flow components for the FCFE Drivers attribution, plus the
  // sub-drivers that explain *why* each line moved (CFO bridge, capex intensity,
  // debt raised/repaid). Debt flows are lumpy so use the zero-fill sum.
  const fcfFlows = useMemo(() => {
    const window = (offset: number) => ({
      cfo: sumLast4(ttmQuarters, offset, 'quarterlyOperatingCashFlow'),
      capex: sumLast4(ttmQuarters, offset, 'quarterlyCapitalExpenditure'),
      fcf: sumLast4(ttmQuarters, offset, 'quarterlyFreeCashFlow'),
      netIncome: sumLast4(ttmQuarters, offset, 'quarterlyNetIncome'),
      da: sumLast4(ttmQuarters, offset, 'quarterlyDepreciationAmortization'),
      revenue: sumLast4(ttmQuarters, offset, 'quarterlyTotalRevenue'),
      debtIssued: sumLast4Zero(ttmQuarters, offset, 'quarterlyDebtIssued'),
      debtRepaid: sumLast4Zero(ttmQuarters, offset, 'quarterlyDebtRepaid'),
      // CFO-bridge components. Zero-fill: a quarter that doesn't disclose the line
      // contributes nothing, and any shortfall lands in the reconciling "Other".
      stockComp: sumLast4Zero(ttmQuarters, offset, 'quarterlyStockComp'),
      deferredTax: sumLast4Zero(ttmQuarters, offset, 'quarterlyDeferredTax'),
      changeReceivables: sumLast4Zero(ttmQuarters, offset, 'quarterlyChangeReceivables'),
      changeInventory: sumLast4Zero(ttmQuarters, offset, 'quarterlyChangeInventory'),
      changePayables: sumLast4Zero(ttmQuarters, offset, 'quarterlyChangePayables'),
      intangibleAmortization: sumLast4Zero(ttmQuarters, offset, 'quarterlyIntangibleAmortization'),
      assetDisposals: sumLast4Zero(ttmQuarters, offset, 'quarterlyAssetDisposals'),
      // Instant balances at this window's most recent quarter. ΔtotalDebt across
      // windows is a universal net-borrowing proxy for filers whose cash-flow debt
      // tags we don't capture; PP&E powers the revenue-intensity capex split.
      totalDebt: (ttmQuarters[offset]?.quarterlyTotalDebt as number | null) ?? null,
      ppe: (ttmQuarters[offset]?.quarterlyPPE as number | null) ?? null,
    });
    // Third window (offset 8) gives a 3-year average capex/D&A to damp lumpiness.
    return { ttm: window(0), prior: window(4), prior2: window(8) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttmQuarters]);

  // Historical P/E and FCF-yield bands from rolling TTM windows × 5Y prices.
  const bands = useMemo(() => {
    if (!bandSeries.length || ttmQuarters.length < 8) return null;
    const priceNow = priceData?.price ?? history?.price ?? null;
    const sharesNow = priceData?.sharesOutstanding ?? financials?.shares ?? null;
    return computeValuationBands(ttmQuarters, bandSeries, priceNow, sharesNow);
  }, [bandSeries, ttmQuarters, priceData, history, financials]);

  // ── Memoized table models (finding 9) ──
  // These rebuild only when their source data changes, not on every render (the
  // component re-renders on each fetch's setState, range toggle, and expansion).
  const periodRows = periodMode === 'annual' ? annualRows : ttmQuarters;
  const periodicLoading = periodMode === 'annual' ? annualLoading : ttmLoading;

  // TTM view: all rolling 4-quarter windows (more than displayed, so sequential
  // % diffs always have a comparison entry).
  const allRolling = useMemo(() => {
    const rows: QuarterRow[] = [];
    const maxRolling = ttmQuarters.length >= 4 ? ttmQuarters.length - 3 : 0;
    for (let i = 0; i < maxRolling; i++) {
      rows.push(buildAggRow(ttmQuarters, i, ttmQuarters[i].asOfDate));
    }
    return rows;
  }, [ttmQuarters]);

  // Quarterly/Annual view: synthetic TTM column + all period columns.
  const ttmRow = useMemo(() => buildAggRow(ttmQuarters, 0, 'TTM'), [ttmQuarters]);
  const allPeriods = useMemo<QuarterRow[]>(
    () => [ttmRow, ...periodRows],
    [ttmRow, periodRows]
  );

  return (
    <div className="space-y-5">
      {!ticker && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <IconChart size={44} className="mb-4 text-gray-700" />
          <h2 className="text-gray-300 text-lg font-semibold mb-2">Interactive Report</h2>
          <p className="text-gray-500 text-sm max-w-md leading-relaxed">
            Search a ticker to see its stock price history across multiple time
            ranges, plus the last 5 quarters of reported financials.
          </p>
        </div>
      )}

      {ticker && (
        <>
          <SectionRule label="Market" />

          {/* Ticker + price header — directly on the page for hero weight */}
          <div className="flex items-start justify-between flex-wrap gap-3 px-1">
              <div className="flex items-center gap-3">
                <CompanyLogo ticker={ticker} size={44} />
                <div>
                  <div className="flex items-baseline gap-3">
                    <div className="text-lg font-mono font-bold text-white">{ticker}</div>
                    {history?.exchange && (
                      <div className="text-[10px] text-gray-500 uppercase">{history.exchange}</div>
                    )}
                  </div>
                  {/* Next earnings + primary-source filing links */}
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-500">
                    {estimates?.nextEarningsDate && (
                      <span>
                        Next earnings:{' '}
                        <span className="text-gray-300 font-mono">
                          {new Date(estimates.nextEarningsDate).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      </span>
                    )}
                    {cik && (
                      <span className="flex items-center gap-2">
                        <span className="text-gray-600">SEC:</span>
                        <a
                          href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=&owner=include&count=10`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          10-K
                        </a>
                        <a
                          href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-Q&dateb=&owner=include&count=10`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          10-Q
                        </a>
                      </span>
                    )}
                  </div>
                  {history?.price != null && (
                    <div className="mt-1 flex items-baseline gap-3">
                      <div className="text-3xl font-bold text-white font-mono tracking-tight">
                        {currencySymbol(history.currency)}
                        {history.price.toFixed(2)}
                      </div>
                      {priceChange && (
                        <div className={`text-sm font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                          {isPositive ? '+' : ''}
                          {priceChange.abs.toFixed(2)} ({isPositive ? '+' : ''}
                          {(priceChange.pct * 100).toFixed(2)}%)
                          <span className="text-gray-500 text-xs ml-2">· {range}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Range toggles — segmented control (tinted active, not filled) */}
              <div className="inline-flex self-center rounded-md border border-gray-700 divide-x divide-gray-800 overflow-hidden text-[11px]">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`px-2.5 py-1 font-medium transition-colors ${
                      range === r.key
                        ? 'bg-blue-500/15 text-blue-300'
                        : 'bg-gray-900 text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
          </div>

          {/* Chart — hero card */}
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-5">
            <div ref={chartBoxRef} className="h-80 relative overflow-hidden">
              {/* Skeleton only when there's nothing to show — on a range change
                  the old chart stays up until the new data zooms in/out. */}
              {loading && chartData.length === 0 ? (
                <div className="w-full h-full bg-gray-950/50 rounded animate-pulse" />
              ) : error ? (
                <div className="w-full h-full flex items-center justify-center text-red-400 text-sm">
                  {error}
                </div>
              ) : chartData.length === 0 ? (
                <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
                  No price data available.
                </div>
              ) : (
                <>
                {/* Incoming layer — scales from the old window's footprint to full width */}
                <div
                  className="absolute inset-0"
                  style={
                    zoomAnim
                      ? {
                          transform: `scaleX(${zoomAnim.run ? 1 : zoomAnim.newScaleFrom})`,
                          opacity: zoomAnim.run ? 1 : 0,
                          // Anchor on the "now" point (plot right edge = 20px right margin in).
                          transformOrigin: 'calc(100% - 20px) center',
                          transition: zoomAnim.run
                            ? 'transform 450ms cubic-bezier(0.22, 0.9, 0.35, 1), opacity 300ms ease'
                            : 'none',
                        }
                      : undefined
                  }
                >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                    <defs>
                      <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1B2537" vertical={false} />
                    <XAxis
                      dataKey="t"
                      tickFormatter={(v) => formatTick(v, range, history?.exchangeTimezone)}
                      stroke="#64748B"
                      tick={{ fontSize: 11 }}
                      minTickGap={40}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      stroke="#64748B"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `${currencySymbol(history?.currency || 'USD')}${Number(v).toFixed(0)}`}
                      width={60}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0E1524',
                        border: '1px solid #2C3A50',
                        borderRadius: 8,
                        fontSize: 12,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                      }}
                      labelFormatter={(v) => {
                        const tz = history?.exchangeTimezone || undefined;
                        const showTime = range === '1D' || range === '5D';
                        return new Date(v as number).toLocaleString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: showTime ? 'numeric' : undefined,
                          minute: showTime ? '2-digit' : undefined,
                          timeZone: tz,
                          timeZoneName: showTime ? 'short' : undefined,
                        });
                      }}
                      formatter={(v) => [
                        `${currencySymbol(history?.currency || 'USD')}${Number(v).toFixed(2)}`,
                        'Close',
                      ]}
                    />
                    {priceChange && (
                      <ReferenceLine y={priceChange.first} stroke="#2C3A50" strokeDasharray="4 4" />
                    )}
                    {/* The model's opinion, drawn over the market's price — only
                        when within a sane band so an extreme value can't squash
                        the chart. */}
                    {keyMetrics.myIVMOS != null &&
                      keyMetrics.currentPrice != null &&
                      keyMetrics.myIVMOS > keyMetrics.currentPrice * 0.4 &&
                      keyMetrics.myIVMOS < keyMetrics.currentPrice * 2.2 && (
                        <ReferenceLine
                          y={keyMetrics.myIVMOS}
                          stroke="#3B82F6"
                          strokeDasharray="6 3"
                          ifOverflow="extendDomain"
                          label={{ value: 'DCF·MOS', position: 'insideRight', fontSize: 10, fill: '#60A5FA' }}
                        />
                      )}
                    {keyMetrics.analystTarget != null &&
                      keyMetrics.currentPrice != null &&
                      keyMetrics.analystTarget > keyMetrics.currentPrice * 0.4 &&
                      keyMetrics.analystTarget < keyMetrics.currentPrice * 2.2 && (
                        <ReferenceLine
                          y={keyMetrics.analystTarget}
                          stroke="#8B5CF6"
                          strokeDasharray="6 3"
                          ifOverflow="extendDomain"
                          label={{ value: 'Target', position: 'insideRight', fontSize: 10, fill: '#A78BFA' }}
                        />
                      )}
                    <Area
                      type="monotone"
                      dataKey="c"
                      stroke={lineColor}
                      strokeWidth={2}
                      fill="url(#priceFill)"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                </div>

                {/* Outgoing layer — the previous range, scaling into (zoom-out)
                    or blowing past (zoom-in) its place in the new window.
                    Explicit size (no ResponsiveContainer) so it renders on the
                    very first frame instead of flashing blank while it measures. */}
                {zoomAnim && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      transform: `scaleX(${zoomAnim.run ? zoomAnim.oldScaleTo : 1})`,
                      opacity: zoomAnim.run ? 0 : 1,
                      transformOrigin: 'calc(100% - 20px) center',
                      transition: zoomAnim.run
                        ? 'transform 450ms cubic-bezier(0.22, 0.9, 0.35, 1), opacity 300ms ease'
                        : 'none',
                    }}
                  >
                    <AreaChart
                      width={zoomAnim.width}
                      height={zoomAnim.height}
                      data={zoomAnim.prevData}
                      margin={{ top: 10, right: 20, bottom: 5, left: 10 }}
                    >
                      <defs>
                        <linearGradient id="priceFillPrev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={zoomAnim.prevColor} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={zoomAnim.prevColor} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      {/* Tickless axes keep the plot geometry identical to the live layer */}
                      <XAxis dataKey="t" tick={false} stroke="#64748B" height={30} />
                      <YAxis domain={['auto', 'auto']} tick={false} stroke="#64748B" width={60} />
                      <Area
                        type="monotone"
                        dataKey="c"
                        stroke={zoomAnim.prevColor}
                        strokeWidth={2}
                        fill="url(#priceFillPrev)"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </div>
                )}
                </>
              )}
            </div>
          </div>

          {/* Recent moves — free Gemini summary with web-search grounding */}
          <GeminiSummary ticker={ticker} />

          {/* Key metrics */}
          <KeyMetricsTable
            metrics={keyMetrics}
            currency={currency}
          />

          {/* FCFE drivers — composition, what moved it, and why */}
          {financials && (
            <FcfDrivers
              cfo={financials.cfo}
              capex={financials.capex}
              netBorrowing={financials.netBorrowing}
              fcfe={financials.fcfe}
              marketCap={keyMetrics.marketCap}
              currency={currency}
              ttm={fcfFlows.ttm}
              prior={fcfFlows.prior}
              prior2={fcfFlows.prior2}
            />
          )}

          {/* Historical valuation bands */}
          {bands && <ValuationBands bands={bands} currency={currency} />}

          <SectionRule label="Track Record" />

          {/* Capital allocation — where a decade of cash went and what it earned */}
          {annualRows.length >= 3 && (
            <CapitalAllocation
              annualRows={annualRows}
              taxRate={financials?.taxRate ?? null}
              currency={currency}
            />
          )}

          {/* Long-term (decade-scale) trends */}
          {annualRows.length >= 4 && (
            <TenYearTrends
              annualRows={annualRows}
              taxRate={financials?.taxRate ?? null}
              currency={currency}
            />
          )}

          {/* Shareholder returns — dividends + buybacks */}
          {annualRows.length >= 2 && (
            <ShareholderReturns
              annualRows={annualRows}
              price={priceData?.price ?? history?.price ?? null}
              currency={currency}
            />
          )}

          {/* Balance-sheet resilience */}
          {financials && (
            <BalanceSheetResilience
              totalDebt={financials.totalDebt}
              cash={financials.cash}
              ebitda={financials.ebitda}
              ebit={financials.ebit}
              interestExpense={financials.interestExpense}
              ttmFCF={ttmFCF}
              currency={currency}
            />
          )}

          <SectionRule label="Fundamentals" />

          {/* Periodic financials */}
          <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-100">
                {periodMode === 'ttm' ? 'Trailing Twelve Months' : `Last 8 ${periodMode === 'annual' ? 'Years' : 'Quarters'}`}
              </h3>
              <div className="flex items-center gap-3">
                <div className="inline-flex rounded-md border border-gray-700 divide-x divide-gray-800 overflow-hidden text-[11px]">
                  {(['ttm', 'quarterly', 'annual'] as PeriodMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPeriodMode(m)}
                      className={`px-3 py-1 font-medium tracking-wide transition-colors ${
                        periodMode === m
                          ? 'bg-blue-500/15 text-blue-300'
                          : 'bg-gray-900 text-gray-400 hover:bg-gray-800'
                      }`}
                    >
                      {m === 'ttm' ? 'TTM' : m === 'quarterly' ? 'Quarterly' : 'Annually'}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-gray-500">Source: Yahoo Finance</div>
              </div>
            </div>

            {periodicLoading && periodRows.length === 0 ? (
              <div className="h-40 bg-gray-950/50 rounded animate-pulse" />
            ) : periodRows.length === 0 ? (
              <div className="text-sm text-gray-500 py-6 text-center">
                No periodic data available for this ticker.
              </div>
            ) : (
              <div className="overflow-x-auto">
                {(() => {
                  // TTM mode: rolling TTM columns (allRolling is memoized above).
                  if (periodMode === 'ttm') {
                    // Only display the 8 most recent TTM columns.
                    const visibleRolling = allRolling.slice(0, Math.min(8, allRolling.length));
                    return (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left border-b border-gray-800">
                            <th className="py-2 pr-4 text-gray-400 font-medium sticky left-0 bg-gray-900">Metric</th>
                            <th className="py-2 px-2 text-gray-500 font-medium">Trend</th>
                            {visibleRolling.map((q) => (
                              <th key={q.asOfDate} className="py-2 px-3 font-medium font-mono text-right whitespace-nowrap text-gray-400">
                                {formatDate(q.asOfDate)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {METRIC_ROWS.map((m) => {
                            const directional = !!m.dir;
                            const spark = trendValues(visibleRolling, m);
                            return (
                              <tr key={m.field} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                                <td className="py-2 pr-4 text-gray-300 sticky left-0 bg-gray-900">{m.label}</td>
                                <td className="py-2 px-2">
                                  <Sparkline values={spark} stroke={SPARK_STROKE} />
                                </td>
                                {visibleRolling.map((q, colIdx) => {
                                  const v = m.compute
                                    ? m.compute(q)
                                    : (q[m.field as keyof QuarterRow] as number | null);
                                  const display = formatCell(v, m.kind, currency);
                                  // Sequential: compare each TTM period to the one immediately before it.
                                  // Margin (derived) rows skip the % diff — a %-of-% is confusing.
                                  const prevQ = m.compute ? null : allRolling[colIdx + 1];
                                  const prev = prevQ
                                    ? (prevQ[m.field as keyof QuarterRow] as number | null)
                                    : null;
                                  let pctStr: string | null = null;
                                  let pctClass = 'text-gray-500';
                                  let pctNum: number | null = null;
                                  if (v != null && prev != null && !Number.isNaN(v) && !Number.isNaN(prev) && prev !== 0) {
                                    pctNum = (v - prev) / Math.abs(prev);
                                    pctStr = `${pctNum > 0 ? '+' : ''}${(pctNum * 100).toFixed(1)}%`;
                                    // Desaturated: direction, not judgment.
                                    if (directional) pctClass = pctNum > 0 ? 'text-green-500/70' : pctNum < 0 ? 'text-red-400/70' : 'text-gray-500';
                                  }
                                  return (
                                    <td key={q.asOfDate} className={`py-2 px-3 font-mono text-right whitespace-nowrap ${v != null && v < 0 ? 'text-red-300' : 'text-gray-200'} ${pctTint(pctNum, directional)}`}>
                                      <span>{display}</span>
                                      {pctStr && <span className={`ml-2 text-[10px] ${pctClass}`}>{pctStr}</span>}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  }

                  // Quarterly / Annual modes: ttmRow + allPeriods are memoized above.
                  // visiblePeriods = TTM + up to 8 periods (what's shown in columns).
                  const visiblePeriods = allPeriods.slice(0, Math.min(9, allPeriods.length));
                  return (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b border-gray-800">
                      <th className="py-2 pr-4 text-gray-400 font-medium sticky left-0 bg-gray-900">Metric</th>
                      <th className="py-2 px-2 text-gray-500 font-medium">Trend</th>
                      {visiblePeriods.map((q) => (
                        <th
                          key={q.asOfDate}
                          className={`py-2 px-3 font-medium font-mono text-right whitespace-nowrap ${
                            q.asOfDate === 'TTM' ? 'text-blue-300' : 'text-gray-400'
                          }`}
                        >
                          {q.asOfDate === 'TTM' ? 'TTM' : formatDate(q.asOfDate)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRIC_ROWS.map((m) => {
                      const directional = !!m.dir;
                      // Sparkline over the dated periods only (skip the TTM column).
                      const spark = trendValues(visiblePeriods.slice(1), m);
                      return (
                      <tr key={m.field} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                        <td className="py-2 pr-4 text-gray-300 sticky left-0 bg-gray-900">{m.label}</td>
                        <td className="py-2 px-2">
                          <Sparkline values={spark} stroke={SPARK_STROKE} />
                        </td>
                        {visiblePeriods.map((q, colIdx) => {
                          const v = m.compute
                            ? m.compute(q)
                            : (q[m.field as keyof QuarterRow] as number | null);
                          const display = formatCell(v, m.kind, currency);

                          // No percentage shown for the TTM column or derived (margin) rows.
                          // All period columns compare to the immediately preceding period.
                          const prevQ = colIdx === 0 || m.compute ? null : allPeriods[colIdx + 1];
                          const prev = prevQ
                            ? (prevQ[m.field as keyof QuarterRow] as number | null)
                            : null;
                          let pctStr: string | null = null;
                          let pctClass = 'text-gray-500';
                          let pctNum: number | null = null;
                          if (
                            v != null &&
                            prev != null &&
                            !Number.isNaN(v) &&
                            !Number.isNaN(prev) &&
                            prev !== 0
                          ) {
                            pctNum = (v - prev) / Math.abs(prev);
                            const sign = pctNum > 0 ? '+' : '';
                            pctStr = `${sign}${(pctNum * 100).toFixed(1)}%`;
                            if (directional) {
                              // Desaturated: direction, not judgment.
                              pctClass = pctNum > 0 ? 'text-green-500/70' : pctNum < 0 ? 'text-red-400/70' : 'text-gray-500';
                            }
                          }

                          return (
                            <td
                              key={q.asOfDate}
                              className={`py-2 px-3 font-mono text-right whitespace-nowrap ${
                                v != null && v < 0 ? 'text-red-300' : 'text-gray-200'
                              } ${pctTint(pctNum, directional)}`}
                            >
                              <span>{display}</span>
                              {pctStr && (
                                <span className={`ml-2 text-[10px] ${pctClass}`}>{pctStr}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Company overview */}
          {profile && !profile.error && (profile.description || profile.sector) && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl">
              <button
                onClick={() => setOverviewExpanded((v) => !v)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/40 transition-colors"
              >
                <span className="text-gray-400 text-xs">{overviewExpanded ? '▾' : '▸'}</span>
                <span className="text-sm font-semibold text-gray-200">
                  {profile.longName || ticker} Overview
                </span>
              </button>

              {overviewExpanded && (
                <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Description */}
                  <div className="md:col-span-2 space-y-3">
                    {profile.description && (
                      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                        {descExpanded || profile.description.length <= 320
                          ? profile.description
                          : `${profile.description.slice(0, 320).trim()}…`}
                      </p>
                    )}
                    {profile.website && (
                      <a
                        href={profile.website}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-block text-sm text-blue-400 hover:text-blue-300 hover:underline"
                      >
                        {profile.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                      </a>
                    )}
                    {profile.description && profile.description.length > 320 && (
                      <div>
                        <button
                          onClick={() => setDescExpanded((v) => !v)}
                          className="px-3 py-1 text-xs text-gray-300 border border-gray-700 rounded-md hover:bg-gray-800"
                        >
                          {descExpanded
                            ? 'Show less'
                            : `More about ${profile.longName || ticker}`}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 content-start">
                    {profile.fullTimeEmployees != null && (
                      <div>
                        <div className="text-base font-bold text-white">
                          {profile.fullTimeEmployees.toLocaleString()}
                        </div>
                        <div className="text-[11px] text-gray-500">Full-time employees</div>
                      </div>
                    )}
                    {profile.fiscalYearEnd && (
                      <div>
                        <div className="text-base font-bold text-white">{profile.fiscalYearEnd}</div>
                        <div className="text-[11px] text-gray-500">Fiscal year ends</div>
                      </div>
                    )}
                    {profile.sector && (
                      <div>
                        <div className="text-base font-bold text-white">{profile.sector}</div>
                        <div className="text-[11px] text-gray-500">Sector</div>
                      </div>
                    )}
                    {profile.industry && (
                      <div>
                        <div className="text-base font-bold text-white">{profile.industry}</div>
                        <div className="text-[11px] text-gray-500">Industry</div>
                      </div>
                    )}
                    {profile.gicsSubIndustryCode && (
                      <div>
                        <div className="text-base font-bold text-white font-mono">
                          {profile.gicsSubIndustryCode}
                        </div>
                        <div className="text-[11px] text-gray-500">GICS sub-industry</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
