import { useState, useEffect, useRef } from 'react';

interface SliderInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: 'percent' | 'years' | 'number';
  defaultValue?: number;
  disabled?: boolean;
}

export function SliderInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = 'percent',
  defaultValue,
  disabled = false,
}: SliderInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const display =
    format === 'percent'
      ? `${(value * 100).toFixed(1)}%`
      : format === 'years'
      ? `${value} yr`
      : value.toString();

  // Begin editing — pre-fill draft with the raw numeric value (percent shown as %).
  const startEdit = () => {
    setDraft(format === 'percent' ? (value * 100).toFixed(2) : String(value));
    setEditing(true);
  };

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const raw = Number(draft);
    if (!Number.isNaN(raw)) {
      const numeric = format === 'percent' ? raw / 100 : raw;
      // Clamp to [min, max] so the slider/cap is respected.
      const clamped = Math.max(min, Math.min(max, numeric));
      onChange(clamped);
    }
    setEditing(false);
  };

  const handleReset = (e: React.MouseEvent) => {
    e.preventDefault();
    if (defaultValue != null) onChange(defaultValue);
  };

  // Track-fill percentage and the default-value tick position.
  const span = max - min || 1;
  const fillPct = Math.max(0, Math.min(100, ((value - min) / span) * 100));
  const defaultPct =
    defaultValue != null
      ? Math.max(0, Math.min(100, ((defaultValue - min) / span) * 100))
      : null;

  return (
    <div className={disabled ? 'opacity-60' : ''}>
      <div className="flex justify-between items-center mb-0.5">
        <label className="text-gray-400 text-[11px]">{label}</label>
        {editing && !disabled ? (
          <input
            ref={inputRef}
            type="number"
            value={draft}
            step={format === 'percent' ? 0.1 : step}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') setEditing(false);
            }}
            className="w-20 bg-gray-800 border border-gray-700 rounded px-1 py-0 text-blue-300 font-mono text-xs tabular-nums text-right focus:outline-none focus:border-blue-500"
          />
        ) : (
          <span
            className={`text-blue-300 font-mono text-xs tabular-nums select-none ${
              disabled ? 'cursor-default' : 'cursor-pointer'
            }`}
            title={disabled ? '' : 'Double-click to edit · Right-click to reset'}
            onDoubleClick={disabled ? undefined : startEdit}
            onContextMenu={disabled ? undefined : handleReset}
          >
            {display}
          </span>
        )}
      </div>
      <div className="relative">
        <input
          type="range"
          disabled={disabled}
          min={format === 'percent' ? min * 1000 : min}
          max={format === 'percent' ? max * 1000 : max}
          step={format === 'percent' ? step * 1000 : step}
          value={format === 'percent' ? value * 1000 : value}
          onChange={(e) =>
            onChange(format === 'percent' ? Number(e.target.value) / 1000 : Number(e.target.value))
          }
          className={`w-full accent-blue-500 h-1 ${disabled ? 'cursor-not-allowed' : ''}`}
          // Drives the two-tone track fill (see index.css).
          style={{ '--fill': `${fillPct}%` } as React.CSSProperties}
        />
        {/* Tick marking the data-driven default, so drift from it is visible. */}
        {defaultPct != null && (
          <span
            className="absolute -top-0.5 h-2 w-px bg-gray-500/80 pointer-events-none"
            style={{ left: `${defaultPct}%` }}
            title="Data-driven default"
          />
        )}
      </div>
    </div>
  );
}
