import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, formatPercent, parseInputValue } from '../utils/formatting';
import { fetchTickerMetrics, runPool, TickerMetrics } from '../utils/tickerMetrics';
import { CompanyLogo } from './CompanyLogo';
import { IconSearch, IconSave } from './icons';

// ── Curated universes ────────────────────────────────────────────────────────
// Screening the full market is expensive, so v1 ships a few liquid large-cap
// universes plus the union of the user's watchlists.
const MEGA_CAP = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'AVGO', 'ORCL', 'ADBE', 'CRM',
  'CSCO', 'ACN', 'TXN', 'QCOM', 'AMD', 'INTC', 'TSLA', 'HD', 'MCD', 'NKE',
  'SBUX', 'COST', 'PG', 'KO', 'PEP', 'WMT', 'UNH', 'JNJ', 'LLY', 'ABBV',
  'MRK', 'TMO', 'V', 'MA', 'JPM', 'AXP', 'CAT', 'HON', 'UNP', 'XOM',
  'CVX', 'NFLX', 'DIS',
];
const BIG_TECH = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'AVGO', 'ORCL', 'NFLX',
  'AMD', 'CRM', 'ADBE',
];

// ── Filters ──────────────────────────────────────────────────────────────────
interface FilterDef {
  id: string;
  label: string;
  metric: keyof TickerMetrics;
  dir: 'min' | 'max';
  parse: 'money' | 'percent' | 'number';
  placeholder: string;
}

const FILTER_DEFS: FilterDef[] = [
  { id: 'minMktCap', label: 'Min Mkt Cap', metric: 'marketCap', dir: 'min', parse: 'money', placeholder: '10B' },
  { id: 'maxPE', label: 'Max P/E', metric: 'pe', dir: 'max', parse: 'number', placeholder: '30' },
  { id: 'maxPEG', label: 'Max PEG', metric: 'peg', dir: 'max', parse: 'number', placeholder: '2' },
  { id: 'minROIC', label: 'Min ROIC %', metric: 'roic', dir: 'min', parse: 'percent', placeholder: '15' },
  { id: 'minFcfeYield', label: 'Min FCFE Yld %', metric: 'fcfeYield', dir: 'min', parse: 'percent', placeholder: '4' },
  { id: 'minFcfCAGR', label: 'Min FCF Gr 5Y %', metric: 'fcfCAGR', dir: 'min', parse: 'percent', placeholder: '5' },
  { id: 'minEpsGrowth', label: 'Min EPS Gr %', metric: 'epsGrowthNext', dir: 'min', parse: 'percent', placeholder: '10' },
  { id: 'minUpside', label: 'Min DCF Upside %', metric: 'upside', dir: 'min', parse: 'percent', placeholder: '0' },
];

function parseThreshold(def: FilterDef, raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (def.parse === 'money') return parseInputValue(s);
  const n = Number(s.replace('%', ''));
  if (Number.isNaN(n)) return null;
  return def.parse === 'percent' ? n / 100 : n;
}

// ── Result columns ───────────────────────────────────────────────────────────
interface Column {
  key: keyof TickerMetrics;
  label: string;
  get: (r: TickerMetrics) => number | null;
  fmt: (r: TickerMetrics) => string;
  // higher value is "better" and best-in-column tinting is meaningful
  higherBetter?: boolean;
  tint?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'price', label: 'Price', get: (r) => r.price, fmt: (r) => formatCurrency(r.price, r.currency, false) },
  { key: 'marketCap', label: 'Mkt Cap', get: (r) => r.marketCap, fmt: (r) => formatCurrency(r.marketCap, r.currency, true) },
  { key: 'pe', label: 'P/E', get: (r) => r.pe, fmt: (r) => (r.pe != null ? `${r.pe.toFixed(1)}x` : '—'), higherBetter: false, tint: true },
  { key: 'peg', label: 'PEG', get: (r) => r.peg, fmt: (r) => (r.peg != null ? r.peg.toFixed(2) : '—'), higherBetter: false, tint: true },
  { key: 'roic', label: 'ROIC', get: (r) => r.roic, fmt: (r) => formatPercent(r.roic), higherBetter: true, tint: true },
  { key: 'fcfCAGR', label: 'FCF Gr 5Y', get: (r) => r.fcfCAGR, fmt: (r) => formatPercent(r.fcfCAGR), higherBetter: true, tint: true },
  { key: 'earningsYield', label: 'Earn Yld', get: (r) => r.earningsYield, fmt: (r) => formatPercent(r.earningsYield), higherBetter: true, tint: true },
  { key: 'fcfeYield', label: 'FCFE Yld', get: (r) => r.fcfeYield, fmt: (r) => formatPercent(r.fcfeYield), higherBetter: true, tint: true },
  { key: 'epsGrowthNext', label: 'EPS Gr NY', get: (r) => r.epsGrowthNext, fmt: (r) => formatPercent(r.epsGrowthNext), higherBetter: true, tint: true },
  { key: 'intrinsicMOS', label: 'Intrinsic (MOS)', get: (r) => r.intrinsicMOS, fmt: (r) => formatCurrency(r.intrinsicMOS, r.currency, false) },
  { key: 'upside', label: 'DCF Upside', get: (r) => r.upside, fmt: (r) => formatPercent(r.upside) },
];

