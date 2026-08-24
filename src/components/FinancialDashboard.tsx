import { useEffect, useState } from 'react';
import { FinancialData, PriceData, Overrides } from '../types';
import {
  formatCurrency,
  formatPercent,
  formatShares,
  formatDate,
  parseInputValue,
} from '../utils/formatting';
import { EditableCell } from './EditableCell';
import { CompanyLogo } from './CompanyLogo';
import { computeWACC, computeROCE, computeEarningsYield } from '../utils/calculations';

interface AnalystEstimates {
  epsGrowthNextYear: number | null;
  epsGrowthLongTerm: number | null;
  pegRatio: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  earningsYield: number | null;
  roe5y: number | null;
  error?: string;
}

interface FinancialDashboardProps {
  ticker: string;
  companyName: string | null;
  financials: FinancialData;
  priceData: PriceData;
  overrides: Overrides;
  onOverride: (field: keyof FinancialData, value: number | null) => void;
}

type ValueFormat = 'currency' | 'percent' | 'shares' | 'ratio' | 'rawNumber';

interface DataRowProps {
  label: string;
  value: number | null;
  format: ValueFormat;
  currency?: string;
  fieldKey?: keyof FinancialData;
  overrides?: Overrides;
  onOverride?: (field: keyof FinancialData, value: number | null) => void;
  description?: string;
  isPercentField?: boolean;
  source?: 'edgar' | 'yahoo';
}

