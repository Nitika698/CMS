import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, Plus } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Skeleton, useToast } from '../../components/ui/index.js';
import { tasksApi } from './api.js';
import { DueLabel, PriorityBadge } from './parts.jsx';

/** Open tasks linked to one campaign, brand or content item, with one-click completion. kind: 'campaign' | 'client' | 'content'. */
export default function LinkedTasks({ kind, id, title = 'Tasks' }) {
  const toast = useToast();
  const [state, setState] = useState({ status: 'loading', rows: [], total: 0, error: null });
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    const ctrl = new AbortController();
    tasksApi
      .list({ [kind]: id, open: 'true', limit: 20 }, ctrl.signal)
      .then((r) => setState({ status: 'ready', rows: r.data, total: r.meta.total, error: null }))
      .catch((err) => err.name !== 'AbortError' && setState((s) => ({ ...s, status: 'error', error: err })));
    return () => ctrl.abort();
  }, [kind, id]);
  useEffect(() => load(), [load]);

  async function complete(task) {
    setBusy(task.id);
    try {
      await tasksApi.complete(task.id);
      toast.success('Task completed');
      load();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusy(null);
    }
  }

  const param = { campaign: 'forCampaign', client: 'forClient', content: 'forContent' }[kind];
  const add = (
    <Link to={`/tasks?new=1&${param}=${id}`}>
      <Button size="sm" variant="secondary" icon={Plus} tabIndex={-1}>Add task</Button>
    </Link>
  );

  return (
    <Card title={title} description="Open tasks linked here." action={add}>
      {state.status === 'loading' ? (
        <Skeleton className="h-16 w-full" />
      ) : state.status === 'error' ? (
        <ErrorState title="Couldn’t load tasks" message={state.error?.message} onRetry={load} />
      ) : state.rows.length === 0 ? (
        <EmptyState icon={CheckSquare} title="No open tasks" description="Add a task with a due date and CMS will remind you." />
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {state.rows.map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-2.5">
                <input type="checkbox" className="mt-1 h-4 w-4 rounded border-slate-300" disabled={busy === t.id} checked={false} onChange={() => complete(t)} aria-label={`Mark “${t.title}” complete`} />
                <div className="min-w-0 flex-1">
                  <Link to={`/tasks?task=${t.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700 hover:underline">{t.title}</Link>
                  <DueLabel task={t} />
                </div>
                <PriorityBadge task={t} />
              </li>
            ))}
          </ul>
          {state.total > state.rows.length && (
            <p className="mt-2 text-xs text-slate-500">Showing {state.rows.length} of {state.total}. <Link to={`/tasks?${kind}=${id}`} className="font-medium text-brand-700 hover:underline">See all</Link></p>
          )}
        </>
      )}
    </Card>
  );
}
