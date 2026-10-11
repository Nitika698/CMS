import { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { DeadlineChip, PlannedDateChip, PostChip } from './Chips.jsx';
import { dayNumber, hourLabel, longDay, weekdayShort, weekday } from './dates.js';
import { dropTarget } from './dnd.js';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const pad = (n) => String(n).padStart(2, '0');

/** Week and day views: one column per day, one row per hour (in the user's timezone). Slots are drop targets. */
export default function TimeGrid({ days, today, byDate, show, canDrag, onOpenPost, onOpenContent, onNewAt, onDropTo }) {
  const scroller = useRef(null);
  // Open on the earliest entry in view (one hour of context above it), or at 07:00 when the range is empty.
  const hours = days.flatMap((d) => (byDate.get(d)?.posts ?? []).map((p) => Number(p.localTime.slice(0, 2))));
  const startHour = hours.length ? Math.max(0, Math.min(...hours) - 1) : 7;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = startHour * 56;
  }, [days[0], startHour]); // eslint-disable-line react-hooks/exhaustive-deps

  const gridCols = `4rem repeat(${days.length}, minmax(${days.length === 1 ? 0 : 7.5}rem, 1fr))`;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div ref={scroller} className="max-h-[68vh] overflow-auto">
        <div role="grid" aria-label={days.length === 1 ? 'Day schedule' : 'Week schedule'} className="min-w-fit">
          {/* header + all-day row stay visible while scrolling */}
          <div className="sticky top-0 z-10 bg-white" role="row">
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ display: 'grid', gridTemplateColumns: gridCols }}>
              <div />
              {days.map((date) => (
                <div key={date} role="columnheader" aria-current={date === today ? 'date' : undefined} className="border-l border-slate-200 px-2 py-2 text-center">
                  <p className="text-xs text-slate-500">{weekdayShort(weekday(date))}</p>
                  <p className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${date === today ? 'bg-brand-600 text-white' : 'text-slate-900'}`}>{dayNumber(date)}</p>
                </div>
              ))}
            </div>
            <div className="grid border-b border-slate-200 bg-white" style={{ display: 'grid', gridTemplateColumns: gridCols }}>
              <div className="px-1 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-slate-400">Dates</div>
              {days.map((date) => {
                const e = byDate.get(date) ?? { deadlines: [], planned: [] };
                return (
                  <div key={date} className="min-h-8 space-y-1 border-l border-slate-200 p-1">
                    {show.deadlines && e.deadlines.map((d) => <DeadlineChip key={d.contentId} item={d} onOpen={onOpenContent} />)}
                    {show.planned && e.planned.map((d) => <PlannedDateChip key={d.contentId} item={d} onOpen={onOpenContent} />)}
                  </div>
                );
              })}
            </div>
          </div>

          {HOURS.map((h) => (
            <div key={h} role="row" className="grid" style={{ gridTemplateColumns: gridCols }}>
              <div className="-mt-2 pr-2 pt-0 text-right text-[11px] text-slate-400">{h === 0 ? '' : hourLabel(h)}</div>
              {days.map((date) => {
                const posts = (byDate.get(date)?.posts ?? []).filter((p) => Number(p.localTime.slice(0, 2)) === h);
                return (
                  <div
                    key={date}
                    role="gridcell"
                    data-date={date}
                    data-hour={h}
                    aria-label={`${longDay(date)} ${hourLabel(h)}`}
                    {...dropTarget((item) => onDropTo(item, { date, time: `${pad(h)}:00` }))}
                    className="group relative min-h-14 border-l border-t border-slate-100 p-0.5 data-[over=true]:bg-brand-50 data-[over=true]:ring-2 data-[over=true]:ring-inset data-[over=true]:ring-brand-500"
                  >
                    <ul className="space-y-0.5">
                      {posts.map((p) => (
                        <li key={p.id}>
                          <PostChip post={p} compact={days.length > 1} canDrag={canDrag} onOpen={onOpenPost} />
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => onNewAt(date, `${pad(h)}:00`)}
                      aria-label={`Add an entry on ${longDay(date)} at ${hourLabel(h)}`}
                      className="absolute right-0.5 top-0.5 rounded p-0.5 text-slate-300 opacity-0 hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
