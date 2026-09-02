// EDGAR-backed historical periodic financials.
// Yahoo's free API caps quarterly at 5 / annual at 4. EDGAR's companyfacts has
// the full filing history, so we use it to extend back to 8 periods for US filers.

import { TAG_CHAINS, ANNUAL_FORMS } from './constants.js';
import { getCompanyFacts } from './edgar.js';

// Companyfacts is fetched through edgar.js's shared cache (TTL + in-flight dedup
// + rate limiter), so the three concurrent /api/quarterly variants and
// /api/financials all share one download instead of racing four.
const getCompanyFactsCached = (cik) => getCompanyFacts(cik);

const QUARTERLY_FORMS = new Set(['10-Q', '10-Q/A', '6-K', '6-K/A']);
const ANNUAL_FORMS_SET = new Set(ANNUAL_FORMS);
const FY_FORMS = new Set([...ANNUAL_FORMS]);

const monthsBetween = (start, end) => {
  // Day-aware: round day difference to nearest month (30.4 d/mo).
  const a = new Date(start), b = new Date(end);
  return Math.round((b - a) / (1000 * 60 * 60 * 24 * 30.4375));
};

// Filter and dedupe non-dimensional flow entries.
function flowEntries(units) {
  return (units || []).filter(
    (e) => !e.dim && !e.dimension && e.start && e.end && e.val != null
  );
}
function instantEntries(units) {
  return (units || []).filter(
    (e) => !e.dim && !e.dimension && !e.start && e.end && e.val != null
  );
}

// Pick best unit array (USD preferred, else first non-shares unit).
function pickUnits(tagFacts) {
  const u = tagFacts?.units || {};
  if (u.USD) return u.USD;
  const keys = Object.keys(u);
  const nonShares = keys.filter((k) => k !== 'shares');
  return nonShares.length ? u[nonShares[0]] : null;
}
function pickEpsUnits(tagFacts) {
  const u = tagFacts?.units || {};
  // EPS uses "USD/shares"
  const epsKey = Object.keys(u).find((k) => /shares/i.test(k));
  return epsKey ? u[epsKey] : (u.USD || null);
}

// Extract single-quarter flow values: keep entries spanning 2-4 months.
// Compute Q4 from FY minus YTD-Q3 by matching the FY's start date to the
// Q3 YTD's start date (e.fy is unreliable — 10-Ks restate comparative-year
// figures under the current fy).
function extractQuarterlyFlow(facts, chain, isEps = false) {
  const byEnd = new Map();
  // Key by start date (which uniquely identifies a fiscal year period).
  const fyByStart = new Map(); // start -> { val, end, filed }
  const ytdQ3ByStart = new Map(); // start -> { val, end, filed }

  for (const { taxonomy, tag } of chain) {
    const tagFacts = facts[taxonomy]?.[tag];
    if (!tagFacts) continue;
    const units = isEps ? pickEpsUnits(tagFacts) : pickUnits(tagFacts);
    if (!units) continue;
    for (const e of flowEntries(units)) {
      const months = monthsBetween(e.start, e.end);
      if (months >= 2 && months <= 4) {
        const prev = byEnd.get(e.end);
        if (!prev || new Date(e.filed) > new Date(prev.filed)) {
          byEnd.set(e.end, { val: e.val, end: e.end, filed: e.filed });
        }
      } else if (months >= 11 && months <= 13 && FY_FORMS.has(e.form)) {
        const prev = fyByStart.get(e.start);
        if (!prev || new Date(e.filed) > new Date(prev.filed)) {
          fyByStart.set(e.start, { val: e.val, end: e.end, filed: e.filed });
        }
      } else if (months >= 8 && months <= 10) {
        const prev = ytdQ3ByStart.get(e.start);
        if (!prev || new Date(e.filed) > new Date(prev.filed)) {
          ytdQ3ByStart.set(e.start, { val: e.val, end: e.end, filed: e.filed });
        }
      }
    }
  }

  for (const [start, fyEntry] of fyByStart.entries()) {
    if (byEnd.has(fyEntry.end)) continue;
    const ytd = ytdQ3ByStart.get(start);
    if (!ytd) continue;
    byEnd.set(fyEntry.end, {
      val: fyEntry.val - ytd.val,
      end: fyEntry.end,
      filed: fyEntry.filed,
      _derived: true,
    });
  }

  return byEnd;
}

