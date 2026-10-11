import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { Button, ErrorState, Modal, Select, Skeleton, useToast } from '../../components/ui/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { contentApi } from '../content/api.js';
import { platformLabel } from '../content/constants.js';
import { useContentMeta } from '../content/useMeta.js';
import { calendarApi, postsApi } from './api.js';
import AgendaList from './AgendaList.jsx';
import { eachDay, longDay, rangeFor, rangeTitle, shiftAnchor, todayIn } from './dates.js';
import { useCanDrag, useMediaQuery } from './dnd.js';
import { MonthCompact, MonthGrid } from './MonthView.jsx';
import PostDialog from './PostDialog.jsx';
import { Legend, UpcomingPanel } from './SidePanels.jsx';
import TimeGrid from './TimeGrid.jsx';

const VIEWS = [['month', 'Month'], ['week', 'Week'], ['day', 'Day']];
const FILTERS = ['platform', 'category', 'campaign', 'status', 'contentStatus'];

function groupByDate(data) {
  const map = new Map();
  const at = (d) => map.get(d) ?? map.set(d, { posts: [], deadlines: [], planned: [] }).get(d);
  for (const p of data?.posts ?? []) if (p.localDate) at(p.localDate).posts.push(p);
  for (const d of data?.deadlines ?? []) at(d.date).deadlines.push(d);
  for (const d of data?.plannedDates ?? []) at(d.date).planned.push(d);
  for (const e of map.values()) e.posts.sort((a, b) => a.localTime.localeCompare(b.localTime));
  return map;
}

