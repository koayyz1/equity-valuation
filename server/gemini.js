// Google Gemini-generated summary of recent corporate moves for a ticker.
// Uses Gemini's free tier with Google Search grounding so the model can cite
// fresh news rather than hallucinate.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Lightweight .env loader (same as summary.js — keeps each module independent).
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
      process.env[name] = rawVal.replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // .env optional
  }
})();

// Try in order; fall back if a model is overloaded (503) or quota-exhausted (429).
// Kept to the 2.5 family: gemini-2.0-flash was retired (404s), and the newer
// gemini-3.x models / "latest" aliases have no free-tier quota (immediate 429).
const MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const REQUEST_TIMEOUT_MS = 30_000; // fail over instead of hanging on a stalled call

const cache = new Map();

// Shared request runner: walks MODEL_CHAIN, retries transient failures once with
// a backoff, aborts any single call that exceeds REQUEST_TIMEOUT_MS, and disables
// the 2.5 models' "thinking" phase (big latency win for these grounded summaries;
// only the 2.5 family accepts thinkingConfig — sending it to 2.0-flash 400s).
async function generateContent(apiKey, baseBody, { backoffMs = 1500 } = {}) {
  let result = null;
  let usedModel = null;
  outer: for (const model of MODEL_CHAIN) {
    const body = model.startsWith('gemini-2.5')
      ? {
          ...baseBody,
          generationConfig: {
            ...(baseBody.generationConfig || {}),
            thinkingConfig: { thinkingBudget: 0 },
          },
        }
      : baseBody;
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        result = { ok: res.ok, status: res.status, text: await res.text() };
      } catch (err) {
        // Our abort surfaces as AbortError; anything else is a network fault.
        result = {
          ok: false,
          status: err.name === 'AbortError' ? 504 : 0,
          text: err.message || 'network error',
        };
      } finally {
        clearTimeout(timer);
      }
      if (result.ok) {
        usedModel = model;
        break outer;
      }
      // Anything not transient (400 bad key, 403, 404 retired model…) is fatal.
      if (![503, 429, 504, 0].includes(result.status)) break outer;
      // Rate/quota limited: retrying the same model won't clear in a couple
      // seconds — fail over to the next model immediately, no wasted backoff.
      if (result.status === 429) break;
      // Overload / timeout / network blip: one quick retry on the same model.
      if (attempt === 0) await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  if (!result?.ok) {
    throw new Error(`Gemini API ${result?.status}: ${(result?.text || '').slice(0, 300)}`);
  }
  return { data: JSON.parse(result.text), usedModel: usedModel || MODEL_CHAIN[0] };
}

export async function getCompanySummaryGemini(ticker, companyName) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set on the server');
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
    `analyst rerating events. Ground every claim in a recent web source. Output 4-6 ` +
    `short bullet points (one sentence each), each ending with the source date in ` +
    `(MMM D, YYYY) format. No preamble or sign-off.`;

  const baseBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  };

  const { data, usedModel } = await generateContent(apiKey, baseBody, { backoffMs: 1500 });
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  const payload = {
    ticker: key,
    model: usedModel || MODEL_CHAIN[0],
    summary: text,
    generatedAt: new Date().toISOString(),
  };
  cache.set(key, { ts: Date.now(), payload });
  return payload;
}