// Annual flow: keep one entry per FY (FY-period values), latest filed wins.
function extractAnnualFlow(facts, chain, isEps = false) {
  const byEnd = new Map();
  for (const { taxonomy, tag } of chain) {
    const tagFacts = facts[taxonomy]?.[tag];
    if (!tagFacts) continue;
    const units = isEps ? pickEpsUnits(tagFacts) : pickUnits(tagFacts);
    if (!units) continue;
    for (const e of flowEntries(units)) {
      if (!FY_FORMS.has(e.form) || e.fp !== 'FY') continue;
      const months = monthsBetween(e.start, e.end);
      if (months < 11 || months > 13) continue;
      const prev = byEnd.get(e.end);
      if (!prev || new Date(e.filed) > new Date(prev.filed)) {
        byEnd.set(e.end, { val: e.val, end: e.end, filed: e.filed });
      }
    }
  }
  return byEnd;
}

// Instant (balance sheet): keep latest-filed value per end date.
function extractInstantSeries(facts, chain) {
  const byEnd = new Map();
  for (const { taxonomy, tag } of chain) {
    const tagFacts = facts[taxonomy]?.[tag];
    if (!tagFacts) continue;
    const units = pickUnits(tagFacts);
    if (!units) continue;
    for (const e of instantEntries(units)) {
      const prev = byEnd.get(e.end);
      if (!prev || new Date(e.filed) > new Date(prev.filed)) {
        byEnd.set(e.end, { val: e.val, end: e.end, filed: e.filed });
      }
    }
  }
  return byEnd;
}

// Sum two ByEnd maps element-wise (for combining LongTerm + ShortTerm debt).
function sumByEnd(a, b) {
  const out = new Map();
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const av = a.get(k)?.val;
    const bv = b.get(k)?.val;
    if (av == null && bv == null) continue;
    out.set(k, { val: (av ?? 0) + (bv ?? 0), end: k });
  }
  return out;
}

// Pick the set of period end-dates appropriate for this period mode.
// For quarterly, use the union of dates across the flow metrics (most reliable).
// For annual, use FY end-dates from the revenue map.
function selectPeriodDates(mapByMetric, period, n) {
  const dates = new Set();
  for (const m of mapByMetric.values()) {
    for (const d of m.keys()) dates.add(d);
  }
  let arr = [...dates].sort((a, b) => (a < b ? 1 : -1));

  if (period === 'quarterly') {
    // Filter out FY-end-only dates that have no quarterly flow data.
    // Already handled — every date in the union came from some series.
  }

  return arr.slice(0, n);
}

const METRIC_DEF = {
  TotalRevenue: { kind: 'flow', chain: TAG_CHAINS.revenue },
  GrossProfit: { kind: 'flow', chain: TAG_CHAINS.grossProfit },
  OperatingIncome: { kind: 'flow', chain: TAG_CHAINS.ebit },
  NetIncome: { kind: 'flow', chain: TAG_CHAINS.netIncome },
  BasicEPS: { kind: 'flow', chain: TAG_CHAINS.basicEPS, isEps: true },
  DilutedEPS: { kind: 'flow', chain: TAG_CHAINS.dilutedEPS, isEps: true },
  OperatingCashFlow: { kind: 'flow', chain: TAG_CHAINS.cfo, ytd: true },
  CapitalExpenditure: { kind: 'flow', chain: TAG_CHAINS.capex, ytd: true, sign: -1 },
  // D&A add-back — the largest non-cash bridge from net income to operating cash
  // flow, used to explain *why* CFO moved. YTD like other cash-flow items.
  DepreciationAmortization: { kind: 'flow', chain: TAG_CHAINS.da, ytd: true },
  // CFO bridge components. Receivables/Inventory are reported as the increase in
  // the balance (a positive value = cash outflow), so flip the sign to express
  // them as their contribution to operating cash flow. Payables already align.
  ChangeReceivables: { kind: 'flow', chain: TAG_CHAINS.changeReceivables, ytd: true, sign: -1 },
  ChangeInventory: { kind: 'flow', chain: TAG_CHAINS.changeInventory, ytd: true, sign: -1 },
  ChangePayables: { kind: 'flow', chain: TAG_CHAINS.changePayables, ytd: true },
  StockComp: { kind: 'flow', chain: TAG_CHAINS.stockComp, ytd: true },
  DeferredTax: { kind: 'flow', chain: TAG_CHAINS.deferredTax, ytd: true },
  // Amortisation of acquired intangibles — subtracted from D&A for the
  // maintenance-capex proxy. Asset disposals offset gross capex where reported.
  IntangibleAmortization: { kind: 'flow', chain: TAG_CHAINS.intangibleAmortization, ytd: true },
  AssetDisposals: { kind: 'flow', chain: TAG_CHAINS.assetDisposals, ytd: true },
  // Net PP&E (instant) for the revenue-intensity capex split.
  PPE: { kind: 'instant', chain: TAG_CHAINS.ppe },
  // Financing-section debt flows for the Net Borrowing breakdown. Issuance is an
  // inflow (positive); repayment tags are positive magnitudes, so flip to negative.
  DebtIssued: { kind: 'flow', chain: TAG_CHAINS.newDebt, ytd: true },
  DebtRepaid: { kind: 'flow', chain: TAG_CHAINS.debtRepayment, ytd: true, sign: -1 },
  // Dividends paid (financing cash outflow; tag value is positive) — used for the
  // dividend/shareholder-yield panel. YTD like other cash-flow items.
  DividendsPaid: { kind: 'flow', chain: TAG_CHAINS.dividends, ytd: true },
  // FreeCashFlow derived = OCF - |CapEx|
  TotalAssets: { kind: 'instant', chain: TAG_CHAINS.totalAssets },
  StockholdersEquity: { kind: 'instant', chain: TAG_CHAINS.stockholdersEquity },
  CashCashEquivalentsAndShortTermInvestments: {
    kind: 'instant',
    chain: TAG_CHAINS.cash,
    addChain: TAG_CHAINS.shortTermInvestments,
  },
};

