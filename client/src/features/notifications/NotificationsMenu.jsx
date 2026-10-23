import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, CheckSquare, Flag, Handshake, Send } from 'lucide-react';
import { Button, EmptyState, ErrorState, Popover, Skeleton } from '../../components/ui/index.js';
import { notificationsApi } from '../calendar/api.js';
import { timeAgo } from '../dashboard/format.js';

const POLL_MS = 60_000;
const ICON = { post_reminder: BellRing, post_ready: Send, deadline_reminder: Flag, campaign_deadline: Flag, followup_reminder: Handshake, task_reminder: CheckSquare, task_overdue: CheckSquare };

/** In-app notifications (reminders, "time to publish", deadlines). Polls quietly; nothing is emailed or pushed. */
export default function NotificationsMenu() {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', items: [], unread: 0 });

  const load = useCallback(() => {
    notificationsApi
      .list({ limit: 15 })
      .then((r) => setState({ status: 'ready', items: r.data, unread: r.meta.unread }))
      .catch(() => setState((s) => (s.items.length ? s : { status: 'error', items: [], unread: 0 })));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function open(n, close) {
    close();
    if (!n.read) {
      setState((s) => ({ ...s, unread: Math.max(0, s.unread - 1), items: s.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }));
      notificationsApi.read(n.id).catch(load);
    }
    const target = {
      post: `/calendar?post=${n.entity.id}${n.localDate ? `&date=${n.localDate}` : ''}`,
      client: `/brands/${n.entity.id}`,
      campaign: `/campaigns/${n.entity.id}`,
      task: `/tasks?task=${n.entity.id}`,
    };
    navigate(target[n.entity.kind] ?? `/content/${n.entity.id}`);
  }

  async function readAll() {
    setState((s) => ({ ...s, unread: 0, items: s.items.map((x) => ({ ...x, read: true })) }));
    notificationsApi.readAll().catch(load);
  }

  return (
    <Popover
      width="w-96"
      trigger={({ toggle, open: isOpen }) => (
        <button
          onClick={() => {
            toggle();
            if (!isOpen) load();
          }}
          aria-label={state.unread ? `Notifications, ${state.unread} unread` : 'Notifications'}
          aria-expanded={isOpen}
          className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <Bell className="h-5 w-5" />
          {state.unread > 0 && (
            <span data-testid="unread-badge" className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {state.unread > 9 ? '9+' : state.unread}
            </span>
          )}
        </button>
      )}
    >
      {({ close }) => (
        <div>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {state.unread > 0 && (
              <Button variant="ghost" size="sm" onClick={readAll}>
                Mark all read
              </Button>
            )}
          </div>
          <div className="max-h-96 overflow-auto">
            {state.status === 'loading' ? (
              <div className="space-y-2 p-3" aria-hidden>
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : state.status === 'error' ? (
              <ErrorState title="Couldn’t load notifications" onRetry={load} />
            ) : state.items.length === 0 ? (
              <EmptyState icon={Bell} title="No notifications" description="Reminders for scheduled posts, content deadlines and brand follow-ups will appear here." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {state.items.map((n) => {
                  const Icon = ICON[n.type] ?? Bell;
                  return (
                    <li key={n.id}>
                      <button onClick={() => open(n, close)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${n.read ? '' : 'bg-brand-50/50'}`}>
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${n.read ? 'text-slate-400' : 'text-brand-600'}`} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm ${n.read ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title}</span>
                          {n.body && <span className="mt-0.5 block text-xs text-slate-600">{n.body}</span>}
                          <span className="mt-1 block text-xs text-slate-400">{timeAgo(n.createdAt)}</span>
                        </span>
                        {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Reminders appear in CMS only. No email or push notifications are set up.</p>
        </div>
      )}
    </Popover>
  );
}
