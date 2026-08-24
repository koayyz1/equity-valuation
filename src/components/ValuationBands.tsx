import { currencySymbol } from '../utils/formatting';

interface PricePoint {
  t: number; // ms epoch
  c: number; // close
}

interface QuarterLike {
  asOfDate: string;
  quarterlyDilutedEPS: number | null;
  quarterlyFreeCashFlow: number | null;
  quarterlySharesOutstanding: number | null;
}

export interface BandStat {
  min: number;
  med: number;
  max: number;
  current: number | null;
  impliedMed: number | null; // price implied by the median multiple/yield today
  points: number;
}

export interface ValuationBandsData {
  pe: BandStat | null;
  fcfYield: BandStat | null;
}

const MAX_DATE_GAP_MS = 45 * 86400000; // price sample must be within 45d of quarter end

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function nearestClose(series: PricePoint[], targetMs: number): number | null {
  let best: PricePoint | null = null;
  let bestDiff = Infinity;
  for (const p of series) {
    const diff = Math.abs(p.t - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best && bestDiff <= MAX_DATE_GAP_MS ? best.c : null;
}

// Sum a flow field over quarters[start..start+3]; null unless all 4 present.
function sum4(
  quarters: QuarterLike[],
  start: number,
  field: 'quarterlyDilutedEPS' | 'quarterlyFreeCashFlow'
): number | null {
  if (quarters.length < start + 4) return null;
  let total = 0;
  for (let i = start; i < start + 4; i++) {
    const v = quarters[i][field];
    if (v == null || Number.isNaN(v)) return null;
    total += v;
  }
  return total;
}

/**
 * Build historical P/E and FCF-yield bands from rolling-TTM windows over the
 * supplied quarters (newest first) matched against a ~5Y price series.
 * Each band needs at least 6 valid observations to be considered meaningful.
 */
export function computeValuationBands(
  quarters: QuarterLike[],
  series: PricePoint[],
  priceNow: number | null,
  sharesNow: number | null
): ValuationBandsData {
  const peSamples: number[] = [];
  const fySamples: number[] = [];

  const maxWindows = quarters.length >= 4 ? quarters.length - 3 : 0;
  for (let i = 0; i < maxWindows; i++) {
    const px = nearestClose(series, Date.parse(quarters[i].asOfDate));
    if (px == null || px <= 0) continue;

    const eps = sum4(quarters, i, 'quarterlyDilutedEPS');
    if (eps != null && eps > 0) peSamples.push(px / eps);

    const fcf = sum4(quarters, i, 'quarterlyFreeCashFlow');
    const sh = quarters[i].quarterlySharesOutstanding ?? sharesNow;
    if (fcf != null && fcf > 0 && sh != null && sh > 0) {
      fySamples.push(fcf / (px * sh));
    }
  }

  const epsNow = sum4(quarters, 0, 'quarterlyDilutedEPS');
  const fcfNow = sum4(quarters, 0, 'quarterlyFreeCashFlow');

  let pe: BandStat | null = null;
  if (peSamples.length >= 6) {
    const med = median(peSamples);
    pe = {
      min: Math.min(...peSamples),
      med,
      max: Math.max(...peSamples),
      current: priceNow != null && epsNow != null && epsNow > 0 ? priceNow / epsNow : null,
      impliedMed: epsNow != null && epsNow > 0 ? epsNow * med : null,
      points: peSamples.length,
    };
  }

  let fcfYield: BandStat | null = null;
  if (fySamples.length >= 6) {
    const med = median(fySamples);
    const fcfPs = fcfNow != null && sharesNow != null && sharesNow > 0 ? fcfNow / sharesNow : null;
    fcfYield = {
      min: Math.min(...fySamples),
      med,
      max: Math.max(...fySamples),
      current:
        priceNow != null && priceNow > 0 && fcfPs != null && fcfPs > 0 ? fcfPs / priceNow : null,
      impliedMed: fcfPs != null && fcfPs > 0 && med > 0 ? fcfPs / med : null,
      points: fySamples.length,
    };
  }

  return { pe, fcfYield };
}

// ── Presentation ────────────────────────────────────────────────────────────

function BandBar({
  stat,
  label,
  fmt,
  cheapWhenLow,
  currency,
}: {
  stat: BandStat;
  label: string;
  fmt: (v: number) => string;
  /** true when a LOW current value is cheap (P/E); false when HIGH is cheap (yield). */
  cheapWhenLow: boolean;
  currency: string;
}) {
  const span = stat.max - stat.min;
  const pos = (v: number) => (span > 0 ? Math.max(0, Math.min(1, (v - stat.min) / span)) : 0.5);
  const cur = stat.current;
  const isCheap =
    cur != null && (cheapWhenLow ? cur < stat.med : cur > stat.med);

  const medPct = pos(stat.med) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] text-gray-400">{label}</span>
        <span className="text-[11px] font-mono text-gray-500">
          med {fmt(stat.med)}
          {stat.impliedMed != null && (
            <>
              {' '}· @med ≈ {currencySymbol(currency)}
              {stat.impliedMed.toFixed(2)}
            </>
          )}
        </span>
      </div>
      {/* Rail — the cheap side of the median is shaded so the bar itself encodes
          cheap-vs-dear; the marker carries a value flag. */}
      <div className="relative h-3.5 rounded bg-gray-800 mt-5">
        <div
          className="absolute inset-y-0 bg-blue-500/10 rounded"
          style={
            cheapWhenLow
              ? { left: 0, width: `${medPct}%` }
              : { left: `${medPct}%`, right: 0 }
          }
        />
        {/* median tick */}
        <div
          className="absolute -top-1 h-[22px] w-0.5 bg-gray-400"
          style={{ left: `${medPct}%` }}
        />
        {/* current marker + value flag */}
        {cur != null && (
          <>
            <div
              className={`absolute -top-0.5 h-[18px] w-1.5 rounded-sm ${
                isCheap ? 'bg-green-400' : 'bg-red-400'
              }`}
              style={{ left: `calc(${pos(cur) * 100}% - 3px)` }}
            />
            <div
              className={`absolute -top-[18px] -translate-x-1/2 text-[9px] font-mono font-semibold whitespace-nowrap ${
                isCheap ? 'text-green-400' : 'text-red-400'
              }`}
              style={{ left: `${pos(cur) * 100}%` }}
            >
              {fmt(cur)}
            </div>
          </>
        )}
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-mono text-gray-500">
        <span>{fmt(stat.min)}</span>
        <span>{fmt(stat.max)}</span>
      </div>
    </div>
  );
}

export function ValuationBands({
  bands,
  currency,
}: {
  bands: ValuationBandsData;
  currency: string;
}) {
  if (!bands.pe && !bands.fcfYield) return null;
  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100">Valuation Bands</h3>
        <div className="text-[11px] text-gray-500">
          Rolling-TTM history (~5Y) · green = cheaper than median
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        {bands.pe && (
          <BandBar
            stat={bands.pe}
            label={`P/E (TTM) · ${bands.pe.points} obs`}
            fmt={(v) => `${v.toFixed(1)}x`}
            cheapWhenLow
            currency={currency}
          />
        )}
        {bands.fcfYield && (
          <BandBar
            stat={bands.fcfYield}
            label={`FCF Yield (TTM) · ${bands.fcfYield.points} obs`}
            fmt={(v) => `${(v * 100).toFixed(1)}%`}
            cheapWhenLow={false}
            currency={currency}
          />
        )}
      </div>
      <div className="mt-3 text-[10px] text-gray-600">
        Bands span the min–max of the trailing multiples over available history; the tick marks the
        median. "@med" is today's price if the stock traded at its median multiple. Negative-earnings
        / negative-FCF periods are excluded.
      </div>
    </div>
  );
}
