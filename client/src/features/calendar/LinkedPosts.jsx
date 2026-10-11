import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus } from 'lucide-react';
import { Badge, Card, Skeleton } from '../../components/ui/index.js';
import { platformLabel } from '../content/constants.js';
import { postsApi } from './api.js';
import { shortDay, timeLabel } from './dates.js';

const TONE = { planned: 'neutral', scheduled: 'info', awaiting_confirmation: 'warning', published: 'success', missed: 'danger', failed: 'danger', cancelled: 'neutral' };

/** The calendar entries of ONE content item (the link back from content to calendar). */
export default function LinkedPosts({ contentId, archived, refreshKey = 0 }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  useEffect(() => {
    const ctrl = new AbortController();
    postsApi
      .forContent(contentId, ctrl.signal)
      .then((r) => setState({ status: 'ready', items: r.data }))
      .catch((e) => e.name !== 'AbortError' && setState({ status: 'error', items: [] }));
    return () => ctrl.abort();
  }, [contentId, refreshKey]);

  return (
    <Card
      title="Calendar"
      description="Where this content is planned or scheduled."
      action={
        !archived && (
          <Link to={`/calendar?newFor=${contentId}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
            <CalendarPlus className="h-4 w-4" aria-hidden /> Add
          </Link>
        )
      }
    >
      {state.status === 'loading' ? (
        <Skeleton className="h-10 w-full" />
      ) : state.status === 'error' ? (
        <p className="text-sm text-red-700">Couldn’t load calendar entries.</p>
      ) : state.items.length === 0 ? (
        <p className="text-sm text-slate-500">Not on the calendar yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100" data-testid="linked-posts">
          {state.items.map((p) => (
            <li key={p.id}>
              <Link to={`/calendar?post=${p.id}${p.localDate ? `&date=${p.localDate}` : ''}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900">{platformLabel(p.platform)}</span>
                  <span className="block text-xs text-slate-500">{p.localDate ? `${shortDay(p.localDate)} · ${timeLabel(p.localTime)}` : 'No date yet'}</span>
                </span>
                <Badge tone={TONE[p.status] ?? 'neutral'}>{p.stage.label}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
