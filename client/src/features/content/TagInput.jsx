import { useState } from 'react';
import { X } from 'lucide-react';

/** Chips input: Enter or comma adds, Backspace on an empty box removes the last chip. `normalize` cleans each entry. */
export default function TagInput({ id, value, onChange, normalize = (s) => s.trim(), placeholder, max, 'aria-describedby': describedBy, disabled }) {
  const [draft, setDraft] = useState('');

  const add = (raw) => {
    const items = raw.split(',').map(normalize).filter(Boolean);
    if (!items.length) return;
    const next = [...value];
    for (const it of items) if (!next.some((x) => x.toLowerCase() === it.toLowerCase()) && (!max || next.length < max)) next.push(it);
    onChange(next);
    setDraft('');
  };

  return (
    <div className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 shadow-sm focus-within:border-brand-500 ${disabled ? 'bg-slate-100' : ''}`}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-sm text-slate-800">
          {t}
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="rounded text-slate-500 hover:text-slate-900">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        aria-describedby={describedBy}
        disabled={disabled || (max && value.length >= max)}
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
        className="min-w-[8rem] flex-1 border-0 bg-transparent p-0.5 text-sm outline-none placeholder:text-slate-400 focus:ring-0"
      />
    </div>
  );
}
