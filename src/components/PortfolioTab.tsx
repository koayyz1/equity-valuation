import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../hooks/usePortfolio';
import { fetchTickerMetrics, runPool, TickerMetrics } from '../utils/tickerMetrics';
import { formatCurrency, formatPercent, currencySymbol } from '../utils/formatting';
import { CompanyLogo } from './CompanyLogo';
import { IconTrendingUp } from './icons';

interface PortfolioTabProps {
  onSelectTicker: (ticker: string) => void;
}

const fmtSigned = (v: number | null) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

export function PortfolioTab({ onSelectTicker }: PortfolioTabProps) {
  const { positions, upsert, remove } = usePortfolio();
  const [metrics, setMetrics] = useState<Record<string, TickerMetrics>>({});
  const [loading, setLoading] = useState(false);
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [cost, setCost] = useState('');

  // Fetch metrics for every held ticker (and refetch when the set changes).
  const heldKey = positions.map((p) => p.ticker).join(',');
  const refresh = useCallback(async () => {
    const tickers = positions.map((p) => p.ticker);
    if (!tickers.length) {
      setMetrics({});
      return;
    }
    setLoading(true);
    await runPool(tickers, fetchTickerMetrics, 6, (t, result) => {
      if (result) setMetrics((prev) => ({ ...prev, [t]: result }));
    });
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const rows = useMemo(() => {
    return positions.map((p) => {
      const m = metrics[p.ticker];
      const price = m?.price ?? null;
      const value = price != null ? price * p.shares : null;
      const costValue = p.costBasis * p.shares;
      const gain = value != null ? value - costValue : null;
      const gainPct = value != null && costValue > 0 ? (value - costValue) / costValue : null;
      const currency = m?.currency ?? 'USD';
      return { p, m, price, value, costValue, gain, gainPct, currency, upside: m?.upside ?? null };
    });
  }, [positions, metrics]);

  const totals = useMemo(() => {
    let value = 0;
    let cost = 0;
    let haveValue = false;
    let weightedUpside = 0;
    let upsideWeight = 0;
    for (const r of rows) {
      cost += r.costValue;
      if (r.value != null) {
        value += r.value;
        haveValue = true;
        if (r.upside != null) {
          weightedUpside += r.upside * r.value;
          upsideWeight += r.value;
        }
      }
    }
    return {
      value: haveValue ? value : null,
      cost,
      gain: haveValue ? value - cost : null,
      gainPct: haveValue && cost > 0 ? (value - cost) / cost : null,
      weightedUpside: upsideWeight > 0 ? weightedUpside / upsideWeight : null,
    };
  }, [rows]);

  const currency = rows[0]?.currency ?? 'USD';

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    const sh = Number(shares);
    const cb = Number(cost);
    if (!t || !Number.isFinite(sh) || sh <= 0 || !Number.isFinite(cb) || cb < 0) return;
    upsert(t, sh, cb);
    setTicker('');
    setShares('');
    setCost('');
  };

  return (
    <div className="space-y-4">
      {/* Add position */}
      <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-blue-500/40 rounded-xl p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-gray-100">Portfolio</h3>
          <div className="text-[11px] text-gray-500">Positions · weighted DCF upside · gain/loss</div>
        </div>
        <form onSubmit={handleAdd} className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500 uppercase tracking-[0.14em]">Ticker</span>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="AAPL"
              className="w-28 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500 uppercase tracking-[0.14em]">Shares</span>
            <input
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="100"
              inputMode="decimal"
              className="w-24 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500 uppercase tracking-[0.14em]">Cost / share</span>
            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="150.00"
              inputMode="decimal"
              className="w-28 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"
            />
          </label>
          <button type="submit" className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors">
            Add / update
          </button>
          {loading && <span className="text-[11px] text-gray-500">refreshing…</span>}
        </form>
      </div>

      {positions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <IconTrendingUp size={44} className="mb-4 text-gray-700" />
          <h2 className="text-gray-300 text-lg font-semibold mb-2">Track what you own</h2>
          <p className="text-gray-500 text-sm max-w-md leading-relaxed">
            Add your holdings above to see live market value, gain/loss, position weights, and a
            value-weighted DCF upside across the whole portfolio. Stored locally in your browser.
          </p>
        </div>
      ) : (
        <>
          {/* Aggregates */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <AggTile label="Market Value" value={totals.value != null ? formatCurrency(totals.value, currency) : '—'} />
            <AggTile label="Cost Basis" value={formatCurrency(totals.cost, currency)} />
            <AggTile
              label="Unrealized Gain"
              value={totals.gain != null ? formatCurrency(totals.gain, currency) : '—'}
              tone={totals.gain == null ? undefined : totals.gain >= 0 ? 'up' : 'down'}
            />
            <AggTile
              label="Return"
              value={fmtSigned(totals.gainPct)}
              tone={totals.gainPct == null ? undefined : totals.gainPct >= 0 ? 'up' : 'down'}
            />
            <AggTile
              label="Wtd DCF Upside"
              value={fmtSigned(totals.weightedUpside)}
              tone={totals.weightedUpside == null ? undefined : totals.weightedUpside >= 0 ? 'up' : 'down'}
            />
          </div>

          {/* Positions table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-gray-800 text-gray-400">
                  <th className="py-2 pr-4 font-medium sticky left-0 bg-gray-900">Company</th>
                  <th className="py-2 px-3 font-medium text-right">Shares</th>
                  <th className="py-2 px-3 font-medium text-right">Cost/sh</th>
                  <th className="py-2 px-3 font-medium text-right">Price</th>
                  <th className="py-2 px-3 font-medium text-right">Mkt Value</th>
                  <th className="py-2 px-3 font-medium text-right">Weight</th>
                  <th className="py-2 px-3 font-medium text-right">Gain/Loss</th>
                  <th className="py-2 px-3 font-medium text-right">DCF Upside</th>
                  <th className="py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const weight = r.value != null && totals.value ? r.value / totals.value : null;
                  return (
                    <tr key={r.p.ticker} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                      <td className="py-2 pr-4 sticky left-0 bg-gray-900">
                        <button onClick={() => onSelectTicker(r.p.ticker)} className="flex items-center gap-2 text-left group">
                          <CompanyLogo ticker={r.p.ticker} size={20} />
                          <span>
                            <span className="font-mono font-semibold text-blue-400 group-hover:text-blue-300">
                              {r.p.ticker}
                            </span>
                            {r.m?.name && (
                              <span className="block text-[10px] text-gray-500 truncate max-w-[140px]">{r.m.name}</span>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="py-2 px-3 font-mono text-right text-gray-200">{r.p.shares.toLocaleString()}</td>
                      <td className="py-2 px-3 font-mono text-right text-gray-400">
                        {currencySymbol(r.currency)}{r.p.costBasis.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 font-mono text-right text-gray-200">
                        {r.price != null ? `${currencySymbol(r.currency)}${r.price.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono text-right text-gray-200">
                        {r.value != null ? formatCurrency(r.value, r.currency) : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono text-right text-gray-400">
                        {weight != null ? formatPercent(weight, 0) : '—'}
                      </td>
                      <td className={`py-2 px-3 font-mono text-right ${r.gain == null ? 'text-gray-500' : r.gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {r.gain != null ? (
                          <span>
                            {formatCurrency(r.gain, r.currency)}
                            <span className="text-[10px] ml-1">({fmtSigned(r.gainPct)})</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`py-2 px-3 font-mono text-right ${r.upside == null ? 'text-gray-500' : r.upside >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {fmtSigned(r.upside)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => remove(r.p.ticker)}
                          className="text-gray-600 hover:text-red-400"
                          title="Remove position"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 text-[10px] text-gray-600">
              Weighted DCF upside = value-weighted mean of each holding's MOS upside (data-driven
              default assumptions). Positions are stored locally — not investment advice.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AggTile({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'text-green-400' : tone === 'down' ? 'text-red-400' : 'text-gray-100';
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">{label}</div>
      <div className={`mt-1 font-mono font-semibold text-sm ${color}`}>{value}</div>
    </div>
  );
}
