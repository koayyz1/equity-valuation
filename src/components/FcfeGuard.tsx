import { FinancialData, Overrides } from '../types';
import { resolveValuationInputs } from '../utils/valuationInputs';
import { formatCurrency } from '../utils/formatting';
import { IconWarning } from './icons';

interface FcfeGuardProps {
  financials: FinancialData;
  overrides: Overrides;
}

/**
 * Warns when the FCFE base makes an FCFE-driven valuation unreliable:
 * negative FCFE (red) or a history with negative-FCF years (amber).
 * Renders nothing when the base looks healthy.
 */
export function FcfeGuard({ financials, overrides }: FcfeGuardProps) {
  const { fcfe } = resolveValuationInputs(financials, overrides);
  const currency = financials.currency || 'USD';

  const recent = (financials.fcfHistory ?? []).slice(0, 5);
  const negYears = recent.filter((e) => e.fcf <= 0).length;

  if (fcfe == null) return null; // models already surface N/A on their own

  if (fcfe <= 0) {
    return (
      <div className="bg-red-950/40 border border-red-900/60 rounded-lg px-4 py-2.5 text-xs text-red-300 leading-relaxed">
        <span className="font-semibold">
          <IconWarning size={13} className="inline -mt-0.5 mr-1" />
          FCFE is negative ({formatCurrency(fcfe, currency)}).
        </span>{' '}
        An FCFE-based DCF and FCF-yield model are unreliable here — typical causes are heavy debt
        repayment, aggressive capex, or a pre-FCF growth phase. Treat both verdicts below with
        caution, or override FCFE / the Y1–Y5 components with normalized figures.
      </div>
    );
  }

  if (negYears > 0) {
    return (
      <div className="bg-amber-950/30 border border-amber-900/50 rounded-lg px-4 py-2.5 text-xs text-amber-300/90 leading-relaxed">
        <span className="font-semibold">
          <IconWarning size={13} className="inline -mt-0.5 mr-1" />
          Erratic FCF history — negative in {negYears} of the last {recent.length} fiscal years.
        </span>{' '}
        The FCFE base and the data-driven growth defaults may be unstable; sanity-check the
        assumptions before trusting the outputs.
      </div>
    );
  }

  return null;
}
