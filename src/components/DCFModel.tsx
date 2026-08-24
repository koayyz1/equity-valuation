import { useMemo } from 'react';
import { DCFAssumptions, FinancialData, Overrides, PriceData } from '../types';
import { calculateDCF, getMOS } from '../utils/calculations';
import { resolveValuationInputs } from '../utils/valuationInputs';
import { formatCurrency, formatPercent } from '../utils/formatting';

interface DCFModelProps {
  financials: FinancialData;
  priceData: PriceData;
  overrides: Overrides;
  assumptions: DCFAssumptions;
}

export function DCFModel({ financials, priceData, overrides, assumptions }: DCFModelProps) {
  const { fcfe, cash, revenue, shares, capex, netBorrowing } = resolveValuationInputs(
    financials,
    overrides
  );

  const result = useMemo(
    () => calculateDCF(fcfe, cash, revenue, shares, assumptions, { capex, netBorrowing }),
    [fcfe, cash, revenue, shares, assumptions, capex, netBorrowing]
  );

  const currency = priceData.currency || financials.currency || 'USD';
  const mos = getMOS(assumptions.uncertainty);
  const isUndervalued =
    priceData.price != null &&
    result.dcfPriceMOS != null &&
    priceData.price < result.dcfPriceMOS;
  const hasResult = result.dcfPrice != null;

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-blue-500/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-gray-100 font-semibold text-sm">DCF Valuation</h3>
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

      {/* Component readout */}
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <StatBox label="FCFE (Y0)" value={formatCurrency(fcfe, currency)} />
        <StatBox label="Excess Cash" value={formatCurrency(result.excessCash, currency)} />
        <StatBox label="Terminal Value" value={formatCurrency(result.terminalValue, currency)} />
        <StatBox
          label="TV / NPV"
          value={result.tvRatio != null ? formatPercent(result.tvRatio, 0) : 'N/A'}
          warning={result.tvRatio != null && result.tvRatio > 0.6}
        />
        <StatBox label="NPV Total" value={formatCurrency(result.npv, currency)} />
        <StatBox label="Shares" value={shares != null ? (shares / 1e6).toFixed(1) + 'M' : 'N/A'} />
      </div>

      {/* Verdict — asymmetric: the MOS price is the actionable number, so it
          alone keeps hero size + glow; intrinsic value is demoted to context. */}
      <div className="grid grid-cols-2 gap-2 items-stretch">
        <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3">
          <div className="text-blue-400 text-[10px] font-medium uppercase tracking-[0.14em]">Intrinsic Value</div>
          <div className="text-gray-200 font-mono font-semibold text-xl tracking-tight mt-1">
            {result.dcfPrice != null ? formatCurrency(result.dcfPrice, currency, false) : 'N/A'}
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
            {result.dcfPriceMOS != null
              ? formatCurrency(result.dcfPriceMOS, currency, false)
              : 'N/A'}
          </div>
        </div>
      </div>

      {priceData.price != null && result.dcfPriceMOS != null && (
        <div className="text-center text-[11px] text-gray-500">
          Current: {formatCurrency(priceData.price, currency, false)} · Implied upside to MOS:{' '}
          <span className={isUndervalued ? 'text-green-400' : 'text-red-400'}>
            {formatPercent((result.dcfPriceMOS - priceData.price) / priceData.price)}
          </span>
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="bg-gray-950/50 border border-gray-800 rounded px-2 py-1.5">
      <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em]">{label}</div>
      <div
        className={`font-mono text-xs tabular-nums ${warning ? 'text-amber-400' : 'text-gray-200'}`}
      >
        {value}
      </div>
    </div>
  );
}