// Cash flow statement entries are usually YTD (year-to-date), not single quarter.
// Convert YTD-by-end to single-quarter: Qn = YTD_n - YTD_{n-1} within same FY.
function ytdToQuarterly(facts, chain, sign = 1) {
  const byEnd = new Map();
  // Group YTD entries by their fiscal-year start date (unique per FY period).
  const byStartEnd = new Map(); // key: start:end -> { months, val, filed, start }

  for (const { taxonomy, tag } of chain) {
    const tagFacts = facts[taxonomy]?.[tag];
    if (!tagFacts) continue;
    const units = pickUnits(tagFacts);
    if (!units) continue;
    for (const e of flowEntries(units)) {
      const months = monthsBetween(e.start, e.end);
      if (![3, 6, 9, 12].includes(months)) continue;
      const key = `${e.start}:${e.end}`;
      const prev = byStartEnd.get(key);
      if (!prev || new Date(e.filed) > new Date(prev.filed)) {
        byStartEnd.set(key, { months, val: e.val, end: e.end, filed: e.filed, start: e.start });
      }
    }
  }

  // Group by start (each FY period has a distinct start date).
  const byStart = new Map();
  for (const v of byStartEnd.values()) {
    if (!byStart.has(v.start)) byStart.set(v.start, []);
    byStart.get(v.start).push(v);
  }

  for (const [, entries] of byStart) {
    entries.sort((a, b) => a.months - b.months);
    let prevVal = 0;
    for (const e of entries) {
      const qVal = (e.val - prevVal) * sign;
      byEnd.set(e.end, { val: qVal, end: e.end });
      prevVal = e.val;
    }
  }

  return byEnd;
}

// Annual sign-applied flow.
function applyAnnualSign(map, sign) {
  if (sign === 1) return map;
  const out = new Map();
  for (const [k, v] of map.entries()) out.set(k, { ...v, val: v.val * sign });
  return out;
}

