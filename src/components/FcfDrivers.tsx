import { formatCurrency } from '../utils/formatting';

interface Flow {
  cfo: number | null;
  capex: number | null;
  fcf: number | null;
  netIncome: number | null;
  da: number | null;
  revenue: number | null;
  debtIssued: number | null;
  debtRepaid: number | null;
  totalDebt: number | null;
}

interface Props {
  // Latest snapshot (matches the FCFE that feeds the DCF): FCFE = CFO + CapEx + Net Borrowing.
  cfo: number | null;
  capex: number | null;
  netBorrowing: number | null;
  fcfe: number | null;
  marketCap: number | null;
  currency: string;
  // TTM vs prior-TTM windows for the change attribution and driver breakdowns.
  ttm: Flow;
  prior: Flow;
}

const ADD = 'bg-emerald-500/80';
const SUB = 'bg-red-500/80';

// Signed money string: formatCurrency already prints the minus for negatives;
// we add the plus for positives so direction always reads at a glance.
const money = (v: number | null, currency: string) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${formatCurrency(v, currency)}`;
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

/**
 * Diverging bar centred on zero: positive values grow right (green, "adds cash"),
 * negative grow left (red, "uses cash"). Length is proportional to |value| / max,
 * so the pieces are visually comparable.
 */
function DivBar({ value, max }: { value: number | null; max: number }) {
  if (value == null) return <div className="h-2 rounded bg-gray-800/50" />;
  const frac = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  const width = `${frac * 50}%`;
  const positive = value >= 0;
  return (
    <div className="relative h-2 rounded bg-gray-800/50">
      <div className="absolute inset-y-0 left-1/2 w-px bg-gray-600/80" />
      <div
        className={`absolute inset-y-0 rounded ${positive ? ADD : SUB}`}
        style={positive ? { left: '50%', width } : { right: '50%', width }}
      />
    </div>
  );
}

// One labelled row: name · signed value · diverging bar.
function Row({
  label,
  value,
  max,
  currency,
  strong,
}: {
  label: string;
  value: number | null;
  max: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[132px_92px_1fr] items-center gap-3">
      <span className={`text-[11px] ${strong ? 'font-semibold text-gray-200' : 'text-gray-400'}`}>
        {label}
      </span>
      <span
        className={`font-mono text-xs text-right tabular-nums ${
          value == null
            ? 'text-gray-500'
            : strong
            ? 'text-gray-100 font-semibold'
            : value < 0
            ? 'text-red-300'
            : 'text-emerald-300'
        }`}
      >
        {money(value, currency)}
      </span>
      <DivBar value={value} max={max} />
    </div>
  );
}

interface Driver {
  key: string;
  title: string;
  delta: number;
  subs: { label: string; value: number | null }[];
  stat?: { label: string; from: string; to: string };
  narrative: string;
}

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
  const compMax = Math.max(Math.abs(cfo ?? 0), Math.abs(capex ?? 0), Math.abs(nb), Math.abs(fcfe ?? 0), 1);
  const fcfeYield = fcfe != null && marketCap && marketCap > 0 ? fcfe / marketCap : null;

  // ── Change attribution: ΔFCF = ΔCFO + ΔCapEx (FCF = CFO + CapEx) ──
  const dCfo = ttm.cfo != null && prior.cfo != null ? ttm.cfo - prior.cfo : null;
  const dCapex = ttm.capex != null && prior.capex != null ? ttm.capex - prior.capex : null;
  const dFcf = ttm.fcf != null && prior.fcf != null ? ttm.fcf - prior.fcf : null;
  const changeMax = Math.max(Math.abs(dCfo ?? 0), Math.abs(dCapex ?? 0), 1);

  // ── "Why it changed": decompose the movers ──
  const drivers: Driver[] = [];

  // CFO bridge: ΔCFO = ΔNet income + ΔD&A + ΔOther (working capital & non-cash).
  if (dCfo != null && ttm.netIncome != null && prior.netIncome != null) {
    const dNi = ttm.netIncome - prior.netIncome;
    const haveDa = ttm.da != null && prior.da != null;
    const dDa = haveDa ? (ttm.da as number) - (prior.da as number) : null;
    const dOther = dCfo - dNi - (dDa ?? 0);
    const subs = [
      { label: 'Net income', value: dNi },
      ...(haveDa ? [{ label: 'D&A (non-cash)', value: dDa }] : []),
      { label: haveDa ? 'Working capital & other' : 'D&A, working capital & other', value: dOther },
    ];
    const top = subs.reduce((a, b) => (Math.abs(b.value ?? 0) > Math.abs(a.value ?? 0) ? b : a));
    drivers.push({
      key: 'cfo',
      title: 'Operating cash flow',
      delta: dCfo,
      subs,
      narrative:
        `Operating cash flow ${dCfo >= 0 ? 'rose' : 'fell'} ${formatCurrency(Math.abs(dCfo), currency)}, ` +
        `driven mainly by ${top.label.toLowerCase()} (${money(top.value, currency)}).`,
    });
  }

  // CapEx: intensity lens — did investment grow faster than the business?
  if (dCapex != null && ttm.capex != null && prior.capex != null) {
    const intTtm = ttm.revenue && ttm.revenue > 0 ? Math.abs(ttm.capex) / ttm.revenue : null;
    const intPrior = prior.revenue && prior.revenue > 0 ? Math.abs(prior.capex) / prior.revenue : null;
    const heavier = intTtm != null && intPrior != null ? intTtm > intPrior : null;
    drivers.push({
      key: 'capex',
      title: 'Capital expenditure',
      delta: dCapex,
      subs: [],
      stat:
        intTtm != null && intPrior != null
          ? { label: '% of revenue', from: pct(intPrior), to: pct(intTtm) }
          : undefined,
      narrative:
        `Capital investment ${Math.abs(ttm.capex) >= Math.abs(prior.capex) ? 'increased' : 'decreased'} ` +
        `${formatCurrency(Math.abs(dCapex), currency)}` +
        (heavier == null
          ? '.'
          : heavier
          ? ' — a rising share of revenue, so the company is investing more heavily for its size.'
          : ' — a falling share of revenue, so investment is scaling more slowly than the business.'),
    });
  }

  // Net borrowing. Preferred: raised vs repaid from EDGAR financing flows (rich
  // detail). Fallback: change in total debt from the balance sheet — universal,
  // for filers whose cash-flow debt tags use maturity-bucketed names we don't sum.
  {
    const raisedT = ttm.debtIssued ?? 0;
    const repaidT = ttm.debtRepaid ?? 0;
    const nbT = raisedT + repaidT;
    const raisedP = prior.debtIssued ?? 0;
    const repaidP = prior.debtRepaid ?? 0;
    const nbP = raisedP + repaidP;
    const cfActivity = Math.abs(raisedT) + Math.abs(repaidT) + Math.abs(raisedP) + Math.abs(repaidP);

    if (cfActivity > 0) {
      drivers.push({
        key: 'nb',
        title: 'Net borrowing',
        delta: nbT - nbP,
        subs: [
          { label: 'Debt raised', value: raisedT },
          { label: 'Debt repaid', value: repaidT },
        ],
        narrative:
          `Over the last year the company ${nbT >= 0 ? 'raised' : 'returned'} net debt of ` +
          `${formatCurrency(Math.abs(nbT), currency)} (${formatCurrency(raisedT, currency)} raised, ` +
          `${formatCurrency(Math.abs(repaidT), currency)} repaid)` +
          (nbP !== 0 ? `, versus ${money(nbP, currency)} the prior year.` : '.'),
      });
    } else if (
      ttm.totalDebt != null &&
      prior.totalDebt != null &&
      Math.abs(ttm.totalDebt) + Math.abs(prior.totalDebt) > 0
    ) {
      const dDebt = ttm.totalDebt - prior.totalDebt;
      drivers.push({
        key: 'nb',
        title: 'Net borrowing',
        delta: dDebt,
        subs: [],
        stat: {
          label: 'Total debt',
          from: formatCurrency(prior.totalDebt, currency),
          to: formatCurrency(ttm.totalDebt, currency),
        },
        narrative:
          `Total debt ${dDebt >= 0 ? 'rose' : 'fell'} from ${formatCurrency(prior.totalDebt, currency)} ` +
          `to ${formatCurrency(ttm.totalDebt, currency)} — a net ${dDebt >= 0 ? 'borrowing' : 'repayment'} of ` +
          `${formatCurrency(Math.abs(dDebt), currency)} over the year (from the balance sheet; this filer ` +
          `doesn't break out debt issuance/repayment in a tag we capture).`,
      });
    }
  }

  drivers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const biggestKey = drivers[0]?.key;

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-100">FCFE Drivers</h3>
        <div className="text-[11px] text-gray-500">
          FCFE = CFO + CapEx + Net Borrowing
          {fcfeYield != null && (
            <>
              {' '}· yield <span className="text-gray-300 font-mono">{pct(fcfeYield)}</span>
            </>
          )}
        </div>
      </div>

      {/* Legend — what the bars mean */}
      <p className="text-[10px] text-gray-500 mb-4 leading-relaxed">
        Bars are centred on zero and sized by dollar amount:{' '}
        <span className="text-emerald-300">green extends right = adds cash</span>,{' '}
        <span className="text-red-300">red extends left = uses cash</span>.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
        {/* Composition */}
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 mb-2">
            Composition · TTM
          </div>
          <div className="space-y-2">
            <Row label="Operating Cash Flow" value={cfo} max={compMax} currency={currency} />
            <Row label="CapEx" value={capex} max={compMax} currency={currency} />
            <Row label="Net Borrowing" value={netBorrowing} max={compMax} currency={currency} />
            <div className="border-t border-gray-800 pt-2">
              <Row label="= FCFE" value={fcfe} max={compMax} currency={currency} strong />
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
              <Row label="Δ Free Cash Flow" value={dFcf} max={changeMax} currency={currency} strong />
              <Row label="from CFO" value={dCfo} max={changeMax} currency={currency} />
              <Row label="from CapEx" value={dCapex} max={changeMax} currency={currency} />
              <p className="text-[10px] text-gray-600 pt-1">
                ΔFCF = ΔCFO + ΔCapEx. The panel below breaks down what moved each piece.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Why it changed — decompose the movers */}
      {drivers.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-800">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 mb-3">
            Why it changed · what moved each driver
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {drivers.map((d) => {
              const subMax = Math.max(1, ...d.subs.map((s) => Math.abs(s.value ?? 0)));
              return (
                <div key={d.key} className="bg-gray-950/40 border border-gray-800 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] font-semibold text-gray-200 truncate">{d.title}</span>
                      {d.key === biggestKey && (
                        <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-1 py-px">
                          Biggest
                        </span>
                      )}
                    </div>
                    <span
                      className={`font-mono text-xs tabular-nums shrink-0 ${
                        d.delta >= 0 ? 'text-emerald-300' : 'text-red-300'
                      }`}
                    >
                      {money(d.delta, currency)}
                    </span>
                  </div>

                  {d.subs.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {d.subs.map((s) => (
                        <div key={s.label} className="grid grid-cols-[1fr_auto] items-center gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] text-gray-400 w-[92px] shrink-0">{s.label}</span>
                            <div className="flex-1 min-w-[40px]">
                              <DivBar value={s.value} max={subMax} />
                            </div>
                          </div>
                          <span
                            className={`font-mono text-[10px] tabular-nums text-right ${
                              (s.value ?? 0) < 0 ? 'text-red-300' : 'text-emerald-300'
                            }`}
                          >
                            {money(s.value, currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {d.stat && (
                    <div className="flex items-center gap-2 mb-2 text-[11px]">
                      <span className="text-gray-500">{d.stat.label}</span>
                      <span className="font-mono text-gray-400">{d.stat.from}</span>
                      <span className="text-gray-600">→</span>
                      <span className="font-mono text-gray-200 font-semibold">{d.stat.to}</span>
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400 leading-relaxed">{d.narrative}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-gray-600">
            Sub-drivers are from SEC filings (TTM vs the prior 12 months). CFO bridge:
            ΔCFO = Δnet income + ΔD&amp;A + Δworking-capital &amp; other.
          </p>
        </div>
      )}
    </div>
  );
}
