import { FinancialData, Overrides } from '../types';

export interface ValuationInputs {
  fcfe: number | null;
  cash: number | null;
  revenue: number | null;
  shares: number | null;
  capex: number | null;
  netBorrowing: number | null;
}

/**
 * Resolve the DCF/FCFY input set from financials, letting any user override win.
 * Shared by the Valuation tab's cards so they all read the same numbers.
 */
export function resolveValuationInputs(
  financials: FinancialData,
  overrides: Overrides
): ValuationInputs {
  const pick = (k: keyof ValuationInputs): number | null =>
    overrides[k] !== undefined ? (overrides[k] as number | null) : financials[k];
  return {
    fcfe: pick('fcfe'),
    cash: pick('cash'),
    revenue: pick('revenue'),
    shares: pick('shares'),
    capex: pick('capex'),
    netBorrowing: pick('netBorrowing'),
  };
}
