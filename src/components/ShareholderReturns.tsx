import { Sparkline } from './Sparkline';
import { currencySymbol } from '../utils/formatting';

export interface SHRow {
  asOfDate: string;
  quarterlyNetIncome: number | null;
  quarterlyDividendsPaid: number | null;
  quarterlySharesOutstanding: number | null;
}

interface Props {
  annualRows: SHRow[]; // newest-first
  price: number | null;
  currency: string;
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
  hint?: string;
}) {
  const color = tone === 'up' ? 'text-green-400' : tone === 'down' ? 'text-red-400' : 'text-gray-100';
  return (
    <div className="bg-gray-950/50 border border-gray-800 rounded-lg px-3 py-2" title={hint}>
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">{label}</div>
      <div className={`mt-1 font-mono font-semibold text-sm ${color}`}>{value}</div>
    </div>
  );
}

/**
 * Shareholder yield & dividend record for value/income investors: DPS history,
 * growth streak & CAGR, payout ratio, and total shareholder yield (dividend +
 * net buyback). Buyback yield comes from the year-over-year change in shares.
 */
export function ShareholderReturns({ annualRows, price, currency }: Props) {
  const rows = annualRows.filter((r) => r.quarterlySharesOutstanding != null).slice(0, 12);
  if (rows.length < 2) return null;

  // DPS per year (oldest → newest).
  const dpsSeries = [...rows]
    .reverse()
    .map((r) =>
      r.quarterlyDividendsPaid != null && r.quarterlyDividendsPaid > 0 && r.quarterlySharesOutstanding
        ? r.quarterlyDividendsPaid / r.quarterlySharesOutstanding
        : 0
    );

  const latest = rows[0];
  const prior = rows[1];
  const paysDividend = dpsSeries.some((d) => d > 0);
  const latestDps = dpsSeries[dpsSeries.length - 1] || 0;

  const dividendYield = paysDividend && price && price > 0 ? latestDps / price : null;
  const payout =
    paysDividend &&
    latest.quarterlyDividendsPaid != null &&
    latest.quarterlyNetIncome != null &&
    latest.quarterlyNetIncome > 0
      ? latest.quarterlyDividendsPaid / latest.quarterlyNetIncome
      : null;

  // Consecutive years of DPS increase, counting back from the latest.
  let streak = 0;
  for (let i = dpsSeries.length - 1; i > 0; i--) {
    if (dpsSeries[i] > dpsSeries[i - 1] && dpsSeries[i - 1] > 0) streak++;
    else break;
  }

  // Dividend CAGR over the paying window.
  const firstPayIdx = dpsSeries.findIndex((d) => d > 0);
  let divCagr: number | null = null;
  if (paysDividend && firstPayIdx >= 0 && firstPayIdx < dpsSeries.length - 1) {
    const start = dpsSeries[firstPayIdx];
    const yrs = dpsSeries.length - 1 - firstPayIdx;
    if (start > 0 && latestDps > 0 && yrs > 0) divCagr = Math.pow(latestDps / start, 1 / yrs) - 1;
  }

  // Buyback yield: shares shrinking → positive. Uses latest vs prior year.
  const buybackYield =
    latest.quarterlySharesOutstanding != null &&
    prior.quarterlySharesOutstanding != null &&
    prior.quarterlySharesOutstanding > 0
      ? (prior.quarterlySharesOutstanding - latest.quarterlySharesOutstanding) /
        prior.quarterlySharesOutstanding
      : null;

  const totalYield =
    dividendYield != null || buybackYield != null
      ? (dividendYield ?? 0) + (buybackYield ?? 0)
      : null;

  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100">Shareholder Returns</h3>
        <div className="text-[11px] text-gray-500">
          {paysDividend ? 'Dividend + buyback yield' : 'No dividend · buyback only'}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Tile
          label="Total Yield"
          value={pct(totalYield)}
          tone={totalYield == null ? undefined : totalYield >= 0 ? 'up' : 'down'}
          hint="Dividend yield + net buyback yield"
        />
        <Tile label="Dividend Yield" value={paysDividend ? pct(dividendYield) : '—'} />
        <Tile
          label="Buyback Yield"
          value={pct(buybackYield)}
          tone={buybackYield == null ? undefined : buybackYield >= 0 ? 'up' : 'down'}
          hint="Positive = share count shrinking (buybacks); negative = dilution"
        />
        <Tile
          label="Payout Ratio"
          value={paysDividend ? pct(payout) : '—'}
          hint="Dividends ÷ net income"
        />
        <Tile
          label={paysDividend ? `DPS · +${streak}y streak` : 'DPS'}
          value={
            paysDividend
              ? `${currencySymbol(currency)}${latestDps.toFixed(2)}${
                  divCagr != null ? ` · ${divCagr >= 0 ? '+' : ''}${(divCagr * 100).toFixed(0)}%/yr` : ''
                }`
              : '—'
          }
        />
      </div>
      {paysDividend && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
            DPS history
          </span>
          <Sparkline values={dpsSeries.filter((d) => d > 0)} stroke="#34d399" width={160} height={24} />
        </div>
      )}
    </div>
  );
}
