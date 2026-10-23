import { Link } from 'react-router-dom';
import { CheckSquare } from 'lucide-react';
import { Badge } from '../../components/ui/index.js';
import DashSection from './DashSection.jsx';
import { formatDate, formatTime } from './format.js';

const PRIORITY = { urgent: 'danger', high: 'warning' };

function List({ title, count, tone, items, empty, when }) {
  return (
    <div>
      <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} <Badge tone={tone}>{count}</Badge>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((t) => (
            <li key={t.id}>
              <Link to={`/tasks?task=${t.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
                <span className="min-w-0 truncate text-sm font-medium text-slate-900">{t.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {PRIORITY[t.priority] && <Badge tone={PRIORITY[t.priority]}>{t.priority === 'urgent' ? 'Urgent' : 'High'}</Badge>}
                  <span className="text-xs text-slate-500">{when(t)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {count > items.length && <p className="mt-1 text-xs text-slate-500">Showing {items.length} of {count}.</p>}
    </div>
  );
}

export default function TasksCard({ section, loading, definitions, timezone, onRetry }) {
  return (
    <DashSection
      title="Tasks"
      description="Overdue, due today and coming up."
      def={definitions?.tasksDueToday}
      section={section}
      loading={loading}
      onRetry={onRetry}
      viewAll={{ to: '/tasks', label: 'Tasks' }}
      isEmpty={(s) => s.dueTodayCount === 0 && s.overdueCount === 0 && s.upcomingCount === 0}
      empty={{ icon: CheckSquare, title: 'Nothing due, overdue or coming up', description: 'Tasks with a due date will show up here.' }}
    >
      {(s) => (
        <div className="space-y-5">
          <List title="Overdue" count={s.overdueCount} tone={s.overdueCount ? 'danger' : 'neutral'} items={s.overdue} empty="No overdue tasks." when={(t) => `was due ${formatDate(t.dueAt, timezone)}`} />
          <List title="Due today" count={s.dueTodayCount} tone="brand" items={s.dueToday} empty="Nothing else due today." when={(t) => (t.dueHasTime ? formatTime(t.dueAt, timezone) : 'all day')} />
          <List title="Upcoming" count={s.upcomingCount} tone="neutral" items={s.upcoming} empty="Nothing due in the next week." when={(t) => formatDate(t.dueAt, timezone)} />
        </div>
      )}
    </DashSection>
  );
}
