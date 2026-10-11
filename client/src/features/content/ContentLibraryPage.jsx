import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Clapperboard, Image, Plus, Search, SearchX, X } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Input, Select, Skeleton, Table } from '../../components/ui/index.js';
import { contentApi } from './api.js';
import { platformLabel, SORT_OPTIONS, typeLabel } from './constants.js';
import { formatDay } from './dates.js';
import StatusBadge from './StatusBadge.jsx';
import { useContentMeta } from './useMeta.js';

const FILTER_KEYS = ['q', 'status', 'type', 'platform', 'category', 'campaign', 'archived'];

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Pagination({ meta, onPage, onLimit, disabled }) {
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.total, meta.page * meta.limit);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <p aria-live="polite">
        {from}–{to} of {meta.total}
      </p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Per page</span>
          <select value={meta.limit} onChange={(e) => onLimit(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm">
            {[10, 20, 50].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={disabled || meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page" />
        <span className="tabular-nums">
          Page {meta.page} of {meta.pages}
        </span>
        <Button variant="secondary" size="sm" icon={ChevronRight} disabled={disabled || meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)} aria-label="Next page" />
      </div>
    </nav>
  );
}

function DeadlineCell({ item }) {
  if (!item.deadline) return <span className="text-slate-400">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${item.isOverdue ? 'font-medium text-red-700' : ''}`}>
      {item.isOverdue && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
      {formatDay(item.deadline)}
      {item.isOverdue && <span className="sr-only"> (overdue)</span>}
    </span>
  );
}

function TitleCell({ item }) {
  return (
    <div className="min-w-0">
      <Link to={`/content/${item.id}`} className="block truncate font-medium text-slate-900 hover:text-brand-700 hover:underline">
        {item.title}
      </Link>
      {item.tags.length > 0 && <p className="mt-0.5 truncate text-xs text-slate-500">{item.tags.map((t) => `#${t}`).join(' ')}</p>}
    </div>
  );
}

