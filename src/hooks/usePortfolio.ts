import { useCallback, useState } from 'react';
import { PortfolioPosition } from '../types';

const KEY = 'ev-portfolio-v1';

function load(): PortfolioPosition[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) {
        return p.filter(
          (x) => x && typeof x.ticker === 'string' && typeof x.shares === 'number'
        );
      }
    }
  } catch {}
  return [];
}

function persist(positions: PortfolioPosition[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(positions));
  } catch {}
}

export function usePortfolio() {
  const [positions, setPositions] = useState<PortfolioPosition[]>(() => load());

  const mutate = useCallback((fn: (p: PortfolioPosition[]) => PortfolioPosition[]) => {
    setPositions((prev) => {
      const next = fn(prev);
      persist(next);
      return next;
    });
  }, []);

  // Upsert by ticker (re-adding a held name overwrites shares/cost).
  const upsert = useCallback(
    (ticker: string, shares: number, costBasis: number) => {
      const T = ticker.toUpperCase();
      mutate((prev) => {
        const rest = prev.filter((p) => p.ticker !== T);
        return [...rest, { ticker: T, shares, costBasis, addedAt: Date.now() }];
      });
    },
    [mutate]
  );

  const remove = useCallback(
    (ticker: string) => {
      const T = ticker.toUpperCase();
      mutate((prev) => prev.filter((p) => p.ticker !== T));
    },
    [mutate]
  );

  return { positions, upsert, remove };
}
