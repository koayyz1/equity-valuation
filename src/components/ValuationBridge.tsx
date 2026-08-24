import { formatCurrency, formatPercent } from '../utils/formatting';

interface ValuationBridgeProps {
  yearlyFCFE: number[];
  terminalValue: number;
  npv: number;
  excessCash: number;
  discountRate: number;
  shares: number | null;
  mos: number;
  dcfPrice: number | null;
  dcfPriceMOS: number | null;
  currency: string;
}

/**
 * Step-by-step bridge from discounted cash flows to the per-share intrinsic
 * value — the same arithmetic the Methodology tab describes, shown with this
 * company's live numbers so the user can eyeball-verify the model.
 */
export function ValuationBridge({
  yearlyFCFE,
  terminalValue,
  npv,
  excessCash,
  discountRate,
  shares,
  mos,
  dcfPrice,
  dcfPriceMOS,
  currency,
}: ValuationBridgeProps) {
  if (!yearlyFCFE.length) return null;

  // Recover the two discounted components from the DCF result so the bridge
  // always reconciles exactly to NPV.
  const discTV = terminalValue / Math.pow(1 + discountRate, 10);
  const sumPVFCFE = npv - excessCash - discTV;

  const pct = (part: number) => (npv > 0 ? part / npv : null);
  const cur = (v: number) => formatCurrency(v, currency);
  const price = (v: number | null) => (v != null ? formatCurrency(v, currency, false) : 'N/A');

  return (
    <div className="text-xs font-mono space-y-1.5">
      {/* Equity value build-up */}
      <BridgeRow
        op="Σ"
        label="PV of FCFE (Y1–Y10)"
        value={cur(sumPVFCFE)}
        share={pct(sumPVFCFE)}
      />
      <BridgeRow op="+" label="PV of Terminal Value" value={cur(discTV)} share={pct(discTV)} />
      <BridgeRow op="+" label="Excess Cash" value={cur(excessCash)} share={pct(excessCash)} />
      <div className="border-t border-gray-700" />
      <BridgeRow op="=" label="NPV (Equity Value)" value={cur(npv)} strong />

      <div className="h-1" />

      {/* Per-share conversion */}
      <BridgeRow
        op="÷"
        label="Shares Outstanding"
        value={shares != null ? `${(shares / 1e6).toFixed(1)}M` : 'N/A'}
      />
      <div className="border-t border-gray-700" />
      <BridgeRow op="=" label="Intrinsic Value / share" value={price(dcfPrice)} strong accent="blue" />
      <BridgeRow op="×" label={`(1 − MOS ${formatPercent(mos, 0)})`} value={`${((1 - mos) * 100).toFixed(0)}%`} />
      <div className="border-t border-gray-700" />
      <BridgeRow op="=" label="MOS Price" value={price(dcfPriceMOS)} strong accent="green" />

      <div className="pt-1 text-[10px] text-gray-600 font-sans leading-relaxed">
        Each year's FCFE is discounted at {formatPercent(discountRate)}; the terminal value is the
        Gordon-growth perpetuity discounted from Year 10. Percentages show each component's share of
        total NPV.
      </div>
    </div>
  );
}

function BridgeRow({
  op,
  label,
  value,
  share,
  strong = false,
  accent,
}: {
  op: string;
  label: string;
  value: string;
  share?: number | null;
  strong?: boolean;
  accent?: 'blue' | 'green';
}) {
  const valueColor =
    accent === 'blue' ? 'text-blue-300' : accent === 'green' ? 'text-green-300' : 'text-gray-200';
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 text-gray-600 text-center shrink-0">{op}</span>
      <span className={`flex-1 ${strong ? 'text-gray-200 font-semibold' : 'text-gray-400'}`}>
        {label}
      </span>
      {share != null && (
        <span className="text-[10px] text-gray-600 tabular-nums w-12 text-right">
          {(share * 100).toFixed(0)}%
        </span>
      )}
      {share == null && <span className="w-12" />}
      <span className={`tabular-nums text-right w-24 ${strong ? 'font-semibold' : ''} ${valueColor}`}>
        {value}
      </span>
    </div>
  );
}
