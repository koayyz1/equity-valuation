import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { SearchBar } from './components/SearchBar';
import { FinancialDashboard } from './components/FinancialDashboard';
import { AssumptionsPanel } from './components/AssumptionsPanel';
import { DCFModel } from './components/DCFModel';
import { DCFDeepDive } from './components/DCFDeepDive';
import { FCFYModel } from './components/FCFYModel';
import { FcfeGuard } from './components/FcfeGuard';
import { IconLink, IconStar, IconTrendingUp } from './components/icons';

// Route-level tab components are code-split so the initial bundle (the Valuation
// tab) doesn't ship recharts (ReportTab only) or the other tabs up front.
const WatchlistTab = lazy(() =>
  import('./components/WatchlistTab').then((m) => ({ default: m.WatchlistTab }))
);
const ReportTab = lazy(() =>
  import('./components/ReportTab').then((m) => ({ default: m.ReportTab }))
);
const DeepDiveTab = lazy(() =>
  import('./components/DeepDiveTab').then((m) => ({ default: m.DeepDiveTab }))
);
const MethodologyTab = lazy(() =>
  import('./components/MethodologyTab').then((m) => ({ default: m.MethodologyTab }))
);
const ScreenerTab = lazy(() =>
  import('./components/ScreenerTab').then((m) => ({ default: m.ScreenerTab }))
);
const PortfolioTab = lazy(() =>
  import('./components/PortfolioTab').then((m) => ({ default: m.PortfolioTab }))
);
import { useCompanyData } from './hooks/useCompanyData';
import { useWatchlist } from './hooks/useWatchlist';
import { computeDefaultAssumptions, calculateDCF, DEFAULT_GROWTH_DECAY } from './utils/calculations';
import { resolveValuationInputs } from './utils/valuationInputs';
import { buildShareUrl, decodeShareState } from './utils/shareState';
import { getPreset } from './utils/presets';
import { DCFAssumptions, FinancialData, Overrides } from './types';

// Static base — non-dynamic fields; used as the template for computed defaults.
const baseAssumptions: DCFAssumptions = {
  growthRate: 0.15,
  growthDecay: DEFAULT_GROWTH_DECAY,
  terminalGrowth: 0.03,
  discountRate: 0.11,
  uncertainty: 2,
  excessCashRatio: 0.02,
  capexOverrides: [null, null, null, null, null],
  netBorrowingOverrides: [null, null, null, null, null],
};

type Tab = 'home' | 'detail' | 'watchlist' | 'report' | 'deepdive' | 'methodology' | 'screener' | 'portfolio';

// Rail-style tab: quiet text with a bottom indicator bar instead of a filled
// pill, so blue-600 fill stays reserved for primary actions.
function TabButton({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative h-full flex items-center gap-1.5 px-3 text-xs transition-colors ${
        active ? 'text-white' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
      {badge}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-blue-500" />
      )}
    </button>
  );
}