function Cards({ items }) {
  return (
    <ul className="space-y-3 md:hidden">
      {items.map((c) => (
        <li key={c.id}>
          <Link to={`/content/${c.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium text-slate-900">{c.title}</p>
              <StatusBadge status={c.status} label={c.statusLabel} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {typeLabel(c.type)}
              {c.category && ` · ${c.category.name}`}
              {c.platforms.length > 0 && ` · ${c.platforms.map(platformLabel).join(', ')}`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1">
                Deadline: <DeadlineCell item={c} />
              </span>
              {c.assetCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Image className="h-3.5 w-3.5" aria-hidden /> {c.assetCount}
                </span>
              )}
              {c.revision > 0 && <Badge tone="warning">Revision {c.revision}</Badge>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ContentLibraryPage() {
  const navigate = useNavigate();
  const meta = useContentMeta();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', data: [], meta: null, error: null });
  const [categories, setCategories] = useState([]);
  const [campaigns, setCampaigns] = useState([]);

  // Filters live in the URL, so reloading, sharing and the back button all keep them.
  const query = useMemo(() => Object.fromEntries(params.entries()), [params]);
  const [search, setSearch] = useState(query.q ?? '');
  const debounced = useDebounced(search);

  const update = useCallback(
    (changes) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, v));
        if (!('page' in changes)) next.delete('page'); // any filter change goes back to page 1
        return next;
      }, { replace: true });
    },
    [setParams],
  );

  useEffect(() => {
    if ((query.q ?? '') !== debounced) update({ q: debounced });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    contentApi.categories().then((r) => setCategories(r.data)).catch(() => {});
    contentApi.campaigns().then((r) => setCampaigns(r.data)).catch(() => {});
  }, []);

  const queryKey = params.toString();
  const load = useCallback(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: s.data.length ? 'refreshing' : 'loading', error: null }));
    contentApi
      .list({ ...Object.fromEntries(new URLSearchParams(queryKey)), limit: new URLSearchParams(queryKey).get('limit') || 20 }, ctrl.signal)
      .then((res) => setState({ status: 'ready', data: res.data, meta: res.meta, error: null }))
      .catch((err) => err.name !== 'AbortError' && setState((s) => ({ ...s, status: 'error', error: err })));
    return () => ctrl.abort();
  }, [queryKey]);
  useEffect(() => load(), [load]);

  const hasFilters = FILTER_KEYS.some((k) => query[k]);
  const clear = () => {
    setSearch('');
    setParams({}, { replace: true });
  };
  const loading = state.status === 'loading';

  const columns = [
    { key: 'title', header: 'Title', render: (c) => <TitleCell item={c} /> },
    { key: 'status', header: 'Status', render: (c) => (<span className="inline-flex items-center gap-1.5"><StatusBadge status={c.status} label={c.statusLabel} />{c.revision > 0 && <Badge tone="warning">Rev {c.revision}</Badge>}</span>) },
    { key: 'type', header: 'Type', render: (c) => typeLabel(c.type) },
    { key: 'category', header: 'Category', render: (c) => c.category?.name ?? <span className="text-slate-400">—</span> },
    { key: 'platforms', header: 'Platforms', render: (c) => (c.platforms.length ? c.platforms.map(platformLabel).join(', ') : <span className="text-slate-400">—</span>) },
    { key: 'deadline', header: 'Deadline', render: (c) => <DeadlineCell item={c} /> },
    { key: 'assets', header: 'Files', className: 'text-right', render: (c) => c.assetCount || <span className="text-slate-400">0</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Content</h2>
          <p className="mt-1 text-sm text-slate-500">Plan, create, review and publish — all in one library.</p>
        </div>
        <Button icon={Plus} onClick={() => navigate('/content/new')}>
          New content
        </Button>
      </div>

      <section aria-label="Filters" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search content" className="pl-9" placeholder="Search title, description, caption, tags…" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
          </div>
          <Select className="col-span-2 lg:col-span-1" aria-label="Sort by" value={query.sort ?? '-updatedAt'} onChange={(e) => update({ sort: e.target.value === '-updatedAt' ? '' : e.target.value })}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Sort: {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Status" value={query.status ?? ''} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All statuses</option>
            {meta?.statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Type" value={query.type ?? ''} onChange={(e) => update({ type: e.target.value })}>
            <option value="">All types</option>
            {meta?.types.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </Select>
          <Select aria-label="Platform" value={query.platform ?? ''} onChange={(e) => update({ platform: e.target.value })}>
            <option value="">All platforms</option>
            {meta?.platforms.map((p) => (
              <option key={p} value={p}>
                {platformLabel(p)}
              </option>
            ))}
          </Select>
          <Select aria-label="Category" value={query.category ?? ''} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Campaign" value={query.campaign ?? ''} onChange={(e) => update({ campaign: e.target.value })}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          <label className="col-span-2 flex h-10 items-center gap-2 text-sm text-slate-700 lg:col-span-1">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={query.archived === 'true'} onChange={(e) => update({ archived: e.target.checked ? 'true' : '' })} />
            Show archived
          </label>
          {hasFilters && (
            <Button variant="ghost" size="md" icon={X} onClick={clear} className="justify-self-start">
              Clear filters
            </Button>
          )}
        </div>
      </section>

      {state.status === 'error' ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <ErrorState title="Couldn’t load your content" message={state.error?.message} onRetry={load} />
        </div>
      ) : loading ? (
        <>
          <div className="hidden md:block">
            <Table columns={columns} loading />
          </div>
          <div className="space-y-3 md:hidden" aria-hidden>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        </>
      ) : state.data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {hasFilters ? (
            <EmptyState
              icon={SearchX}
              title="No content matches these filters"
              description="Try a different search, or clear the filters to see everything."
              action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={Clapperboard}
              title="No content yet"
              description="Capture your first idea. You can move it through planning, creation, review and publishing from here."
              action={<Button icon={Plus} onClick={() => navigate('/content/new')}>Create your first content</Button>}
            />
          )}
        </div>
      ) : (
        <div className={state.status === 'refreshing' ? 'opacity-60 transition-opacity' : ''} aria-busy={state.status === 'refreshing'}>
          <div className="hidden md:block">
            <Table columns={columns} rows={state.data} />
          </div>
          <Cards items={state.data} />
        </div>
      )}

      {state.meta && state.data.length > 0 && (
        <Pagination meta={state.meta} disabled={state.status !== 'ready'} onPage={(p) => update({ page: String(p) })} onLimit={(n) => update({ limit: n === 20 ? '' : String(n) })} />
      )}
    </div>
  );
}
