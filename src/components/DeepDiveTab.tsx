import { useState, useCallback } from 'react';
import { IconClipboard, IconChart, IconScale, IconShield, IconFlask } from './icons';

interface DeepDiveSection {
  key: 'overview' | 'segments' | 'proscons' | 'scorecard';
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}

const SECTIONS: DeepDiveSection[] = [
  {
    key: 'overview',
    title: 'Overall (1Y)',
    subtitle: 'Major operational moves over the past year with evaluation',
    icon: <IconClipboard size={16} />,
  },
  {
    key: 'segments',
    title: 'Segment Analysis',
    subtitle: 'Top 3 revenue segments — weightage, recent moves, and outlook',
    icon: <IconChart size={16} />,
  },
  {
    key: 'proscons',
    title: 'Pros & Cons',
    subtitle: 'Forward-looking opportunities and risks',
    icon: <IconScale size={16} />,
  },
  {
    key: 'scorecard',
    title: 'Moat & Risks Scorecard',
    subtitle: 'Rated dimensions — moat, pricing power, balance sheet, risks (5 = strong / low risk)',
    icon: <IconShield size={16} />,
  },
];

interface SectionData {
  content: string;
  model: string;
  generatedAt: string;
}

// Relative age of a generated payload, e.g. "3h ago". Null when unparseable.
function relativeAge(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, (Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface ScorecardRow {
  dim: string;
  score: number;
  why: string;
}

// Parse "Dimension | N/5 | justification" lines. Returns null when the model
// ignored the format (caller falls back to markdown rendering).
function parseScorecard(text: string): ScorecardRow[] | null {
  const rows: ScorecardRow[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[•*-]\s*/, '');
    const m = line.match(/^\**([^|*]+?)\**\s*\|\s*(\d(?:\.\d)?)\s*\/\s*5\s*\|\s*(.+)$/);
    if (m) rows.push({ dim: m[1].trim(), score: parseFloat(m[2]), why: m[3].trim() });
  }
  return rows.length >= 4 ? rows : null;
}

function scoreClasses(score: number): string {
  if (score >= 4) return 'bg-green-900/60 text-green-300 border-green-700';
  if (score >= 3) return 'bg-yellow-900/60 text-yellow-300 border-yellow-700';
  return 'bg-red-900/60 text-red-300 border-red-700';
}

function Scorecard({ rows }: { rows: ScorecardRow[] }) {
  const overall = rows.find((r) => r.dim.toLowerCase() === 'overall');
  const dims = rows.filter((r) => r !== overall);
  return (
    <div className="space-y-2 py-1">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {dims.map((r) => (
          <div key={r.dim} className="bg-gray-950/50 border border-gray-800 rounded-lg p-2.5 flex gap-3">
            <span
              className={`shrink-0 self-start px-1.5 py-0.5 rounded border font-mono text-xs font-bold ${scoreClasses(r.score)}`}
            >
              {r.score}/5
            </span>
            <div>
              <div className="text-sm font-medium text-gray-200">{r.dim}</div>
              <div className="text-[11px] text-gray-400 leading-relaxed mt-0.5">{r.why}</div>
            </div>
          </div>
        ))}
      </div>
      {overall && (
        <div className="border border-gray-700 bg-gray-800/40 rounded-lg p-3 flex gap-3 items-start">
          <span
            className={`shrink-0 px-2 py-0.5 rounded border font-mono text-sm font-bold ${scoreClasses(overall.score)}`}
          >
            {overall.score}/5
          </span>
          <div>
            <div className="text-sm font-semibold text-gray-100">Overall</div>
            <div className="text-xs text-gray-300 leading-relaxed mt-0.5">{overall.why}</div>
          </div>
        </div>
      )}
      <div className="text-[10px] text-gray-600">
        Risk dimensions (Disruption, Regulatory, Cyclicality) are inverted: 5 = low risk.
      </div>
    </div>
  );
}

// Render inline **bold** spans within a string.
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i} className="font-semibold text-gray-100">{p.slice(2, -2)}</strong>
          : p
      )}
    </>
  );
}

function parseMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      result.push(<div key={key++} className="h-2" />);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      // Sub-section label — rendered underlined
      result.push(
        <p key={key++} className="text-sm font-medium text-gray-200 underline decoration-gray-600 mt-3 mb-1">
          {trimmed.slice(4)}
        </p>
      );
    } else if (trimmed.startsWith('## ')) {
      // Segment header
      result.push(
        <h4 key={key++} className="text-sm font-semibold text-gray-100 mt-5 mb-1 border-b border-gray-700 pb-1">
          {trimmed.slice(3)}
        </h4>
      );
    } else if (trimmed.startsWith('# ')) {
      result.push(
        <h3 key={key++} className="text-sm font-bold text-gray-100 mt-3 mb-1">
          {trimmed.slice(2)}
        </h3>
      );
    } else if (trimmed.startsWith('•') || trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      const content = trimmed.replace(/^[•*-]\s+/, '');
      result.push(
        <div key={key++} className="flex gap-2 text-sm text-gray-300 leading-relaxed mb-1">
          <span className="text-blue-400 mt-0.5 shrink-0">•</span>
          <span>{renderInline(content)}</span>
        </div>
      );
    } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      // Standalone bold line (fallback for models that ignore ### instruction)
      result.push(
        <p key={key++} className="text-sm font-medium text-gray-200 underline decoration-gray-600 mt-3 mb-1">
          {trimmed.slice(2, -2)}
        </p>
      );
    } else {
      result.push(
        <p key={key++} className="text-sm text-gray-300 leading-relaxed mb-1">
          {renderInline(trimmed)}
        </p>
      );
    }
  }
  return result;
}

function SectionCard({
  section,
  ticker,
}: {
  section: DeepDiveSection;
  ticker: string;
}) {
  const [data, setData] = useState<SectionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const generate = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const url =
        `/api/deepdive/${encodeURIComponent(ticker)}?section=${section.key}` +
        (force ? '&force=true' : '');
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [ticker, section.key]);

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-violet-500/40 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
        >
          <span className="text-gray-400 shrink-0">{section.icon}</span>
          <div>
            <div className="text-sm font-semibold text-gray-200">{section.title}</div>
            <div className="text-[11px] text-gray-500">{section.subtitle}</div>
          </div>
          <span className="text-gray-600 text-xs ml-1">{expanded ? '▾' : '▸'}</span>
        </button>
        <div className="flex items-center gap-2">
          {data && (
            <span
              className="text-[11px] text-gray-500"
              title={`Generated ${new Date(data.generatedAt).toLocaleString()}`}
            >
              via {data.model}
              {relativeAge(data.generatedAt) && (
                <span className="text-gray-600"> · {relativeAge(data.generatedAt)}</span>
              )}
            </span>
          )}
          <button
            onClick={() => generate(!!data)}
            disabled={loading}
            className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
              loading
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : data
                ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700'
                : 'bg-blue-600 text-white hover:bg-blue-500'
            }`}
          >
            {loading ? 'Researching…' : data ? 'Refresh' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-4 py-3">
          {loading ? (
            <div className="space-y-2 py-2">
              {[100, 90, 95, 85, 92, 88].map((w, i) => (
                <div
                  key={i}
                  className="h-3 bg-gray-800 rounded animate-pulse"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          ) : error ? (
            <div className="text-xs text-red-400 py-2">
              {error.includes('GEMINI_API_KEY')
                ? 'Set GEMINI_API_KEY in equity-valuation/.env to enable deep research.'
                : error}
            </div>
          ) : data ? (
            section.key === 'scorecard' && parseScorecard(data.content) ? (
              <Scorecard rows={parseScorecard(data.content)!} />
            ) : (
              <div className="space-y-0.5 py-1">{parseMarkdown(data.content)}</div>
            )
          ) : (
            <div className="text-xs text-gray-600 py-4 text-center">
              Click <span className="text-blue-400 font-medium">Generate</span> to run deep research on this company using Gemini with live web search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DeepDiveTabProps {
  ticker: string | null;
}

export function DeepDiveTab({ ticker }: DeepDiveTabProps) {
  if (!ticker) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-600">
        <IconFlask size={44} className="mb-4 text-gray-700" />
        <p className="text-sm">Enter a ticker to run a deep dive analysis.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-100">Deep Dive — {ticker}</h2>
        <span className="text-[11px] text-gray-500">Powered by Google Gemini + web search</span>
      </div>
      {SECTIONS.map((s) => (
        <SectionCard key={s.key} section={s} ticker={ticker} />
      ))}
    </div>
  );
}