// Named custom sets (formerly the Peers tab's saved sets).
interface CustomSet {
  name: string;
  tickers: string[];
}
const SETS_KEY = 'ev-screen-sets-v1';
function loadSets(): CustomSet[] {
  try {
    const raw = localStorage.getItem(SETS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p.filter((s) => s && typeof s.name === 'string' && Array.isArray(s.tickers));
    }
  } catch {}
  return [];
}

interface ScreenerTabProps {
  watchlistTickers: string[];
  /** Tickers in the ACTIVE watchlist — controls the ★ state of the Watch column. */
  watchedTickers: string[];
  onSelectTicker: (ticker: string) => void;
  onAddToWatchlist: (ticker: string, name: string, currency: string) => void;
}

type UniverseKey = 'mega' | 'tech' | 'watchlist' | 'custom';

// Persist the last universe + filters + custom list so the screener reopens
// where you left it.
const STORAGE_KEY = 'ev-screener-v1';

function loadStoredState(): {
  universeKey?: UniverseKey;
  filters?: Record<string, string>;
  customTickers?: string[];
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const universeKey = ['mega', 'tech', 'watchlist', 'custom'].includes(parsed?.universeKey)
        ? (parsed.universeKey as UniverseKey)
        : undefined;
      const filters =
        parsed?.filters && typeof parsed.filters === 'object' ? parsed.filters : undefined;
      const customTickers = Array.isArray(parsed?.customTickers) ? parsed.customTickers : undefined;
      return { universeKey, filters, customTickers };
    }
  } catch {}
  return {};
}