// A small colored dot indicating which data source supplied a value.
function SourceDot({ source }: { source?: 'edgar' | 'yahoo' }) {
  if (!source) return null;
  const isEdgar = source === 'edgar';
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
        isEdgar ? 'bg-sky-500' : 'bg-violet-500'
      }`}
      title={isEdgar ? 'Source: SEC EDGAR' : 'Source: Yahoo Finance'}
    />
  );
}

function formatValue(val: number | null | undefined, fmt: ValueFormat, currency: string) {
  if (val === null || val === undefined) return 'N/A';
  switch (fmt) {
    case 'currency':
      return formatCurrency(val, currency);
    case 'percent':
      return formatPercent(val);
    case 'shares':
      return formatShares(val);
    case 'ratio':
      return val.toFixed(2) + 'x';
    case 'rawNumber':
      return val.toLocaleString();
  }
}

function DataRow({
  label,
  value,
  format,
  currency = 'USD',
  fieldKey,
  overrides,
  onOverride,
  description,
  isPercentField,
  source,
}: DataRowProps) {
  const isOverridden =
    fieldKey != null && overrides ? overrides[fieldKey] !== undefined : false;
  const displayValue =
    fieldKey && overrides && overrides[fieldKey] !== undefined
      ? overrides[fieldKey]!
      : value;
  const formatted = formatValue(displayValue, format, currency);
  const isMissing = displayValue === null || displayValue === undefined;

  const handleSave = (raw: string) => {
    if (!fieldKey || !onOverride) return;
    const num = parseInputValue(raw);
    // If user types a percentage-style number without %, and it's a percent field, interpret as such
    if (num != null && isPercentField && Math.abs(num) > 1 && !raw.includes('%')) {
      onOverride(fieldKey, num / 100);
    } else {
      onOverride(fieldKey, num);
    }
  };

  const handleClear = () => {
    if (!fieldKey || !onOverride) return;
    onOverride(fieldKey, undefined as unknown as number | null);
  };

  return (
    <div
      className={`flex items-center justify-between py-1 px-2 rounded transition-colors ${
        isMissing ? 'bg-yellow-900/10' : 'hover:bg-gray-800/40'
      }`}
      title={description}
    >
      <span className="text-gray-400 text-xs flex items-center gap-1.5">
        <SourceDot source={source} />
        {label}
      </span>
      {fieldKey && onOverride ? (
        <EditableCell
          value={formatted}
          onSave={handleSave}
          onClear={handleClear}
          isOverridden={isOverridden}
          className={`font-mono text-xs ${
            isMissing ? 'text-yellow-500' : isOverridden ? 'text-blue-400' : 'text-gray-200'
          }`}
        />
      ) : (
        <span
          className={`font-mono text-xs ${
            isMissing ? 'text-yellow-500' : 'text-gray-200'
          }`}
        >
          {formatted}
        </span>
      )}
    </div>
  );
}

export function FinancialDashboard({
  ticker,
  companyName,
  financials,
  priceData,
  overrides,
  onOverride,
}: FinancialDashboardProps) {
  const currency = priceData.currency || financials.currency || 'USD';

  const effectiveFCFE =
    overrides.fcfe !== undefined ? overrides.fcfe : financials.fcfe;

  // Derive market cap from price × shares if Yahoo didn't return it.
  const effectiveShares =
    overrides.shares !== undefined ? overrides.shares : financials.shares;
  const effectiveMarketCap =
    priceData.marketCap ??
    (priceData.price != null && effectiveShares != null
      ? priceData.price * effectiveShares
      : null);

  const fcfeYield =
    effectiveFCFE != null && effectiveMarketCap != null && effectiveMarketCap > 0
      ? effectiveFCFE / effectiveMarketCap
      : null;

  // WACC = Ke × (E/V) + Kd × (1-t) × (D/V)
  const wacc = computeWACC({
    beta: financials.beta,
    marketCap: effectiveMarketCap,
    totalDebt: financials.totalDebt,
    interestExpense: financials.interestExpense,
    taxRate: financials.taxRate,
  });

  const roicMinusWacc =
    financials.roic != null && wacc != null ? financials.roic - wacc : null;

  // Analyst estimates (PEG, EPS growth next year, 5y ROE)
  const [estimates, setEstimates] = useState<AnalystEstimates | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!ticker) return;
    fetch(`/api/estimates/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setEstimates(j); })
      .catch(() => { if (!cancelled) setEstimates(null); });
    return () => { cancelled = true; };
  }, [ticker]);

  // Insider ownership (from Yahoo profile / defaultKeyStatistics)
  const [insiderPct, setInsiderPct] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!ticker) return;
    fetch(`/api/profile/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setInsiderPct(j?.heldPercentInsiders ?? null);
      })
      .catch(() => { if (!cancelled) setInsiderPct(null); });
    return () => { cancelled = true; };
  }, [ticker]);

  // ROCE = NOPAT / (Invested Capital + Excess Cash)
  const roce = computeROCE({
    ebit: financials.ebit,
    taxRate: financials.taxRate,
    investedCapital: financials.investedCapital,
    cash: financials.cash,
    revenue: financials.revenue,
  });

  // Earnings yield prefers estimate (1/trailingPE); fallback to NI/MktCap.
  const earningsYield =
    estimates?.earningsYield ?? computeEarningsYield(financials.netIncome, effectiveMarketCap);

  const displayName = companyName || financials.entityName || priceData.longName || 'N/A';

  return (
    <div className="space-y-3">
      {/* Identifier row */}
      <div className="grid grid-cols-2 md:grid-cols-[auto_1fr_2.5fr_1fr_1fr_1fr] gap-2 items-center">
        <div className="flex items-center justify-center md:pr-1">
          <CompanyLogo ticker={ticker} size={56} />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider">Ticker</div>
          <div className="text-blue-400 font-mono font-bold text-base">{ticker}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider">Company</div>
          <div className="text-white font-medium text-sm truncate" title={displayName}>
            {displayName}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider">Price</div>
          <div className="text-white font-mono font-bold text-base">
            {priceData.price != null
              ? formatCurrency(priceData.price, currency, false)
              : 'N/A'}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider">Mkt Cap</div>
          <div className="text-white font-mono font-bold text-base">
            {formatCurrency(effectiveMarketCap, currency)}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider">Currency</div>
          <div className="text-white font-mono font-bold text-base">{currency}</div>
        </div>
      </div>

      {/* Meta strip — data freshness + source legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-gray-500 px-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500" />
          EDGAR filed:{' '}
          <span className="text-gray-300">
            {formatDate(financials._asOf?.edgarFiling ?? financials.filingDate)}
          </span>
        </span>
        {financials._asOf?.yahooTtm && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500" />
            Yahoo TTM thru:{' '}
            <span className="text-gray-300">{formatDate(financials._asOf.yahooTtm)}</span>
          </span>
        )}
        {financials._asOf?.yahooCash && (
          <span>
            Balance sheet:{' '}
            <span className="text-gray-300">{formatDate(financials._asOf.yahooCash)}</span>
          </span>
        )}
        {priceData.exchange && (
          <span>
            Exchange: <span className="text-gray-300">{priceData.exchange}</span>
          </span>
        )}
        <span className="text-gray-500 ml-auto">
          Double-click to override · Right-click to reset
        </span>
      </div>

      {/* Data grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Income */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em] mb-2 pb-1 border-b border-gray-800">
            Income (LTM)
          </div>
          <div className="space-y-0.5">
            <DataRow
              label="Revenue"
              value={financials.revenue}
              format="currency"
              currency={currency}
              fieldKey="revenue"
              overrides={overrides}
              onOverride={onOverride}
              source={financials._sources?.revenue}
            />
            <DataRow
              label="EBITDA"
              value={financials.ebitda}
              format="currency"
              currency={currency}
              fieldKey="ebitda"
              overrides={overrides}
              onOverride={onOverride}
            />
            <DataRow
              label="EBIT"
              value={financials.ebit}
              format="currency"
              currency={currency}
              fieldKey="ebit"
              overrides={overrides}
              onOverride={onOverride}
            />
            <DataRow
              label="Net Income"
              value={financials.netIncome}
              format="currency"
              currency={currency}
              fieldKey="netIncome"
              overrides={overrides}
              onOverride={onOverride}
              source={financials._sources?.netIncome}
            />
          </div>
        </div>

        {/* Cash Flow */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em] mb-2 pb-1 border-b border-gray-800">
            Cash Flow (LTM)
          </div>
          <div className="space-y-0.5">
            <DataRow
              label="CFO"
              value={financials.cfo}
              format="currency"
              currency={currency}
              fieldKey="cfo"
              overrides={overrides}
              onOverride={onOverride}
              source={financials._sources?.cfo}
            />
            <DataRow
              label="CapEx"
              value={financials.capex}
              format="currency"
              currency={currency}
              fieldKey="capex"
              overrides={overrides}
              onOverride={onOverride}
              source={financials._sources?.capex}
            />
            <DataRow
              label="D&A"
              value={financials.da}
              format="currency"
              currency={currency}
              fieldKey="da"
              overrides={overrides}
              onOverride={onOverride}
              source={financials._sources?.da}
            />
            <DataRow
              label="Net Borrowing"
              value={financials.netBorrowing}
              format="currency"
              currency={currency}
              fieldKey="netBorrowing"
              overrides={overrides}
              onOverride={onOverride}
              source={financials._sources?.netBorrowing}
            />
            <DataRow
              label="FCFE"
              value={financials.fcfe}
              format="currency"
              currency={currency}
              fieldKey="fcfe"
              overrides={overrides}
              onOverride={onOverride}
              description="CFO + CapEx (negative) + Net Borrowing"
              source={financials._sources?.fcfe}
            />
          </div>
        </div>

        {/* Balance Sheet */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em] mb-2 pb-1 border-b border-gray-800">
            Balance Sheet
          </div>
          <div className="space-y-0.5">
            <DataRow
              label="Cash"
              value={financials.cash}
              format="currency"
              currency={currency}
              fieldKey="cash"
              overrides={overrides}
              onOverride={onOverride}
              source={financials._sources?.cash}
            />
            <DataRow
              label="Total Assets"
              value={financials.totalAssets}
              format="currency"
              currency={currency}
              fieldKey="totalAssets"
              overrides={overrides}
              onOverride={onOverride}
            />
            <DataRow
              label="Current Liab."
              value={financials.currentLiabilities}
              format="currency"
              currency={currency}
              fieldKey="currentLiabilities"
              overrides={overrides}
              onOverride={onOverride}
            />
            <DataRow
              label="Shares Out"
              value={financials.shares}
              format="shares"
              fieldKey="shares"
              overrides={overrides}
              onOverride={onOverride}
            />
            <DataRow
              label="Invested Capital"
              value={financials.investedCapital}
              format="currency"
              currency={currency}
            />
          </div>
        </div>

        {/* Returns & Ratios */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em] mb-2 pb-1 border-b border-gray-800">
            Returns & Ratios
          </div>
          <div className="space-y-0.5">
            <DataRow
              label="ROIC"
              value={financials.roic}
              format="percent"
              fieldKey="roic"
              overrides={overrides}
              onOverride={onOverride}
              isPercentField
              description="NOPAT / Invested Capital"
            />
            <DataRow
              label="ROIC - WACC"
              value={roicMinusWacc}
              format="percent"
              description="Value creation spread"
            />
            <DataRow
              label="ROCE"
              value={roce}
              format="percent"
              description="NOPAT / (Invested Capital + Excess Cash)"
            />
            <DataRow
              label="ROE (5Y avg)"
              value={estimates?.roe5y ?? null}
              format="percent"
              description="Mean of NetIncome / Equity over the last 5 fiscal years"
            />
            <DataRow
              label="PEG Ratio"
              value={estimates?.pegRatio ?? null}
              format="ratio"
              description="Trailing P/E ÷ long-term EPS growth (Yahoo)"
            />
          </div>
        </div>

        {/* Dividends & Debt */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em] mb-2 pb-1 border-b border-gray-800">
            Dividends & Debt
          </div>
          <div className="space-y-0.5">
            <DataRow
              label="Dividends Paid"
              value={financials.dividends}
              format="currency"
              currency={currency}
              fieldKey="dividends"
              overrides={overrides}
              onOverride={onOverride}
            />
            <DataRow
              label="New Debt"
              value={financials.newDebt}
              format="currency"
              currency={currency}
              fieldKey="newDebt"
              overrides={overrides}
              onOverride={onOverride}
            />
            <DataRow
              label="Debt Repaid"
              value={financials.debtRepayment}
              format="currency"
              currency={currency}
              fieldKey="debtRepayment"
              overrides={overrides}
              onOverride={onOverride}
            />
            <DataRow
              label="Interest Expense"
              value={financials.interestExpense}
              format="currency"
              currency={currency}
              fieldKey="interestExpense"
              overrides={overrides}
              onOverride={onOverride}
            />
            <DataRow
              label="Insider Shares (%)"
              value={insiderPct}
              format="percent"
              description="% of shares held by insiders (Yahoo)"
            />
          </div>
        </div>

        {/* Forward / market metrics */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.14em] mb-2 pb-1 border-b border-gray-800">
            Forward Metrics
          </div>
          <div className="space-y-0.5">
            <DataRow
              label="FCF Growth (5Y)"
              value={financials.fcfCAGR}
              format="percent"
            />
            <DataRow label="FCFE Yield" value={fcfeYield} format="percent" />
            <DataRow
              label="Earnings Yield"
              value={earningsYield}
              format="percent"
              description="1 / trailing P/E"
            />
            <DataRow
              label="EPS Growth (Next Yr)"
              value={estimates?.epsGrowthNextYear ?? null}
              format="percent"
              description="Analyst consensus EPS growth, next fiscal year (Yahoo)"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
