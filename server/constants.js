// XBRL tag fallback chains. First match wins.
// Each entry is { taxonomy, tag } — taxonomy is "us-gaap", "ifrs-full", or "dei".

export const TAG_CHAINS = {
  revenue: [
    { taxonomy: 'us-gaap', tag: 'RevenueFromContractWithCustomerExcludingAssessedTax' },
    { taxonomy: 'us-gaap', tag: 'Revenues' },
    { taxonomy: 'us-gaap', tag: 'SalesRevenueNet' },
    { taxonomy: 'us-gaap', tag: 'SalesRevenueGoodsNet' },
    { taxonomy: 'us-gaap', tag: 'RevenueFromContractWithCustomerIncludingAssessedTax' },
    { taxonomy: 'ifrs-full', tag: 'Revenue' },
    { taxonomy: 'ifrs-full', tag: 'RevenueFromContractsWithCustomers' },
  ],
  netIncome: [
    { taxonomy: 'us-gaap', tag: 'NetIncomeLoss' },
    { taxonomy: 'us-gaap', tag: 'NetIncomeLossAvailableToCommonStockholdersBasic' },
    { taxonomy: 'ifrs-full', tag: 'ProfitLoss' },
    { taxonomy: 'ifrs-full', tag: 'ProfitLossAttributableToOwnersOfParent' },
  ],
  cfo: [
    { taxonomy: 'us-gaap', tag: 'NetCashProvidedByUsedInOperatingActivities' },
    { taxonomy: 'us-gaap', tag: 'NetCashProvidedByOperatingActivities' },
    { taxonomy: 'us-gaap', tag: 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations' },
    { taxonomy: 'ifrs-full', tag: 'CashFlowsFromUsedInOperatingActivities' },
  ],
  da: [
    { taxonomy: 'us-gaap', tag: 'DepreciationDepletionAndAmortization' },
    { taxonomy: 'us-gaap', tag: 'DepreciationAndAmortization' },
    { taxonomy: 'us-gaap', tag: 'Depreciation' },
    { taxonomy: 'ifrs-full', tag: 'DepreciationAndAmortisationExpense' },
  ],
  capex: [
    { taxonomy: 'us-gaap', tag: 'PaymentsToAcquirePropertyPlantAndEquipment' },
    { taxonomy: 'us-gaap', tag: 'PaymentsToAcquireProductiveAssets' },
    { taxonomy: 'us-gaap', tag: 'CapitalExpenditureDiscontinuedOperations' },
    { taxonomy: 'ifrs-full', tag: 'PurchaseOfPropertyPlantAndEquipment' },
  ],
  // ── FCFE driver decomposition ──────────────────────────────────────────────
  // Working-capital components. Sign convention: these tags report the INCREASE
  // in the balance, so a positive AR/Inventory value is a cash OUTFLOW (negated
  // when bridging to CFO); a positive AP value is a cash INFLOW.
  changeReceivables: [
    { taxonomy: 'us-gaap', tag: 'IncreaseDecreaseInAccountsReceivable' },
    { taxonomy: 'us-gaap', tag: 'IncreaseDecreaseInAccountsAndOtherReceivables' },
    { taxonomy: 'ifrs-full', tag: 'AdjustmentsForDecreaseIncreaseInTradeAndOtherReceivables' },
  ],
  changeInventory: [
    { taxonomy: 'us-gaap', tag: 'IncreaseDecreaseInInventories' },
    { taxonomy: 'ifrs-full', tag: 'AdjustmentsForDecreaseIncreaseInInventories' },
  ],
  changePayables: [
    { taxonomy: 'us-gaap', tag: 'IncreaseDecreaseInAccountsPayable' },
    { taxonomy: 'us-gaap', tag: 'IncreaseDecreaseInAccountsPayableAndAccruedLiabilities' },
    { taxonomy: 'ifrs-full', tag: 'AdjustmentsForIncreaseDecreaseInTradeAndOtherPayables' },
  ],
  // Non-cash add-backs — often larger than working capital for software/tech.
  stockComp: [
    { taxonomy: 'us-gaap', tag: 'ShareBasedCompensation' },
    { taxonomy: 'us-gaap', tag: 'AllocatedShareBasedCompensationExpense' },
    { taxonomy: 'ifrs-full', tag: 'AdjustmentsForSharebasedPayments' },
  ],
  deferredTax: [
    { taxonomy: 'us-gaap', tag: 'DeferredIncomeTaxExpenseBenefit' },
    { taxonomy: 'us-gaap', tag: 'DeferredIncomeTaxesAndTaxCredits' },
  ],
  // Amortisation of acquired intangibles — stripped out of D&A to get a cleaner
  // maintenance-capex proxy (intangible amortisation needs no cash replacement).
  intangibleAmortization: [
    { taxonomy: 'us-gaap', tag: 'AmortizationOfIntangibleAssets' },
    { taxonomy: 'us-gaap', tag: 'AmortizationOfAcquiredIntangibleAssets' },
  ],
  // Proceeds from disposals — only some filers break this out; rendered conditionally.
  assetDisposals: [
    { taxonomy: 'us-gaap', tag: 'ProceedsFromSaleOfPropertyPlantAndEquipment' },
    { taxonomy: 'us-gaap', tag: 'ProceedsFromSaleOfProductiveAssets' },
    { taxonomy: 'ifrs-full', tag: 'ProceedsFromSalesOfPropertyPlantAndEquipment' },
  ],
  // Capital deployed outside PP&E. Acquisitions are how capital allocation skill
  // (or its absence) usually shows up, and were previously invisible: the model
  // counted only PP&E purchases as capex, so a serial acquirer looked
  // capital-light. Both are cash outflows reported as positive magnitudes.
  acquisitions: [
    { taxonomy: 'us-gaap', tag: 'PaymentsToAcquireBusinessesNetOfCashAcquired' },
    { taxonomy: 'us-gaap', tag: 'PaymentsToAcquireBusinessesGross' },
    { taxonomy: 'ifrs-full', tag: 'CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities' },
  ],
  buybacks: [
    { taxonomy: 'us-gaap', tag: 'PaymentsForRepurchaseOfCommonStock' },
    { taxonomy: 'us-gaap', tag: 'PaymentsForRepurchaseOfEquity' },
    { taxonomy: 'us-gaap', tag: 'TreasuryStockValueAcquiredCostMethod' },
  ],
  // Net PP&E (instant) — powers the Greenwald revenue-intensity capex estimate.
  ppe: [
    { taxonomy: 'us-gaap', tag: 'PropertyPlantAndEquipmentNet' },
    { taxonomy: 'ifrs-full', tag: 'PropertyPlantAndEquipment' },
  ],
  cash: [
    { taxonomy: 'us-gaap', tag: 'CashCashEquivalentsAndShortTermInvestments' },
    { taxonomy: 'us-gaap', tag: 'CashAndCashEquivalentsAtCarryingValue' },
    { taxonomy: 'us-gaap', tag: 'CashAndCashEquivalents' },
    { taxonomy: 'ifrs-full', tag: 'CashAndCashEquivalents' },
  ],
  ebit: [
    { taxonomy: 'us-gaap', tag: 'OperatingIncomeLoss' },
    { taxonomy: 'ifrs-full', tag: 'ProfitLossFromOperatingActivities' },
  ],
  interestExpense: [
    { taxonomy: 'us-gaap', tag: 'InterestExpense' },
    { taxonomy: 'us-gaap', tag: 'InterestExpenseDebt' },
    { taxonomy: 'ifrs-full', tag: 'FinanceCosts' },
  ],
  tax: [
    { taxonomy: 'us-gaap', tag: 'IncomeTaxExpenseBenefit' },
    { taxonomy: 'ifrs-full', tag: 'IncomeTaxExpenseContinuingOperations' },
  ],
  dividends: [
    { taxonomy: 'us-gaap', tag: 'PaymentsOfDividends' },
    { taxonomy: 'us-gaap', tag: 'PaymentsOfDividendsCommonStock' },
    { taxonomy: 'us-gaap', tag: 'PaymentsOfOrdinaryDividends' },
    { taxonomy: 'ifrs-full', tag: 'DividendsPaid' },
  ],
  newDebt: [
    { taxonomy: 'us-gaap', tag: 'ProceedsFromIssuanceOfDebt' },
    { taxonomy: 'us-gaap', tag: 'ProceedsFromIssuanceOfLongTermDebt' },
    { taxonomy: 'us-gaap', tag: 'ProceedsFromShortTermDebt' },
  ],
  debtRepayment: [
    { taxonomy: 'us-gaap', tag: 'RepaymentsOfDebt' },
    { taxonomy: 'us-gaap', tag: 'RepaymentsOfLongTermDebt' },
    { taxonomy: 'us-gaap', tag: 'RepaymentsOfShortTermDebt' },
  ],
  shares: [
    { taxonomy: 'us-gaap', tag: 'CommonStockSharesIssued' },
    { taxonomy: 'us-gaap', tag: 'CommonStockSharesOutstanding' },
    { taxonomy: 'dei', tag: 'EntityCommonStockSharesOutstanding' },
    { taxonomy: 'us-gaap', tag: 'WeightedAverageNumberOfDilutedSharesOutstanding' },
    { taxonomy: 'us-gaap', tag: 'WeightedAverageNumberOfSharesOutstandingBasic' },
  ],
  totalAssets: [
    { taxonomy: 'us-gaap', tag: 'Assets' },
    { taxonomy: 'ifrs-full', tag: 'Assets' },
  ],
  currentLiabilities: [
    { taxonomy: 'us-gaap', tag: 'LiabilitiesCurrent' },
    { taxonomy: 'ifrs-full', tag: 'CurrentLiabilities' },
  ],
  grossProfit: [
    { taxonomy: 'us-gaap', tag: 'GrossProfit' },
    { taxonomy: 'ifrs-full', tag: 'GrossProfit' },
  ],
  basicEPS: [
    { taxonomy: 'us-gaap', tag: 'EarningsPerShareBasic' },
    { taxonomy: 'ifrs-full', tag: 'BasicEarningsLossPerShare' },
  ],
  dilutedEPS: [
    { taxonomy: 'us-gaap', tag: 'EarningsPerShareDiluted' },
    { taxonomy: 'ifrs-full', tag: 'DilutedEarningsLossPerShare' },
  ],
  longTermDebt: [
    { taxonomy: 'us-gaap', tag: 'LongTermDebt' },
    { taxonomy: 'us-gaap', tag: 'LongTermDebtNoncurrent' },
    { taxonomy: 'ifrs-full', tag: 'NoncurrentBorrowings' },
  ],
  shortTermDebt: [
    { taxonomy: 'us-gaap', tag: 'DebtCurrent' },
    { taxonomy: 'us-gaap', tag: 'ShortTermBorrowings' },
    { taxonomy: 'us-gaap', tag: 'LongTermDebtCurrent' },
    { taxonomy: 'ifrs-full', tag: 'CurrentBorrowings' },
  ],
  stockholdersEquity: [
    { taxonomy: 'us-gaap', tag: 'StockholdersEquity' },
    { taxonomy: 'us-gaap', tag: 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest' },
    { taxonomy: 'ifrs-full', tag: 'EquityAttributableToOwnersOfParent' },
    { taxonomy: 'ifrs-full', tag: 'Equity' },
  ],
  shortTermInvestments: [
    { taxonomy: 'us-gaap', tag: 'ShortTermInvestments' },
    { taxonomy: 'us-gaap', tag: 'AvailableForSaleSecuritiesCurrent' },
    { taxonomy: 'us-gaap', tag: 'MarketableSecuritiesCurrent' },
  ],
};

// Annual report form types across US and foreign filers.
export const ANNUAL_FORMS = ['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A'];

// User-Agent required by SEC EDGAR. Replace with your contact info.
export const USER_AGENT = 'EquityValuationApp contact@example.com';

// Rate limiter: stay below EDGAR's 10 req/sec cap.
export const RATE_LIMIT_MS = 125; // ~8 requests/second
