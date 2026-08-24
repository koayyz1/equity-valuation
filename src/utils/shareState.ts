import { DCFAssumptions, Overrides } from '../types';

/** A self-contained analysis snapshot that can be encoded into a URL. */
export interface SharedState {
  ticker: string;
  assumptions: DCFAssumptions;
  overrides: Overrides;
}

// base64url encode/decode of UTF-8 JSON (URL-safe, no padding).
function toB64Url(json: string): string {
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64)));
}

export function encodeShareState(state: SharedState): string {
  return toB64Url(JSON.stringify(state));
}

export function decodeShareState(param: string): SharedState | null {
  try {
    const parsed = JSON.parse(fromB64Url(param));
    if (
      parsed &&
      typeof parsed.ticker === 'string' &&
      parsed.assumptions &&
      typeof parsed.assumptions === 'object'
    ) {
      return {
        ticker: parsed.ticker,
        assumptions: parsed.assumptions,
        overrides: parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Build an absolute URL to the current page with the analysis encoded in `?s=`. */
export function buildShareUrl(state: SharedState): string {
  const url = new URL(window.location.href);
  url.searchParams.set('s', encodeShareState(state));
  return url.toString();
}
