# EquityVal — EDGAR-Powered DCF Terminal

A full-stack equity-valuation web app that pulls live financials from SEC EDGAR's XBRL API, computes a DCF and Forward FCF Yield valuation, and lets you override any value for foreign/OTC companies EDGAR can't cover.

## Stack

- **Frontend:** React 18 + TypeScript + Tailwind CSS + Vite (port 5173)
- **Backend:** Express proxy for EDGAR + Yahoo Finance (port 3001)
- **Data:** SEC EDGAR `companyfacts` endpoint (US-GAAP + IFRS), Yahoo Finance chart API
- **No database:** all data fetched on demand, assumptions kept in React state

## Quick Start

```bash
cd equity-valuation
npm install
npm run dev
```

This runs the Express proxy (3001) and Vite dev server (5173) concurrently. Open http://localhost:5173.

### Important: EDGAR User-Agent

Before running, edit `server/constants.js` and replace the `USER_AGENT` constant with your real name + email. EDGAR will 403 requests without a proper UA.

```js
export const USER_AGENT = 'EquityValuationApp yourname@youremail.com';
```

## Features

- **Ticker autocomplete** backed by SEC's `company_tickers.json` (cached 1h server-side)
- **Financial dashboard** with 20+ fields: revenue, EBIT/EBITDA, CFO, CapEx, D&A, Cash, ROIC, payout, tax rate, 5Y FCF CAGR, etc.
- **DCF valuation**: 10-year, 3-phase (growth / steady / terminal) with sliders for growth rate, steady rate, terminal growth, discount rate, and an uncertainty → MOS mapping
- **Forward FCF Yield**: piecewise-linear approximation mapping target IRR + blended growth to the minimum yield required today
- **Year-by-year CapEx / Net Borrowing overrides** for Y1–Y5 (useful for SIRI/SHSGF-style known future plans)
- **Manual override mode**: double-click any value in the dashboard to override. Overridden values show in blue; right-click to reset
- **IFRS fallback chain** for filers like ASML
- **XBRL tag debug panel** shows which tag variant was used for each concept
- **Rate-limited EDGAR requests** (~8/sec) to stay under their 10/sec cap

## Known Limitations

- **OTC ADRs (SHSGF, HOCPF, KYCCF)**: No SEC filings. Dashboard will return a "not found" error; override everything manually after clicking one of the US example tickers first.
- **FCFE formula**: uses `CFO + CapEx (negative) + Net Borrowing`. Won't perfectly match third-party sources that include SBC adjustments or working-capital changes.
- **LTM not yet computed**: the current implementation takes the latest 10-K / 20-F FY figure. Quarterly stitching to build a true LTM (10-K + latest-quarter YTD − prior-year-same-quarter YTD) is a todo.
- **Yahoo Finance is unofficial** — it can change or throttle without notice.

## File Structure

```
equity-valuation/
├── server/
│   ├── index.js          # Express routes
│   ├── edgar.js          # EDGAR fetch + XBRL normalization
│   ├── price.js          # Yahoo Finance proxy
│   └── constants.js      # Tag fallback chains + User-Agent
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── types.ts
│   ├── components/
│   │   ├── SearchBar.tsx
│   │   ├── FinancialDashboard.tsx
│   │   ├── DCFModel.tsx
│   │   ├── FCFYModel.tsx
│   │   ├── ProjectionTable.tsx
│   │   └── EditableCell.tsx
│   ├── hooks/
│   │   └── useCompanyData.ts
│   └── utils/
│       ├── calculations.ts
│       └── formatting.ts
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
└── vite.config.ts
```
