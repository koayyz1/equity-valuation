import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  WatchlistEntry, WatchlistData, FinancialData, PriceData,
  DCFAssumptions, UncertaintyLevel,
} from '../types';
import { calculateDCF, calculateFCFY, getMOS, UNCERTAINTY_LABELS, computeDefaultAssumptions, scenarioAssumptions, computeWACC } from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';
import { IconClipboard } from './icons';

const API_BASE = '/api';

// The untouched "base template" values (mirror App.tsx's baseAssumptions). Used
// to detect an entry that has never had data-driven defaults applied, so we can
// seed it once without clobbering a user's real saved assumptions.
function isBaseAssumptions(a: DCFAssumptions): boolean {
  return (
    a.growthYears === 5 &&
    Math.abs(a.growthRate - 0.15) < 1e-9 &&
    Math.abs(a.steadyRate - 0.09) < 1e-9 &&
    Math.abs(a.terminalGrowth - 0.03) < 1e-9 &&
    Math.abs(a.discountRate - 0.11) < 1e-9
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

interface RowData {
  entry: WatchlistEntry;
  financials: FinancialData | null;
  priceData: PriceData | null;
  loading: boolean;
  error: string | null;
  // pre-computed sort values
  computed: ComputedMetrics | null;
}

interface ComputedMetrics {
  price: number | null;
  mktCap: number | null;
  dcfPrice: number | null;
  dcfPriceMOS: number | null;
  dcfUpside: number | null;
  // Bear / Bull scenario MOS upside (base case is dcfUpside).
  bearUpside: number | null;
  bullUpside: number | null;
  bearPriceMOS: number | null;
  bullPriceMOS: number | null;
  fcfyPrice: number | null;
  fcfyPriceMOS: number | null;
  fcfyUpside: number | null;
  fcfeYield: number | null;
  fcfCAGR: number | null;
  roic: number | null;
  wacc: number | null;
  spread: number | null;
  maxGrowth: number | null;
  tvRatio: number | null;
}

type SortCol =
  | 'price' | 'mktCap'
  | 'dcfUpside' | 'bearUpside' | 'bullUpside' | 'fcfyUpside'
  | 'fcfeYield' | 'fcfCAGR'
  | 'roic' | 'wacc' | 'spread' | 'maxGrowth' | 'tvRatio'
  | 'growthRate' | 'growthYears' | 'steadyRate' | 'terminalGrowth' | 'uncertainty';

type SortDir = 'asc' | 'desc';

// ── Helpers ────────────────────────────────────────────────────────────────

const API_BASE_URL = '/api';

async function fetchTickerData(ticker: string): Promise<{ financials: FinancialData | null; priceData: PriceData | null }> {
  const compRes = await fetch(`${API_BASE_URL}/company/${encodeURIComponent(ticker)}`);
  if (!compRes.ok) throw new Error('Company not found');
  const company = await compRes.json();
  const [finRes, priceRes] = await Promise.all([
    fetch(`${API_BASE_URL}/financials/${company.cik}?ticker=${encodeURIComponent(ticker)}`),
    fetch(`${API_BASE_URL}/price/${encodeURIComponent(ticker)}`),
  ]);
  const financials = finRes.ok ? await finRes.json() : null;
  const priceData = priceRes.ok ? await priceRes.json() : null;
  return { financials, priceData };
}

function computeMetrics(
  financials: FinancialData,
  priceData: PriceData,
  entry: WatchlistEntry,
): ComputedMetrics {
  const shares = entry.overrides.shares ?? financials.shares;
  const mktCap = priceData.marketCap ?? (priceData.price != null && shares != null ? priceData.price * shares : null);
  const fcfe = entry.overrides.fcfe ?? financials.fcfe;
  const cash = entry.overrides.cash ?? financials.cash;
  const revenue = entry.overrides.revenue ?? financials.revenue;
  // FCF = CFO - |CapEx| (excludes net borrowing, matches SA FCF methodology)
  const cfo = entry.overrides.cfo ?? financials.cfo;
  const capex = entry.overrides.capex ?? financials.capex;
  const fcf = cfo != null && capex != null ? cfo + capex : null;

  // WACC
  const wacc = computeWACC({
    beta: financials.beta,
    marketCap: mktCap,
    totalDebt: financials.totalDebt,
    interestExpense: financials.interestExpense,
    taxRate: financials.taxRate,
  });

  const roic = financials.roic;
  const payoutRatio = financials.payoutRatio;
  const reinvestRate = payoutRatio != null ? 1 - payoutRatio : null;
  const maxGrowth = roic != null && reinvestRate != null ? roic * reinvestRate : null;

  const baseComp = {
    capex: entry.overrides.capex ?? financials.capex,
    netBorrowing: entry.overrides.netBorrowing ?? financials.netBorrowing,
  };
  const dcfResult = calculateDCF(fcfe, cash, revenue, shares, entry.assumptions, baseComp);
  const fcfyResult = calculateFCFY(fcfe, shares, entry.assumptions);

  // Bear / Bull scenario intrinsic values, derived from the entry's base assumptions.
  const scen = scenarioAssumptions(entry.assumptions);
  const bearResult = calculateDCF(fcfe, cash, revenue, shares, scen.bear, baseComp);
  const bullResult = calculateDCF(fcfe, cash, revenue, shares, scen.bull, baseComp);

  const price = priceData.price;
  const up = (cur: number | null, tgt: number | null) =>
    cur != null && tgt != null && cur !== 0 ? (tgt - cur) / cur : null;

  return {
    price,
    mktCap,
    dcfPrice: dcfResult.dcfPrice,
    dcfPriceMOS: dcfResult.dcfPriceMOS,
    dcfUpside: up(price, dcfResult.dcfPriceMOS),
    bearUpside: up(price, bearResult.dcfPriceMOS),
    bullUpside: up(price, bullResult.dcfPriceMOS),
    bearPriceMOS: bearResult.dcfPriceMOS,
    bullPriceMOS: bullResult.dcfPriceMOS,
    fcfyPrice: fcfyResult.fcfyPrice,
    fcfyPriceMOS: fcfyResult.fcfyPriceMOS,
    fcfyUpside: up(price, fcfyResult.fcfyPriceMOS),
    fcfeYield: fcf != null && mktCap != null && mktCap > 0 ? fcf / mktCap : null,
    fcfCAGR: financials.fcfCAGR,
    roic,
    wacc,
    spread: roic != null && wacc != null ? roic - wacc : null,
    maxGrowth,
    tvRatio: dcfResult.tvRatio,
  };
}

function getSortValue(row: RowData, col: SortCol): number | null {
  if (!row.computed) {
    // assumption-only columns still sortable
    const a = row.entry.assumptions;
    if (col === 'growthRate') return a.growthRate;
    if (col === 'growthYears') return a.growthYears;
    if (col === 'steadyRate') return a.steadyRate;
    if (col === 'terminalGrowth') return a.terminalGrowth;
    if (col === 'uncertainty') return a.uncertainty;
    return null;
  }
  const c = row.computed;
  const a = row.entry.assumptions;
  switch (col) {
    case 'price':         return c.price;
    case 'mktCap':        return c.mktCap;
    case 'dcfUpside':     return c.dcfUpside;
    case 'bearUpside':    return c.bearUpside;
    case 'bullUpside':    return c.bullUpside;
    case 'fcfyUpside':    return c.fcfyUpside;
    case 'fcfeYield':     return c.fcfeYield;
    case 'fcfCAGR':       return c.fcfCAGR;
    case 'roic':          return c.roic;
    case 'wacc':          return c.wacc;
    case 'spread':        return c.spread;
    case 'maxGrowth':     return c.maxGrowth;
    case 'tvRatio':       return c.tvRatio;
    case 'growthRate':    return a.growthRate;
    case 'growthYears':   return a.growthYears;
    case 'steadyRate':    return a.steadyRate;
    case 'terminalGrowth': return a.terminalGrowth;
    case 'uncertainty':   return a.uncertainty;
  }
}

function sortRows(rows: RowData[], col: SortCol, dir: SortDir): RowData[] {
  return [...rows].sort((a, b) => {
    const av = getSortValue(a, col);
    const bv = getSortValue(b, col);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === 'asc' ? av - bv : bv - av;
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function UpsideBadge({ value, title }: { value: number | null; title?: string }) {
  if (value == null) return <span className="text-gray-600 font-mono text-xs">—</span>;
  const pct = value * 100;
  const color = pct >= 20 ? 'text-green-400' : pct >= 0 ? 'text-yellow-400' : 'text-red-400';
  return (
    <span className={`font-mono text-xs font-medium ${color}`} title={title}>
      {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

function MosBadge({ level, onChange }: { level: UncertaintyLevel; onChange: (l: UncertaintyLevel) => void }) {
  const colors: Record<UncertaintyLevel, string> = {
    1: 'bg-green-900/60 text-green-300 border-green-700',
    2: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
    3: 'bg-amber-900/60 text-amber-300 border-amber-700',
    4: 'bg-red-900/60 text-red-300 border-red-700',
  };
  return (
    <select
      value={level}
      onChange={(e) => onChange(Number(e.target.value) as UncertaintyLevel)}
      className={`text-[10px] border rounded px-1 py-0.5 font-mono cursor-pointer bg-transparent ${colors[level]}`}
    >
      {([1, 2, 3, 4] as UncertaintyLevel[]).map((l) => (
        <option key={l} value={l} className="bg-gray-900 text-gray-200">
          M{l} {UNCERTAINTY_LABELS[l]} ({formatPercent(getMOS(l), 0)})
        </option>
      ))}
    </select>
  );
}

// Sortable column header
function SortTh({
  col, label, sortConfig, onSort, className = '',
}: {
  col: SortCol;
  label: string;
  sortConfig: { col: SortCol; dir: SortDir } | null;
  onSort: (col: SortCol) => void;
  className?: string;
}) {
  const active = sortConfig?.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap cursor-pointer select-none hover:text-gray-300 transition-colors ${className}`}
    >
      <span className="flex items-center gap-1 justify-end">
        {label}
        {/* Arrow only when active — an idle glyph on every column is noise. */}
        {active && (
          <span className="text-[9px] text-blue-400">
            {sortConfig!.dir === 'desc' ? '▼' : '▲'}
          </span>
        )}
      </span>
    </th>
  );
}

// ── List selector bar ──────────────────────────────────────────────────────

interface ListSelectorProps {
  lists: WatchlistData[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function ListSelector({ lists, activeId, onSelect, onCreate, onRename, onDelete }: ListSelectorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const startEdit = (list: WatchlistData) => {
    setEditingId(list.id);
    setEditName(list.name);
  };

  const commitEdit = () => {
    if (editingId && editName.trim()) onRename(editingId, editName.trim());
    setEditingId(null);
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-gray-800 mb-3">
      {lists.map((list) => (
        <div key={list.id} className="relative group/tab flex-shrink-0">
          {editingId === list.id ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }}
              className="px-3 py-1.5 text-xs rounded-t-md bg-blue-900 border border-blue-500 text-white font-medium outline-none w-28"
            />
          ) : (
            <button
              onClick={() => onSelect(list.id)}
              onDoubleClick={() => startEdit(list)}
              title="Double-click to rename"
              className={`px-3 py-1.5 text-xs rounded-t-md font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeId === list.id
                  ? 'bg-gray-800 text-gray-100 border-t border-x border-gray-700'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
              }`}
            >
              {list.name}
              <span className="text-[10px] text-gray-600">{list.entries.length}</span>
              {lists.length > 1 && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(list.id); }}
                  className="text-gray-700 hover:text-red-400 ml-0.5 opacity-0 group-hover/tab:opacity-100 transition-opacity leading-none"
                  title="Delete list"
                >
                  ×
                </span>
              )}
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onCreate}
        className="px-2 py-1.5 text-xs text-gray-600 hover:text-gray-300 hover:bg-gray-900 rounded-md transition-colors flex-shrink-0"
        title="New watchlist"
      >
        + New
      </button>
    </div>
  );
}

// ── Table row ──────────────────────────────────────────────────────────────

interface WatchlistRowProps {
  row: RowData;
  index: number;
  isSorted: boolean;
  onRemove: (ticker: string) => void;
  onAssumptionChange: (ticker: string, a: DCFAssumptions) => void;
  onSelect: (ticker: string) => void;
  onDragStart: (idx: number) => void;
  onDragOver: (idx: number) => void;
  onDrop: () => void;
  isDragging: boolean;
  isDragOver: boolean;
  expanded: boolean;
  onToggleNotes: (ticker: string) => void;
  onUpdateNotes: (ticker: string, notes: string) => void;
}

function WatchlistRow({
  row, index, isSorted, onRemove, onAssumptionChange, onSelect,
  onDragStart, onDragOver, onDrop, isDragging, isDragOver,
  expanded, onToggleNotes, onUpdateNotes,
}: WatchlistRowProps) {
  const { entry, financials, priceData, loading, error, computed } = row;
  const a = entry.assumptions;

  const setField = useCallback(
    <K extends keyof DCFAssumptions>(field: K) =>
      (val: DCFAssumptions[K]) =>
        onAssumptionChange(entry.ticker, { ...a, [field]: val }),
    [a, entry.ticker, onAssumptionChange]
  );

  const currency = priceData?.currency || financials?.currency || entry.currency || 'USD';

  const trCls = [
    'border-t border-gray-800 group transition-colors',
    isDragOver && !isSorted ? 'bg-blue-900/20 border-t-2 border-t-blue-500' : '',
    isDragging ? 'opacity-40' : '',
    loading ? 'animate-pulse' : 'hover:bg-gray-900/40',
  ].join(' ');

  if (loading) {
    return (
      <tr className={trCls}>
        <td className="px-2 py-2 text-gray-700 text-xs">⋮⋮</td>
        <td className="px-3 py-2 font-mono text-blue-400 text-xs">{entry.ticker}</td>
        {Array.from({ length: 21 }).map((_, i) => (
          <td key={i} className="px-3 py-2"><div className="h-3 bg-gray-800 rounded w-14" /></td>
        ))}
      </tr>
    );
  }

  if (error || !financials || !priceData || !computed) {
    return (
      <tr className={trCls}>
        <td className="px-2 py-2 text-gray-700 text-xs">⋮⋮</td>
        <td className="px-3 py-2 font-mono text-blue-400 text-xs">{entry.ticker}</td>
        <td colSpan={20} className="px-3 py-2 text-red-400 text-xs">{error ?? 'No data'}</td>
        <td className="px-3 py-2 text-center">
          <button onClick={() => onRemove(entry.ticker)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
        </td>
      </tr>
    );
  }

  const c = computed;
  const isStar = (c.dcfUpside != null && c.dcfUpside > 0.15) || (c.fcfyUpside != null && c.fcfyUpside > 0.15);
  // Price has crossed below the DCF MOS price — the actionable "buy zone" signal.
  const belowMos = c.price != null && c.dcfPriceMOS != null && c.price <= c.dcfPriceMOS;
  const hasNotes = !!(entry.notes && entry.notes.trim());
  const fmtPct = (v: number | null) => v != null ? formatPercent(v) : <span className="text-gray-600">—</span>;

  const mainRowCls = [
    trCls,
    belowMos ? 'bg-green-950/20 shadow-[inset_2px_0_0_0_rgb(34,197,94)]' : '',
  ].join(' ');

  return (
    <>
    <tr
      className={mainRowCls}
      draggable={!isSorted}
      onDragStart={() => !isSorted && onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); !isSorted && onDragOver(index); }}
      onDrop={() => !isSorted && onDrop()}
    >
      {/* Drag handle */}
      <td
        className={`px-2 py-2 ${isSorted ? 'text-gray-800 cursor-not-allowed' : 'text-gray-600 cursor-grab hover:text-gray-400'} text-xs select-none`}
        title={isSorted ? 'Clear sort to reorder' : 'Drag to reorder'}
      >
        ⋮⋮
      </td>

      {/* Ticker + name */}
      <td className="px-3 py-2 sticky left-0 bg-gray-950 z-10">
        <div className="flex items-center gap-1">
          {belowMos && (
            <span className="text-green-400 text-[10px]" title="Price is at or below your MOS price — buy zone">
              🔔
            </span>
          )}
          <button
            onClick={() => onSelect(entry.ticker)}
            className="font-mono text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            {isStar && <span className="text-yellow-400 text-[10px]">★</span>}
            {entry.ticker}
          </button>
          <button
            onClick={() => onToggleNotes(entry.ticker)}
            className={`text-[10px] ${hasNotes ? 'text-blue-400' : 'text-gray-600 hover:text-gray-300'}`}
            title={hasNotes ? 'Edit thesis note' : 'Add thesis note'}
          >
            {hasNotes ? '📝' : '✎'}
          </button>
        </div>
        <div className="text-[10px] text-gray-500 truncate max-w-[80px]" title={entry.name}>{entry.name}</div>
      </td>

      {/* Price & Mkt Cap */}
      <td className="px-3 py-2 font-mono text-xs text-gray-200 text-right whitespace-nowrap">
        {c.price != null ? formatCurrency(c.price, currency, false) : '—'}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-gray-400 text-right whitespace-nowrap">
        {c.mktCap != null ? formatCurrency(c.mktCap, currency) : '—'}
      </td>

      {/* DCF + MOS */}
      <td className="px-3 py-2 font-mono text-xs text-right whitespace-nowrap">
        <div className={c.dcfPriceMOS != null ? 'text-gray-200' : 'text-gray-600'}>
          {c.dcfPriceMOS != null ? formatCurrency(c.dcfPriceMOS, currency, false) : '—'}
        </div>
        <div className="text-[10px] text-gray-500">
          {c.dcfPrice != null ? formatCurrency(c.dcfPrice, currency, false) : ''}
        </div>
      </td>
      <td className="px-3 py-2 text-right"><UpsideBadge value={c.dcfUpside} /></td>

      {/* Bear / Bull scenario upside */}
      <td className="px-3 py-2 text-right">
        <UpsideBadge
          value={c.bearUpside}
          title={c.bearPriceMOS != null ? `Bear MOS price: ${formatCurrency(c.bearPriceMOS, currency, false)}` : undefined}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <UpsideBadge
          value={c.bullUpside}
          title={c.bullPriceMOS != null ? `Bull MOS price: ${formatCurrency(c.bullPriceMOS, currency, false)}` : undefined}
        />
      </td>

      {/* FCFY + MOS */}
      <td className="px-3 py-2 font-mono text-xs text-right whitespace-nowrap">
        <div className={c.fcfyPriceMOS != null ? 'text-gray-200' : 'text-gray-600'}>
          {c.fcfyPriceMOS != null ? formatCurrency(c.fcfyPriceMOS, currency, false) : '—'}
        </div>
        <div className="text-[10px] text-gray-500">
          {c.fcfyPrice != null ? formatCurrency(c.fcfyPrice, currency, false) : ''}
        </div>
      </td>
      <td className="px-3 py-2 text-right"><UpsideBadge value={c.fcfyUpside} /></td>

      {/* Metrics */}
      <td className="px-3 py-2 font-mono text-xs text-right text-gray-300">{fmtPct(c.fcfeYield)}</td>
      <td className="px-3 py-2 font-mono text-xs text-right text-gray-300">{fmtPct(c.fcfCAGR)}</td>
      <td className="px-3 py-2 font-mono text-xs text-right text-gray-300">{fmtPct(c.roic)}</td>
      <td className="px-3 py-2 font-mono text-xs text-right text-gray-300">{fmtPct(c.wacc)}</td>
      <td className="px-3 py-2 font-mono text-xs text-right">
        {c.spread != null ? (
          <span className={c.spread > 0 ? 'text-green-400' : 'text-red-400'}>{fmtPct(c.spread)}</span>
        ) : <span className="text-gray-600">—</span>}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-right text-gray-400">{fmtPct(c.maxGrowth)}</td>
      <td className="px-3 py-2 font-mono text-xs text-right text-gray-400">
        {c.tvRatio != null ? formatPercent(c.tvRatio) : <span className="text-gray-600">—</span>}
      </td>

      {/* Editable assumptions */}
      <td className="px-2 py-2 text-center">
        <input
          type="number" value={(a.growthRate * 100).toFixed(1)} step="0.5" min={0} max={100}
          onChange={(e) => setField('growthRate')(Number(e.target.value) / 100)}
          className="w-14 bg-gray-800 border border-gray-700 rounded text-xs text-center font-mono text-gray-200 px-1 py-0.5 focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-2 py-2 text-center">
        <input
          type="number" value={a.growthYears} step="1" min={1} max={9}
          onChange={(e) => setField('growthYears')(Number(e.target.value))}
          className="w-10 bg-gray-800 border border-gray-700 rounded text-xs text-center font-mono text-gray-200 px-1 py-0.5 focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-2 py-2 text-center">
        <input
          type="number" value={(a.steadyRate * 100).toFixed(1)} step="0.5" min={0} max={50}
          onChange={(e) => setField('steadyRate')(Number(e.target.value) / 100)}
          className="w-14 bg-gray-800 border border-gray-700 rounded text-xs text-center font-mono text-gray-200 px-1 py-0.5 focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-2 py-2 text-center">
        <input
          type="number" value={(a.terminalGrowth * 100).toFixed(1)} step="0.5" min={0} max={10}
          onChange={(e) => setField('terminalGrowth')(Number(e.target.value) / 100)}
          className="w-12 bg-gray-800 border border-gray-700 rounded text-xs text-center font-mono text-gray-200 px-1 py-0.5 focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-2 py-2 text-center">
        <MosBadge level={a.uncertainty} onChange={setField('uncertainty')} />
      </td>

      {/* Remove */}
      <td className="px-3 py-2 text-center">
        <button
          onClick={() => onRemove(entry.ticker)}
          className="text-gray-700 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        >
          ✕
        </button>
      </td>
    </tr>
    {expanded && (
      <tr className="bg-gray-950/60">
        <td colSpan={23} className="px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 pt-1.5 shrink-0">
              Thesis
            </span>
            <textarea
              defaultValue={entry.notes ?? ''}
              onBlur={(e) => onUpdateNotes(entry.ticker, e.target.value)}
              placeholder="Why you own it, what would break the thesis, target exit… (saved on blur)"
              rows={2}
              className="flex-1 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 leading-relaxed focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 resize-y"
            />
            {entry.notesAt && (
              <span className="text-[10px] text-gray-600 pt-1.5 shrink-0">
                {new Date(entry.notesAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export interface WatchlistTabProps {
  lists: WatchlistData[];
  activeList: WatchlistData;
  activeId: string;
  onSelectList: (id: string) => void;
  onCreateList: () => void;
  onRenameList: (id: string, name: string) => void;
  onDeleteList: (id: string) => void;
  onRemove: (ticker: string) => void;
  onAssumptionChange: (ticker: string, a: DCFAssumptions) => void;
  onUpdateNotes: (ticker: string, notes: string) => void;
  onReorder: (from: number, to: number) => void;
  onSelectTicker: (ticker: string) => void;
}

export function WatchlistTab({
  lists, activeList, activeId,
  onSelectList, onCreateList, onRenameList, onDeleteList,
  onRemove, onAssumptionChange, onUpdateNotes, onReorder, onSelectTicker,
}: WatchlistTabProps) {
  const [rows, setRows] = useState<RowData[]>([]);
  const [sortConfig, setSortConfig] = useState<{ col: SortCol; dir: SortDir } | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [belowMosOnly, setBelowMosOnly] = useState(false);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const toggleNotes = useCallback(
    (ticker: string) => setExpandedTicker((cur) => (cur === ticker ? null : ticker)),
    []
  );

  // Count of names in the buy zone (price ≤ MOS) for the alert toggle badge.
  const belowMosCount = rows.filter(
    (r) => r.computed?.price != null && r.computed?.dcfPriceMOS != null && r.computed.price <= r.computed.dcfPriceMOS
  ).length;

  // Re-fetch whenever the active list's ticker set changes
  const tickerKey = activeList.entries.map((e) => e.ticker).join(',');

  useEffect(() => {
    setRows(
      activeList.entries.map((entry) => ({
        entry,
        financials: null,
        priceData: null,
        loading: true,
        error: null,
        computed: null,
      }))
    );

    activeList.entries.forEach((entry, idx) => {
      fetchTickerData(entry.ticker)
        .then(({ financials, priceData }) => {
          // Honor the entry's SAVED assumptions — the auto-refresh that used to
          // overwrite them here silently discarded the user's inline edits every
          // load. Data-driven defaults are computed once, at add-time, instead.
          // Migration: if the entry still holds the untouched base template,
          // seed it with data-driven defaults now (one-time).
          let entryToUse = entry;
          if (financials && isBaseAssumptions(entry.assumptions)) {
            const seeded = computeDefaultAssumptions(financials.fcfHistory ?? [], entry.assumptions);
            entryToUse = { ...entry, assumptions: seeded };
            onAssumptionChange(entry.ticker, seeded);
          }

          setRows((prev) => {
            const next = [...prev];
            if (!next[idx]) return prev;
            const computed =
              financials && priceData ? computeMetrics(financials, priceData, entryToUse) : null;
            next[idx] = { ...next[idx], entry: entryToUse, financials, priceData, loading: false, computed };
            return next;
          });
        })
        .catch((err) => {
          setRows((prev) => {
            const next = [...prev];
            if (!next[idx]) return prev;
            next[idx] = { ...next[idx], loading: false, error: err.message };
            return next;
          });
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  // Sync assumption/override changes without re-fetching. Only rows whose entry
  // inputs actually changed are recomputed — during a load, each row's metrics
  // are already computed on its fetch-resolve, so this effect (which fires once
  // per row as onAssumptionChange lands) skips them instead of recomputing all N
  // rows N times (was O(N²) computeMetrics + DCF runs per watchlist open).
  useEffect(() => {
    setRows((prev) =>
      prev.map((row) => {
        const updated = activeList.entries.find((e) => e.ticker === row.entry.ticker);
        if (!updated || updated === row.entry) return row; // nothing changed
        // Only recompute metrics when the DCF inputs actually changed; a notes
        // edit updates the entry ref but keeps the existing computed metrics.
        const inputsSame =
          updated.assumptions === row.entry.assumptions &&
          updated.overrides === row.entry.overrides;
        const computed =
          !inputsSame && row.financials && row.priceData
            ? computeMetrics(row.financials, row.priceData, updated)
            : row.computed;
        return { ...row, entry: updated, computed };
      })
    );
  }, [activeList.entries]);

  const handleSort = useCallback((col: SortCol) => {
    setSortConfig((prev) => {
      if (prev?.col === col) {
        return prev.dir === 'desc' ? null : { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { col, dir: 'desc' }; // default: high → low
    });
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((idx: number) => { dragFrom.current = idx; }, []);
  const handleDragOver = useCallback((idx: number) => { setDragOverIdx(idx); }, []);
  const handleDrop = useCallback(() => {
    if (dragFrom.current !== null && dragOverIdx !== null && dragFrom.current !== dragOverIdx) {
      onReorder(dragFrom.current, dragOverIdx);
    }
    dragFrom.current = null;
    setDragOverIdx(null);
  }, [dragOverIdx, onReorder]);

  const isSorted = sortConfig !== null;
  // Sort once per [rows, sortConfig]; then optionally filter to the buy zone.
  const displayRows = useMemo(() => {
    const base = sortConfig ? sortRows(rows, sortConfig.col, sortConfig.dir) : rows;
    if (!belowMosOnly) return base;
    return base.filter(
      (r) =>
        r.computed?.price != null &&
        r.computed?.dcfPriceMOS != null &&
        r.computed.price <= r.computed.dcfPriceMOS
    );
  }, [rows, sortConfig, belowMosOnly]);
  // O(1) original-index lookup for drag reorder (was findIndex per row → O(n²)).
  const indexByTicker = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.entry.ticker, i));
    return m;
  }, [rows]);

  const thBase = 'px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap';
  const SortHeader = ({ col, label, className = '' }: { col: SortCol; label: string; className?: string }) => (
    <SortTh col={col} label={label} sortConfig={sortConfig} onSort={handleSort} className={className} />
  );

  return (
    <div className="space-y-0">
      {/* List selector */}
      <ListSelector
        lists={lists}
        activeId={activeId}
        onSelect={onSelectList}
        onCreate={onCreateList}
        onRename={onRenameList}
        onDelete={(id) => {
          const list = lists.find((l) => l.id === id);
          if (!list) return;
          if (list.entries.length > 0 && !confirm(`Delete "${list.name}" (${list.entries.length} tickers)?`)) return;
          onDeleteList(id);
        }}
      />

      {/* Alert toolbar */}
      {activeList.entries.length > 0 && (
        <div className="flex items-center gap-2 py-2">
          <button
            onClick={() => setBelowMosOnly((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
              belowMosOnly
                ? 'border-green-700 bg-green-900/30 text-green-300'
                : 'border-gray-700 bg-gray-900 text-gray-400 hover:text-gray-200'
            }`}
            title="Show only names trading at or below their MOS price"
          >
            🔔 Below MOS
            {belowMosCount > 0 && (
              <span className="font-mono font-bold px-1 rounded bg-green-800/60 text-green-200">
                {belowMosCount}
              </span>
            )}
          </button>
          {belowMosOnly && (
            <span className="text-[10px] text-gray-500">Showing buy-zone names only</span>
          )}
        </div>
      )}

      {activeList.entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <IconClipboard size={44} className="mb-4 text-gray-700" />
          <h2 className="text-gray-300 text-base font-semibold mb-1">"{activeList.name}" is empty</h2>
          <p className="text-gray-500 text-sm max-w-sm">
            Switch to the Valuation tab, search a ticker, set your assumptions, then click{' '}
            <span className="text-blue-400 font-mono">+ Watchlist</span>.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800 border-l-2 border-l-emerald-500/40 bg-gray-950"
          onDragEnd={() => { dragFrom.current = null; setDragOverIdx(null); }}
        >
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-950/95 sticky top-0 z-20">
              <tr>
                {/* Drag handle col */}
                <th className={`${thBase} w-6`} title={isSorted ? 'Clear sort to reorder' : 'Drag to reorder'}>
                  {isSorted ? (
                    <button onClick={() => setSortConfig(null)} className="text-blue-400 hover:text-blue-300 text-[10px]" title="Clear sort">✕</button>
                  ) : '⠿'}
                </th>
                <th className={`${thBase} sticky left-0 bg-gray-950`}>Ticker</th>
                <SortHeader col="price" label="Price" className="text-right" />
                <SortHeader col="mktCap" label="Mkt Cap" className="text-right" />
                <th className={`${thBase} text-right`} colSpan={2}>DCF + MOS ↕</th>
                <SortHeader col="bearUpside" label="Bear" className="text-right" />
                <SortHeader col="bullUpside" label="Bull" className="text-right" />
                <th className={`${thBase} text-right`} colSpan={2}>FCFY + MOS ↕</th>
                <SortHeader col="fcfeYield" label="FCFE Yld" className="text-right" />
                <SortHeader col="fcfCAGR" label="FCF 5Y" className="text-right" />
                <SortHeader col="roic" label="ROIC" className="text-right" />
                <SortHeader col="wacc" label="WACC" className="text-right" />
                <SortHeader col="spread" label="Spread" className="text-right" />
                <SortHeader col="maxGrowth" label="Max g" className="text-right" />
                <SortHeader col="tvRatio" label="TV/NPV" className="text-right" />
                <SortHeader col="growthRate" label="G1%" />
                <SortHeader col="growthYears" label="Yrs" />
                <SortHeader col="steadyRate" label="G2%" />
                <SortHeader col="terminalGrowth" label="TG%" />
                <SortHeader col="uncertainty" label="MOS" />
                <th className={thBase}></th>
              </tr>
              {/* Sort indicator bar */}
              {isSorted && (
                <tr>
                  <td colSpan={23} className="px-3 py-1 bg-blue-950/40 text-[10px] text-blue-400 border-b border-blue-900">
                    Sorted by <strong>{sortConfig.col}</strong> ({sortConfig.dir === 'desc' ? 'high → low' : 'low → high'})
                    · Drag-to-reorder disabled while sorted ·{' '}
                    <button onClick={() => setSortConfig(null)} className="underline hover:text-blue-200">Clear sort</button>
                  </td>
                </tr>
              )}
            </thead>
            <tbody>
              {displayRows.map((row, displayIdx) => {
                // For DnD we need the original index in the un-sorted rows
                const originalIdx = isSorted
                  ? indexByTicker.get(row.entry.ticker) ?? displayIdx
                  : displayIdx;
                return (
                  <WatchlistRow
                    key={row.entry.ticker}
                    row={row}
                    index={originalIdx}
                    isSorted={isSorted}
                    onRemove={onRemove}
                    onAssumptionChange={onAssumptionChange}
                    onSelect={onSelectTicker}
                    onDragStart={handleDragStart}
                    onDragOver={() => setDragOverIdx(displayIdx)}
                    onDrop={handleDrop}
                    isDragging={dragFrom.current === originalIdx}
                    isDragOver={dragOverIdx === displayIdx && !isSorted}
                    expanded={expandedTicker === row.entry.ticker}
                    onToggleNotes={toggleNotes}
                    onUpdateNotes={onUpdateNotes}
                  />
                );
              })}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={23} className="px-3 py-6 text-center text-gray-500 text-xs">
                    No names are at or below their MOS price right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="px-4 py-2 text-[10px] text-gray-600 border-t border-gray-800">
            ★ = upside &gt;15% after MOS · Bear / Bull = stressed / optimistic MOS upside · click
            headers to sort · drag ⠿ to reorder · click a ticker to open its analysis
          </div>
        </div>
      )}
    </div>
  );
}
