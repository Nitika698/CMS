import { AlertTriangle, Inbox, Loader2, Info } from 'lucide-react';
import Button from './Button.jsx';
import Badge from './Badge.jsx';

export function Spinner({ label = 'Loading…', className = '' }) {
  return (
    <div role="status" className={`flex items-center gap-2 text-sm text-slate-500 ${className}`}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-slate-200 ${className}`} />;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-3 rounded-full bg-red-50 p-3 text-red-600">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Marks a screen or section whose functionality has not been built yet. */
export function PlaceholderBanner({ phase, children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="flex flex-wrap items-center gap-2 font-medium">
          Placeholder — not implemented yet
          {phase && <Badge tone="warning">{phase}</Badge>}
        </p>
        <p className="mt-1 text-amber-800">
          {children ?? 'This screen has no functionality yet. Nothing here is saved, and no data is shown.'}
        </p>
      </div>
    </div>
  );
}
