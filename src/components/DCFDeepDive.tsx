import { useMemo, useState } from 'react';
import { DCFAssumptions, DCFResult, FinancialData, Overrides, PriceData } from '../types';
import {
  calculateDCF,
  getMOS,
  reverseDCFGrowth,
  scenarioAssumptions,
  growthPath,
  PHASE_SPLIT_YEAR,
  DEFAULT_GROWTH_DECAY,
} from '../utils/calculations';
import { resolveValuationInputs } from '../utils/valuationInputs';
import { formatCurrency, formatPercent } from '../utils/formatting';
import { ProjectionTable } from './ProjectionTable';
import { SensitivityTable } from './SensitivityTable';
import { ValuationBridge } from './ValuationBridge';

interface DCFDeepDiveProps {
  financials: FinancialData;
  priceData: PriceData;
  overrides: Overrides;
  assumptions: DCFAssumptions;
  defaultAssumptions: DCFAssumptions;
  onAssumptionsChange: (a: DCFAssumptions) => void;
}

/**
 * Full-width DCF analysis tools: Bear/Base/Bull scenarios, reverse DCF, the
 * valuation bridge, the sensitivity grid, and the 10-year projection. Separated
 * from the core DCF card so these wide tables get room to breathe.
 */
export function DCFDeepDive({
  financials,
  priceData,
  overrides,
  assumptions,
  defaultAssumptions,
  onAssumptionsChange,
}: DCFDeepDiveProps) {
  const [showBridge, setShowBridge] = useState(false);
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const { fcfe, cash, revenue, shares, capex, netBorrowing } = resolveValuationInputs(
    financials,
    overrides
  );
  const currency = priceData.currency || financials.currency || 'USD';
  const mos = getMOS(assumptions.uncertainty);

  const result = useMemo(
    () => calculateDCF(fcfe, cash, revenue, shares, assumptions, { capex, netBorrowing }),
    [fcfe, cash, revenue, shares, assumptions, capex, netBorrowing]
  );
  const hasResult = result.dcfPrice != null;

  // Bear / Base / Bull scenarios derived from the data-driven defaults.
  const scenarios = useMemo(() => scenarioAssumptions(defaultAssumptions), [defaultAssumptions]);
  const scenarioPrices = useMemo(() => {
    const price = (a: DCFAssumptions) =>
      calculateDCF(fcfe, cash, revenue, shares, a, { capex, netBorrowing }).dcfPrice;
    return {
      bear: price(scenarios.bear),
      base: price(scenarios.base),
      bull: price(scenarios.bull),
    };
  }, [scenarios, fcfe, cash, revenue, shares, capex, netBorrowing]);

  // Reverse DCF: growth-phase rate the current price implies (other assumptions fixed).
  const impliedGrowth = useMemo(
    () =>
      reverseDCFGrowth(fcfe, cash, revenue, shares, assumptions, priceData.price ?? null, {
        capex,
        netBorrowing,
      }),
    [fcfe, cash, revenue, shares, assumptions, priceData.price, capex, netBorrowing]
  );

  const sameAssumptions = (a: DCFAssumptions, b: DCFAssumptions) =>
    Math.abs(a.growthRate - b.growthRate) < 1e-6 &&
    Math.abs((a.growthDecay ?? 0) - (b.growthDecay ?? 0)) < 1e-6 &&
    Math.abs(a.terminalGrowth - b.terminalGrowth) < 1e-6 &&
    Math.abs(a.discountRate - b.discountRate) < 1e-6 &&
    a.uncertainty === b.uncertainty;
  const activeScenario = sameAssumptions(assumptions, scenarios.bear)
    ? 'bear'
    : sameAssumptions(assumptions, scenarios.bull)
    ? 'bull'
    : sameAssumptions(assumptions, scenarios.base)
    ? 'base'
    : null;

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-blue-500/40 rounded-xl p-4 space-y-3">
      <h3 className="text-gray-100 font-semibold text-sm">DCF Analysis</h3>

      {/* Present-value breakdown — the three additive terms of the closed-form DCF */}
      {hasResult && (
        <PVBreakdown result={result} splitYear={PHASE_SPLIT_YEAR} currency={currency} />
      )}

      {/* Scenarios + Reverse DCF, side by side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bear / Base / Bull scenarios */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
            Scenarios — click to apply
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { key: 'bear', label: 'Bear', a: scenarios.bear, price: scenarioPrices.bear, tone: 'red' },
              { key: 'base', label: 'Base', a: scenarios.base, price: scenarioPrices.base, tone: 'blue' },
              { key: 'bull', label: 'Bull', a: scenarios.bull, price: scenarioPrices.bull, tone: 'green' },
            ] as const).map((s) => {
              const active = activeScenario === s.key;
              const toneRing =
                s.tone === 'red'
                  ? 'border-red-800'
                  : s.tone === 'green'
                  ? 'border-green-800'
                  : 'border-blue-800';
              const toneText =
                s.tone === 'red'
                  ? 'text-red-400'
                  : s.tone === 'green'
                  ? 'text-green-400'
                  : 'text-blue-300';
              return (
                <button
                  key={s.key}
                  onClick={() => onAssumptionsChange(s.a)}
                  className={`rounded-lg p-2 border text-left transition-colors ${toneRing} ${
                    active
                      ? 'bg-gray-800 ring-1 ring-inset ring-gray-500'
                      : 'bg-gray-950/50 hover:bg-gray-800/60'
                  }`}
                  title={`Growth ${formatPercent(s.a.growthRate)} · Disc ${formatPercent(
                    s.a.discountRate
                  )} · Term ${formatPercent(s.a.terminalGrowth)} · MOS ${formatPercent(
                    getMOS(s.a.uncertainty),
                    0
                  )}`}
                >
                  <div className={`text-[10px] uppercase tracking-wider ${toneText}`}>{s.label}</div>
                  <div className="text-white font-mono font-bold text-sm">
                    {s.price != null ? formatCurrency(s.price, currency, false) : 'N/A'}
                  </div>
                  <div className="text-[9px] text-gray-500 font-mono">
                    g {formatPercent(s.a.growthRate, 0)} · r {formatPercent(s.a.discountRate, 0)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Reverse DCF */}
        {priceData.price != null && (
          <div>
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">
                Reverse DCF — growth priced in
              </div>
              <div className="font-mono text-sm font-bold text-blue-300">
                {impliedGrowth == null
                  ? '> 500%'
                  : impliedGrowth <= -0.9
                  ? '< −90%'
                  : formatPercent(impliedGrowth)}
              </div>
            </div>
            <div className="text-[10px] text-gray-500 mt-1 leading-relaxed">
              Growth-phase FCFE rate the current price implies (steady, terminal &amp; discount
              rates held fixed).{' '}
              {impliedGrowth != null && impliedGrowth > -0.9 && (
                <>
                  You assume{' '}
                  <span className="text-gray-300 font-mono">
                    {formatPercent(assumptions.growthRate)}
                  </span>
                  {financials.fcfCAGR != null && (
                    <>
                      {' '}· 5Y historical FCF CAGR{' '}
                      <span className="text-gray-300 font-mono">
                        {formatPercent(financials.fcfCAGR)}
                      </span>
                    </>
                  )}
                  .{' '}
                  {financials.fcfCAGR != null && (
                    <span
                      className={
                        impliedGrowth > financials.fcfCAGR ? 'text-red-400' : 'text-green-400'
                      }
                    >
                      {impliedGrowth > financials.fcfCAGR
                        ? 'Market expects more than history delivered.'
                        : 'Market expects less than history delivered.'}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Valuation Bridge Toggle */}
      <div className="border-t border-gray-800 pt-3">
        <button
          onClick={() => setShowBridge((v) => !v)}
          className="text-[11px] text-gray-400 hover:text-gray-200 flex items-center gap-1"
        >
          {showBridge ? '▾' : '▸'} Valuation Bridge — how NPV becomes the per-share price
        </button>
        {showBridge && hasResult && (
          <div className="mt-2 bg-gray-950/50 border border-gray-800 rounded-lg p-3 max-w-xl">
            <ValuationBridge
              yearlyFCFE={result.yearlyFCFE}
              terminalValue={result.terminalValue}
              npv={result.npv}
              excessCash={result.excessCash}
              discountRate={assumptions.discountRate}
              shares={shares}
              mos={mos}
              dcfPrice={result.dcfPrice}
              dcfPriceMOS={result.dcfPriceMOS}
              currency={currency}
            />
          </div>
        )}
      </div>

      {/* Sensitivity Table Toggle */}
      <div className="border-t border-gray-800 pt-3">
        <button
          onClick={() => setShowSensitivity((v) => !v)}
          className="text-[11px] text-gray-400 hover:text-gray-200 flex items-center gap-1"
        >
          {showSensitivity ? '▾' : '▸'} Sensitivity — Intrinsic Value vs Discount &amp; Terminal Rate
        </button>
        {showSensitivity && (
          <div className="mt-2 max-w-2xl">
            <SensitivityTable
              fcfe={fcfe}
              cash={cash}
              revenue={revenue}
              shares={shares}
              capex={capex}
              netBorrowing={netBorrowing}
              assumptions={assumptions}
              currentPrice={priceData.price ?? null}
              currency={currency}
            />
          </div>
        )}
      </div>

      {/* Projection Table Toggle */}
      <div className="border-t border-gray-800 pt-3">
        <button
          onClick={() => setShowTable((v) => !v)}
          className="text-[11px] text-gray-400 hover:text-gray-200 flex items-center gap-1"
        >
          {showTable ? '▾' : '▸'} 10-Year Projection
        </button>
        {showTable && (
          <div className="mt-2 max-w-3xl">
            <ProjectionTable
              yearlyFCFE={result.yearlyFCFE}
              terminalValue={result.terminalValue}
              currency={currency}
              discountRate={assumptions.discountRate}
              splitYear={PHASE_SPLIT_YEAR}
              growthPath={growthPath(
                assumptions.growthRate,
                assumptions.terminalGrowth,
                assumptions.growthDecay ?? DEFAULT_GROWTH_DECAY
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Present-value breakdown: intrinsic value as the three additive terms of the
 * closed-form DCF — Phase 1 (growth), Phase 2 (steady), Terminal — plus excess
 * cash when present. Shown as a stacked bar and a comparable per-term legend so
 * you can see at a glance how much of the value rests on the terminal value.
 */
function PVBreakdown({
  result,
  splitYear,
  currency,
}: {
  result: DCFResult;
  splitYear: number;
  currency: string;
}) {
  const npv = result.npv;
  if (!(npv > 0)) return null;
  const pieces = [
    {
      key: 'p1',
      label: `Years 1–${splitYear}`,
      value: result.phase1PV,
      bar: 'bg-emerald-500',
      text: 'text-emerald-300',
    },
    {
      key: 'p2',
      label: `Years ${splitYear + 1}–10`,
      value: result.phase2PV,
      bar: 'bg-sky-500',
      text: 'text-sky-300',
    },
    {
      key: 'tv',
      label: 'Terminal',
      value: result.terminalPV,
      bar: 'bg-amber-500',
      text: 'text-amber-300',
    },
    ...(result.excessCash > 0
      ? [
          {
            key: 'cash',
            label: 'Excess cash',
            value: result.excessCash,
            bar: 'bg-gray-500',
            text: 'text-gray-300',
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
        Present-value breakdown — three additive terms
      </div>
      {/* Stacked proportion bar */}
      <div className="flex h-3 rounded overflow-hidden bg-gray-800">
        {pieces.map((p) => {
          const w = Math.max(0, (p.value / npv) * 100);
          return (
            <div
              key={p.key}
              className={p.bar}
              style={{ width: `${w}%` }}
              title={`${p.label}: ${formatCurrency(p.value, currency)} (${formatPercent(
                p.value / npv,
                0
              )})`}
            />
          );
        })}
      </div>
      {/* Comparable per-term legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 mt-2.5">
        {pieces.map((p) => (
          <div key={p.key}>
            <div className="flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-sm ${p.bar}`} />
              <span className="text-[10px] text-gray-400 truncate">{p.label}</span>
            </div>
            <div className="font-mono text-xs text-gray-100 mt-0.5">
              {formatCurrency(p.value, currency)}
            </div>
            <div className={`text-[10px] font-mono ${p.text}`}>
              {formatPercent(p.value / npv, 0)} of value
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
        Intrinsic value = Phase 1 + Phase 2 + Terminal
        {result.excessCash > 0 ? ' + excess cash' : ''}. A high terminal share means most of the
        value rests on year-11-and-beyond assumptions.
      </p>
    </div>
  );
}
