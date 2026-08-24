import { useState, useCallback } from 'react';
import { CompanyInfo, FinancialData, PriceData } from '../types';

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
      const companyRes = await fetch(`${API_BASE}/company/${encodeURIComponent(ticker)}`);
      if (!companyRes.ok) {
        const body = await companyRes.json().catch(() => ({}));
        throw new Error(body.error || `Company lookup failed (${companyRes.status})`);
      }
      const company = await companyRes.json();
      const info: CompanyInfo = {
        ticker: ticker.toUpperCase(),
        cik: company.cik,
        name: company.name,
      };
      setCompanyInfo(info);

      // Fetch financials and price in parallel
      const [finRes, priceRes] = await Promise.all([
        fetch(`${API_BASE}/financials/${company.cik}?ticker=${encodeURIComponent(ticker)}`),
        fetch(`${API_BASE}/price/${encodeURIComponent(ticker)}`),
      ]);

      if (!finRes.ok) {
        const body = await finRes.json().catch(() => ({}));
        throw new Error(body.error || `Financials fetch failed (${finRes.status})`);
      }

      const [fin, price] = await Promise.all([finRes.json(), priceRes.json()]);
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
