import { AlertCircle, CalendarClock, CheckCircle2, Circle, CircleDashed, CircleDot, XCircle } from 'lucide-react';
import { Badge } from '../../components/ui/index.js';
import { daysLabel } from '../dashboard/format.js';

export const STATUS_TONE = { todo: 'neutral', doing: 'info', done: 'success', cancelled: 'neutral' };
export const STATUS_ICON = { todo: Circle, doing: CircleDot, done: CheckCircle2, cancelled: XCircle };
export const PRIORITY_TONE = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' };

/** The lead times offered when setting reminders (minutes before the due moment; before the END of the day for date-only tasks). */
export const REMINDER_CHOICES = [
  { value: 0, label: 'When it is due' },
  { value: 15, label: '15 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 180, label: '3 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
  { value: 10080, label: '1 week before' },
];

export const reminderLabel = (minutes) => REMINDER_CHOICES.find((c) => c.value === minutes)?.label ?? `${minutes} minutes before`;

const dayFmt = (ymd) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${ymd}T00:00:00Z`));
const timeFmt = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
};

export const dueText = (t) => (t.dueDate ? `${dayFmt(t.dueDate)}${t.dueTime ? `, ${timeFmt(t.dueTime)}` : ''}` : 'No due date');

/** Overdue and due-today are words as well as colours. */
export function DueLabel({ task, className = '' }) {
  if (!task.dueDate) return <span className={`text-xs text-slate-400 ${className}`}>No due date</span>;
  const open = task.status === 'todo' || task.status === 'doing';
  if (task.overdue) {
    const days = -task.daysUntilDue;
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium text-red-700 ${className}`}>
        <AlertCircle className="h-3.5 w-3.5" aria-hidden /> Overdue · {dueText(task)}{days > 1 ? ` (${days} days)` : ''}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${open && task.dueState === 'today' ? 'font-medium text-amber-800' : 'text-slate-500'} ${className}`}>
      <CalendarClock className="h-3.5 w-3.5" aria-hidden />
      {open && task.dueState === 'today' ? `Due today${task.dueTime ? `, ${timeFmt(task.dueTime)}` : ''}` : dueText(task)}
      {open && task.dueState === 'upcoming' && task.daysUntilDue <= 7 ? ` · ${daysLabel(task.daysUntilDue)}` : ''}
    </span>
  );
}

export const PriorityBadge = ({ task }) => (task.priority === 'normal' ? null : <Badge tone={PRIORITY_TONE[task.priority]}>{task.priorityLabel}</Badge>);

export const StatusBadge = ({ task }) => <Badge tone={STATUS_TONE[task.status]}>{task.statusLabel}</Badge>;

export { CircleDashed };