export function ScreenerTab({
  watchlistTickers,
  watchedTickers,
  onSelectTicker,
  onAddToWatchlist,
}: ScreenerTabProps) {
  const [universeKey, setUniverseKey] = useState<UniverseKey>(
    () => loadStoredState().universeKey ?? 'mega'
  );
  const [filters, setFilters] = useState<Record<string, string>>(
    () => loadStoredState().filters ?? {}
  );
  const [customTickers, setCustomTickers] = useState<string[]>(
    () => loadStoredState().customTickers ?? []
  );
  const [customInput, setCustomInput] = useState('');
  const [savedSets, setSavedSets] = useState<CustomSet[]>(() => loadSets());
  const [rows, setRows] = useState<TickerMetrics[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sortKey, setSortKey] = useState<keyof TickerMetrics>('upside');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Persist universe + filters + custom list across sessions.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ universeKey, filters, customTickers }));
    } catch {}
  }, [universeKey, filters, customTickers]);

  const persistSets = (sets: CustomSet[]) => {
    setSavedSets(sets);
    try {
      localStorage.setItem(SETS_KEY, JSON.stringify(sets));
    } catch {}
  };

  const addCustom = (raw: string) => {
    const parts = raw
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (parts.length) setCustomTickers((prev) => Array.from(new Set([...prev, ...parts])));
  };

  const watched = useMemo(
    () => new Set(watchedTickers.map((t) => t.toUpperCase())),
    [watchedTickers]
  );

  const universe = useMemo(() => {
    if (universeKey === 'tech') return BIG_TECH;
    if (universeKey === 'watchlist') return Array.from(new Set(watchlistTickers.map((t) => t.toUpperCase())));
    if (universeKey === 'custom') return customTickers;
    return MEGA_CAP;
  }, [universeKey, watchlistTickers, customTickers]);

  const running = progress != null && progress.done < progress.total;
  const stopRef = useRef(false);

  const runScreen = async () => {
    if (!universe.length) return;
    stopRef.current = false;
    setRows([]);
    setProgress({ done: 0, total: universe.length });
    // Stream rows into the table as each ticker settles; stop dispatching new
    // fetches as soon as the user hits Stop.
    await runPool(
      universe,
      fetchTickerMetrics,
      6,
      (_ticker, result) => {
        if (result) setRows((prev) => [...prev, result]);
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      },
      () => stopRef.current
    );
    // Clear the "running" state whether it finished or was stopped early.
    setProgress((p) => (p ? { ...p, total: p.done } : p));
  };

  const stopScreen = () => {
    stopRef.current = true;
  };

  // Apply active filters.
  const passing = useMemo(() => {
    const active = FILTER_DEFS.map((def) => ({ def, threshold: parseThreshold(def, filters[def.id] ?? '') })).filter(
      (f) => f.threshold != null
    );
    return rows.filter((r) =>
      active.every(({ def, threshold }) => {
        const v = r[def.metric] as number | null;
        if (v == null) return false; // can't satisfy a filter on a missing metric
        return def.dir === 'min' ? v >= threshold! : v <= threshold!;
      })
    );
  }, [rows, filters]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    return [...passing].sort((a, b) => {
      const va = col ? col.get(a) : null;
      const vb = col ? col.get(b) : null;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [passing, sortKey, sortDir]);

  // Best value per tint-able column (O(1) lookup during cell render).
  const bestByColumn = useMemo(() => {
    const best: Record<string, number> = {};
    if (sorted.length <= 1) return best;
    for (const c of COLUMNS) {
      if (!c.tint) continue;
      let acc: number | null = null;
      for (const r of sorted) {
        const v = c.get(r);
        if (v == null) continue;
        acc = acc == null ? v : c.higherBetter ? Math.max(acc, v) : Math.min(acc, v);
      }
      if (acc != null) best[c.key] = acc;
    }
    return best;
  }, [sorted]);

  const toggleSort = (key: keyof TickerMetrics) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const activeFilterCount = FILTER_DEFS.filter((d) => parseThreshold(d, filters[d.id] ?? '') != null).length;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-gray-100">Screener</h3>
          <div className="text-[11px] text-gray-500">
            EDGAR + Yahoo · DCF on data-driven defaults
          </div>
        </div>

        {/* Universe + run */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-gray-400">Universe:</span>
          <div className="inline-flex rounded-md border border-gray-700 divide-x divide-gray-800 overflow-hidden text-[11px]">
            {([
              { key: 'mega', label: `Mega Cap (${MEGA_CAP.length})` },
              { key: 'tech', label: `Big Tech (${BIG_TECH.length})` },
              { key: 'watchlist', label: `My Watchlists (${new Set(watchlistTickers).size})` },
              { key: 'custom', label: `Custom (${customTickers.length})` },
            ] as const).map((u) => (
              <button
                key={u.key}
                onClick={() => setUniverseKey(u.key)}
                className={`px-3 py-1 font-medium transition-colors ${
                  universeKey === u.key ? 'bg-blue-500/15 text-blue-300' : 'bg-gray-900 text-gray-400 hover:bg-gray-800'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
          <button
            onClick={runScreen}
            disabled={running || universe.length === 0}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              running || universe.length === 0
                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-500'
            }`}
          >
            {running ? `Screening… ${progress!.done}/${progress!.total}` : 'Run Screen'}
          </button>
          {running && (
            <button
              onClick={stopScreen}
              className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-500 transition-colors"
              title="Stop the screen — keeps the results fetched so far"
            >
              ■ Stop
            </button>
          )}
          {universeKey === 'watchlist' && watchlistTickers.length === 0 && (
            <span className="text-[11px] text-amber-500/80">Your watchlists are empty.</span>
          )}
        </div>

        {/* Custom universe — ad-hoc tickers + saved sets (absorbed from Peers) */}
        {universeKey === 'custom' && (
          <div className="space-y-2 border-t border-gray-800 pt-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addCustom(customInput);
                setCustomInput('');
              }}
              className="flex gap-2"
            >
              <input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="Add tickers to compare (e.g. AAPL, MSFT, GOOGL)"
                className="flex-1 bg-gray-950 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"
              />
              <button type="submit" className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors">
                Add
              </button>
            </form>
            {customTickers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {customTickers.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono border border-gray-700 bg-gray-800 text-gray-300">
                    {t}
                    <button
                      onClick={() => setCustomTickers((prev) => prev.filter((x) => x !== t))}
                      className="text-gray-500 hover:text-gray-200"
                      title="Remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Saved sets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide mr-1">Saved sets:</span>
              {savedSets.length === 0 && <span className="text-[11px] text-gray-600">none yet</span>}
              {savedSets.map((s) => (
                <span key={s.name} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border border-gray-700 bg-gray-800 text-gray-300">
                  <button
                    onClick={() => setCustomTickers(s.tickers)}
                    className="hover:text-blue-300 transition-colors"
                    title={s.tickers.join(', ')}
                  >
                    {s.name}
                    <span className="text-gray-500 ml-1">({s.tickers.length})</span>
                  </button>
                  <button
                    onClick={() => persistSets(savedSets.filter((x) => x.name !== s.name))}
                    className="text-gray-600 hover:text-red-400"
                    title="Delete set"
                  >
                    ×
                  </button>
                </span>
              ))}
              {customTickers.length > 0 && (
                <button
                  onClick={() => {
                    const name = window.prompt('Name this set:', '')?.trim();
                    if (name) persistSets([...savedSets.filter((s) => s.name !== name), { name, tickers: customTickers }]);
                  }}
                  className="ml-auto px-2 py-1 text-[10px] rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                  title="Save the current tickers as a named set"
                >
                  <IconSave size={11} className="inline -mt-0.5 mr-1" />
                  Save current as set
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-1">
          {FILTER_DEFS.map((def) => (
            <label key={def.id} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-500">{def.label}</span>
              <input
                value={filters[def.id] ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, [def.id]: e.target.value }))}
                placeholder={def.placeholder}
                className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"
              />
            </label>
          ))}
        </div>
        {(activeFilterCount > 0 || rows.length > 0) && (
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            {rows.length > 0 && (
              <span>
                <span className="text-gray-300 font-mono">{sorted.length}</span> of{' '}
                <span className="text-gray-300 font-mono">{rows.length}</span> pass
                {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active` : ''}
              </span>
            )}
            {activeFilterCount > 0 && (
              <button onClick={() => setFilters({})} className="underline hover:text-gray-300">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <IconSearch size={44} className="mb-4 text-gray-700" />
          <h2 className="text-gray-300 text-lg font-semibold mb-2">Find ideas across a universe</h2>
          <p className="text-gray-500 text-sm max-w-md leading-relaxed">
            Pick a universe (or build a <span className="text-gray-300">Custom</span> set of tickers
            to compare), set any filters, and run the screen. Each name is valued with its own
            data-driven default DCF. Click a ticker to open the full analysis. First run fetches live
            data and may take a moment.
          </p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-gray-800">
                <th className="py-2 pr-4 text-gray-400 font-medium sticky left-0 bg-gray-900">Company</th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`py-2 px-3 font-medium text-right whitespace-nowrap cursor-pointer select-none hover:text-gray-200 ${
                      sortKey === c.key ? 'text-blue-300' : 'text-gray-400'
                    }`}
                  >
                    {c.label}
                    {sortKey === c.key && (sortDir === 'desc' ? ' ▾' : ' ▴')}
                  </th>
                ))}
                <th className="py-2 px-3 text-gray-400 font-medium text-center whitespace-nowrap">
                  Watch
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.ticker} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                  <td className="py-2 pr-4 sticky left-0 bg-gray-900">
                    <button
                      onClick={() => onSelectTicker(r.ticker)}
                      className="flex items-center gap-2 text-left group"
                      title="Open full analysis"
                    >
                      <CompanyLogo ticker={r.ticker} size={20} />
                      <span>
                        <span className="font-mono font-semibold text-blue-400 group-hover:text-blue-300">
                          {r.ticker}
                        </span>
                        {r.name && (
                          <span className="block text-[10px] text-gray-500 truncate max-w-[140px]">
                            {r.name}
                          </span>
                        )}
                      </span>
                    </button>
                  </td>
                  {COLUMNS.map((c) => {
                    const v = c.get(r);
                    let cls = 'text-gray-200';
                    if (c.key === 'upside' && v != null) {
                      cls = v >= 0 ? 'text-green-400' : 'text-red-400';
                    } else if (c.tint && v != null && v === bestByColumn[c.key]) {
                      cls = 'text-emerald-300 font-semibold';
                    }
                    return (
                      <td key={c.key} className={`py-2 px-3 font-mono text-right whitespace-nowrap ${cls}`}>
                        {c.fmt(r)}
                      </td>
                    );
                  })}
                  <td className="py-2 px-3 text-center">
                    {watched.has(r.ticker) ? (
                      <span className="text-yellow-400 text-xs" title="In your active watchlist">
                        ★
                      </span>
                    ) : (
                      <button
                        onClick={() => onAddToWatchlist(r.ticker, r.name ?? '', r.currency)}
                        className="px-2 py-0.5 text-[10px] rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                        title="Add to your active watchlist"
                      >
                        + Watch
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="py-6 text-center text-gray-500">
                    No names pass the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-2 text-[10px] text-gray-600">
            <span className="text-emerald-300">Green</span> = best in column · Intrinsic (MOS) and
            DCF Upside use each company's data-driven default DCF assumptions.
          </div>
        </div>
      )}
    </div>
  );
}
