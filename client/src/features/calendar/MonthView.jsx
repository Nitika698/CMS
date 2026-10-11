import { Plus } from 'lucide-react';
import { DeadlineChip, PlannedDateChip, PostChip } from './Chips.jsx';
import { dayNumber, eachDay, longDay, weekdayShort } from './dates.js';
import { dropTarget } from './dnd.js';
import { STAGE_STYLE } from './stages.js';

const MAX_VISIBLE = 3;

function items(entry, show) {
  return [
    ...entry.deadlines.filter(() => show.deadlines).map((d) => ({ kind: 'deadline', key: `d-${d.contentId}`, d })),
    ...entry.posts.map((p) => ({ kind: 'post', key: `p-${p.id}`, p })),
    ...entry.planned.filter(() => show.planned).map((d) => ({ kind: 'planned', key: `n-${d.contentId}`, d })),
  ];
}

/** Desktop/tablet month grid. Each day is a drop target for rescheduling and has an "add entry" button. */
export function MonthGrid({ range, anchorMonth, today, byDate, show, canDrag, weekStartsOn, onOpenPost, onOpenContent, onNewOn, onOpenDay, onDropTo }) {
  const days = eachDay(range.from, range.to);
  const header = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
  return (
    <div role="grid" aria-label="Month calendar" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div role="row" className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
        {header.map((dow) => (
          <div key={dow} role="columnheader" className="px-2 py-2 text-center">
            {weekdayShort(dow)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date) => {
          const entry = byDate.get(date) ?? { posts: [], deadlines: [], planned: [] };
          const list = items(entry, show);
          const inMonth = date.slice(0, 7) === anchorMonth;
          return (
            <div
              key={date}
              role="gridcell"
              aria-label={longDay(date)}
              data-date={date}
              {...dropTarget((item) => onDropTo(item, { date }))}
              className={`group relative min-h-[7.5rem] min-w-0 border-b border-r border-slate-100 p-1.5 data-[over=true]:bg-brand-50 data-[over=true]:ring-2 data-[over=true]:ring-inset data-[over=true]:ring-brand-500 ${inMonth ? 'bg-white' : 'bg-slate-50/70'}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onOpenDay(date)}
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${date === today ? 'bg-brand-600 text-white' : inMonth ? 'text-slate-800 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-100'}`}
                  aria-label={`Open ${longDay(date)}`}
                  aria-current={date === today ? 'date' : undefined}
                >
                  {dayNumber(date)}
                </button>
                <button
                  type="button"
                  onClick={() => onNewOn(date)}
                  aria-label={`Add an entry on ${longDay(date)}`}
                  className="rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <ul className="space-y-1">
                {list.slice(0, MAX_VISIBLE).map((it) => (
                  <li key={it.key}>
                    {it.kind === 'post' ? (
                      <PostChip post={it.p} compact canDrag={canDrag} onOpen={onOpenPost} />
                    ) : it.kind === 'deadline' ? (
                      <DeadlineChip item={it.d} compact onOpen={onOpenContent} />
                    ) : (
                      <PlannedDateChip item={it.d} compact onOpen={onOpenContent} />
                    )}
                  </li>
                ))}
              </ul>
              {list.length > MAX_VISIBLE && (
                <button type="button" onClick={() => onOpenDay(date)} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
                  +{list.length - MAX_VISIBLE} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Phone month view: a compact grid of dots; tapping a day selects it and its entries are listed below. */
export function MonthCompact({ range, anchorMonth, today, selected, byDate, show, weekStartsOn, onSelect }) {
  const days = eachDay(range.from, range.to);
  const header = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
  return (
    <div role="grid" aria-label="Month calendar" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div role="row" className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600">
        {header.map((dow) => (
          <div key={dow} role="columnheader" className="py-1.5 text-center">
            {weekdayShort(dow).slice(0, 2)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date) => {
          const entry = byDate.get(date) ?? { posts: [], deadlines: [], planned: [] };
          const inMonth = date.slice(0, 7) === anchorMonth;
          const dots = [
            ...entry.posts.map((p) => ({ key: p.id, cls: STAGE_STYLE[p.status]?.swatch })),
            ...(show.deadlines ? entry.deadlines.map((d) => ({ key: `d${d.contentId}`, cls: 'border border-rose-400 bg-rose-200' })) : []),
          ];
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              data-date={date}
              onClick={() => onSelect(date)}
              aria-label={`${longDay(date)}: ${entry.posts.length} entries${show.deadlines && entry.deadlines.length ? `, ${entry.deadlines.length} deadlines` : ''}`}
              aria-selected={selected === date}
              className={`flex h-14 flex-col items-center gap-1 border-b border-r border-slate-100 pt-1.5 ${selected === date ? 'bg-brand-50 ring-2 ring-inset ring-brand-500' : inMonth ? 'bg-white' : 'bg-slate-50'}`}
            >
              <span className={`flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-medium ${date === today ? 'bg-brand-600 text-white' : inMonth ? 'text-slate-800' : 'text-slate-400'}`}>{dayNumber(date)}</span>
              <span className="flex flex-wrap justify-center gap-0.5 px-1" aria-hidden>
                {dots.slice(0, 4).map((dot) => (
                  <span key={dot.key} className={`h-1.5 w-1.5 rounded-full ${dot.cls}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
