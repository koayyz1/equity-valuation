import { useMemo } from 'react';
import { DCFAssumptions, FinancialData, Overrides, PriceData } from '../types';
import { calculateFCFY, getMOS } from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';

interface FCFYModelProps {
  financials: FinancialData;
  priceData: PriceData;
  overrides: Overrides;
  assumptions: DCFAssumptions;
  /** DCF's verdict — FCFY shares every assumption with the DCF and isn't an
   *  independent check, so its badge defers to the DCF rather than contradicting it. */
  referenceUndervalued?: boolean | null;
}

export function FCFYModel({
  financials,
  priceData,
  overrides,
  assumptions,
  referenceUndervalued,
}: FCFYModelProps) {
  const fcfe = overrides.fcfe !== undefined ? overrides.fcfe : financials.fcfe;
  const shares = overrides.shares !== undefined ? overrides.shares : financials.shares;

  const result = useMemo(
    () => calculateFCFY(fcfe, shares, assumptions),
    [fcfe, shares, assumptions]
  );

  const currency = priceData.currency || financials.currency || 'USD';
  const mos = getMOS(assumptions.uncertainty);
  const fcfeY1 = fcfe != null ? fcfe * (1 + assumptions.growthRate) : null;

  const ownUndervalued =
    priceData.price != null &&
    result.fcfyPriceMOS != null &&
    priceData.price < result.fcfyPriceMOS;
  // Defer to the DCF's verdict when available (FCFY is a cross-check, not an
  // independent model), falling back to its own only if the DCF has none.
  const isUndervalued = referenceUndervalued ?? ownUndervalued;
  const hasResult = result.fcfyPrice != null;

  // Determine which piece of the piecewise formula we're in
  const g = result.blendedGrowth;
  const formulaLabel =
    g <= 0.08 ? 'Low-growth band' : g <= 0.15 ? 'Mid-growth band' : 'High-growth band';

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-blue-500/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-gray-100 font-semibold text-sm">Forward FCF Yield</h3>
        {hasResult && (
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
              isUndervalued
                ? 'bg-green-900/50 text-green-400 border-green-800'
                : 'bg-red-900/50 text-red-400 border-red-800'
            }`}
          >
            {isUndervalued ? '▲ UNDERVALUED' : '▼ OVERVALUED'}
          </span>
        )}
      </div>

      <div className="bg-gray-950/50 border border-gray-800 rounded p-2.5 text-[11px] text-gray-400 leading-relaxed">
        <span className="text-gray-300">Shares DCF assumptions →</span> "What minimum FCF yield
        today delivers the target IRR, given projected growth?"
      </div>

      {/* Readout */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="bg-gray-950/50 border border-gray-800 rounded px-2 py-1.5">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em]">Blended Growth</div>
          <div className="text-gray-200 font-mono text-xs">{formatPercent(result.blendedGrowth)}</div>
        </div>
        <div className="bg-gray-950/50 border border-gray-800 rounded px-2 py-1.5">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em]">Required Yield</div>
          <div className="text-blue-300 font-mono text-xs font-bold">
            {formatPercent(result.minYield)}
          </div>
        </div>
        <div className="bg-gray-950/50 border border-gray-800 rounded px-2 py-1.5">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em]">FCFE (Y1)</div>
          <div className="text-gray-200 font-mono text-xs">
            {formatCurrency(fcfeY1, currency)}
          </div>
        </div>
        <div className="bg-gray-950/50 border border-gray-800 rounded px-2 py-1.5">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em]">Band</div>
          <div className="text-gray-300 font-mono text-[10px]">{formulaLabel}</div>
        </div>
      </div>

      {/* Verdict — asymmetric: MOS price is the actionable number */}
      <div className="grid grid-cols-2 gap-2 items-stretch">
        <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3">
          <div className="text-blue-400 text-[10px] font-medium uppercase tracking-[0.14em]">FCFY Price</div>
          <div className="text-gray-200 font-mono font-semibold text-xl tracking-tight mt-1">
            {result.fcfyPrice != null
              ? formatCurrency(result.fcfyPrice, currency, false)
              : 'N/A'}
          </div>
        </div>
        <div
          className={`rounded-lg p-3 border ${
            isUndervalued
              ? 'bg-green-950/50 border-green-900/50 shadow-[0_0_36px_-12px_rgba(34,197,94,0.5)]'
              : 'bg-red-950/50 border-red-900/50 shadow-[0_0_36px_-12px_rgba(239,68,68,0.45)]'
          }`}
        >
          <div
            className={`text-[10px] font-medium uppercase tracking-[0.14em] ${
              isUndervalued ? 'text-green-400' : 'text-red-400'
            }`}
          >
            With {formatPercent(mos, 0)} MOS
          </div>
          <div className="text-white font-mono font-bold text-3xl tracking-tight">
            {result.fcfyPriceMOS != null
              ? formatCurrency(result.fcfyPriceMOS, currency, false)
              : 'N/A'}
          </div>
        </div>
      </div>

      {priceData.price != null && result.fcfyPriceMOS != null && (
        <div className="text-center text-[11px] text-gray-500">
          Current: {formatCurrency(priceData.price, currency, false)} · Implied upside:{' '}
          <span className={isUndervalued ? 'text-green-400' : 'text-red-400'}>
            {formatPercent((result.fcfyPriceMOS - priceData.price) / priceData.price)}
          </span>
        </div>
      )}

      {/* Formula breakdown */}
      <div className="border-t border-gray-800 pt-3 text-[10px] font-mono text-gray-500 space-y-0.5">
        <div>
          min_yield = <span className="text-gray-300">{formatPercent(result.minYield)}</span>
        </div>
        <div>
          FCFY_Price = FCFE_Y1 / min_yield / Shares ={' '}
          <span className="text-gray-300">
            {result.fcfyPrice != null
              ? formatCurrency(result.fcfyPrice, currency, false)
              : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  );
}
