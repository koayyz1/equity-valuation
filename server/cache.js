// Lightweight in-memory TTL cache shared across requests.
//
// The Peers and Watchlist views fan out to many tickers at once and repeatedly
// re-request the same ones; caching the upstream EDGAR/Yahoo results collapses
// that into a single fetch per ticker per TTL window, cutting latency and the
// chance of tripping a rate limit.

const store = new Map(); // key -> { value, expires }
const MAX_ENTRIES = 500;

export function getCached(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function setCached(key, value, ttlMs) {
  // Opportunistically evict expired entries when the map grows large.
  if (store.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of store) if (v.expires <= now) store.delete(k);
  }
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// Coalesces concurrent misses: while one call for `key` is running, later
// callers await the same promise instead of launching their own upstream work.
const inflight = new Map();

/**
 * Return the cached value for `key`, or run `fn`, cache, and return its result.
 * Errors are not cached. Concurrent callers for the same key share one `fn` run.
 */
export async function withCache(key, ttlMs, fn) {
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    const value = await fn();
    if (value !== undefined && value !== null) setCached(key, value, ttlMs);
    return value;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

// Common TTLs.
export const TTL = {
  PRICE: 60 * 1000, // 1 min — prices move intraday
  HISTORY: 60 * 1000, // 1 min
  FUNDAMENTALS: 15 * 60 * 1000, // 15 min — filings/estimates change rarely
};

/**
 * Fetch with exponential backoff on transient failures (429 / 5xx / network).
 * Returns the Response on success or the last Response on exhausted retries;
 * the caller still checks `.ok`.
 */
export async function fetchRetry(url, options = {}, { retries = 2, baseDelay = 400 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status !== 429 && res.status < 500) return res;
      if (attempt === retries) return res; // give the caller the failed response
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, baseDelay * 2 ** attempt));
  }
  throw lastErr;
}
