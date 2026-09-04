import { useMemo } from 'react';
import { DCFAssumptions, FinancialData, Overrides, PriceData } from '../types';
import { calculateDCF, getMOS, valueRange, roundSignificant } from '../utils/calculations';
import { resolveValuationInputs } from '../utils/valuationInputs';
import { resolveEarningsBase } from '../utils/ownerEarnings';
import { formatCurrency, formatPercent } from '../utils/formatting';

interface DCFModelProps {
  financials: FinancialData;
  priceData: PriceData;
  overrides: Overrides;
  assumptions: DCFAssumptions;
  onAssumptionsChange?: (a: DCFAssumptions) => void;
}

export function DCFModel({
  financials,
  priceData,
  overrides,
  assumptions,
  onAssumptionsChange,
}: DCFModelProps) {
  const { fcfe, cash, revenue, shares, capex, netBorrowing, cfo, maintenance } =
    resolveValuationInputs(financials, overrides);

  const basis = assumptions.earningsBasis ?? 'fcfe';
  // Owner earnings drops net borrowing, so the per-year net-borrowing overrides
  // must not be reapplied on that basis.
  const baseComponents =
    basis === 'ownerEarnings' ? { capex, netBorrowing: null } : { capex, netBorrowing };
  const earningsFor = (variant: 'low' | 'mid' | 'high') =>
    resolveEarningsBase(basis, { fcfe, cfo, maintenance }, variant);
  const earningsBase = earningsFor('mid');

  const result = useMemo(
    () => calculateDCF(earningsBase, cash, revenue, shares, assumptions, baseComponents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [earningsBase, cash, revenue, shares, assumptions, capex, netBorrowing, basis]
  );

  const range = useMemo(
    () => valueRange(earningsFor, cash, revenue, shares, assumptions, baseComponents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fcfe, cfo, maintenance, cash, revenue, shares, assumptions, capex, netBorrowing, basis]
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
        <div className="flex items-center gap-2">
          <h3 className="text-gray-100 font-semibold text-sm">DCF Valuation</h3>
          {onAssumptionsChange && (
            <div className="inline-flex rounded border border-gray-700 overflow-hidden text-[9px]">
              {(['fcfe', 'ownerEarnings'] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => onAssumptionsChange({ ...assumptions, earningsBasis: b })}
                  title={
                    b === 'fcfe'
                      ? 'CFO + capex + net borrowing — subtracts all capex'
                      : 'CFO − maintenance capex — does not penalise growth investment, and ignores net borrowing'
                  }
                  className={`px-1.5 py-0.5 transition-colors ${
                    basis === b
                      ? 'bg-blue-500/15 text-blue-300'
                      : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {b === 'fcfe' ? 'FCFE' : 'Owner'}
                </button>
              ))}
            </div>
          )}
        </div>
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
        <StatBox
          label={basis === 'ownerEarnings' ? 'Owner Earnings' : 'FCFE (Y0)'}
          value={formatCurrency(earningsBase, currency)}
        />
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
          <div className="text-blue-400 text-[10px] font-medium uppercase tracking-[0.14em]">
            Intrinsic Value Range
          </div>
          <div className="text-gray-200 font-mono font-semibold text-xl tracking-tight mt-1">
            {range.low != null && range.high != null
              ? `${formatCurrency(roundSignificant(Math.min(range.low, range.high)), currency, false)} – ${formatCurrency(roundSignificant(Math.max(range.low, range.high)), currency, false)}`
              : 'N/A'}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            base{' '}
            <span className="font-mono text-gray-400">
              {formatCurrency(roundSignificant(range.base), currency, false)}
            </span>
            {maintenance.wide && basis === 'ownerEarnings' && (
              <span className="text-amber-500/80"> · wide maintenance estimate</span>
            )}
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
              ? formatCurrency(roundSignificant(result.dcfPriceMOS), currency, false)
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
