import { Link } from 'react-router-dom';
import { ArrowRight, Hourglass } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/index.js';

const KIND = { count: 'Count', amount: 'Amount', duration: 'Days' };

/** "Count · next 14 days" — states what the number is and the period it covers. */
export function MetricTag({ def }) {
  if (!def) return null;
  return (
    <span className="inline-block max-w-full rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
      {KIND[def.kind]} · {def.period}
    </span>
  );
}

/** Native <details>: keyboard accessible, no JS, shows the exact calculation. */
export function Definition({ def }) {
  if (!def) return null;
  return (
    <details className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
      <summary className="cursor-pointer select-none font-medium text-slate-600 hover:text-slate-900">How is this calculated?</summary>
      <p className="mt-2 leading-relaxed">{def.text}</p>
    </details>
  );
}

export function UnavailableState({ section }) {
  return (
    <EmptyState
      icon={Hourglass}
      title="Not available yet"
      description={`This needs the ${section.label} module, which hasn't been built yet. Nothing is shown rather than a made-up zero.`}
      action={<Badge tone="warning">{section.phase}</Badge>}
    />
  );
}

export function SectionSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/**
 * One dashboard card with all four states handled in one place:
 * loading skeleton | unavailable module | failed section | empty | content.
 */
export default function DashSection({ title, description, def, section, loading, isEmpty, empty, viewAll, onRetry, children, className = '' }) {
  let body;
  if (loading || !section) body = <SectionSkeleton />;
  else if (section.state === 'unavailable') body = <UnavailableState section={section} />;
  else if (section.state === 'error') body = <ErrorState title="Couldn't load this section" message="The rest of the dashboard is unaffected." onRetry={onRetry} />;
  else if (isEmpty?.(section)) body = <EmptyState {...empty} />;
  else body = children(section);

  return (
    <Card
      className={className}
      title={title}
      description={description}
      action={
        viewAll && (
          <Link to={viewAll.to} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
            {viewAll.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )
      }
    >
      {section?.state === 'ok' && def && (
        <div className="-mt-1 mb-3">
          <MetricTag def={def} />
        </div>
      )}
      {body}
      {section?.state === 'ok' && !isEmpty?.(section) && <Definition def={def} />}
    </Card>
  );
}
