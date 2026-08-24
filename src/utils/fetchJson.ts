const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchJsonOpts {
  retries?: number;
  baseDelay?: number;
}

/**
 * Fetch JSON with retry on *transient* failures.
 *
 * On a hosted free tier the Node service can briefly be unreachable (cold start
 * after idle, or a restart). In that window the platform's edge returns a
 * plain-text "Not Found" 404 — not our JSON error — and `res.json()` blows up
 * with "Unexpected token 'N'". Those blips are retried with backoff.
 *
 * A genuine application error (our JSON `{ error }` body on a 4xx, e.g. a real
 * "ticker not found") is surfaced immediately without pointless retries.
 */
export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOpts = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelay = opts.baseDelay ?? 500;

  for (let attempt = 0; ; attempt++) {
    const last = attempt >= retries;

    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      // Network error — the instance may be waking. Retry, then give up cleanly.
      if (last) throw new Error('Server unreachable — it may be waking up. Please try again in a moment.');
      await sleep(baseDelay * (attempt + 1));
      continue;
    }

    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        if (last) throw new Error('Unexpected response from the server. Please try again.');
        await sleep(baseDelay * (attempt + 1));
        continue;
      }
    }

    // Non-OK: read the body and decide whether it's a real error or an edge blip.
    const text = await res.text().catch(() => '');
    let apiError: string | null = null;
    try {
      const j = JSON.parse(text);
      apiError = j && typeof j === 'object' ? (j.error ?? null) : null;
    } catch {
      /* not JSON → almost certainly an edge/proxy "Not Found" */
    }

    // Genuine client-side app error (our JSON error on a 4xx) — don't retry.
    if (apiError != null && res.status >= 400 && res.status < 500) {
      throw new Error(apiError);
    }

    // Otherwise transient (edge "Not Found", 5xx, non-JSON) — retry, then give up.
    if (last) {
      throw new Error(
        apiError ?? 'The server is temporarily unavailable — it may be starting up. Please try again in a moment.'
      );
    }
    await sleep(baseDelay * (attempt + 1));
  }
}
