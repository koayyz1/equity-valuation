import { DCFAssumptions } from '../types';

// Per-ticker saved assumption presets, persisted to localStorage.
// A saved preset is auto-applied when that ticker loads (share links win).
const KEY = 'ev-assumption-presets-v1';

function loadAll(): Record<string, DCFAssumptions> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function persist(all: Record<string, DCFAssumptions>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

export function getPreset(ticker: string): DCFAssumptions | null {
  return loadAll()[ticker.toUpperCase()] ?? null;
}

export function savePreset(ticker: string, assumptions: DCFAssumptions): void {
  const all = loadAll();
  all[ticker.toUpperCase()] = assumptions;
  persist(all);
}

export function deletePreset(ticker: string): void {
  const all = loadAll();
  delete all[ticker.toUpperCase()];
  persist(all);
}
