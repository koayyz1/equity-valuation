import { useState, useEffect, useRef } from 'react';

interface EditableCellProps {
  value: string;
  onSave: (raw: string) => void;
  onClear?: () => void;
  isOverridden?: boolean;
  className?: string;
}

export function EditableCell({
  value,
  onSave,
  onClear,
  isOverridden = false,
  className = '',
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setEditing(false);
            onSave(draft);
          } else if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="bg-gray-800 text-blue-300 border border-blue-500 rounded px-1 w-full font-mono text-sm text-right focus:outline-none"
      />
    );
  }

  return (
    <span
      onDoubleClick={() => setEditing(true)}
      onContextMenu={(e) => {
        if (isOverridden && onClear) {
          e.preventDefault();
          onClear();
        }
      }}
      className={`cursor-pointer px-1 rounded hover:bg-gray-700/50 transition-colors select-none ${
        isOverridden ? 'text-blue-400' : ''
      } ${className}`}
      title={
        isOverridden
          ? 'Overridden — double-click to edit, right-click to reset'
          : 'Double-click to edit'
      }
    >
      {value}
    </span>
  );
}
