import { useEffect, useState } from 'react';
import { Thesis, THESIS_QUESTIONS, getThesis, saveThesis, thesisCompleteness } from '../utils/thesis';

/**
 * The four questions the reader answers themselves. Sits alongside the
 * model-assembled evidence deliberately: the evidence is research, this is the
 * judgment, and only one of them can be delegated.
 */
export function ThesisJournal({ ticker }: { ticker: string }) {
  const [thesis, setThesis] = useState<Thesis>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setThesis(getThesis(ticker) ?? {});
    setDirty(false);
  }, [ticker]);

  // Persist shortly after typing stops, so answers are never lost to a tab
  // switch — this is a notebook, not a form to submit.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      saveThesis(ticker, thesis);
      setDirty(false);
    }, 800);
    return () => clearTimeout(t);
  }, [thesis, dirty, ticker]);

  const done = thesisCompleteness(thesis);
  const set = (k: keyof Thesis) => (v: string) => {
    setThesis((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-amber-500/40 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-100">Your Thesis</h3>
        <span className="text-[11px] text-gray-500">
          {done}/4 answered
          {dirty && <span className="text-gray-600"> · saving…</span>}
        </span>
      </div>
      <p className="text-[10px] text-gray-500 mb-4 leading-relaxed">
        The evidence above is research; this is the judgment. Written in your own words it is worth
        something — borrowed from a model it is worth nothing. Saved locally per ticker.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {THESIS_QUESTIONS.map((q) => {
          const value = thesis[q.key] ?? '';
          const answered = value.trim().length > 10;
          return (
            <div key={q.key}>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span
                  className={`text-[11px] font-semibold ${
                    answered ? 'text-amber-300' : 'text-gray-300'
                  }`}
                >
                  {q.label}
                </span>
                {answered && <span className="text-[9px] text-emerald-400">✓</span>}
              </div>
              <p className="text-[10px] text-gray-600 mb-1.5 leading-relaxed">{q.prompt}</p>
              <textarea
                value={value}
                onChange={(e) => set(q.key)(e.target.value)}
                rows={4}
                placeholder="…"
                className="w-full bg-gray-950/60 border border-gray-800 rounded-lg px-2.5 py-2 text-[11px] text-gray-200 leading-relaxed placeholder-gray-700 focus:outline-none focus:border-amber-500/50 resize-y"
              />
            </div>
          );
        })}
      </div>

      {thesis.updatedAt && (
        <div className="text-[10px] text-gray-600 mt-2">
          Last updated {new Date(thesis.updatedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
