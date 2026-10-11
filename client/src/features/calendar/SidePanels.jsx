import { Link } from 'react-router-dom';
import { AlertTriangle, Flag, Info } from 'lucide-react';
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/index.js';
import { platformLabel } from '../content/constants.js';
import { endDrag, startDrag } from './dnd.js';
import { shortDay, timeLabel } from './dates.js';
import { STAGE_STYLE } from './stages.js';

/** The legend doubles as the explanation of the states users must not confuse. */
export function Legend({ integrationsManual = true }) {
  const rows = [
    ['planned', 'Planned', 'A tentative slot. No reminder.'],
    ['scheduled', 'Scheduled reminder', 'CMS reminds you. It does not post.'],
    ['awaiting_confirmation', 'Ready to publish', 'Time has come: post it yourself, then confirm.'],
    ['published', 'Published', 'You confirmed it is live.'],
  ];
  return (
    <section aria-label="Legend" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map(([key, label, help]) => {
          const Icon = STAGE_STYLE[key].icon;
          return (
            <li key={key} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 inline-flex h-5 w-7 shrink-0 items-center justify-center rounded ${STAGE_STYLE[key].chip}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold text-slate-900">{label}</span>
                <span className="block text-slate-600">{help}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1"><Flag className="h-3.5 w-3.5 text-rose-600" aria-hidden /> Content deadline</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-4 rounded-sm border border-dotted border-violet-500 bg-violet-50" aria-hidden /> Planned date (no entry yet)</span>
        {integrationsManual && (
          <span className="inline-flex items-center gap-1">
            <Info className="h-3.5 w-3.5" aria-hidden /> CMS does not publish to Instagram, YouTube, TikTok or any other network. You publish, then confirm.
          </span>
        )}
      </p>
    </section>
  );
}

function Row({ children, to, onClick, draggablePost, canDrag }) {
  const cls = 'block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50';
  if (to) return <Link to={to} className={cls}>{children}</Link>;
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={!!(draggablePost && canDrag)}
      onDragStart={draggablePost && canDrag ? (e) => startDrag(e, draggablePost) : undefined}
      onDragEnd={draggablePost && canDrag ? endDrag : undefined}
      className={`${cls} ${draggablePost && canDrag ? 'cursor-grab' : ''}`}
    >
      {children}
    </button>
  );
}

const Group = ({ title, count, children }) => (
  <div>
    <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {title}
      {count > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-700">{count}</span>}
    </h3>
    {children}
  </div>
);

/** Deadlines in the next 14 days, entries that need action, upcoming reminders, and undated plans. */
export function UpcomingPanel({ state, canDrag, onOpenPost, onRetry }) {
  const body = () => {
    if (state.status === 'loading') return <div className="space-y-2" aria-hidden>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>;
    if (state.status === 'error') return <ErrorState title="Couldn’t load this panel" onRetry={onRetry} />;
    const d = state.data;
    const nothing = !d.deadlines.length && !d.overdueDeadlines && !d.needsAttention.length && !d.nextReminders.length && !d.unscheduled.length;
    if (nothing) return <EmptyState icon={Info} title="Nothing needs you right now" description="Deadlines, reminders and entries that need action will show up here." />;
    return (
      <div className="space-y-5">
        {d.needsAttention.length > 0 && (
          <Group title="Needs your attention" count={d.needsAttention.length}>
            <ul>
              {d.needsAttention.map((p) => (
                <li key={p.id}>
                  <Row onClick={() => onOpenPost(p)}>
                    <span className="flex items-center gap-1.5 font-medium text-amber-900"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{p.content?.title}</span>
                    <span className="block text-xs text-slate-600">{p.stage.label} · {platformLabel(p.platform)} · {p.localDate && shortDay(p.localDate)} {p.localTime && timeLabel(p.localTime)}</span>
                  </Row>
                </li>
              ))}
            </ul>
          </Group>
        )}
        {(d.deadlines.length > 0 || d.overdueDeadlines > 0) && (
          <Group title={`Deadlines · next ${d.windowDays} days`} count={d.deadlines.length}>
            {d.overdueDeadlines > 0 && (
              <p role="status" className="mb-1 rounded-lg bg-red-50 px-2 py-1.5 text-xs font-medium text-red-800">
                {d.overdueDeadlines} overdue deadline{d.overdueDeadlines === 1 ? '' : 's'} on unfinished content
              </p>
            )}
            <ul>
              {d.deadlines.map((c) => (
                <li key={c.contentId}>
                  <Row to={`/content/${c.contentId}`}>
                    <span className="flex items-center gap-1.5 font-medium text-slate-900"><Flag className="h-3.5 w-3.5 text-rose-600" aria-hidden />{c.title}</span>
                    <span className="block text-xs text-slate-600">{c.daysLeft === 0 ? 'Due today' : c.daysLeft === 1 ? 'Due tomorrow' : `Due in ${c.daysLeft} days`} · {shortDay(c.date)} · {c.statusLabel}</span>
                  </Row>
                </li>
              ))}
            </ul>
          </Group>
        )}
        {d.nextReminders.length > 0 && (
          <Group title="Next reminders · 7 days" count={d.nextReminders.length}>
            <ul>
              {d.nextReminders.map((p) => (
                <li key={p.id}>
                  <Row onClick={() => onOpenPost(p)} draggablePost={p} canDrag={canDrag}>
                    <span className="font-medium text-slate-900">{p.content?.title}</span>
                    <span className="block text-xs text-slate-600">{platformLabel(p.platform)} · {shortDay(p.localDate)} {timeLabel(p.localTime)}</span>
                  </Row>
                </li>
              ))}
            </ul>
          </Group>
        )}
        {d.unscheduled.length > 0 && (
          <Group title="Planned, no date yet" count={d.unscheduled.length}>
            <ul>
              {d.unscheduled.map((p) => (
                <li key={p.id}>
                  <Row onClick={() => onOpenPost(p)} draggablePost={p} canDrag={canDrag}>
                    <span className="font-medium text-slate-900">{p.content?.title}</span>
                    <span className="block text-xs text-slate-600">{platformLabel(p.platform)}{canDrag ? ' · drag onto a day to schedule' : ' · open to give it a date'}</span>
                  </Row>
                </li>
              ))}
            </ul>
          </Group>
        )}
      </div>
    );
  };
  return (
    <Card title="Needs you" description="Deadlines, reminders and entries that need action." className="h-fit">
      {body()}
    </Card>
  );
}
