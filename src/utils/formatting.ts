const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  HKD: 'HK$',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'CHF ',
  KRW: '₩',
  INR: '₹',
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] || `${code} `;
}

export function formatCurrency(
  value: number | null | undefined,
  currency: string = 'USD',
  abbreviated: boolean = true
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  const sym = currencySymbol(currency);
  const absVal = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (!abbreviated) {
    return `${sign}${sym}${absVal.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }

  if (absVal >= 1e12) return `${sign}${sym}${(absVal / 1e12).toFixed(2)}T`;
  if (absVal >= 1e9) return `${sign}${sym}${(absVal / 1e9).toFixed(2)}B`;
  if (absVal >= 1e6) return `${sign}${sym}${(absVal / 1e6).toFixed(1)}M`;
  if (absVal >= 1e3) return `${sign}${sym}${(absVal / 1e3).toFixed(1)}K`;
  return `${sign}${sym}${absVal.toFixed(2)}`;
}

export function formatPercent(
  value: number | null | undefined,
  decimals: number = 1
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatShares(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  const absVal = Math.abs(value);
  if (absVal >= 1e9) return `${(absVal / 1e9).toFixed(2)}B`;
  if (absVal >= 1e6) return `${(absVal / 1e6).toFixed(2)}M`;
  if (absVal >= 1e3) return `${(absVal / 1e3).toFixed(1)}K`;
  return absVal.toLocaleString();
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/** Parse a user-typed value like "$164.7B", "-$2.3M", "1,234,567", "11%". */
export function parseInputValue(raw: string): number | null {
  const cleaned = raw.replace(/[$€£¥₩₹,\s]/g, '').replace(/[A-Za-z]$/, (m) => m.toUpperCase());
  const neg = cleaned.startsWith('-');
  const stripped = neg ? cleaned.slice(1) : cleaned;
  const suffix = stripped.slice(-1);
  const body = stripped.replace(/[BMKT%]$/i, '');
  const num = parseFloat(body);
  if (Number.isNaN(num)) return null;
  let multiplier = 1;
  if (suffix === 'T') multiplier = 1e12;
  else if (suffix === 'B') multiplier = 1e9;
  else if (suffix === 'M') multiplier = 1e6;
  else if (suffix === 'K') multiplier = 1e3;
  else if (suffix === '%') multiplier = 0.01;
  return (neg ? -1 : 1) * num * multiplier;
}
