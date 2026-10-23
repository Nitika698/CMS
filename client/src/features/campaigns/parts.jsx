import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { Badge } from '../../components/ui/index.js';
import { formatDay } from '../content/dates.js';

export const STATUS_TONE = { proposed: 'neutral', negotiating: 'info', confirmed: 'brand', in_progress: 'brand', delivered: 'success', completed: 'success', cancelled: 'danger' };
export const DELIVERABLE_TONE = { pending: 'neutral', in_progress: 'info', completed: 'info', changes_requested: 'warning', submitted: 'warning', approved: 'success', delivered: 'success' };
export const DELIVERABLE_LABEL = { pending: 'Planned', in_progress: 'In progress', completed: 'Completed', changes_requested: 'Changes requested', submitted: 'Awaiting approval', approved: 'Approved', delivered: 'Published' };
/** Short verbs for the buttons that move a deliverable forward (or back). */
export const DELIVERABLE_ACTION = {
  pending: 'Back to planned', in_progress: 'Start work', completed: 'Mark completed', submitted: 'Send for approval',
  approved: 'Mark approved', changes_requested: 'Changes requested', delivered: 'Mark published',
};
export const label = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
export const ymdLabel = (ymd) => (ymd ? formatDay(`${ymd}T00:00:00Z`) : '—');

export function StatusBadge({ campaign }) {
  return <Badge tone={STATUS_TONE[campaign.status]}>{campaign.statusLabel}</Badge>;
}

export function DeliverableBadge({ status, text }) {
  return <Badge tone={DELIVERABLE_TONE[status]}>{text ?? DELIVERABLE_LABEL[status]}</Badge>;
}

const FLAG_STYLE = {
  danger: { icon: AlertCircle, cls: 'text-red-700' },
  warning: { icon: AlertTriangle, cls: 'text-amber-800' },
  info: { icon: Info, cls: 'text-sky-700' },
};

/** Warnings are always icon + words, never colour alone. */
export function Flags({ flags, compact = false }) {
  if (!flags?.length) return null;
  return (
    <ul className={compact ? 'space-y-0.5' : 'space-y-1.5'}>
      {flags.map((f) => {
        const { icon: Icon, cls } = FLAG_STYLE[f.severity] ?? FLAG_STYLE.info;
        return (
          <li key={f.code} className={`flex items-start gap-1.5 text-xs font-medium ${cls}`}>
            <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span><span className="sr-only">{f.severity}: </span>{f.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Progress is computed on the server from deliverable states. This only draws it. */
export function ProgressBar({ progress, showStages = false }) {
  const { percent, total, stages } = progress;
  return (
    <div className="min-w-[7rem]">
      <div className="flex items-center gap-2">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={total ? `${percent}% complete` : 'No deliverables yet'}
          className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
        >
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
        <span className="w-9 text-right text-xs font-medium tabular-nums text-slate-700">{total ? `${percent}%` : '—'}</span>
      </div>
      {showStages ? (
        <p className="mt-1 text-xs text-slate-500">
          {total === 0 ? 'No deliverables yet' : `${stages.planned} planned · ${stages.completed} completed · ${stages.approved} approved · ${stages.published} published`}
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-slate-500">{total ? `${stages.published}/${total} published` : 'No deliverables'}</p>
      )}
    </div>
  );
}
