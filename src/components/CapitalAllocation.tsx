import { formatCurrency, formatPercent } from '../utils/formatting';
import { computeCapitalAllocation, AllocationRow } from '../utils/capitalAllocation';

interface Props {
  annualRows: AllocationRow[];
  taxRate: number | null;
  currency: string;
}

const TONE: Record<string, string> = {
  capex: 'bg-emerald-500/80',
  acq: 'bg-sky-500/80',
  buyback: 'bg-violet-500/80',
  div: 'bg-amber-500/80',
};

/**
 * Where a decade of cash went, and what it earned — the capital-allocation
 * record. Reinvestment (capex, acquisitions) is separated from cash returned
 * (buybacks, dividends), and paired with incremental ROIC, which is what the
 * next retained dollar actually earns.
 */
export function CapitalAllocation({ annualRows, taxRate, currency }: Props) {
  const a = computeCapitalAllocation(annualRows, taxRate);
  if (!a.complete) return null;

  const fy = (d: string | null) => (d ? d.slice(0, 4) : '—');
  const maxUse = Math.max(1, ...a.uses.map((u) => u.value));

  const verdict = (() => {
    if (a.incrementalROIC == null) return null;
    const r = a.incrementalROIC;
    if (r >= 0.2) return { label: 'Excellent', tone: 'text-emerald-300' };
    if (r >= 0.1) return { label: 'Good', tone: 'text-emerald-300/80' };
    if (r >= 0.05) return { label: 'Adequate', tone: 'text-gray-300' };
    return { label: 'Poor', tone: 'text-amber-300' };
  })();

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-100">Capital Allocation</h3>
        <span className="text-[11px] text-gray-500">
          FY{fy(a.from)}–{fy(a.to)} · {a.years} years
        </span>
      </div>
      <p className="text-[10px] text-gray-500 mb-4">
        Over this period the business generated{' '}
        <span className="font-mono text-gray-300">{formatCurrency(a.cfoTotal, currency)}</span> of
        operating cash. Where it went, and what it earned:
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
        {/* Where the cash went */}
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 mb-2">
            Deployed
          </div>
          <div className="space-y-2">
            {a.uses.map((u) => (
              <div key={u.key} className="grid grid-cols-[132px_84px_1fr_44px] items-center gap-2">
                <span className="text-[11px] text-gray-400">{u.label}</span>
                <span className="font-mono text-xs text-right tabular-nums text-gray-200">
                  {formatCurrency(u.value, currency)}
                </span>
                <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${TONE[u.key] ?? 'bg-gray-500'}`}
                    style={{ width: `${(u.value / maxUse) * 100}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-right text-gray-500">
                  {u.share != null ? formatPercent(u.share, 0) : '—'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
            <span className="text-gray-500">
              Reinvested{' '}
              <span className="font-mono text-emerald-300">
                {a.reinvestedShare != null ? formatPercent(a.reinvestedShare, 0) : '—'}
              </span>
            </span>
            <span className="text-gray-500">
              Returned{' '}
              <span className="font-mono text-violet-300">
                {a.returnedShare != null ? formatPercent(a.returnedShare, 0) : '—'}
              </span>
            </span>
            <span className="text-gray-600">of operating cash</span>
          </div>
        </div>

        {/* What it bought */}
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 mb-2">
            What it earned
          </div>
          <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">
                Incremental ROIC
              </span>
              {verdict && (
                <span className={`text-[10px] font-medium ${verdict.tone}`}>{verdict.label}</span>
              )}
            </div>
            <div className="font-mono text-2xl font-semibold text-gray-100 tracking-tight">
              {a.incrementalROIC != null ? formatPercent(a.incrementalROIC) : 'n/a'}
            </div>
            <div className="text-[10px] text-gray-600 mt-0.5">
              ΔNOPAT {formatCurrency(a.nopatDelta, currency)} ÷ ΔInvested capital{' '}
              {formatCurrency(a.icDelta, currency)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-950/40 border border-gray-800 rounded px-2 py-1.5">
              <div className="text-gray-500 text-[9px] uppercase tracking-wider">Share count</div>
              <div
                className={`font-mono text-xs ${
                  a.shareChange != null && a.shareChange < 0 ? 'text-emerald-300' : 'text-gray-300'
                }`}
                title={
                  a.shareDataUnreliable
                    ? 'Suppressed: the share series spans a stock split, and EDGAR reports counts as-filed rather than split-adjusted.'
                    : undefined
                }
              >
                {a.shareChange != null
                  ? formatPercent(a.shareChange)
                  : a.shareDataUnreliable
                  ? 'split'
                  : '—'}
              </div>
            </div>
            <div className="bg-gray-950/40 border border-gray-800 rounded px-2 py-1.5">
              <div className="text-gray-500 text-[9px] uppercase tracking-wider">Undeployed</div>
              <div className="font-mono text-xs text-gray-300">
                {formatCurrency(a.retained, currency)}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
            Incremental ROIC is what the <em>next</em> retained dollar earns — average ROIC only
            describes capital already committed. It is shown only when the capital base grew; a
            shrinking base makes the ratio flip sign for reasons unrelated to returns.
          </p>
        </div>
      </div>
    </div>
  );
}
