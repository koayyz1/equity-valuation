import { formatCurrency } from '../utils/formatting';

interface Flow {
  cfo: number | null;
  capex: number | null;
  fcf: number | null;
}

interface Props {
  // Latest snapshot (matches the FCFE that feeds the DCF): FCFE = CFO + CapEx + Net Borrowing.
  cfo: number | null;
  capex: number | null;
  netBorrowing: number | null;
  fcfe: number | null;
  marketCap: number | null;
  currency: string;
  // TTM vs prior-TTM for the change attribution (CFO + CapEx = FCF).
  ttm: Flow;
  prior: Flow;
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// A component row of the FCFE build-up.
function CompRow({
  label,
  value,
  max,
  currency,
  color,
}: {
  label: string;
  value: number | null;
  max: number;
  currency: string;
  color: string;
}) {
  return (
    <div className="grid grid-cols-[130px_90px_1fr] items-center gap-3">
      <span className="text-[11px] text-gray-400">{label}</span>
      <span
        className={`font-mono text-xs text-right tabular-nums ${
          value == null ? 'text-gray-500' : value < 0 ? 'text-red-300' : 'text-gray-200'
        }`}
      >
        {value == null ? '—' : `${value >= 0 ? '+' : ''}${formatCurrency(value, currency)}`}
      </span>
      {value == null ? <span /> : <Bar value={value} max={max} color={color} />}
    </div>
  );
}

/**
 * FCFE Drivers — what the free-cash-flow-to-equity number is made of, and what
 * moved it. Composition: FCFE = CFO + CapEx + Net Borrowing. Attribution: the
 * TTM-vs-prior change in FCF broken into its CFO and CapEx contributions.
 */
export function FcfDrivers({
  cfo,
  capex,
  netBorrowing,
  fcfe,
  marketCap,
  currency,
  ttm,
  prior,
}: Props) {
  const nb = netBorrowing ?? 0;
  const compMax = Math.max(
    Math.abs(cfo ?? 0),
    Math.abs(capex ?? 0),
    Math.abs(nb),
    Math.abs(fcfe ?? 0),
    1
  );
  const fcfeYield = fcfe != null && marketCap && marketCap > 0 ? fcfe / marketCap : null;

  // Change attribution: ΔFCF = ΔCFO + ΔCapEx (FCF = CFO + CapEx).
  const dCfo = ttm.cfo != null && prior.cfo != null ? ttm.cfo - prior.cfo : null;
  const dCapex = ttm.capex != null && prior.capex != null ? ttm.capex - prior.capex : null;
  const dFcf = ttm.fcf != null && prior.fcf != null ? ttm.fcf - prior.fcf : null;
  const changeMax = Math.max(Math.abs(dCfo ?? 0), Math.abs(dCapex ?? 0), 1);

  const fmtDelta = (v: number | null) =>
    v == null ? '—' : `${v >= 0 ? '+' : ''}${formatCurrency(v, currency)}`;

  // Plain-language read of the change.
  const narrative = (() => {
    if (dFcf == null) return null;
    const dir = dFcf >= 0 ? 'rose' : 'fell';
    const parts: string[] = [];
    if (dCfo != null && Math.abs(dCfo) > 0) {
      parts.push(
        `operating cash flow ${dCfo >= 0 ? 'added' : 'cut'} ${formatCurrency(Math.abs(dCfo), currency)}`
      );
    }
    if (dCapex != null && Math.abs(dCapex) > 0) {
      // capex more negative = heavier spend = drag on FCF
      parts.push(
        `capital expenditure ${dCapex >= 0 ? 'eased by' : 'grew'} ${formatCurrency(Math.abs(dCapex), currency)}`
      );
    }
    return `Free cash flow ${dir} ${formatCurrency(Math.abs(dFcf), currency)} versus the prior twelve months${
      parts.length ? ` — ${parts.join('; ')}.` : '.'
    }`;
  })();

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100">FCFE Drivers</h3>
        <div className="text-[11px] text-gray-500">
          FCFE = CFO + CapEx + Net Borrowing
          {fcfeYield != null && (
            <>
              {' '}· yield <span className="text-gray-300 font-mono">{(fcfeYield * 100).toFixed(1)}%</span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
        {/* Composition */}
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 mb-2">
            Composition (TTM)
          </div>
          <div className="space-y-2">
            <CompRow label="Operating Cash Flow" value={cfo} max={compMax} currency={currency} color="bg-green-500/70" />
            <CompRow label="CapEx" value={capex} max={compMax} currency={currency} color="bg-red-500/70" />
            <CompRow
              label="Net Borrowing"
              value={netBorrowing}
              max={compMax}
              currency={currency}
              color={nb >= 0 ? 'bg-blue-500/70' : 'bg-amber-500/70'}
            />
            <div className="border-t border-gray-800 pt-2 grid grid-cols-[130px_90px_1fr] items-center gap-3">
              <span className="text-[11px] font-semibold text-gray-200">= FCFE</span>
              <span className="font-mono text-xs text-right font-semibold text-gray-100 tabular-nums">
                {fcfe == null ? '—' : formatCurrency(fcfe, currency)}
              </span>
              <span />
            </div>
          </div>
          <div className="mt-2 text-[10px] text-gray-600">
            Net Borrowing is annual (Yahoo); CFO &amp; CapEx are TTM — matches the FCFE used in the
            Valuation tab.
          </div>
        </div>

        {/* Change attribution */}
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 mb-2">
            What changed · TTM vs prior 12m
          </div>
          {dFcf == null ? (
            <div className="text-xs text-gray-500 py-4">
              Not enough quarterly history to attribute the change yet.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[130px_90px_1fr] items-center gap-3">
                <span className="text-[11px] font-semibold text-gray-200">Δ Free Cash Flow</span>
                <span
                  className={`font-mono text-xs text-right font-semibold tabular-nums ${
                    dFcf >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {fmtDelta(dFcf)}
                </span>
                <span />
              </div>
              <CompRow
                label="from CFO"
                value={dCfo}
                max={changeMax}
                currency={currency}
                color={(dCfo ?? 0) >= 0 ? 'bg-green-500/70' : 'bg-red-500/70'}
              />
              <CompRow
                label="from CapEx"
                value={dCapex}
                max={changeMax}
                currency={currency}
                color={(dCapex ?? 0) >= 0 ? 'bg-green-500/70' : 'bg-red-500/70'}
              />
              {narrative && (
                <p className="text-[11px] text-gray-400 leading-relaxed pt-1">{narrative}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
