import { Check } from 'lucide-react';

/** The six workflow stages. Past stages are ticked, the current one highlighted; text always names the state (not colour alone). */
export default function WorkflowStepper({ statuses, current }) {
  const at = statuses.findIndex((s) => s.key === current);
  return (
    <ol className="grid grid-cols-3 gap-y-3 sm:grid-cols-6" aria-label="Workflow progress">
      {statuses.map((s, i) => {
        const active = i === at;
        const last = i === statuses.length - 1;
        const done = i < at;
        return (
          <li key={s.key} aria-current={active ? 'step' : undefined} className="flex items-center gap-2 sm:flex-col sm:gap-1.5 sm:text-center">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                active ? 'bg-brand-600 text-white ring-4 ring-brand-100' : done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {done || (active && last) ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <span className={`text-xs ${active ? 'font-semibold text-slate-900' : done ? 'text-slate-700' : 'text-slate-500'}`}>
              {s.label}
              <span className="sr-only">{active ? ' (current stage)' : done ? ' (completed)' : ' (upcoming)'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
