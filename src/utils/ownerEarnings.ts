/**
 * Maintenance capex and owner earnings.
 *
 * FCFE subtracts *total* capex, which penalises a company for investing — a
 * business spending heavily at high returns scores worse than one harvesting.
 * Buffett's owner earnings subtract only the capex needed to hold position, on
 * the view that growth capex is discretionary value creation rather than a cost
 * of staying alive.
 *
 * Neither maintenance nor growth capex is disclosed, so both are estimated two
 * independent ways. Where the estimates disagree, that gap is the honest
 * uncertainty and is carried through to the valuation as a range rather than
 * hidden behind a point estimate.
 */

export interface MaintenanceCapexInputs {
  /** Total capex, negative (cash outflow). */
  capex: number | null;
  /** Depreciation & amortisation. */
  da: number | null;
  /** Amortisation of acquired intangibles — needs no cash replacement. */
  intangibleAmortization: number | null;
  /** Net PP&E, for the revenue-intensity estimate. */
  ppe: number | null;
  revenue: number | null;
  priorRevenue: number | null;
}

export interface MaintenanceCapexEstimate {
  /** Positive magnitudes. Null when the method's inputs are unavailable. */
  daMethod: number | null;
  intensityMethod: number | null;
  /** Conservative (highest maintenance → lowest owner earnings). */
  high: number | null;
  /** Aggressive (lowest maintenance → highest owner earnings). */
  low: number | null;
  /** Midpoint used for the headline figure. */
  mid: number | null;
  /** True when the two methods disagree enough to matter (>20% apart). */
  wide: boolean;
  /** Total capex as a positive magnitude, for reference. */
  totalCapex: number | null;
  /** capex ÷ D&A — scale-free replacement-rate signal. */
  capexToDa: number | null;
}

/**
 * Two independent estimates:
 *  - D&A run-rate: depreciation approximates the annual consumption of the
 *    asset base. Intangible amortisation is stripped out where reported, since
 *    acquired intangibles are not replaced with cash.
 *  - Revenue intensity (Greenwald): PP&E per dollar of sales × revenue growth
 *    gives the growth portion; the remainder is maintenance.
 */
export function computeMaintenanceCapex(i: MaintenanceCapexInputs): MaintenanceCapexEstimate {
  const totalCapex = i.capex != null ? Math.abs(i.capex) : null;
  const daNet =
    i.da != null ? Math.max(0, i.da - Math.abs(i.intangibleAmortization ?? 0)) : null;

  // Maintenance cannot sensibly exceed what was actually spent.
  const daMethod = daNet != null && totalCapex != null ? Math.min(daNet, totalCapex) : daNet;

  let intensityMethod: number | null = null;
  if (
    totalCapex != null &&
    i.ppe != null &&
    i.revenue != null &&
    i.revenue > 0 &&
    i.priorRevenue != null
  ) {
    const intensity = i.ppe / i.revenue;
    const growth = Math.max(0, intensity * (i.revenue - i.priorRevenue));
    intensityMethod = Math.max(0, Math.min(totalCapex, totalCapex - growth));
  }

  const both = [daMethod, intensityMethod].filter((v): v is number => v != null);
  const high = both.length ? Math.max(...both) : null;
  const low = both.length ? Math.min(...both) : null;
  const mid = both.length ? both.reduce((a, b) => a + b, 0) / both.length : null;
  const wide = high != null && low != null && high > 0 ? (high - low) / high > 0.2 : false;

  return {
    daMethod,
    intensityMethod,
    high,
    low,
    mid,
    wide,
    totalCapex,
    capexToDa: daNet != null && daNet > 0 && totalCapex != null ? totalCapex / daNet : null,
  };
}

export type EarningsBasis = 'fcfe' | 'ownerEarnings';

/**
 * The cash figure the DCF capitalises, under the chosen basis.
 *
 *   FCFE           = CFO + capex + net borrowing
 *   Owner earnings = CFO − maintenance capex
 *
 * Owner earnings deliberately excludes net borrowing: crediting debt-funded
 * cash as "free" rewards leverage, which is the opposite of how an owner reads
 * a balance sheet.
 *
 * `variant` selects which end of the maintenance range to use, so a valuation
 * can be run at both ends to produce a range instead of false precision.
 */
export function resolveEarningsBase(
  basis: EarningsBasis,
  inputs: {
    fcfe: number | null;
    cfo: number | null;
    maintenance: MaintenanceCapexEstimate;
  },
  variant: 'low' | 'mid' | 'high' = 'mid'
): number | null {
  if (basis === 'fcfe') return inputs.fcfe;
  if (inputs.cfo == null) return inputs.fcfe;
  // "low" value ⇒ conservative ⇒ the *highest* maintenance charge.
  const maint =
    variant === 'low' ? inputs.maintenance.high
    : variant === 'high' ? inputs.maintenance.low
    : inputs.maintenance.mid;
  if (maint == null) return inputs.fcfe;
  return inputs.cfo - maint;
}
