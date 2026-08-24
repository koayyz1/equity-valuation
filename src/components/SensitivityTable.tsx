import { useMemo } from 'react';
import { DCFAssumptions } from '../types';
import { calculateDCF } from '../utils/calculations';
import { currencySymbol } from '../utils/formatting';

interface SensitivityTableProps {
  fcfe: number | null;
  cash: number | null;
  revenue: number | null;
  shares: number | null;
  capex: number | null;
  netBorrowing: number | null;
  assumptions: DCFAssumptions;
  currentPrice: number | null;
  currency: string;
}

// Offsets applied around the base assumption, in absolute rate terms.
const DISCOUNT_OFFSETS = [-0.02, -0.01, 0, 0.01, 0.02];
const TERMINAL_OFFSETS = [-0.01, -0.005, 0, 0.005, 0.01];

function fmtPrice(v: number | null, currency: string): string {
  if (v == null || Number.isNaN(v)) return '—';
  const sym = currencySymbol(currency);
  return `${sym}${Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2)}`;
}

/**
 * Intrinsic-value sensitivity grid: discount rate (rows) × terminal growth
 * (columns). Cells are tinted green when the intrinsic value sits at or above
 * the current price (undervalued) and red when below. The base-assumption cell
 * is ringed for reference.
 */
export function SensitivityTable({
  fcfe,
  cash,
  revenue,
  shares,
  capex,
  netBorrowing,
  assumptions,
  currentPrice,
  currency,
}: SensitivityTableProps) {
  const grid = useMemo(() => {
    return DISCOUNT_OFFSETS.map((dOff) => {
      const discountRate = assumptions.discountRate + dOff;
      return TERMINAL_OFFSETS.map((tOff) => {
        const terminalGrowth = assumptions.terminalGrowth + tOff;
        // Terminal growth must stay below the discount rate and non-negative.
        if (terminalGrowth < 0 || terminalGrowth >= discountRate) {
          return { discountRate, terminalGrowth, value: null as number | null };
        }
        const { dcfPrice } = calculateDCF(
          fcfe,
          cash,
          revenue,
          shares,
          { ...assumptions, discountRate, terminalGrowth },
          { capex, netBorrowing }
        );
        return { discountRate, terminalGrowth, value: dcfPrice };
      });
    });
  }, [fcfe, cash, revenue, shares, capex, netBorrowing, assumptions]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr>
            <th className="py-1 px-2 text-left font-normal text-gray-500 align-bottom">
              <div className="text-gray-400">Disc ↓ / Term →</div>
            </th>
            {TERMINAL_OFFSETS.map((tOff) => {
              const g = assumptions.terminalGrowth + tOff;
              return (
                <th
                  key={tOff}
                  className={`py-1 px-2 text-right font-normal ${
                    tOff === 0 ? 'text-blue-300' : 'text-gray-500'
                  }`}
                >
                  {(g * 100).toFixed(1)}%
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, ri) => {
            const dOff = DISCOUNT_OFFSETS[ri];
            const r = assumptions.discountRate + dOff;
            return (
              <tr key={dOff} className="border-t border-gray-900">
                <td
                  className={`py-1 px-2 text-left ${
                    dOff === 0 ? 'text-blue-300' : 'text-gray-500'
                  }`}
                >
                  {(r * 100).toFixed(1)}%
                </td>
                {row.map((cell, ci) => {
                  const isBase =
                    DISCOUNT_OFFSETS[ri] === 0 && TERMINAL_OFFSETS[ci] === 0;
                  // Magnitude-scaled heatmap (matches the financials tables'
                  // dialect): alpha steps at ±10% / ±30% distance from the
                  // current price, so the grid shows how far assumptions must
                  // drift before the verdict flips — not just a binary tint.
                  let cls = 'text-gray-500';
                  if (cell.value != null && currentPrice != null && currentPrice > 0) {
                    const pct = (cell.value - currentPrice) / currentPrice;
                    const mag = Math.abs(pct);
                    if (pct >= 0) {
                      cls =
                        mag >= 0.3
                          ? 'text-green-300 bg-green-500/20'
                          : mag >= 0.1
                          ? 'text-gray-200 bg-green-500/10'
                          : 'text-gray-200 bg-green-500/5';
                    } else {
                      cls =
                        mag >= 0.3
                          ? 'text-red-300 bg-red-500/20'
                          : mag >= 0.1
                          ? 'text-gray-200 bg-red-500/10'
                          : 'text-gray-200 bg-red-500/5';
                    }
                  } else if (cell.value != null) {
                    cls = 'text-gray-200';
                  }
                  if (isBase) cls = 'text-gray-100 bg-blue-500/10';
                  return (
                    <td
                      key={ci}
                      className={`py-1 px-2 text-right whitespace-nowrap ${cls} ${
                        isBase ? 'ring-2 ring-inset ring-blue-500 font-semibold' : ''
                      }`}
                    >
                      {fmtPrice(cell.value, currency)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-gray-600 flex flex-wrap gap-3">
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-green-900/60 mr-1 align-middle" />
          Intrinsic ≥ current price (undervalued)
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-red-900/60 mr-1 align-middle" />
          Intrinsic &lt; current price
        </span>
        <span>
          <span className="ring-1 ring-inset ring-blue-500 px-1 mr-1">base</span>
          your current assumptions
        </span>
      </div>
    </div>
  );
}
