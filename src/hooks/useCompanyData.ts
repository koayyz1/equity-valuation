import { useState, useCallback } from 'react';
import { CompanyInfo, FinancialData, PriceData } from '../types';
import { fetchJson } from '../utils/fetchJson';

const API_BASE = '/api';

interface UseCompanyDataReturn {
  companyInfo: CompanyInfo | null;
  financials: FinancialData | null;
  priceData: PriceData | null;
  loading: boolean;
  error: string | null;
  fetchCompany: (ticker: string) => Promise<void>;
  clearData: () => void;
}

export function useCompanyData(): UseCompanyDataReturn {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [financials, setFinancials] = useState<FinancialData | null>(null);
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompany = useCallback(async (ticker: string) => {
    setLoading(true);
    setError(null);
    setCompanyInfo(null);
    setFinancials(null);
    setPriceData(null);

    try {
      // fetchJson retries transient edge/cold-start blips (the "Not Found" 404s)
      // and only surfaces genuine app errors (e.g. a real "ticker not found").
      const company = await fetchJson<{ cik: string; name: string }>(
        `${API_BASE}/company/${encodeURIComponent(ticker)}`
      );
      const info: CompanyInfo = {
        ticker: ticker.toUpperCase(),
        cik: company.cik,
        name: company.name,
      };
      setCompanyInfo(info);

      // Fetch financials and price in parallel
      const [fin, price] = await Promise.all([
        fetchJson<FinancialData>(
          `${API_BASE}/financials/${company.cik}?ticker=${encodeURIComponent(ticker)}`
        ),
        fetchJson<PriceData>(`${API_BASE}/price/${encodeURIComponent(ticker)}`),
      ]);
      setFinancials(fin);
      setPriceData(price);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  const clearData = useCallback(() => {
    setCompanyInfo(null);
    setFinancials(null);
    setPriceData(null);
    setError(null);
  }, []);

  return {
    companyInfo,
    financials,
    priceData,
    loading,
    error,
    fetchCompany,
    clearData,
  };
}
