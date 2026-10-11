import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/index.js';
import { DeadlineChip, PlannedDateChip, PostChip } from './Chips.jsx';
import { longDay } from './dates.js';

/** Phone-friendly list of entries grouped by day (used for week/day on small screens and under the compact month). */
export default function AgendaList({ days, today, byDate, show, onOpenPost, onOpenContent, onNewOn, showEmptyDays = true }) {
  return (
    <div className="space-y-3" data-testid="agenda">
      {days.map((date) => {
        const e = byDate.get(date) ?? { posts: [], deadlines: [], planned: [] };
        const n = e.posts.length + (show.deadlines ? e.deadlines.length : 0) + (show.planned ? e.planned.length : 0);
        if (!showEmptyDays && n === 0) return null;
        return (
          <section key={date} aria-label={longDay(date)} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <h3 className={`text-sm font-semibold ${date === today ? 'text-brand-700' : 'text-slate-900'}`}>
                {longDay(date)}
                {date === today && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Today</span>}
              </h3>
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => onNewOn(date)} aria-label={`Add an entry on ${longDay(date)}`} />
            </header>
            {n === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">Nothing on this day.</p>
            ) : (
              <ul className="space-y-1.5 p-2">
                {show.deadlines && e.deadlines.map((d) => <li key={`d${d.contentId}`}><DeadlineChip item={d} onOpen={onOpenContent} /></li>)}
                {e.posts.map((p) => <li key={p.id}><PostChip post={p} onOpen={onOpenPost} /></li>)}
                {show.planned && e.planned.map((d) => <li key={`n${d.contentId}`}><PlannedDateChip item={d} onOpen={onOpenContent} /></li>)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