export default function App() {
  const { companyInfo, financials, priceData, loading, error, fetchCompany } = useCompanyData();
  const [overrides, setOverrides] = useState<Overrides>({});
  const [assumptions, setAssumptions] = useState<DCFAssumptions>(baseAssumptions);
  // Per-ticker computed defaults — used by DCFModel for right-click reset.
  const [defaultAssumptions, setDefaultAssumptions] =
    useState<DCFAssumptions>(baseAssumptions);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [shareCopied, setShareCopied] = useState(false);
  // Keep the user-built, ticker-independent tabs (Screener, Portfolio) mounted
  // once visited so switching away and back doesn't discard their state and
  // refetch. They're hidden with CSS rather than unmounted.
  const [visitedScreener, setVisitedScreener] = useState(false);
  const [visitedPortfolio, setVisitedPortfolio] = useState(false);
  useEffect(() => {
    if (activeTab === 'screener') setVisitedScreener(true);
    if (activeTab === 'portfolio') setVisitedPortfolio(true);
  }, [activeTab]);
  // Holds assumptions/overrides decoded from a share link until financials arrive.
  const pendingRestoreRef = useRef<{ assumptions: DCFAssumptions; overrides: Overrides } | null>(null);
  const {
    lists, activeList, activeId,
    createList, renameList, deleteList, setActiveList,
    add, remove, updateAssumptions, updateNotes, reorder, isWatched,
  } = useWatchlist();

  // When financials load, set the data-driven defaults. Precedence for the
  // active assumptions: share-link restore > saved per-ticker preset > defaults.
  useEffect(() => {
    if (financials) {
      const def = computeDefaultAssumptions(financials.fcfHistory ?? [], baseAssumptions);
      setDefaultAssumptions(def);
      const pending = pendingRestoreRef.current;
      if (pending) {
        setAssumptions(pending.assumptions);
        setOverrides(pending.overrides);
        pendingRestoreRef.current = null;
      } else {
        const preset = companyInfo ? getPreset(companyInfo.ticker) : null;
        setAssumptions(preset ?? def);
      }
    }
  }, [financials, companyInfo]);

  // On first load, restore a shared analysis from the ?s= URL param.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('s');
    if (!param) return;
    const decoded = decodeShareState(param);
    if (decoded) {
      pendingRestoreRef.current = {
        assumptions: decoded.assumptions,
        overrides: decoded.overrides,
      };
      setActiveTab('detail');
      fetchCompany(decoded.ticker);
    }
    // Clear the param so a later manual search / refresh isn't re-restored.
    window.history.replaceState({}, '', window.location.pathname);
  }, [fetchCompany]);

  const handleSearch = useCallback(
    (ticker: string) => {
      setOverrides({});
      setAssumptions(baseAssumptions); // temporary until financials arrive
      fetchCompany(ticker);
      // Leave the current analysis tab alone — except the Home landing, which
      // should hand off to General once a ticker is chosen.
      setActiveTab((t) => (t === 'home' ? 'report' : t));
    },
    [fetchCompany]
  );

  const handleOverride = useCallback(
    (field: keyof FinancialData, value: number | null | undefined) => {
      setOverrides((prev) => {
        const next = { ...prev };
        if (value === undefined) {
          delete next[field];
        } else {
          next[field] = value;
        }
        return next;
      });
    },
    []
  );

  const handleAddToWatchlist = useCallback(() => {
    if (!companyInfo || !financials) return;
    add(
      companyInfo.ticker,
      companyInfo.name || financials.entityName || '',
      financials.currency || 'USD',
      assumptions,
      overrides
    );
  }, [companyInfo, financials, assumptions, overrides, add]);

  const handleSelectWatchlistTicker = useCallback(
    (ticker: string) => {
      handleSearch(ticker);
      setActiveTab('detail');
    },
    [handleSearch]
  );

  // Quick-add from the Screener: base assumptions are fine — the Watchlist tab
  // replaces them with data-driven defaults when the entry first loads.
  const handleQuickAddToWatchlist = useCallback(
    (ticker: string, name: string, currency: string) => {
      add(ticker, name, currency, baseAssumptions, {});
    },
    [add]
  );

  // Copy a shareable link encoding the current ticker + assumptions + overrides.
  const handleShare = useCallback(() => {
    if (!companyInfo) return;
    const url = buildShareUrl({ ticker: companyInfo.ticker, assumptions, overrides });
    const done = () => {
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => window.prompt('Copy this link:', url));
    } else {
      window.prompt('Copy this link:', url);
    }
  }, [companyInfo, assumptions, overrides]);

  const hasData = !loading && financials && priceData && companyInfo;
  const watched = companyInfo ? isWatched(companyInfo.ticker) : false;
  const totalWatched = lists.reduce((s, l) => s + l.entries.length, 0);
  const watchlistTickers = lists.flatMap((l) => l.entries.map((e) => e.ticker));

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-5 py-3 flex items-center gap-5">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-violet-600 rounded-md flex items-center justify-center shadow-[0_0_16px_-4px_rgba(99,102,241,0.6)]">
              <span className="text-white text-xs font-bold">EV</span>
            </div>
            <div>
              <div className="font-semibold text-sm text-gray-100 leading-tight">EquityVal</div>
              <div className="text-[10px] text-gray-400 leading-tight">EDGAR + DCF terminal</div>
            </div>
          </div>
          <SearchBar onSearch={handleSearch} loading={loading} />

          {/* Tab rail — Home | analysis | portfolio tools (docs lives right) */}
          <nav className="flex items-stretch ml-2 self-stretch -my-3">
            <TabButton label="Home" active={activeTab === 'home'} onClick={() => setActiveTab('home')} />
            <div className="w-px h-4 bg-gray-800 mx-1.5 self-center" />
            <TabButton label="General" active={activeTab === 'report'} onClick={() => setActiveTab('report')} />
            <TabButton label="Valuation" active={activeTab === 'detail'} onClick={() => setActiveTab('detail')} />
            <TabButton label="Deep Dive" active={activeTab === 'deepdive'} onClick={() => setActiveTab('deepdive')} />
            <div className="w-px h-4 bg-gray-800 mx-1.5 self-center" />
            <TabButton label="Screener" active={activeTab === 'screener'} onClick={() => setActiveTab('screener')} />
            <TabButton label="Portfolio" active={activeTab === 'portfolio'} onClick={() => setActiveTab('portfolio')} />
            <TabButton
              label="Watchlist"
              active={activeTab === 'watchlist'}
              onClick={() => setActiveTab('watchlist')}
              badge={
                totalWatched > 0 ? (
                  <span className="text-[10px] font-bold px-1 rounded bg-gray-800 text-gray-300">
                    {totalWatched}
                  </span>
                ) : undefined
              }
            />
          </nav>

          {/* Right side: contextual actions + Docs link. No ml-auto — the search
              bar's flex-grow fills the space instead, pushing the tabs right. */}
          <div className="flex items-center gap-2">
            {hasData && activeTab === 'detail' && (
              <>
                <button
                  onClick={handleShare}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    shareCopied
                      ? 'border-green-600 bg-green-900/30 text-green-400'
                      : 'border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                  title="Copy a link that restores this ticker, assumptions, and overrides"
                >
                  {shareCopied ? '✓ Link copied' : (<><IconLink size={13} /> Share</>)}
                </button>
                <button
                  onClick={handleAddToWatchlist}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    watched
                      ? 'border-yellow-600 bg-yellow-900/30 text-yellow-400 hover:bg-yellow-900/50'
                      : 'border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                  title={watched ? 'Update watchlist entry with current assumptions' : 'Add to watchlist'}
                >
                  <IconStar size={13} filled={watched} /> {watched ? 'In Watchlist' : 'Watchlist'}
                </button>
              </>
            )}
            {!hasData && (
              <span className="text-[10px] text-gray-400 hidden md:block">
                SEC EDGAR · Yahoo Finance · Live
              </span>
            )}
            <button
              onClick={() => setActiveTab('methodology')}
              className={`text-xs px-2 py-1 transition-colors ${
                activeTab === 'methodology'
                  ? 'text-gray-200 underline underline-offset-4 decoration-gray-600'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              title="Methodology — how the DCF and FCFY models work"
            >
              Docs
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-5 py-5 space-y-5">
        {/* ── Home / welcome ── */}
        {activeTab === 'home' && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <IconTrendingUp size={52} className="mb-5 text-gray-700" />
            <h2 className="text-gray-200 text-2xl font-semibold mb-2">Enter a ticker to begin</h2>
            <p className="text-gray-500 text-sm max-w-md leading-relaxed mb-6">
              Search any US-listed company. Financials pull live from SEC EDGAR's XBRL API, with
              Yahoo Finance for prices.
            </p>
            <div className="w-full max-w-md flex">
              <SearchBar onSearch={handleSearch} loading={loading} />
            </div>
            <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-xl">
              {['AAPL', 'MSFT', 'GOOGL', 'META', 'NVDA', 'ASML', 'SIRI', 'BRK.B'].map((t) => (
                <button
                  key={t}
                  onClick={() => handleSearch(t)}
                  className="px-3 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-md text-xs font-mono text-gray-300"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        <Suspense
          fallback={
            <div className="flex items-center justify-center py-24 text-gray-600 text-sm">
              Loading…
            </div>
          }
        >
        {/* ── Methodology tab ── */}
        {activeTab === 'methodology' && <MethodologyTab />}

        {/* ── Report tab ── */}
        {activeTab === 'report' && (
          <ReportTab
            ticker={companyInfo?.ticker ?? null}
            assumptions={assumptions}
            overrides={overrides}
            financials={financials}
            priceData={priceData}
            cik={companyInfo?.cik ?? null}
          />
        )}

        {/* ── Deep Dive tab ── */}
        {activeTab === 'deepdive' && (
          <DeepDiveTab ticker={companyInfo?.ticker ?? null} />
        )}

        {/* ── Screener tab (kept mounted once visited) ── */}
        {visitedScreener && (
          <div className={activeTab === 'screener' ? '' : 'hidden'}>
            <ScreenerTab
              watchlistTickers={watchlistTickers}
              watchedTickers={activeList.entries.map((e) => e.ticker)}
              onSelectTicker={handleSelectWatchlistTicker}
              onAddToWatchlist={handleQuickAddToWatchlist}
            />
          </div>
        )}

        {/* ── Portfolio tab (kept mounted once visited) ── */}
        {visitedPortfolio && (
          <div className={activeTab === 'portfolio' ? '' : 'hidden'}>
            <PortfolioTab onSelectTicker={handleSelectWatchlistTicker} />
          </div>
        )}

        {/* ── Watchlist tab ── */}
        {activeTab === 'watchlist' && (
          <WatchlistTab
            lists={lists}
            activeList={activeList}
            activeId={activeId}
            onSelectList={setActiveList}
            onCreateList={() => {
              const name = window.prompt('Name for new watchlist:', 'New List');
              if (name?.trim()) createList(name.trim());
            }}
            onRenameList={renameList}
            onDeleteList={deleteList}
            onRemove={remove}
            onAssumptionChange={updateAssumptions}
            onUpdateNotes={updateNotes}
            onReorder={reorder}
            onSelectTicker={handleSelectWatchlistTicker}
          />
        )}

        {/* ── Detail / Analysis tab ── */}
        {activeTab === 'detail' && (
          <>
            {/* Error State */}
            {error && (
              <div className="bg-red-950/50 border border-red-900 rounded-lg p-4 text-red-300 text-sm">
                <div className="font-semibold mb-1">Error</div>
                <div className="text-red-200/80">{error}</div>
                {error.toLowerCase().includes('not found') && (
                  <div className="mt-2 text-xs text-gray-400">
                    This ticker may be an OTC ADR with no SEC filings, or a foreign filer not in
                    the primary tickers list. For foreign IFRS filers (e.g., ASML), use the root
                    symbol. For pure OTC, all fields can be manually overridden by double-clicking
                    values in the dashboard.
                  </div>
                )}
              </div>
            )}

            {/* Loading Skeleton */}
            {loading && (
              <div className="space-y-4 animate-pulse">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg h-16" />
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg h-44" />
                  ))}
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <div className="bg-gray-900 border border-gray-800 rounded-xl h-96" />
                  <div className="bg-gray-900 border border-gray-800 rounded-xl h-96" />
                </div>
              </div>
            )}

            {/* Data Loaded */}
            {hasData && (
              <>
                <FinancialDashboard
                  ticker={companyInfo.ticker}
                  companyName={companyInfo.name}
                  financials={financials}
                  priceData={priceData}
                  overrides={overrides}
                  onOverride={handleOverride}
                />

                <AssumptionsPanel
                  ticker={companyInfo.ticker}
                  financials={financials}
                  priceData={priceData}
                  overrides={overrides}
                  assumptions={assumptions}
                  defaultAssumptions={defaultAssumptions}
                  onAssumptionsChange={setAssumptions}
                />

                <FcfeGuard financials={financials} overrides={overrides} />

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <DCFModel
                    financials={financials}
                    priceData={priceData}
                    overrides={overrides}
                    assumptions={assumptions}
                  />
                  <FCFYModel
                    financials={financials}
                    priceData={priceData}
                    overrides={overrides}
                    assumptions={assumptions}
                    referenceUndervalued={(() => {
                      const inp = resolveValuationInputs(financials, overrides);
                      const r = calculateDCF(inp.fcfe, inp.cash, inp.revenue, inp.shares, assumptions, {
                        capex: inp.capex,
                        netBorrowing: inp.netBorrowing,
                      });
                      return r.dcfPriceMOS != null && priceData.price != null
                        ? priceData.price < r.dcfPriceMOS
                        : null;
                    })()}
                  />
                </div>

                <DCFDeepDive
                  financials={financials}
                  priceData={priceData}
                  overrides={overrides}
                  assumptions={assumptions}
                  defaultAssumptions={defaultAssumptions}
                  onAssumptionsChange={setAssumptions}
                />
              </>
            )}

            {/* Empty state */}
            {!loading && !financials && !error && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <IconTrendingUp size={44} className="mb-4 text-gray-700" />
                <h2 className="text-gray-300 text-lg font-semibold mb-2">Enter a ticker to begin</h2>
                <p className="text-gray-500 text-sm max-w-md leading-relaxed">
                  Search any US-listed company by ticker. Financials pull live from SEC EDGAR's XBRL
                  API, with Yahoo Finance for prices. Double-click any value to override.
                </p>
                <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-xl">
                  {['AAPL', 'MSFT', 'GOOGL', 'META', 'NVDA', 'ASML', 'SIRI', 'BRK.B'].map((t) => (
                    <button
                      key={t}
                      onClick={() => handleSearch(t)}
                      className="px-3 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-md text-xs font-mono text-gray-300"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        </Suspense>

        {/* Footer */}
        <div className="text-center text-[10px] text-gray-700 pt-8 pb-4">
          Data: SEC EDGAR XBRL (US-GAAP / IFRS) · Prices: Yahoo Finance · Not investment advice
        </div>
      </main>
    </div>
  );
}
