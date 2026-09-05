/**
 * Per-ticker investment thesis, recorded by the user.
 *
 * The qualitative judgment is the part that cannot be delegated — it is where
 * understanding lives, and an LLM rating grounded in web search returns the
 * consensus narrative, which is the opposite of independent thinking. So the
 * model assembles evidence and the reader answers the questions.
 *
 * Stored per ticker rather than per watchlist entry so a thesis survives adding
 * and removing the name, and exists for tickers merely being researched.
 */

export interface Thesis {
  /** Circle of competence — can I explain how this makes money? */
  understand?: string;
  /** The durable advantage, and the evidence for it. */
  moat?: string;
  /** Inversion: what would actually kill this business? */
  breaks?: string;
  /** What I would have to see to change my mind. */
  watch?: string;
  updatedAt?: number;
}

export const THESIS_QUESTIONS: {
  key: keyof Omit<Thesis, 'updatedAt'>;
  label: string;
  prompt: string;
}[] = [
  {
    key: 'understand',
    label: 'Do I understand it?',
    prompt: 'How does this business make money? If you cannot state it plainly, that is the answer.',
  },
  {
    key: 'moat',
    label: 'What is the moat?',
    prompt: 'What stops a well-funded competitor taking these profits, and what evidence supports it?',
  },
  {
    key: 'breaks',
    label: 'What would kill it?',
    prompt: 'Invert. Assume it is 2035 and this went badly — write the reason.',
  },
  {
    key: 'watch',
    label: 'What would change my mind?',
    prompt: 'Name the specific numbers or events that would break the thesis.',
  },
];

const KEY = 'ev-thesis-v1';

type Store = Record<string, Thesis>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    // Unreadable storage should not block research.
    return {};
  }
}

export function getThesis(ticker: string): Thesis | null {
  return load()[ticker.toUpperCase()] ?? null;
}

export function saveThesis(ticker: string, thesis: Thesis): void {
  try {
    const store = load();
    store[ticker.toUpperCase()] = { ...thesis, updatedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Persistence is a convenience; the in-memory value still shows.
  }
}

/** How many of the four questions have a substantive answer. */
export function thesisCompleteness(t: Thesis | null): number {
  if (!t) return 0;
  return THESIS_QUESTIONS.filter((q) => (t[q.key] ?? '').trim().length > 10).length;
}