export default function CalendarPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const contentMeta = useContentMeta();
  const tz = user.timezone;
  const weekStartsOn = user.calendarPrefs?.weekStartsOn ?? 1;
  const canDrag = useCanDrag();
  const mobile = useMediaQuery('(max-width: 767px)');

  const [params, setParams] = useSearchParams();
  const today = todayIn(tz);
  const view = VIEWS.some(([k]) => k === params.get('view')) ? params.get('view') : 'month';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : today;
  const show = { deadlines: params.get('deadlines') !== '0', planned: params.get('planned') !== '0' };
  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? '']));
  const range = useMemo(() => rangeFor(view, anchor, weekStartsOn), [view, anchor, weekStartsOn]);

  const [state, setState] = useState({ status: 'loading', data: null, error: null, refreshing: false });
  const [upcoming, setUpcoming] = useState({ status: 'loading', data: null });
  const [calMeta, setCalMeta] = useState(null);
  const [integrations, setIntegrations] = useState(null);
  const [categories, setCategories] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [dialog, setDialog] = useState(null); // { mode, post?, preset? }
  const [selectedDay, setSelectedDay] = useState(anchor);
  const [conflict, setConflict] = useState(null); // a drag-and-drop move that needs "schedule anyway"
  const [busyMove, setBusyMove] = useState(false);

  const update = useCallback(
    (changes) => setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, v));
      return next;
    }, { replace: true }),
    [setParams],
  );

  useEffect(() => {
    calendarApi.meta().then(setCalMeta).catch(() => {});
    calendarApi.integrations().then((r) => setIntegrations(r.data)).catch(() => {});
    contentApi.categories().then((r) => setCategories(r.data)).catch(() => {});
    contentApi.campaigns().then((r) => setCampaigns(r.data)).catch(() => {});
  }, []);

  // ---- the visible range
  const queryKey = JSON.stringify([range, filters]);
  const load = useCallback(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: s.data ? 'ready' : 'loading', refreshing: !!s.data, error: null }));
    calendarApi
      .range({ from: range.from, to: range.to, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }, ctrl.signal)
      .then((data) => setState({ status: 'ready', data, error: null, refreshing: false }))
      .catch((error) => error.name !== 'AbortError' && setState((s) => ({ status: 'error', data: s.data, error, refreshing: false })));
    return () => ctrl.abort();
  }, [queryKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => load(), [load]);

  const loadUpcoming = useCallback(() => {
    calendarApi.upcoming().then((data) => setUpcoming({ status: 'ready', data })).catch(() => setUpcoming((s) => (s.data ? s : { status: 'error', data: null })));
  }, []);
  useEffect(() => loadUpcoming(), [loadUpcoming]);

  const refreshAll = () => {
    load();
    loadUpcoming();
  };

  // ---- deep links: /calendar?post=<id> opens an entry; /calendar?newFor=<contentId> starts a new one
  const handled = useRef(null);
  useEffect(() => {
    const postId = params.get('post');
    const newFor = params.get('newFor');
    const key = `${postId}|${newFor}`;
    if (handled.current === key || (!postId && !newFor)) return;
    handled.current = key;
    if (postId) postsApi.get(postId).then((r) => setDialog({ mode: 'edit', post: r.data })).catch(() => toast.error('That calendar entry could not be found.'));
    else setDialog({ mode: 'create', preset: { contentId: newFor, date: anchor } });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeDialog = () => {
    setDialog(null);
    handled.current = null;
    if (params.get('post') || params.get('newFor')) update({ post: '', newFor: '' });
  };

  const byDate = useMemo(() => groupByDate(state.data), [state.data]);
  const days = useMemo(() => eachDay(range.from, range.to), [range]);
  const hasFilters = FILTERS.some((k) => filters[k]);
  const entries = state.data ? state.data.posts.length : 0;

  const goto = (date, nextView) => update({ date, view: nextView ?? view });

  // ---- rescheduling by drag and drop (optimistic, with rollback)
  async function reschedule(item, target, { confirmConflict = false } = {}) {
    const time = target.time ?? item.localTime ?? '09:00';
    const scheduledLocal = `${target.date}T${time}`;
    if (scheduledLocal === item.scheduledLocal) return;

    const before = state.data;
    setState((s) => ({
      ...s,
      data: {
        ...s.data,
        posts: s.data.posts.some((p) => p.id === item.id)
          ? s.data.posts.map((p) => (p.id === item.id ? { ...p, localDate: target.date, localTime: time, scheduledLocal } : p))
          : [...s.data.posts, { ...item, localDate: target.date, localTime: time, scheduledLocal }],
      },
    }));
    setBusyMove(true);
    try {
      const res = await postsApi.update(item.id, { scheduledLocal, version: item.version, ...(confirmConflict && { confirmConflict: true }) });
      setConflict(null);
      toast.success(res.data.status !== item.status && res.data.status === 'scheduled' ? 'Rescheduled. It is a scheduled reminder again.' : `Moved to ${target.date} at ${time}`);
      res.warnings?.forEach((w) => toast.success(w.message));
      refreshAll();
    } catch (ex) {
      setState((s) => ({ ...s, data: before })); // roll back the optimistic move
      if (ex.code === 'SCHEDULE_CONFLICT') setConflict({ item, target, details: ex.body.error.details });
      else if (ex.code === 'STALE_VERSION' || ex.code === 'CONFLICT') {
        toast.error('That entry was changed elsewhere. The calendar has been refreshed; try again.');
        refreshAll();
      } else toast.error(ex.body?.error?.details?.[0]?.message ?? ex.message);
    } finally {
      setBusyMove(false);
    }
  }

  function afterSave(post, opts = {}) {
    if (opts.silent) return refreshAll();
    setDialog(null);
    handled.current = null;
    if (params.get('post') || params.get('newFor')) update({ post: '', newFor: '' });
    if (post?.localDate && post.localDate < range.from || post?.localDate > range.to) goto(post.localDate);
    refreshAll();
  }

  const openPost = (post) => setDialog({ mode: 'edit', post });
  const openContent = (item) => navigate(`/content/${item.contentId}`);
  const newOn = (date, time) => setDialog({ mode: 'create', preset: { date, time } });

  const loading = state.status === 'loading';
  const gridProps = { today, byDate, show, onOpenPost: openPost, onOpenContent: openContent };

  const body = () => {
    if (state.status === 'error' && !state.data) return <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><ErrorState title="Couldn’t load the calendar" message={state.error?.message} onRetry={load} /></div>;
    if (loading) return <Skeleton className="h-[32rem] w-full" />;
    if (mobile) {
      if (view === 'month') {
        const sel = days.includes(selectedDay) ? selectedDay : anchor;
        return (
          <div className="space-y-3">
            <MonthCompact range={range} anchorMonth={anchor.slice(0, 7)} today={today} selected={sel} byDate={byDate} show={show} weekStartsOn={weekStartsOn} onSelect={setSelectedDay} />
            <AgendaList days={[sel]} {...gridProps} onNewOn={(d) => newOn(d)} />
          </div>
        );
      }
      return <AgendaList days={days} {...gridProps} onNewOn={(d) => newOn(d)} />;
    }
    if (view === 'month') {
      return <MonthGrid range={range} anchorMonth={anchor.slice(0, 7)} canDrag={canDrag} weekStartsOn={weekStartsOn} {...gridProps} onNewOn={(d) => newOn(d)} onOpenDay={(d) => goto(d, 'day')} onDropTo={(item, t) => reschedule(item, t)} />;
    }
    return <TimeGrid days={days} canDrag={canDrag} {...gridProps} onNewAt={newOn} onDropTo={(item, t) => reschedule(item, t)} />;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Calendar</h2>
          <p className="mt-1 text-sm text-slate-500">Plan and schedule reminders for your content. Times are in {tz}.</p>
        </div>
        <Button icon={Plus} onClick={() => newOn(view === 'month' ? (anchor.slice(0, 7) === today.slice(0, 7) ? today : anchor) : anchor)}>
          New entry
        </Button>
      </div>

      <Legend />

      {/* ---- navigation and view switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={ChevronLeft} aria-label={`Previous ${view}`} onClick={() => goto(shiftAnchor(view, anchor, -1))} />
          <Button variant="secondary" size="sm" onClick={() => goto(today)}>Today</Button>
          <Button variant="secondary" size="sm" icon={ChevronRight} aria-label={`Next ${view}`} onClick={() => goto(shiftAnchor(view, anchor, 1))} />
          <h3 className="ml-2 text-lg font-semibold text-slate-900" aria-live="polite" data-testid="range-title">{rangeTitle(view, anchor, weekStartsOn)}</h3>
          {state.refreshing && <span className="text-xs text-slate-500">Updating…</span>}
        </div>
        <div role="tablist" aria-label="Calendar view" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          {VIEWS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={view === key} onClick={() => update({ view: key === 'month' ? '' : key })} className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === key ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ---- filters */}
      <section aria-label="Filters" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Select aria-label="Platform" value={filters.platform} onChange={(e) => update({ platform: e.target.value })}>
            <option value="">All platforms</option>
            {contentMeta?.platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
          </Select>
          <Select aria-label="Category" value={filters.category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="Campaign" value={filters.campaign} onChange={(e) => update({ campaign: e.target.value })}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
          <Select aria-label="Entry state" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">Any entry state</option>
            {calMeta?.postStatuses.map((s) => <option key={s.status} value={s.status}>{s.label}</option>)}
          </Select>
          <Select aria-label="Content status" value={filters.contentStatus} onChange={(e) => update({ contentStatus: e.target.value })}>
            <option value="">Any content status</option>
            {calMeta?.contentStatuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700">
          <label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={show.deadlines} onChange={(e) => update({ deadlines: e.target.checked ? '' : '0' })} /> Show deadlines</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={show.planned} onChange={(e) => update({ planned: e.target.checked ? '' : '0' })} /> Show planned dates</label>
          {hasFilters && <Button variant="ghost" size="sm" icon={X} onClick={() => update(Object.fromEntries(FILTERS.map((k) => [k, ''])))}>Clear filters</Button>}
          {state.data && <span className="ml-auto text-xs text-slate-500" data-testid="entry-count">{entries} entr{entries === 1 ? 'y' : 'ies'} in view</span>}
        </div>
      </section>

      {upcoming.data && (upcoming.data.needsAttention.length > 0 || upcoming.data.overdueDeadlines > 0) && (
        <a href="#needs-you" role="status" data-testid="attention-banner" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 hover:bg-amber-100 2xl:hidden">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-medium">
            {[
              upcoming.data.needsAttention.length > 0 && `${upcoming.data.needsAttention.length} entr${upcoming.data.needsAttention.length === 1 ? 'y needs' : 'ies need'} your attention`,
              upcoming.data.overdueDeadlines > 0 && `${upcoming.data.overdueDeadlines} overdue deadline${upcoming.data.overdueDeadlines === 1 ? '' : 's'}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="underline">See details below</span>
        </a>
      )}

      {state.data && entries === 0 && !loading && (
        <p role="status" className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
          {hasFilters ? 'No entries match these filters in this period.' : 'Nothing is scheduled in this period yet. Click a day, or use New entry, to plan something.'}
        </p>
      )}

      <div className="grid gap-4 2xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0">{body()}</div>
        <div id="needs-you" className="min-w-0">
          <UpcomingPanel state={upcoming} canDrag={canDrag && !mobile} onOpenPost={openPost} onRetry={loadUpcoming} />
        </div>
      </div>

      <PostDialog
        open={!!dialog}
        mode={dialog?.mode}
        post={dialog?.post}
        preset={dialog?.preset}
        user={user}
        calMeta={calMeta}
        integrations={integrations}
        onClose={closeDialog}
        onSaved={afterSave}
      />

      <Modal
        open={!!conflict}
        onClose={() => !busyMove && setConflict(null)}
        title="Schedule anyway?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflict(null)} disabled={busyMove}>Keep it where it was</Button>
            <Button onClick={() => reschedule(conflict.item, conflict.target, { confirmConflict: true })} loading={busyMove}>Schedule anyway</Button>
          </>
        }
      >
        {conflict && (
          <div className="space-y-2 text-sm text-slate-700">
            <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden /> Moving “{conflict.item.content?.title}” to {longDay(conflict.target.date)} puts it close to:</p>
            <ul className="list-disc pl-9">
              {conflict.details.conflicts.map((c) => <li key={c.postId}>“{c.title}” ({c.minutesApart} min apart)</li>)}
            </ul>
            <p className="text-xs text-slate-500">Posts on one platform less than {conflict.details.windowMinutes} minutes apart need your confirmation.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