export async function getEdgarPeriodicFinancials(cik, period = 'quarterly', n = 8) {
  const facts = (await getCompanyFactsCached(cik)).facts || {};

  const mapByMetric = new Map();

  for (const [name, def] of Object.entries(METRIC_DEF)) {
    let m;
    if (def.kind === 'flow') {
      if (period === 'quarterly') {
        if (def.ytd) {
          m = ytdToQuarterly(facts, def.chain, def.sign ?? 1);
        } else {
          m = extractQuarterlyFlow(facts, def.chain, def.isEps);
          if (def.sign === -1) m = applyAnnualSign(m, -1);
        }
      } else {
        m = extractAnnualFlow(facts, def.chain, def.isEps);
        if (def.sign === -1) m = applyAnnualSign(m, -1);
      }
    } else {
      m = extractInstantSeries(facts, def.chain);
      if (def.addChain) {
        const add = extractInstantSeries(facts, def.addChain);
        // Only sum where the cash chain came back as bare cash (not pre-combined).
        // Use plain sum where short-term investments exist alongside cash.
        m = sumByEnd(m, add);
      }
    }
    mapByMetric.set(name, m);
  }

  // Shares outstanding: instant EntityCommonStockSharesOutstanding first,
  // fall back to weighted-average quarterly flow entries.
  {
    const sharesMap = new Map();
    // First pass: instant entries (no start date)
    for (const { taxonomy, tag } of TAG_CHAINS.shares) {
      const tf = facts[taxonomy]?.[tag];
      const units = tf?.units?.shares;
      if (!units) continue;
      for (const e of units) {
        if (e.start || !e.end || e.val == null || e.dim) continue;
        const prev = sharesMap.get(e.end);
        if (!prev || new Date(e.filed) > new Date(prev.filed)) {
          sharesMap.set(e.end, { val: e.val, end: e.end });
        }
      }
    }
    // Second pass: quarterly flow entries (weighted average shares).
    // Always run — instant entries use cover-page dates that may not align with
    // period-end dates, so we add period-end-keyed entries from quarterly flows.
    // sharesMap.has(e.end) check prevents overwriting a better instant value.
    for (const { taxonomy, tag } of TAG_CHAINS.shares) {
      const tf = facts[taxonomy]?.[tag];
      const units = tf?.units?.shares;
      if (!units) continue;
      for (const e of units) {
        if (!e.start || !e.end || e.val == null || e.dim) continue;
        if (sharesMap.has(e.end)) continue;
        const months = monthsBetween(e.start, e.end);
        if (months < 2 || months > 4) continue;
        sharesMap.set(e.end, { val: e.val, end: e.end });
      }
    }
    mapByMetric.set('SharesOutstanding', sharesMap);
  }

  // For annual, also restrict dates to known FY end-dates from revenue.
  let candidateDates;
  if (period === 'annual') {
    candidateDates = [...(mapByMetric.get('TotalRevenue')?.keys() || [])]
      .sort((a, b) => (a < b ? 1 : -1));
  } else {
    // Quarterly: union of dates across all flow metrics so that quarters
    // with missing revenue (but present net income / OCF / etc.) are included.
    // Exclude instant-only dates by requiring at least one flow metric hit.
    const FLOW_METRICS = ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'OperatingCashFlow'];
    const flowDatesSet = new Set();
    for (const name of FLOW_METRICS) {
      for (const d of (mapByMetric.get(name)?.keys() || [])) {
        flowDatesSet.add(d);
      }
    }
    candidateDates = [...flowDatesSet].sort((a, b) => (a < b ? 1 : -1));
  }
  const dates = candidateDates.slice(0, n);

  const periods = dates.map((d) => {
    const row = { asOfDate: d };
    for (const name of Object.keys(METRIC_DEF)) {
      const v = mapByMetric.get(name)?.get(d)?.val;
      row['quarterly' + name] = v ?? null;
    }
    // FreeCashFlow = OCF + CapEx (CapEx is negative)
    const ocf = row.quarterlyOperatingCashFlow;
    const cx = row.quarterlyCapitalExpenditure;
    row.quarterlyFreeCashFlow = ocf != null && cx != null ? ocf + cx : null;
    // Shares: exact date first, then nearest entry within 60 days.
    // EDGAR's DEI EntityCommonStockSharesOutstanding uses the cover-page date
    // (often weeks after the period end), so an exact match may not exist.
    const sharesMap = mapByMetric.get('SharesOutstanding');
    let sv = sharesMap?.get(d)?.val ?? null;
    if (sv == null && sharesMap?.size) {
      const targetMs = new Date(d).getTime();
      let bestDiff = Infinity;
      for (const [shareDate, entry] of sharesMap.entries()) {
        const diff = Math.abs(new Date(shareDate).getTime() - targetMs);
        if (diff < 60 * 86400000 && diff < bestDiff) {
          bestDiff = diff;
          sv = entry.val;
        }
      }
    }
    row.quarterlySharesOutstanding = sv;
    // TotalDebt = LongTermDebt + ShortTermDebt (instant)
    const ltd = mapByMetric.get('LongTermDebt')?.get(d)?.val;
    const std = mapByMetric.get('ShortTermDebt')?.get(d)?.val;
    row.quarterlyTotalDebt =
      ltd != null || std != null ? (ltd ?? 0) + (std ?? 0) : null;
    return row;
  });

  return { source: 'edgar', period, quarters: periods };
}

// Total debt is computed inline above; add it to METRIC_DEF in a separate map
// so we still extract LongTermDebt/ShortTermDebt independently.
METRIC_DEF.LongTermDebt = { kind: 'instant', chain: TAG_CHAINS.longTermDebt };
METRIC_DEF.ShortTermDebt = { kind: 'instant', chain: TAG_CHAINS.shortTermDebt };
