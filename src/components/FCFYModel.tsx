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

  const marketCap =
    priceData.marketCap ??
    (priceData.price != null && shares != null ? priceData.price * shares : null);

  const result = useMemo(
    () => calculateFCFY(fcfe, shares, assumptions, marketCap),
    [fcfe, shares, assumptions, marketCap]
  );

  const currency = priceData.currency || financials.currency || 'USD';
  const mos = getMOS(assumptions.uncertainty);
  const fcfeY1 = fcfe != null ? fcfe * (1 + assumptions.growthRate) : null;

  // Verdict comes from the model itself so every surface agrees.
  const isUndervalued = result.clearsHurdle ?? referenceUndervalued ?? false;
  const hasResult = result.fcfyPrice != null;
  const yieldGap =
    result.actualYield != null && Number.isFinite(result.requiredYield)
      ? result.actualYield - result.requiredYield
      : null;

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
            {isUndervalued ? '▲ CLEARS HURDLE' : '▼ BELOW HURDLE'}
          </span>
        )}
      </div>

      <div className="bg-gray-950/50 border border-gray-800 rounded p-2.5 text-[11px] text-gray-400 leading-relaxed">
        <span className="text-gray-300">Derived from the DCF →</span> "Does today's FCF yield beat
        the yield these assumptions demand, if I only part-credit the terminal value?"
      </div>

      {/* The comparison that matters: offered vs demanded */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-950/50 border border-gray-800 rounded-lg px-3 py-2">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em]">
            Actual yield today
          </div>
          <div className="text-gray-100 font-mono text-lg font-semibold tracking-tight">
            {result.actualYield != null ? formatPercent(result.actualYield) : 'N/A'}
          </div>
          <div className="text-[9px] text-gray-600">FCFE Y1 ÷ market cap</div>
        </div>
        <div className="bg-gray-950/50 border border-gray-800 rounded-lg px-3 py-2">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em]">
            Required yield
          </div>
          <div className="text-blue-300 font-mono text-lg font-bold tracking-tight">
            {Number.isFinite(result.requiredYield) ? formatPercent(result.requiredYield) : 'N/A'}
          </div>
          <div className="text-[9px] text-gray-600">
            DCF-implied {formatPercent(result.baseYield)} ·{' '}
            {formatPercent(result.terminalHaircut, 0)} terminal haircut
          </div>
        </div>
      </div>

      {yieldGap != null && (
        <div
          className={`rounded-lg px-3 py-2 border text-center ${
            isUndervalued
              ? 'bg-green-950/40 border-green-900/50'
              : 'bg-red-950/40 border-red-900/50'
          }`}
        >
          <span className="text-[10px] uppercase tracking-[0.14em] text-gray-400">
            Yield gap{' '}
          </span>
          <span
            className={`font-mono font-bold text-base ${
              isUndervalued ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {yieldGap >= 0 ? '+' : ''}
            {(yieldGap * 100).toFixed(2)} pp
          </span>
          <span className="text-[10px] text-gray-500">
            {' '}· offers {result.actualYield != null ? formatPercent(result.actualYield) : '—'} vs{' '}
            {formatPercent(result.requiredYield)} demanded
          </span>
        </div>
      )}

      {/* Where the required yield comes from */}
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { k: 'Growth PV', v: result.terms.phase1 },
          { k: 'Steady PV', v: result.terms.phase2 },
          { k: 'Terminal PV', v: result.terms.terminal },
        ].map((t) => (
          <div key={t.k} className="bg-gray-950/50 border border-gray-800 rounded px-2 py-1.5">
            <div className="text-gray-500 text-[9px] font-medium uppercase tracking-[0.12em]">
              {t.k}
            </div>
            <div className="text-gray-300 font-mono text-xs">{t.v.toFixed(2)}×</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-gray-600 -mt-1">
        Multiples of FCFE₀. Terminal is{' '}
        <span className="text-gray-400 font-mono">
          {result.terminalShare != null ? formatPercent(result.terminalShare, 0) : '—'}
        </span>{' '}
        of the un-haircut value — the piece the haircut discounts. FCFE Y1{' '}
        <span className="text-gray-400 font-mono">{formatCurrency(fcfeY1, currency)}</span>.
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
          F = FCFE_Y1 / (S1 + S2 + S_T) ={' '}
          <span className="text-gray-300">{formatPercent(result.baseYield)}</span>
          <span className="text-gray-600"> ← DCF-equivalent</span>
        </div>
        <div>
          required = FCFE_Y1 / (S1 + S2 + S_T x {(1 - result.terminalHaircut).toFixed(2)}) ={' '}
          <span className="text-gray-300">{formatPercent(result.requiredYield)}</span>
        </div>
        <div>
          FCFY_Price = FCFE_Y1 / required / Shares ={' '}
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
