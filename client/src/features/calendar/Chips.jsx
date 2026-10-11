import { Flag, CalendarClock } from 'lucide-react';
import { platformLabel } from '../content/constants.js';
import { endDrag, startDrag } from './dnd.js';
import { MOVABLE, STAGE_STYLE } from './stages.js';
import { timeLabel } from './dates.js';

/** A calendar entry. Always a real <button> (keyboard and screen-reader friendly); draggable where the browser supports it. */
export function PostChip({ post, compact = false, canDrag, onOpen }) {
  const style = STAGE_STYLE[post.status] ?? STAGE_STYLE.planned;
  const Icon = style.icon;
  const movable = canDrag && MOVABLE.includes(post.status);
  const when = post.localTime ? timeLabel(post.localTime) : 'No time';
  const label = `${post.content?.title ?? 'Content'}, ${platformLabel(post.platform)}, ${post.stage.label}${post.localDate ? `, ${post.localDate} ${when}` : ''}`;
  const common = {
    type: 'button',
    draggable: movable,
    onDragStart: movable ? (e) => startDrag(e, post) : undefined,
    onDragEnd: movable ? endDrag : undefined,
    onClick: () => onOpen(post),
    'aria-label': label,
    title: `${post.stage.label}: ${post.stage.description}`,
    'data-testid': 'post-chip',
    'data-status': post.status,
  };
  const base = `w-full min-w-0 rounded-md px-1.5 py-1 text-left text-xs leading-tight ${style.chip} ${movable ? 'cursor-grab active:cursor-grabbing' : ''} hover:brightness-95`;
  if (compact) {
    // Month cells are narrow: time and platform share one line and the title gets its own, so it stays readable.
    return (
      <button {...common} className={`${base} block`}>
        <span className="flex items-center gap-1">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{when}</span>
          <span className="ml-auto min-w-0 truncate text-[10px] font-medium uppercase tracking-wide opacity-80">{platformLabel(post.platform)}</span>
        </span>
        <span className="mt-0.5 block truncate">{post.content?.title ?? 'Untitled'}</span>
      </button>
    );
  }
  return (
    <button {...common} className={`${base} flex items-center gap-1.5`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="shrink-0 font-medium tabular-nums">{when}</span>
      <span className="min-w-0 flex-1 truncate">{post.content?.title ?? 'Untitled'}</span>
      <span className="shrink-0 rounded bg-black/10 px-1 text-[10px] font-medium uppercase tracking-wide">{platformLabel(post.platform)}</span>
    </button>
  );
}

/** A content deadline: a date marker (no time of day). Links to the content. */
export function DeadlineChip({ item, onOpen, compact = false }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={`Deadline for “${item.title}” (${item.statusLabel})${item.done ? '. Already approved.' : ''}`}
      aria-label={`Deadline: ${item.title}, ${item.statusLabel}${item.done ? ', done' : ''}`}
      data-testid="deadline-chip"
      className={`w-full min-w-0 rounded-md border px-1.5 py-1 text-left text-xs leading-tight ${compact ? 'block' : 'flex items-center gap-1.5'} ${item.done ? 'border-slate-200 bg-slate-50 text-slate-500 line-through' : 'border-rose-300 bg-rose-50 text-rose-900'}`}
    >
      {compact ? (
        <>
          <span className="flex items-center gap-1">
            <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="font-semibold">Deadline</span>
          </span>
          <span className="mt-0.5 block truncate">{item.title}</span>
        </>
      ) : (
        <>
          <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="shrink-0 font-medium">Due</span>
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
        </>
      )}
    </button>
  );
}

/** A planned publication date on a content item that has no reminder yet. */
export function PlannedDateChip({ item, onOpen, compact = false }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={`“${item.title}” is planned for this date but has no calendar entry yet`}
      aria-label={`Planned date, no entry yet: ${item.title}`}
      data-testid="planned-date-chip"
      className={`w-full min-w-0 rounded-md border border-dotted border-violet-400 bg-violet-50/60 px-1.5 py-1 text-left text-xs leading-tight text-violet-900 ${compact ? 'block' : 'flex items-center gap-1.5'}`}
    >
      {compact ? (
        <>
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="font-semibold">Planned date</span>
          </span>
          <span className="mt-0.5 block truncate">{item.title}</span>
        </>
      ) : (
        <>
          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="shrink-0 font-medium">Plan</span>
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
        </>
      )}
    </button>
  );
}
