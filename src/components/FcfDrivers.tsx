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
  stockComp: number | null;
  deferredTax: number | null;
  changeReceivables: number | null;
  changeInventory: number | null;
  changePayables: number | null;
  intangibleAmortization: number | null;
  assetDisposals: number | null;
  ppe: number | null;
}

interface Props {
  // Latest snapshot (matches the FCFE that feeds the DCF): FCFE = CFO + CapEx + Net Borrowing.
  cfo: number | null;
  capex: number | null;
  netBorrowing: number | null;
  fcfe: number | null;
  marketCap: number | null;
  currency: string;
  // Trailing windows: TTM, prior 12m, and the 12m before that (for 3yr averages).
  ttm: Flow;
  prior: Flow;
  prior2: Flow;
}

const ADD = 'bg-emerald-500/80';
const SUB = 'bg-red-500/80';

const money = (v: number | null, currency: string) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${formatCurrency(v, currency)}`;
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const n0 = (v: number | null | undefined) => v ?? 0;

/**
 * Diverging bar centred on zero: positive grows right (green, "adds cash"),
 * negative grows left (red, "uses cash"), length ∝ |value| / max.
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

/** Panel shell for one driver in the "why it changed" stack. */
function DriverPanel({
  title,
  delta,
  biggest,
  currency,
  children,
  note,
}: {
  title: string;
  delta: number;
  biggest?: boolean;
  currency: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold text-gray-200">{title}</span>
          {biggest && (
            <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-1 py-px">
              Biggest
            </span>
          )}
        </div>
        <span
          className={`font-mono text-xs tabular-nums shrink-0 ${
            delta >= 0 ? 'text-emerald-300' : 'text-red-300'
          }`}
        >
          {money(delta, currency)}
        </span>
      </div>
      {children}
      {note && <p className="text-[10px] text-gray-400 leading-relaxed mt-2">{note}</p>}
    </div>
  );
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
  prior2,
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

  // ── ΔFCF = ΔCFO + ΔCapEx ──
  const dCfo = ttm.cfo != null && prior.cfo != null ? ttm.cfo - prior.cfo : null;
  const dCapex = ttm.capex != null && prior.capex != null ? ttm.capex - prior.capex : null;
  const dFcf = ttm.fcf != null && prior.fcf != null ? ttm.fcf - prior.fcf : null;
  const changeMax = Math.max(Math.abs(dCfo ?? 0), Math.abs(dCapex ?? 0), 1);

  // ── CFO bridge: named components + a reconciling plug ──
  // Net income + D&A + SBC + deferred tax + ΔWC + Other = CFO (exactly, by plug).
  const bridgeOf = (w: Flow) => {
    const named = [
      { key: 'ni', label: 'Net income', v: n0(w.netIncome) },
      { key: 'da', label: 'D&A', v: n0(w.da) },
      { key: 'sbc', label: 'Stock comp', v: n0(w.stockComp) },
      { key: 'dt', label: 'Deferred tax', v: n0(w.deferredTax) },
      { key: 'ar', label: 'Δ Receivables', v: n0(w.changeReceivables) },
      { key: 'inv', label: 'Δ Inventory', v: n0(w.changeInventory) },
      { key: 'ap', label: 'Δ Payables', v: n0(w.changePayables) },
    ];
    const sum = named.reduce((a, c) => a + c.v, 0);
    const other = w.cfo != null ? w.cfo - sum : 0;
    return [...named, { key: 'other', label: 'Other (reconciling)', v: other }];
  };

  const drivers: {
    key: string;
    title: string;
    delta: number;
    render: () => React.ReactNode;
    note?: string;
  }[] = [];

  // ---- CFO driver ----
  if (dCfo != null && ttm.netIncome != null && prior.netIncome != null) {
    const bTtm = bridgeOf(ttm);
    const bPrior = bridgeOf(prior);
    const rows = bTtm
      .map((r, i) => ({ ...r, prior: bPrior[i].v, delta: r.v - bPrior[i].v }))
      // Drop lines a filer never reports (all-zero both periods) to cut noise.
      .filter((r) => !(r.v === 0 && r.prior === 0));
    const dMax = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));
    const top = rows.filter((r) => r.key !== 'other').reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));

    drivers.push({
      key: 'cfo',
      title: 'Operating cash flow',
      delta: dCfo,
      note:
        `Operating cash flow ${dCfo >= 0 ? 'rose' : 'fell'} ${formatCurrency(Math.abs(dCfo), currency)}, ` +
        `driven mainly by ${top.label.toLowerCase()} (${money(top.delta, currency)}).`,
      render: () => (
        <div>
          <div className="grid grid-cols-[136px_84px_84px_1fr] gap-2 text-[9px] uppercase tracking-wider text-gray-600 mb-1">
            <span>Component</span>
            <span className="text-right">TTM</span>
            <span className="text-right">Δ vs prior</span>
            <span />
          </div>
          <div className="space-y-1">
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[136px_84px_84px_1fr] gap-2 items-center">
                <span
                  className={`text-[10px] truncate ${
                    r.key === 'other' ? 'text-gray-500 italic' : 'text-gray-400'
                  }`}
                >
                  {r.label}
                </span>
                <span
                  className={`font-mono text-[10px] text-right tabular-nums ${
                    r.v < 0 ? 'text-red-300/80' : 'text-gray-300'
                  }`}
                >
                  {money(r.v, currency)}
                </span>
                <span
                  className={`font-mono text-[10px] text-right tabular-nums ${
                    r.delta < 0 ? 'text-red-300' : 'text-emerald-300'
                  }`}
                >
                  {money(r.delta, currency)}
                </span>
                <DivBar value={r.delta} max={dMax} />
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-600 mt-1.5">
            Bars show the year-over-year change. Components sum to reported CFO; "Other" is the
            reconciling remainder (other non-cash items and working-capital lines not broken out).
          </p>
        </div>
      ),
    });
  }

  // ---- CapEx driver: intensity ratio + maintenance/growth range ----
  if (dCapex != null && ttm.capex != null && prior.capex != null) {
    const spend = Math.abs(ttm.capex);
    // Maintenance proxy A: D&A stripped of intangible amortisation (no cash to replace).
    const intang = n0(ttm.intangibleAmortization);
    const daNet = ttm.da != null ? ttm.da - intang : null;
    const ratio = daNet && daNet > 0 ? spend / daNet : null;
    const stance =
      ratio == null ? null : ratio >= 1.5 ? 'Expanding' : ratio >= 0.9 ? 'Steady state' : 'Harvesting';
    const stanceTone =
      ratio == null
        ? ''
        : ratio >= 1.5
        ? 'text-emerald-300'
        : ratio >= 0.9
        ? 'text-gray-300'
        : 'text-amber-300';

    // 3-year average ratio damps single-year lumpiness.
    const ratios = [ttm, prior, prior2]
      .map((w) => {
        const d = w.da != null ? w.da - n0(w.intangibleAmortization) : null;
        return w.capex != null && d && d > 0 ? Math.abs(w.capex) / d : null;
      })
      .filter((x): x is number => x != null);
    const ratio3 = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;

    // Estimate A (D&A): maintenance = D&A ex-intangibles.
    const growthA = daNet != null ? spend - daNet : null;
    // Estimate B (revenue intensity, Greenwald): growth = (PP&E/revenue) × Δrevenue.
    const dRev =
      ttm.revenue != null && prior.revenue != null ? ttm.revenue - prior.revenue : null;
    const intensity = ttm.ppe != null && ttm.revenue && ttm.revenue > 0 ? ttm.ppe / ttm.revenue : null;
    const growthB = intensity != null && dRev != null ? Math.max(0, intensity * dRev) : null;
    const est = [growthA, growthB].filter((x): x is number => x != null);
    const gLo = est.length ? Math.min(...est) : null;
    const gHi = est.length ? Math.max(...est) : null;

    const intTtm = ttm.revenue && ttm.revenue > 0 ? spend / ttm.revenue : null;
    const intPrior =
      prior.revenue && prior.revenue > 0 ? Math.abs(prior.capex) / prior.revenue : null;

    drivers.push({
      key: 'capex',
      title: 'Capital expenditure',
      delta: dCapex,
      note:
        `Capital investment ${spend >= Math.abs(prior.capex) ? 'increased' : 'decreased'} ` +
        `${formatCurrency(Math.abs(dCapex), currency)}` +
        (intTtm != null && intPrior != null
          ? ` — ${pct(intPrior)} → ${pct(intTtm)} of revenue.`
          : '.') +
        (ratio != null && ratio < 0.9
          ? ' Spending below the depreciation run-rate means the asset base is not being fully replaced.'
          : ''),
      render: () => (
        <div className="space-y-2.5">
          {/* Headline: capex vs depreciation run-rate */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-gray-500">
                CapEx / D&amp;A{intang > 0 ? ' (ex-intangibles)' : ''}
              </span>
              <span className="font-mono text-sm font-semibold text-gray-100">
                {ratio != null ? `${ratio.toFixed(2)}×` : '—'}
              </span>
              {stance && <span className={`text-[10px] font-medium ${stanceTone}`}>{stance}</span>}
            </div>
            {ratio3 != null && (
              <span className="text-[10px] text-gray-500 font-mono">
                3yr avg {ratio3.toFixed(2)}×
              </span>
            )}
            {intTtm != null && intPrior != null && (
              <span className="text-[10px] text-gray-500">
                intensity <span className="font-mono text-gray-400">{pct(intPrior)}</span> →{' '}
                <span className="font-mono text-gray-200">{pct(intTtm)}</span> of revenue
              </span>
            )}
          </div>

          {/* Maintenance vs growth — two independent estimates */}
          <div className="border-t border-gray-800/70 pt-2">
            <div className="text-[9px] uppercase tracking-wider text-gray-600 mb-1.5">
              Maintenance vs growth · estimated, TTM spend {formatCurrency(spend, currency)}
            </div>
            <div className="grid grid-cols-[150px_1fr_1fr] gap-2 text-[9px] uppercase tracking-wider text-gray-600 mb-1">
              <span>Method</span>
              <span className="text-right">Maintenance</span>
              <span className="text-right">Growth</span>
            </div>
            {[
              {
                k: 'a',
                label: 'D&A run-rate',
                maint: daNet,
                growth: growthA,
              },
              {
                k: 'b',
                label: 'Revenue intensity',
                maint: growthB != null ? spend - growthB : null,
                growth: growthB,
              },
            ].map((m) => (
              <div key={m.k} className="grid grid-cols-[150px_1fr_1fr] gap-2 items-center py-0.5">
                <span className="text-[10px] text-gray-400">{m.label}</span>
                <span className="font-mono text-[10px] text-right tabular-nums text-gray-300">
                  {m.maint == null ? '—' : formatCurrency(m.maint, currency)}
                </span>
                <span
                  className={`font-mono text-[10px] text-right tabular-nums ${
                    m.growth == null
                      ? 'text-gray-500'
                      : m.growth < 0
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                  }`}
                >
                  {m.growth == null ? '—' : formatCurrency(m.growth, currency)}
                </span>
              </div>
            ))}
            {gLo != null && gHi != null && (
              <p className="text-[10px] text-gray-400 mt-1.5">
                Growth capex ≈{' '}
                <span className="font-mono text-gray-200">
                  {formatCurrency(gLo, currency)}
                  {Math.abs(gHi - gLo) > 1 ? ` – ${formatCurrency(gHi, currency)}` : ''}
                </span>
                {gLo < 0 && ' — negative means spending is below the depreciation run-rate.'}
              </p>
            )}
            {n0(ttm.assetDisposals) > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">
                Asset disposals offset{' '}
                <span className="font-mono text-emerald-300">
                  {formatCurrency(n0(ttm.assetDisposals), currency)}
                </span>{' '}
                of gross spend.
              </p>
            )}
            <p className="text-[9px] text-gray-600 mt-1.5 leading-relaxed">
              Both splits are estimates, not disclosures. The D&amp;A method treats depreciation as
              the replacement run-rate (understates it when assets are old, since D&amp;A is at
              historical cost); the revenue-intensity method infers growth spend from PP&amp;E per
              dollar of sales × revenue growth. Where they disagree, the gap is the uncertainty.
            </p>
          </div>
        </div>
      ),
    });
  }

  // ---- Net borrowing driver ----
  {
    const raisedT = n0(ttm.debtIssued);
    const repaidT = n0(ttm.debtRepaid);
    const nbT = raisedT + repaidT;
    const nbP = n0(prior.debtIssued) + n0(prior.debtRepaid);
    const cfActivity =
      Math.abs(raisedT) + Math.abs(repaidT) + Math.abs(n0(prior.debtIssued)) + Math.abs(n0(prior.debtRepaid));

    if (cfActivity > 0) {
      const subMax = Math.max(1, Math.abs(raisedT), Math.abs(repaidT));
      drivers.push({
        key: 'nb',
        title: 'Net borrowing',
        delta: nbT - nbP,
        note:
          `Over the last year the company ${nbT >= 0 ? 'raised' : 'returned'} net debt of ` +
          `${formatCurrency(Math.abs(nbT), currency)} (${formatCurrency(raisedT, currency)} raised, ` +
          `${formatCurrency(Math.abs(repaidT), currency)} repaid)` +
          (nbP !== 0 ? `, versus ${money(nbP, currency)} the prior year.` : '.'),
        render: () => (
          <div className="space-y-1.5">
            <Row label="Debt raised" value={raisedT} max={subMax} currency={currency} />
            <Row label="Debt repaid" value={repaidT} max={subMax} currency={currency} />
          </div>
        ),
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
        note:
          `Total debt ${dDebt >= 0 ? 'rose' : 'fell'} from ${formatCurrency(prior.totalDebt, currency)} ` +
          `to ${formatCurrency(ttm.totalDebt, currency)} — a net ${dDebt >= 0 ? 'borrowing' : 'repayment'} of ` +
          `${formatCurrency(Math.abs(dDebt), currency)} (from the balance sheet; this filer doesn't ` +
          `break out debt issuance/repayment in a tag we capture).`,
        render: () => (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-gray-500">Total debt</span>
            <span className="font-mono text-gray-400">
              {formatCurrency(prior.totalDebt!, currency)}
            </span>
            <span className="text-gray-600">→</span>
            <span className="font-mono text-gray-200 font-semibold">
              {formatCurrency(ttm.totalDebt!, currency)}
            </span>
          </div>
        ),
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
                ΔFCF = ΔCFO + ΔCapEx. The panels below break down what moved each piece.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Why it changed — one stacked panel per driver, ranked by impact */}
      {drivers.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-800">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 mb-3">
            Why it changed · what moved each driver
          </div>
          <div className="space-y-3">
            {drivers.map((d) => (
              <DriverPanel
                key={d.key}
                title={d.title}
                delta={d.delta}
                biggest={d.key === biggestKey}
                currency={currency}
                note={d.note}
              >
                {d.render()}
              </DriverPanel>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-gray-600">
            Sub-drivers are from SEC filings (TTM vs the prior 12 months).
          </p>
        </div>
      )}
    </div>
  );
}
