import { formatCurrency } from '../utils/formatting';

interface Props {
  totalDebt: number | null;
  cash: number | null;
  ebitda: number | null;
  ebit: number | null;
  interestExpense: number | null;
  ttmFCF: number | null;
  currency: string;
}

type Tone = 'good' | 'ok' | 'weak' | 'neutral';

const toneClass: Record<Tone, string> = {
  good: 'text-green-400',
  ok: 'text-amber-400',
  weak: 'text-red-400',
  neutral: 'text-gray-200',
};

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: Tone;
  hint: string;
}) {
  return (
    <div className="bg-gray-950/50 border border-gray-800 rounded-lg px-3 py-2" title={hint}>
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">{label}</div>
      <div className={`mt-1 font-mono font-semibold text-sm ${toneClass[tone]}`}>{value}</div>
    </div>
  );
}

/**
 * "Can this survive a bad decade?" — the value-investor pre-question. Uses debt,
 * cash, EBITDA, EBIT/interest, and TTM FCF the app already fetches.
 */
export function BalanceSheetResilience({
  totalDebt,
  cash,
  ebitda,
  ebit,
  interestExpense,
  ttmFCF,
  currency,
}: Props) {
  const debt = totalDebt ?? 0;
  const netDebt = totalDebt != null && cash != null ? totalDebt - cash : null;
  const netCash = netDebt != null && netDebt < 0;

  // Effectively debt-free: leverage/coverage ratios aren't meaningful.
  const minimalDebt = totalDebt != null && ebitda != null && ebitda > 0 && totalDebt < 0.25 * ebitda;

  const netDebtEbitda = netDebt != null && ebitda != null && ebitda > 0 ? netDebt / ebitda : null;
  const interest = interestExpense != null ? Math.abs(interestExpense) : null;
  const coverage = ebit != null && interest != null && interest > 0 ? ebit / interest : null;
  const debtFcfYears = ttmFCF != null && ttmFCF > 0 ? debt / ttmFCF : null;

  const ndeTone: Tone = netCash
    ? 'good'
    : netDebtEbitda == null
    ? 'neutral'
    : netDebtEbitda < 1
    ? 'good'
    : netDebtEbitda <= 3
    ? 'ok'
    : 'weak';

  const covTone: Tone = minimalDebt
    ? 'good'
    : coverage == null
    ? 'neutral'
    : coverage >= 8
    ? 'good'
    : coverage >= 4
    ? 'ok'
    : 'weak';

  const paybackTone: Tone = netCash
    ? 'good'
    : debtFcfYears == null
    ? 'neutral'
    : debtFcfYears < 3
    ? 'good'
    : debtFcfYears <= 6
    ? 'ok'
    : 'weak';

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-emerald-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100">Balance-Sheet Resilience</h3>
        <div className="text-[11px] text-gray-500">Can it survive a bad decade?</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile
          label="Net Debt"
          value={netDebt == null ? '—' : netCash ? `${formatCurrency(-netDebt, currency)} net cash` : formatCurrency(netDebt, currency)}
          tone={netDebt == null ? 'neutral' : netCash ? 'good' : 'neutral'}
          hint="Total debt − cash & short-term investments"
        />
        <Tile
          label="Net Debt / EBITDA"
          value={netCash ? 'net cash' : netDebtEbitda == null ? '—' : `${netDebtEbitda.toFixed(1)}×`}
          tone={ndeTone}
          hint="Leverage. <1× strong · 1–3× ok · >3× stretched"
        />
        <Tile
          label="Interest Coverage"
          value={minimalDebt ? 'minimal debt' : coverage == null ? '—' : `${coverage.toFixed(1)}×`}
          tone={covTone}
          hint="EBIT ÷ interest expense. >8× strong · 4–8× ok · <4× risky"
        />
        <Tile
          label="Debt / FCF"
          value={netCash ? 'covered' : debtFcfYears == null ? '—' : `${debtFcfYears.toFixed(1)} yrs`}
          tone={paybackTone}
          hint="Years of TTM free cash flow to repay all debt. <3 strong · 3–6 ok · >6 stretched"
        />
      </div>
    </div>
  );
}
