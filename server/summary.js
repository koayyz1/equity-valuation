// Claude-generated summary of recent corporate moves for a ticker.
// Uses the Anthropic Messages API with the built-in web_search tool so the
// model can read fresh news rather than hallucinate.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Lightweight .env loader — populates ANTHROPIC_API_KEY (and others) from a
// .env file at repo root if not already in process.env. Avoids the dotenv dep.
(() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const envPath = join(here, '..', '.env');
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      const [, name, rawVal] = m;
      if (process.env[name]) continue;
      const val = rawVal.replace(/^['"]|['"]$/g, '');
      process.env[name] = val;
    }
  } catch {
    // .env is optional
  }
})();

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — news doesn't change minute-to-minute

const cache = new Map(); // ticker -> { ts, payload }

export async function getCompanySummary(ticker, companyName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set on the server');
  }

  const key = ticker.toUpperCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.payload;
  }

  const subject = companyName ? `${companyName} (${key})` : key;
  const prompt =
    `Summarise the major corporate moves at ${subject} over the last 3 months. ` +
    `Focus on material events: earnings, guidance changes, M&A, leadership changes, ` +
    `product launches, regulatory or legal developments, capital returns, and major ` +
    `analyst rerating events. Use the web_search tool to ground every claim in a ` +
    `recent source. Output 4-6 short bullet points (one sentence each), each ending ` +
    `with the source date in (MMM D, YYYY) format. No preamble or sign-off.`;

  const body = {
    model: MODEL,
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: prompt }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  // Pull out only the model's final text blocks (skip tool_use / web_search_result blocks).
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const payload = {
    ticker: key,
    model: MODEL,
    summary: text,
    generatedAt: new Date().toISOString(),
  };
  cache.set(key, { ts: Date.now(), payload });
  return payload;
}
