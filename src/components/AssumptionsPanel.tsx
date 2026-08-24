import { useEffect, useState } from 'react';
import { DCFAssumptions, FinancialData, Overrides, PriceData, UncertaintyLevel } from '../types';
import { getMOS, UNCERTAINTY_LABELS, computeWACC } from '../utils/calculations';
import { resolveValuationInputs } from '../utils/valuationInputs';
import { formatCurrency, formatPercent, parseInputValue } from '../utils/formatting';
import { getPreset, savePreset, deletePreset } from '../utils/presets';
import { SliderInput } from './SliderInput';
import { IconSave } from './icons';

interface AssumptionsPanelProps {
  ticker: string;
  financials: FinancialData;
  priceData: PriceData;
  overrides: Overrides;
  assumptions: DCFAssumptions;
  defaultAssumptions: DCFAssumptions;
  onAssumptionsChange: (a: DCFAssumptions) => void;
}

/**
 * Shared assumption editor for the Valuation tab. Both the DCF and Forward FCF
 * Yield models read these values, so they live in one panel above the two model
 * cards rather than inside either one.
 */
export function AssumptionsPanel({
  ticker,
  financials,
  priceData,
  overrides,
  assumptions,
  defaultAssumptions,
  onAssumptionsChange,
}: AssumptionsPanelProps) {
  const [showOverrides, setShowOverrides] = useState(false);
  const [lockToWacc, setLockToWacc] = useState(false);
  const [hasPreset, setHasPreset] = useState(() => getPreset(ticker) != null);
  const [presetFlash, setPresetFlash] = useState(false);

  useEffect(() => {
    setHasPreset(getPreset(ticker) != null);
  }, [ticker]);

  const handleSavePreset = () => {
    savePreset(ticker, assumptions);
    setHasPreset(true);
    setPresetFlash(true);
    window.setTimeout(() => setPresetFlash(false), 1500);
  };

  const handleClearPreset = () => {
    deletePreset(ticker);
    setHasPreset(false);
  };

  const { shares } = resolveValuationInputs(financials, overrides);
  const currency = priceData.currency || financials.currency || 'USD';
  const mos = getMOS(assumptions.uncertainty);

  // WACC-derived discount rate, clamped to the slider's [5%, 20%] range.
  const marketCap =
    priceData.marketCap ??
    (priceData.price != null && shares != null ? priceData.price * shares : null);
  const wacc = computeWACC({
    beta: financials.beta,
    marketCap,
    totalDebt: financials.totalDebt,
    interestExpense: financials.interestExpense,
    taxRate: financials.taxRate,
  });
  const waccClamped = wacc != null ? Math.max(0.05, Math.min(0.2, wacc)) : null;

  // While locked, force the discount rate to track WACC. The guard prevents a
  // write loop: once discountRate equals waccClamped the effect no-ops.
  useEffect(() => {
    if (lockToWacc && waccClamped != null && Math.abs(assumptions.discountRate - waccClamped) > 1e-9) {
      onAssumptionsChange({ ...assumptions, discountRate: waccClamped });
    }
  }, [lockToWacc, waccClamped, assumptions, onAssumptionsChange]);

  const setField =
    <K extends keyof DCFAssumptions>(key: K) =>
    (value: DCFAssumptions[K]) =>
      onAssumptionsChange({ ...assumptions, [key]: value });

  const setYearOverride = (
    field: 'capexOverrides' | 'netBorrowingOverrides',
    year: number,
    raw: string
  ) => {
    const parsed = raw.trim() === '' ? null : parseInputValue(raw);
    const arr = [...(assumptions[field] || Array(5).fill(null))];
    while (arr.length < 5) arr.push(null);
    arr[year] = parsed;
    onAssumptionsChange({ ...assumptions, [field]: arr });
  };

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-blue-500/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-gray-100 font-semibold text-sm">
          Assumptions
          {hasPreset && (
            <span className="ml-2 text-[9px] font-normal px-1.5 py-0.5 rounded bg-blue-900/50 border border-blue-800 text-blue-300">
              preset saved
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-500 mr-2 hidden lg:inline">
            Shared by both models
          </span>
          <button
            onClick={handleSavePreset}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-colors ${
              presetFlash
                ? 'border-green-600 bg-green-900/30 text-green-400'
                : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
            title={`Save these assumptions as the preset for ${ticker} — auto-applied when it loads`}
          >
            {presetFlash ? '✓ Saved' : (<><IconSave size={11} /> Save preset</>)}
          </button>
          {hasPreset && (
            <>
              <button
                onClick={() => {
                  const p = getPreset(ticker);
                  if (p) onAssumptionsChange(p);
                }}
                className="px-2 py-1 text-[10px] rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                title={`Re-apply the saved preset for ${ticker}`}
              >
                Load preset
              </button>
              <button
                onClick={handleClearPreset}
                className="px-2 py-1 text-[10px] rounded border border-gray-700 bg-gray-800 text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
                title={`Delete the saved preset for ${ticker}`}
              >
                ✕
              </button>
            </>
          )}
          <button
            onClick={() => onAssumptionsChange(defaultAssumptions)}
            className="px-2 py-1 text-[10px] rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
            title="Reset all sliders to the data-driven defaults for this ticker"
          >
            Reset defaults
          </button>
        </div>
      </div>

      {/* Sliders laid out across the full width */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
        <SliderInput
          label="Growth Phase (years)"
          value={assumptions.growthYears}
          min={1}
          max={10}
          step={1}
          onChange={setField('growthYears')}
          format="years"
          defaultValue={defaultAssumptions.growthYears}
        />
        <SliderInput
          label={`Growth Phase Rate (Y1–Y${assumptions.growthYears})`}
          value={assumptions.growthRate}
          min={0}
          max={0.5}
          step={0.005}
          onChange={setField('growthRate')}
          defaultValue={defaultAssumptions.growthRate}
        />
        <SliderInput
          label={`Steady Phase Rate (Y${assumptions.growthYears + 1}–Y10)`}
          value={assumptions.steadyRate}
          min={0}
          max={0.5}
          step={0.005}
          onChange={setField('steadyRate')}
          defaultValue={defaultAssumptions.steadyRate}
        />
        <SliderInput
          label="Terminal Growth"
          value={assumptions.terminalGrowth}
          min={0}
          max={0.05}
          step={0.001}
          onChange={setField('terminalGrowth')}
          defaultValue={defaultAssumptions.terminalGrowth}
        />

        {/* Discount rate + WACC link */}
        <div>
          <SliderInput
            label={lockToWacc ? 'Discount Rate (WACC-linked)' : 'Discount Rate (Target IRR)'}
            value={assumptions.discountRate}
            min={0.05}
            max={0.2}
            step={0.005}
            onChange={setField('discountRate')}
            defaultValue={defaultAssumptions.discountRate}
            disabled={lockToWacc}
          />
          <div className="flex items-center justify-between mt-0.5">
            <label
              className={`flex items-center gap-1.5 text-[10px] ${
                wacc != null ? 'text-gray-400 cursor-pointer' : 'text-gray-600 cursor-not-allowed'
              }`}
              title={
                wacc == null
                  ? 'WACC unavailable — needs beta, market cap, and debt data'
                  : 'Link the discount rate to the computed WACC'
              }
            >
              <input
                type="checkbox"
                className="accent-blue-500 h-3 w-3"
                checked={lockToWacc}
                disabled={wacc == null}
                onChange={(e) => setLockToWacc(e.target.checked)}
              />
              Use WACC
            </label>
            {wacc != null && (
              <span className="text-[10px] font-mono text-gray-500">
                WACC ≈ {formatPercent(wacc)}
                {waccClamped != null && Math.abs(waccClamped - wacc) > 1e-9 && (
                  <span className="text-amber-500/80"> (clamped {formatPercent(waccClamped)})</span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Uncertainty / MOS */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-gray-400 text-[11px]">
              Uncertainty — MOS {formatPercent(mos, 0)}
            </label>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {([1, 2, 3, 4] as const).map((level) => (
              <button
                key={level}
                onClick={() => setField('uncertainty')(level as UncertaintyLevel)}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  assumptions.uncertainty === level
                    ? 'bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-500/40'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {UNCERTAINTY_LABELS[level]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Year-by-year overrides */}
      <div className="border-t border-gray-800 pt-3">
        <button
          onClick={() => setShowOverrides((v) => !v)}
          className="text-[11px] text-gray-400 hover:text-gray-200 flex items-center gap-1"
        >
          {showOverrides ? '▾' : '▸'} Custom CapEx / Net Borrowing (Y1–Y5)
        </button>
        {showOverrides && (
          <div className="mt-2 space-y-2 max-w-2xl">
            <div className="grid grid-cols-6 gap-1 text-[10px] text-gray-500">
              <span></span>
              {[1, 2, 3, 4, 5].map((y) => (
                <span key={y} className="text-center font-mono">Y{y}</span>
              ))}
            </div>
            <div className="grid grid-cols-6 gap-1 items-center">
              <span className="text-[10px] text-gray-400">CapEx</span>
              {[0, 1, 2, 3, 4].map((i) => (
                <input
                  key={i}
                  placeholder="—"
                  defaultValue={
                    assumptions.capexOverrides?.[i] != null
                      ? formatCurrency(assumptions.capexOverrides[i]!, currency)
                      : ''
                  }
                  onBlur={(e) => setYearOverride('capexOverrides', i, e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 font-mono text-[10px] text-right w-full focus:outline-none focus:border-blue-500"
                />
              ))}
            </div>
            <div className="grid grid-cols-6 gap-1 items-center">
              <span className="text-[10px] text-gray-400">Net Borr.</span>
              {[0, 1, 2, 3, 4].map((i) => (
                <input
                  key={i}
                  placeholder="—"
                  defaultValue={
                    assumptions.netBorrowingOverrides?.[i] != null
                      ? formatCurrency(assumptions.netBorrowingOverrides[i]!, currency)
                      : ''
                  }
                  onBlur={(e) => setYearOverride('netBorrowingOverrides', i, e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 font-mono text-[10px] text-right w-full focus:outline-none focus:border-blue-500"
                />
              ))}
            </div>
            <div className="text-[10px] text-gray-600">
              Accepts $, B/M/K, negatives. Empty = use default projection.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
