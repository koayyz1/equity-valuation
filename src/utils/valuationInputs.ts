import { FinancialData, Overrides } from '../types';
import { computeMaintenanceCapex, MaintenanceCapexEstimate } from './ownerEarnings';

export interface ValuationInputs {
  fcfe: number | null;
  cash: number | null;
  revenue: number | null;
  shares: number | null;
  capex: number | null;
  netBorrowing: number | null;
  cfo: number | null;
  /** Estimated split of capex, for the owner-earnings basis. */
  maintenance: MaintenanceCapexEstimate;
}

/**
 * Resolve the DCF/FCFY input set from financials, letting any user override win.
 * Shared by the Valuation tab's cards so they all read the same numbers.
 */
export function resolveValuationInputs(
  financials: FinancialData,
  overrides: Overrides
): ValuationInputs {
  const pick = (k: 'fcfe' | 'cash' | 'revenue' | 'shares' | 'capex' | 'netBorrowing' | 'cfo'): number | null =>
    overrides[k] !== undefined ? (overrides[k] as number | null) : financials[k];
  const capex = pick('capex');
  const revenue = pick('revenue');
  return {
    fcfe: pick('fcfe'),
    cash: pick('cash'),
    revenue,
    shares: pick('shares'),
    capex,
    netBorrowing: pick('netBorrowing'),
    cfo: pick('cfo'),
    maintenance: computeMaintenanceCapex({
      capex,
      da: financials.da,
      intangibleAmortization: financials.intangibleAmortization,
      ppe: financials.ppe,
      revenue,
      priorRevenue: financials.priorRevenue,
    }),
  };
}
