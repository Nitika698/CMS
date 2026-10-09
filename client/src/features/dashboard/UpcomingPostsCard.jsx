import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { Badge } from '../../components/ui/index.js';
import DashSection from './DashSection.jsx';
import { formatDateTime } from './format.js';

export default function UpcomingPostsCard({ section, loading, definition, timezone, onRetry }) {
  return (
    <DashSection
      title="Upcoming scheduled posts"
      description="Posts you’ve planned to publish."
      def={definition}
      section={section}
      loading={loading}
      onRetry={onRetry}
      viewAll={{ to: '/calendar', label: 'Calendar' }}
      isEmpty={(s) => s.count === 0 && s.needsConfirmation === 0}
      empty={{
        icon: CalendarDays,
        title: 'Nothing scheduled in the next 14 days',
        description: 'Schedule a post from the Calendar to be reminded when it’s time to publish.',
      }}
    >
      {(s) => (
        <>
          {s.needsConfirmation > 0 && (
            <div role="status" className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="shrink-0 whitespace-nowrap">
                <Badge tone="warning" dot>Needs confirmation</Badge>
              </span>
              <span>
                {s.needsConfirmation} post{s.needsConfirmation === 1 ? ' is' : 's are'} past their time and not yet confirmed as published.
              </span>
            </div>
          )}
          {s.items.length === 0 ? (
            <p className="text-sm text-slate-500">No posts scheduled in the next {s.windowDays} days.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {s.items.map((p) => (
                <li key={p.id}>
                  <Link to="/calendar" className="flex items-center justify-between gap-3 py-2.5 hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{p.contentTitle}</span>
                      <span className="block text-xs text-slate-500">{formatDateTime(p.scheduledAt, timezone)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone="brand">{p.platform}</Badge>
                      <span className="text-xs text-slate-500">Reminder only</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {s.count > s.items.length && <p className="mt-2 text-xs text-slate-500">Showing {s.items.length} of {s.count}.</p>}
        </>
      )}
    </DashSection>
  );
}
