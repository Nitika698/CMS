import { Link } from 'react-router-dom';
import { Badge, Skeleton } from '../../components/ui/index.js';
import { formatCount, formatMoney } from './format.js';

function Tile({ to, label, unit, section, loading, children }) {
  let body;
  if (loading || !section) {
    body = (
      <>
        <Skeleton className="h-8 w-16" />
        <Skeleton className="mt-2 h-4 w-28" />
      </>
    );
  } else if (section.state === 'unavailable') {
    body = (
      <>
        <p className="text-sm font-medium text-slate-500">Not available yet</p>
        <div className="mt-1">
          <Badge tone="warning">{section.phase}</Badge>
        </div>
      </>
    );
  } else if (section.state === 'error') {
    body = <p className="text-sm text-red-600">Couldn’t load</p>;
  } else {
    body = children(section);
  }
  return (
    <Link
      to={to}
      className="group block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-500 focus-visible:border-brand-500"
    >
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <div className="mt-2 min-h-[3.25rem]">{body}</div>
      <p className="mt-2 text-xs text-slate-500">{unit}</p>
    </Link>
  );
}

const Big = ({ children }) => <p className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{children}</p>;
const Sub = ({ children, tone }) => <p className={`mt-0.5 text-sm ${tone === 'danger' ? 'font-medium text-red-700' : 'text-slate-500'}`}>{children}</p>;

export default function SummaryCards({ sections, loading }) {
  const s = sections ?? {};
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Tile to="/content" label="Content in pipeline" unit="Count · items now" section={s.contentPipeline} loading={loading}>
        {(c) => (
          <>
            <Big>{formatCount(c.total)}</Big>
            <Sub>{formatCount(c.stages.find((x) => x.key === 'ready')?.count ?? 0)} ready</Sub>
          </>
        )}
      </Tile>
      <Tile to="/calendar" label="Upcoming posts" unit={`Count · next ${s.upcomingPosts?.windowDays ?? 14} days`} section={s.upcomingPosts} loading={loading}>
        {(c) => (
          <>
            <Big>{formatCount(c.count)}</Big>
            <Sub tone={c.needsConfirmation ? 'danger' : undefined}>{c.needsConfirmation ? `${c.needsConfirmation} need confirmation` : 'reminders set'}</Sub>
          </>
        )}
      </Tile>
      <Tile to="/campaigns" label="Active campaigns" unit="Count · confirmed or in progress" section={s.campaigns} loading={loading}>
        {(c) => (
          <>
            <Big>{formatCount(c.activeCount)}</Big>
            <Sub>{formatCount(c.deadlineCount)} deadline{c.deadlineCount === 1 ? '' : 's'} soon</Sub>
          </>
        )}
      </Tile>
      <Tile to="/tasks" label="Tasks due today" unit="Count · today, your timezone" section={s.tasks} loading={loading}>
        {(c) => (
          <>
            <Big>{formatCount(c.dueTodayCount)}</Big>
            <Sub tone={c.overdueCount ? 'danger' : undefined}>{formatCount(c.overdueCount)} overdue</Sub>
          </>
        )}
      </Tile>
      <Tile to="/campaigns" label="Pending reviews" unit="Count · awaiting client" section={s.reviews} loading={loading}>
        {(c) => (
          <>
            <Big>{formatCount(c.count)}</Big>
            <Sub>{c.items[0] ? `oldest ${c.items[0].waitingDays}d` : 'none waiting'}</Sub>
          </>
        )}
      </Tile>
      <Tile to="/payments" label="Outstanding" unit="Amount · invoiced, unpaid" section={s.payments} loading={loading}>
        {(c) =>
          c.currencies.length === 0 ? (
            <Sub>No invoices yet</Sub>
          ) : (
            <div className="space-y-0.5">
              {c.currencies.slice(0, 2).map((x) => (
                <p key={x.currency} className="text-xl font-semibold tabular-nums leading-tight text-slate-900">
                  {formatMoney(x.outstanding, x.currency)}
                </p>
              ))}
              {c.currencies.length > 2 && <Sub>+{c.currencies.length - 2} more currencies</Sub>}
            </div>
          )
        }
      </Tile>
    </div>
  );
}
