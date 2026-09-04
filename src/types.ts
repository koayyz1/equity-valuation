export interface CompanyInfo {
  ticker: string;
  cik: string;
  name: string;
}

export interface FinancialData {
  entityName: string | null;
  cik: number | null;
  filingDate: string | null;
  currency: string;
  // Raw
  revenue: number | null;
  netIncome: number | null;
  cfo: number | null;
  da: number | null;
  capex: number | null;
  cash: number | null;
  ebit: number | null;
  interestExpense: number | null;
  tax: number | null;
  dividends: number | null;
  newDebt: number | null;
  debtRepayment: number | null;
  shares: number | null;
  totalAssets: number | null;
  currentLiabilities: number | null;
  totalDebt: number | null;
  stockholdersEquity: number | null;
  goodwill: number | null;
  beta: number | null;
  // Computed
  ebitda: number | null;
  netBorrowing: number | null;
  fcfe: number | null;
  payoutRatio: number | null;
  taxRate: number | null;
  nopat: number | null;
  investedCapital: number | null;
  roic: number | null;
  wacc: number | null;
  fcfCAGR: number | null;
  fcfHistory: { fy: number; fcf: number }[];
  _tags?: Record<string, string | undefined>;
  /** Per-field data provenance: which source supplied the displayed value. */
  _sources?: Partial<Record<keyof FinancialData, 'edgar' | 'yahoo'>>;
  /** As-of dates for the underlying sources. */
  _asOf?: {
    edgarFiling: string | null;
    yahooTtm: string | null;
    yahooCash: string | null;
  };
}

export interface PriceData {
  price: number | null;
  marketCap: number | null;
  currency: string;
  sharesOutstanding: number | null;
  exchange?: string | null;
  longName?: string | null;
  error?: string;
}

export type UncertaintyLevel = 1 | 2 | 3 | 4;

export interface DCFAssumptions {
  growthYears: number;
  growthRate: number;
  steadyRate: number;
  terminalGrowth: number;
  discountRate: number;
  uncertainty: UncertaintyLevel;
  excessCashRatio: number;
  /** Forward FCF Yield conservatism lever: fraction of the DCF's terminal value
   *  to discard when setting the required yield. 0 = identical to the DCF,
   *  1 = no terminal credit at all. Optional for back-compat with saved
   *  assumptions; defaults to DEFAULT_TERMINAL_HAIRCUT. */
  terminalHaircut?: number;
  /** Optional year-by-year overrides for CapEx (negative values) and Net Borrowing.
   *  Indexed 0..4 for years 1..5. null means use default projection. */
  capexOverrides?: (number | null)[];
  netBorrowingOverrides?: (number | null)[];
}

export interface DCFResult {
  yearlyFCFE: number[];
  terminalValue: number;
  npv: number;
  excessCash: number;
  dcfPrice: number | null;
  dcfPriceMOS: number | null;
  tvRatio: number | null;
  // Present value split into the three additive terms of the closed-form DCF,
  // computed from the actual (override-adjusted) discounted cash flows.
  phase1PV: number; // growth phase: years 1..growthYears
  phase2PV: number; // steady phase: years growthYears+1..10
  terminalPV: number; // discounted terminal value
}

export interface FCFYResult {
  /** Yield demanded after the terminal haircut — the actionable hurdle. */
  requiredYield: number;
  /** Yield implied by the DCF with no haircut, i.e. F = FCFE₁/(S₁+S₂+S_T). */
  baseYield: number;
  /** Conservatism lever actually applied (0 = pure DCF, 1 = no terminal credit). */
  terminalHaircut: number;
  /** The three additive PV terms, per unit of FCFE₀ (pre-haircut). */
  terms: { phase1: number; phase2: number; terminal: number };
  /** Terminal share of pre-haircut value — what the haircut is acting on. */
  terminalShare: number | null;
  /** FCFE₁ / market cap — what the stock actually offers today. */
  actualYield: number | null;
  /** Single source of truth for the verdict: does the offered yield meet the
   *  hurdle? Null when no market cap was supplied. Every surface must use this
   *  rather than re-deriving a threshold, or the same stock reads differently
   *  in the detail view and the watchlist. */
  clearsHurdle: boolean | null;
  blendedGrowth: number;
  fcfyPrice: number | null;
  fcfyPriceMOS: number | null;
}

export interface SearchResult {
  ticker: string;
  name: string;
  cik?: string;
}

/** Overrides let the user manually supply values EDGAR couldn't provide. */
export type Overrides = Partial<Record<keyof FinancialData, number | null>>;

/** A single entry in the watchlist, persisted to localStorage. */
export interface WatchlistEntry {
  ticker: string;
  name: string;
  currency: string;
  assumptions: DCFAssumptions;
  overrides: Overrides;
  addedAt: number; // timestamp
  notes?: string; // thesis journal
  notesAt?: number; // last-edited timestamp
}

/** A named watchlist containing an ordered array of entries. */
export interface WatchlistData {
  id: string;
  name: string;
  entries: WatchlistEntry[];
  createdAt: number;
}

/** A held position, persisted to localStorage. */
export interface PortfolioPosition {
  ticker: string;
  shares: number;
  costBasis: number; // per-share average cost
  purchaseDate?: string; // YYYY-MM-DD — needed for TWRR / MWRR
  addedAt: number;
}