const DEEPDIVE_CACHE = new Map();
const DEEPDIVE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const DEEPDIVE_PROMPTS = {
  overview: (subject) =>
    `Research the major business and operational moves that ${subject} has made over the past 12 months. ` +
    `Do NOT include any financial reporting or earnings numbers. Instead focus entirely on what the company ` +
    `has launched, built, acquired, partnered, or done operationally. For each move, evaluate whether it is ` +
    `beneficial or detrimental to the long-term health of the business. ` +
    `Format: bullet points, each on its own line starting with "•", with the move described in one sentence ` +
    `followed by a short evaluation in parentheses. End each bullet with the approximate date (Month YYYY). ` +
    `Use the web_search tool to ground every claim. Aim for 6–10 bullets.`,

  segments: (subject) =>
    `For ${subject}, identify the top 3 revenue segments (by revenue contribution). ` +
    `For each segment provide: the approximate % weighting of total revenue and its estimated annual revenue in dollars, ` +
    `a summary of recent moves and developments over the past 6 months, ` +
    `an assessment of its market position and key competitors, ` +
    `and a forward-looking outlook given the current macro and industry landscape. ` +
    `Use the web_search tool to ground every claim with recent sources. ` +
    `Format rules (follow exactly): ` +
    `Use "## Segment Name (XX% of revenue) - $X.XX Billion" as the segment header — no numbering. ` +
    `Use "### " followed by the sub-section label for each of the four points — do NOT use ** for these labels. ` +
    `Sub-section labels should be: "### Revenue Weighting", "### Recent Moves", "### Market Position", "### Outlook". ` +
    `Write each sub-section as a short paragraph or 2–3 bullet points starting with "•". ` +
    `Do not number segments or sub-sections.`,

  proscons: (subject) =>
    `For ${subject}, assemble the EVIDENCE bearing on the investment case — do not ` +
    `render a verdict, score, or recommendation. Give 3–5 pieces of evidence that the ` +
    `business is durable and 3–5 that it is vulnerable. Each must be a specific, ` +
    `checkable fact — a number, a contract, a ruling, a launch, a market-share move — ` +
    `not an opinion or an adjective. Use the web_search tool to ground every item. ` +
    `Format: two sections with headers "## Evidence For" and "## Evidence Against", ` +
    `each containing bullet points starting with "•", one fact per bullet with a cited ` +
    `date (Month YYYY). Do not add a summary, conclusion, or overall judgement — the ` +
    `reader forms their own.`,

  scorecard: (subject) =>
    `For ${subject}, lay out the evidence on each dimension below WITHOUT scoring or ` +
    `concluding. For each, give the single strongest piece of evidence FOR and the ` +
    `single strongest AGAINST, each a specific checkable fact with a date. If the ` +
    `evidence is thin or absent for a dimension, say "insufficient evidence" rather ` +
    `than inferring. Use the web_search tool to ground every item. ` +
    `Dimensions, in this order: Economic Moat, Pricing Power, Balance Sheet, ` +
    `Capital Allocation, Growth Runway, Disruption Risk, Regulatory Risk, Cyclicality. ` +
    `Output format (follow exactly — three lines per dimension, nothing else): ` +
    `"## Dimension Name" then "• For: <fact> (Month YYYY)" then ` +
    `"• Against: <fact> (Month YYYY)". ` +
    `Do not assign ratings, numbers out of five, or an overall verdict.`,

};

export async function getCompanyDeepDive(ticker, section, companyName, force = false) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set on the server');

  const promptFn = DEEPDIVE_PROMPTS[section];
  if (!promptFn) throw new Error(`Unknown section: ${section}`);

  const cacheKey = `${ticker.toUpperCase()}:${section}`;
  const cached = DEEPDIVE_CACHE.get(cacheKey);
  if (!force && cached && Date.now() - cached.ts < DEEPDIVE_TTL_MS) return cached.payload;

  const subject = companyName ? `${companyName} (${ticker.toUpperCase()})` : ticker.toUpperCase();
  const prompt = promptFn(subject);

  const baseBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 8192 },
  };

  const { data, usedModel } = await generateContent(apiKey, baseBody, { backoffMs: 2000 });
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text).filter(Boolean).join('\n').trim();

  const payload = {
    ticker: ticker.toUpperCase(),
    section,
    model: usedModel || MODEL_CHAIN[0],
    content: text,
    generatedAt: new Date().toISOString(),
  };
  DEEPDIVE_CACHE.set(cacheKey, { ts: Date.now(), payload });
  return payload;
}
