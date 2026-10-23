import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CheckSquare, LayoutList, Columns3, Plus, Search, SearchX, X } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Input, Select, Skeleton, useToast } from '../../components/ui/index.js';
import { campaignsApi } from '../campaigns/api.js';
import { clientsApi } from '../clients/api.js';
import { tasksApi } from './api.js';
import TaskDialog from './TaskDialog.jsx';
import { DueLabel, PriorityBadge, STATUS_ICON, StatusBadge } from './parts.jsx';

const FILTER_KEYS = ['q', 'status', 'priority', 'due', 'campaign', 'client', 'assignee', 'archived'];
const SORTS = [['due', 'Due date (soonest)'], ['-due', 'Due date (latest)'], ['priority', 'Priority (highest)'], ['-priority', 'Priority (lowest)'], ['title', 'Title A–Z'], ['-updatedAt', 'Recently updated'], ['-createdAt', 'Newest']];
const BOARD_COLUMNS = ['todo', 'doing', 'done'];
const DUE_TILES = [['overdue', 'Overdue', 'danger'], ['today', 'Due today', 'brand'], ['upcoming', 'Upcoming', 'neutral'], ['none', 'No due date', 'neutral']];

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The round checkbox: one click marks a task complete (or reopens it). */
function Check({ task, onToggle, busy }) {
  const Icon = STATUS_ICON[task.status];
  const done = task.status === 'done';
  return (
    <button
      type="button"
      disabled={busy || !!task.archivedAt}
      onClick={() => onToggle(task)}
      aria-label={done ? `Reopen “${task.title}”` : `Mark “${task.title}” complete`}
      aria-pressed={done}
      className={`shrink-0 rounded-full p-0.5 hover:bg-slate-100 disabled:opacity-40 ${done ? 'text-emerald-600' : 'text-slate-400 hover:text-emerald-600'}`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

function Links({ task }) {
  const { campaign, client, content } = task.links;
  const bits = [
    campaign && <Link key="c" to={`/campaigns/${campaign.id}`} className="hover:underline">{campaign.title}</Link>,
    !campaign && client && <Link key="b" to={`/brands/${client.id}`} className="hover:underline">{client.name}</Link>,
    content && <Link key="k" to={`/content/${content.id}`} className="hover:underline">{content.title}</Link>,
  ].filter(Boolean);
  if (!bits.length) return null;
  return <span className="truncate text-xs text-slate-500">{bits.reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}</span>;
}

function ListView({ rows, onOpen, onToggle, busyId }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
      {rows.map((t) => (
        <li key={t.id} className={`flex items-start gap-3 px-4 py-3 ${t.overdue ? 'bg-red-50/40' : ''}`}>
          <Check task={t} onToggle={onToggle} busy={busyId === t.id} />
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => onOpen(t)} className={`block max-w-full truncate text-left text-sm font-medium hover:text-brand-700 hover:underline ${t.status === 'done' || t.status === 'cancelled' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
              {t.title}
            </button>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <DueLabel task={t} />
              <Links task={t} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <PriorityBadge task={t} />
            {t.status !== 'todo' && <StatusBadge task={t} />}
            {t.archivedAt && <Badge>Archived</Badge>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function BoardView({ rows, statuses, onOpen, onToggle, onMove, busyId }) {
  const [over, setOver] = useState(null);
  const columns = useMemo(() => BOARD_COLUMNS.map((key) => ({ key, label: statuses.find((s) => s.key === key)?.label ?? key, tasks: rows.filter((t) => t.status === key) })), [rows, statuses]);
  const extra = rows.filter((t) => t.status === 'cancelled');
  if (extra.length) columns.push({ key: 'cancelled', label: 'Cancelled', tasks: extra });

  return (
    <div className={`grid gap-4 ${columns.length > 3 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
      {columns.map((col) => (
        <section
          key={col.key}
          aria-label={`${col.label} (${col.tasks.length})`}
          onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
          onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = e.dataTransfer.getData('text/task');
            const task = rows.find((t) => t.id === id);
            if (task && task.status !== col.key) onMove(task, col.key);
          }}
          className={`rounded-xl border bg-slate-50 p-3 ${over === col.key ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200'}`}
        >
          <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-700">{col.label} <Badge>{col.tasks.length}</Badge></h3>
          <ul className="space-y-2">
            {col.tasks.map((t) => (
              <li
                key={t.id}
                draggable={!t.archivedAt}
                onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)}
                className={`rounded-lg border bg-white p-3 shadow-sm ${t.overdue ? 'border-red-200' : 'border-slate-200'} ${busyId === t.id ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <Check task={t} onToggle={onToggle} busy={busyId === t.id} />
                  <button type="button" onClick={() => onOpen(t)} className={`min-w-0 flex-1 text-left text-sm font-medium hover:text-brand-700 ${t.status === 'done' || t.status === 'cancelled' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{t.title}</button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7">
                  <DueLabel task={t} />
                  <PriorityBadge task={t} />
                </div>
                <div className="mt-1 pl-7"><Links task={t} /></div>
                <label className="mt-2 block pl-7">
                  <span className="sr-only">Move “{t.title}” to</span>
                  <Select className="h-8 text-xs" value={t.status} disabled={busyId === t.id || !!t.archivedAt} onChange={(e) => onMove(t, e.target.value)}>
                    {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </Select>
                </label>
              </li>
            ))}
            {col.tasks.length === 0 && <li className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500">Drop a task here</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function TasksPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => Object.fromEntries(params.entries()), [params]);
  const view = query.view === 'board' ? 'board' : 'list';
  const [state, setState] = useState({ status: 'loading', data: [], meta: null, error: null });
  const [summary, setSummary] = useState(null);
  const [meta, setMeta] = useState({ statuses: [], priorities: [] });
  const [campaigns, setCampaigns] = useState([]);
  const [brands, setBrands] = useState([]);
  const [dialog, setDialog] = useState({ open: false, task: null, preset: undefined });
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState(query.q ?? '');
  const debounced = useDebounced(search);

  useEffect(() => {
    tasksApi.meta().then(setMeta).catch(() => {});
    campaignsApi.list({ limit: 100 }).then((r) => setCampaigns(r.data)).catch(() => {});
    clientsApi.list({ limit: 100 }).then((r) => setBrands(r.data)).catch(() => {});
  }, []);

  const update = useCallback(
    (changes) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, v));
        if (!('page' in changes)) next.delete('page');
        return next;
      }, { replace: true });
    },
    [setParams],
  );
  useEffect(() => {
    if ((query.q ?? '') !== debounced) update({ q: debounced });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  // The list is always requested without the view/new/task helper params.
  const apiQuery = useMemo(() => {
    const q = { ...query };
    for (const k of ['view', 'new', 'task', 'forCampaign', 'forClient', 'forContent']) delete q[k];
    if (view === 'board') {
      delete q.status;
      delete q.page;
      q.limit = 200;
    }
    return q;
  }, [query, view]);
  const queryKey = JSON.stringify(apiQuery);

  const loadSummary = useCallback(() => tasksApi.summary().then((r) => setSummary(r.data)).catch(() => {}), []);
  const load = useCallback(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: s.data.length ? 'refreshing' : 'loading', error: null }));
    tasksApi
      .list(JSON.parse(queryKey), ctrl.signal)
      .then((res) => setState({ status: 'ready', data: res.data, meta: res.meta, error: null }))
      .catch((err) => err.name !== 'AbortError' && setState((s) => ({ ...s, status: 'error', error: err })));
    return () => ctrl.abort();
  }, [queryKey]);
  useEffect(() => load(), [load]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const refresh = useCallback(() => { load(); loadSummary(); }, [load, loadSummary]);

  // ?new=1 (optionally with forCampaign / forClient / forContent) opens the new-task dialog; ?task=<id> opens that task (from a notification).
  useEffect(() => {
    if (query.new === '1') {
      setDialog({ open: true, task: null, preset: { campaign: query.forCampaign ?? '', client: query.forCampaign ? '' : query.forClient ?? '', content: query.forContent ?? '' } });
      update({ new: '', forCampaign: '', forClient: '', forContent: '' });
    } else if (query.task) {
      tasksApi.get(query.task).then((r) => setDialog({ open: true, task: r.data, preset: undefined })).catch((ex) => toast.error(ex.message));
      update({ task: '' });
    }
  }, [query.new, query.task]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(task) {
    setBusyId(task.id);
    try {
      await (task.status === 'done' ? tasksApi.reopen(task.id) : tasksApi.complete(task.id));
      toast.success(task.status === 'done' ? 'Task reopened' : 'Task completed');
      refresh();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusyId(null);
    }
  }
  async function move(task, to) {
    setBusyId(task.id);
    try {
      await tasksApi.move(task.id, to);
      refresh();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusyId(null);
    }
  }

  const hasFilters = FILTER_KEYS.some((k) => query[k]);
  const clear = () => {
    setSearch('');
    setParams(view === 'board' ? { view: 'board' } : {}, { replace: true });
  };
  const loading = state.status === 'loading';
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Tasks</h2>
          <p className="mt-1 text-sm text-slate-500">Things to do, with due dates and reminders. Link them to a campaign, brand or content.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm" role="group" aria-label="View">
            {[['list', 'List', LayoutList], ['board', 'Board', Columns3]].map(([key, text, Icon]) => (
              <button key={key} type="button" aria-pressed={view === key} onClick={() => update({ view: key === 'list' ? '' : key })} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm ${view === key ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                <Icon className="h-4 w-4" aria-hidden /> {text}
              </button>
            ))}
          </div>
          <Button icon={Plus} onClick={() => setDialog({ open: true, task: null, preset: undefined })}>New task</Button>
        </div>
      </div>

      {summary && (
        <section aria-label="Due overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {DUE_TILES.map(([key, text, tone]) => {
            const count = key === 'none' ? summary.counts.noDate : summary.counts[key];
            const active = query.due === key;
            return (
              <button key={key} type="button" aria-pressed={active} onClick={() => update({ due: active ? '' : key, status: '', archived: '' })} className={`rounded-xl border bg-white p-4 text-left shadow-sm hover:border-brand-500 ${active ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200'}`}>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{text}</p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${key === 'overdue' && count ? 'text-red-700' : 'text-slate-900'}`}>{count}</p>
                <p className="text-xs text-slate-500">{key === 'upcoming' ? `Next ${summary.upcomingDays} days` : tone === 'danger' && count ? 'Needs attention' : 'Open tasks'}</p>
              </button>
            );
          })}
        </section>
      )}

      <section aria-label="Filters" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search tasks" className="pl-9" placeholder="Search title and notes…" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
          </div>
          <Select className="col-span-2 lg:col-span-1" aria-label="Sort by" value={query.sort ?? 'due'} onChange={(e) => update({ sort: e.target.value === 'due' ? '' : e.target.value })}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </Select>
          {view === 'list' ? (
            <Select className="col-span-2 lg:col-span-1" aria-label="Status" value={query.status ?? ''} onChange={(e) => update({ status: e.target.value })}>
              <option value="">All statuses</option>
              <option value="todo,doing">Open (to do + doing)</option>
              {meta.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          ) : <div className="hidden lg:block" />}
          <Select aria-label="Priority" value={query.priority ?? ''} onChange={(e) => update({ priority: e.target.value })}>
            <option value="">Any priority</option>
            {meta.priorities.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </Select>
          <Select aria-label="Due" value={query.due ?? ''} onChange={(e) => update({ due: e.target.value })}>
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="none">No due date</option>
          </Select>
          <Select aria-label="Campaign" value={query.campaign ?? ''} onChange={(e) => update({ campaign: e.target.value })}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
          <Select aria-label="Brand" value={query.client ?? ''} onChange={(e) => update({ client: e.target.value })}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={query.archived === 'true'} onChange={(e) => update({ archived: e.target.checked ? 'true' : '' })} />
            Show archived
          </label>
          {hasFilters && <Button variant="ghost" icon={X} onClick={clear} className="justify-self-start">Clear filters</Button>}
        </div>
      </section>

      {state.status === 'error' ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><ErrorState title="Couldn’t load your tasks" message={state.error?.message} onRetry={load} /></div>
      ) : loading ? (
        <div className="space-y-2" aria-hidden>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : state.data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {hasFilters ? (
            <EmptyState icon={SearchX} title="No tasks match these filters" description="Try a different search, or clear the filters to see everything." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={CheckSquare} title="No tasks yet" description="Add a task with a due date and CMS will remind you, even when this page is closed." action={<Button icon={Plus} onClick={() => setDialog({ open: true, task: null, preset: undefined })}>Add your first task</Button>} />
          )}
        </div>
      ) : (
        <div className={state.status === 'refreshing' ? 'opacity-60 transition-opacity' : ''} aria-busy={state.status === 'refreshing'}>
          {view === 'board'
            ? <BoardView rows={state.data} statuses={meta.statuses} onOpen={(t) => setDialog({ open: true, task: t, preset: undefined })} onToggle={toggle} onMove={move} busyId={busyId} />
            : <ListView rows={state.data} onOpen={(t) => setDialog({ open: true, task: t, preset: undefined })} onToggle={toggle} busyId={busyId} />}
        </div>
      )}

      {state.meta && view === 'board' && state.meta.total > state.data.length && <p className="text-sm text-slate-500">Showing the first {state.data.length} of {state.meta.total} tasks. Use filters to narrow the board.</p>}
      {state.meta && view === 'list' && state.meta.pages > 1 && (
        <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p aria-live="polite">Page {state.meta.page} of {state.meta.pages} · {state.meta.total} tasks</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={state.meta.page <= 1} onClick={() => update({ page: String(state.meta.page - 1) })} aria-label="Previous page" />
            <Button variant="secondary" size="sm" icon={ChevronRight} disabled={state.meta.page >= state.meta.pages} onClick={() => update({ page: String(state.meta.page + 1) })} aria-label="Next page" />
          </div>
        </nav>
      )}

      <TaskDialog
        open={dialog.open}
        task={dialog.task}
        preset={dialog.preset}
        priorities={meta.priorities}
        onClose={closeDialog}
        onSaved={() => { closeDialog(); refresh(); }}
      />
    </div>
  );
}
