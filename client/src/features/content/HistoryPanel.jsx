import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { Button, EmptyState, ErrorState, Skeleton } from '../../components/ui/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { contentApi } from './api.js';
import { platformLabel } from './constants.js';
import { formatDay, formatInstant } from './dates.js';

const FIELD_LABEL = {
  title: 'title', type: 'type', category: 'category', campaign: 'campaign', platforms: 'platforms', plannedDate: 'planned date', deadline: 'deadline',
  description: 'description', caption: 'caption', brief: 'brief', tags: 'tags', hashtags: 'hashtags', publishedAt: 'publication time',
};
const DATE_FIELDS = ['plannedDate', 'deadline'];

function show(field, v) {
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return 'none';
  if (DATE_FIELDS.includes(field)) return formatDay(v);
  if (field === 'platforms') return v.map(platformLabel).join(', ');
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/** One plain-English sentence per event. Long text edits say THAT they changed, never what the text was. */
function Line({ e, statusLabel, tz }) {
  switch (e.type) {
    case 'created':
      return <>Created this content</>;
    case 'status_changed':
      return (
        <>
          Moved from <b>{statusLabel(e.from)}</b> to <b>{statusLabel(e.to)}</b>
        </>
      );
    case 'approved':
      return <>Approved</>;
    case 'changes_requested':
      return (
        <>
          Requested changes, back to <b>{statusLabel(e.to)}</b> (revision {e.revision})
        </>
      );
    case 'comment':
      return <>Added a comment</>;
    case 'asset_added':
      return <>Added file {e.comment ? <b>{e.comment}</b> : null}</>;
    case 'asset_removed':
      return <>Removed file {e.comment ? <b>{e.comment}</b> : null}</>;
    case 'post_created':
      return <>Added a {platformLabel(e.comment)} entry to the calendar ({e.to === 'scheduled' ? 'scheduled reminder' : 'planned'})</>;
    case 'post_rescheduled':
      return (
        <>
          Rescheduled the {platformLabel(e.comment)} entry
          {e.fields[0] && <span className="text-slate-500"> ({e.fields[0].from ? formatInstant(e.fields[0].from, tz) : 'no date'} → {e.fields[0].to ? formatInstant(e.fields[0].to, tz) : 'no date'})</span>}
        </>
      );
    case 'post_status_changed':
      return (
        <>
          {platformLabel(e.comment?.split(' ')[0])} calendar entry: <b>{e.from}</b> → <b>{e.to}</b>
        </>
      );
    case 'archived':
      return <>Archived</>;
    case 'restored':
      return <>Restored from archive</>;
    case 'updated':
      return (
        <>
          Edited{' '}
          {e.fields.map((f, i) => (
            <span key={f.field}>
              {i > 0 && ', '}
              <b>{FIELD_LABEL[f.field] ?? f.field}</b>
              {'to' in f && f.field !== 'category' && f.field !== 'campaign' && (
                <span className="text-slate-500">
                  {' '}
                  ({show(f.field, f.from)} → {show(f.field, f.to)})
                </span>
              )}
            </span>
          ))}
        </>
      );
    default:
      return <>{e.type}</>;
  }
}

export default function HistoryPanel({ content, meta, refreshKey }) {
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'loading', items: [], next: null, more: false, loadingMore: false });
  const statusLabel = (k) => meta?.statuses.find((s) => s.key === k)?.label ?? k;

  const load = useCallback(() => {
    const ctrl = new AbortController();
    contentApi
      .history(content.id, { limit: 20 }, ctrl.signal)
      .then((r) => setState({ status: 'ready', items: r.data, next: r.meta.next, more: r.meta.hasMore, loadingMore: false }))
      .catch((e) => e.name !== 'AbortError' && setState((s) => ({ ...s, status: 'error' })));
    return () => ctrl.abort();
  }, [content.id]);
  useEffect(() => load(), [load, refreshKey]);

  async function more() {
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const r = await contentApi.history(content.id, { limit: 20, before: state.next });
      setState((s) => ({ ...s, items: [...s.items, ...r.data], next: r.meta.next, more: r.meta.hasMore, loadingMore: false }));
    } catch {
      setState((s) => ({ ...s, loadingMore: false }));
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="space-y-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <ErrorState title="Couldn’t load history" onRetry={load} />
      </div>
    );
  }
  if (!state.items.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <EmptyState icon={History} title="No history yet" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
        {state.items.map((e) => (
          <li key={e.id} className="px-4 py-3">
            <p className="text-sm text-slate-800">
              <Line e={e} statusLabel={statusLabel} tz={user.timezone} />
            </p>
            {e.comment && ['status_changed', 'approved', 'changes_requested'].includes(e.type) && (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">“{e.comment}”</p>
            )}
            <p className="mt-0.5 text-xs text-slate-500">{formatInstant(e.createdAt, user.timezone)}</p>
          </li>
        ))}
      </ol>
      {state.more && (
        <div className="text-center">
          <Button variant="secondary" size="sm" onClick={more} loading={state.loadingMore}>
            Load older activity
          </Button>
        </div>
      )}
    </div>
  );
}
