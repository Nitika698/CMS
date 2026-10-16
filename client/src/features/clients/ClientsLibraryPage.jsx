import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Building2, ChevronLeft, ChevronRight, Plus, Search, SearchX, X } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Input, Select, Skeleton, Table } from '../../components/ui/index.js';
import { formatDay } from '../content/dates.js';
import { timeAgo } from '../dashboard/format.js';
import { clientsApi } from './api.js';
import { SORT_OPTIONS, STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from './constants.js';
import { useClientMeta } from './useClientMeta.js';

const FILTER_KEYS = ['q', 'status', 'type', 'category', 'followUp', 'archived'];

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const domain = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Badge>;
}

function FollowUp({ item }) {
  if (!item.followUpAt) return <span className="text-slate-400">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${item.followUpOverdue ? 'font-medium text-red-700' : ''}`}>
      {item.followUpOverdue && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
      {formatDay(item.followUpAt)}
      {item.followUpOverdue && <span className="sr-only"> (overdue)</span>}
    </span>
  );
}

function Pagination({ meta, onPage, disabled }) {
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.total, meta.page * meta.limit);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <p aria-live="polite">{from}–{to} of {meta.total}</p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={disabled || meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page" />
        <span className="tabular-nums">Page {meta.page} of {meta.pages}</span>
        <Button variant="secondary" size="sm" icon={ChevronRight} disabled={disabled || meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)} aria-label="Next page" />
      </div>
    </nav>
  );
}

function Cards({ items }) {
  return (
    <ul className="space-y-3 md:hidden">
      {items.map((c) => (
        <li key={c.id}>
          <Link to={`/brands/${c.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium text-slate-900">{c.name}</p>
              <StatusBadge status={c.status} />
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">{[TYPE_LABEL[c.type], c.category, c.industry].filter(Boolean).join(' · ')}</p>
            {c.primaryContact && <p className="mt-2 truncate text-sm text-slate-700">{c.primaryContact.name}{c.primaryContact.email ? ` · ${c.primaryContact.email}` : ''}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>Last contact: {c.lastContactAt ? timeAgo(c.lastContactAt) : '—'}</span>
              <span className="inline-flex items-center gap-1">Follow-up: <FollowUp item={c} /></span>
              {c.activeCampaigns > 0 && <Badge tone="brand">{c.activeCampaigns} active</Badge>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ClientsLibraryPage() {
  const navigate = useNavigate();
  const { meta } = useClientMeta();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', data: [], meta: null, error: null });

  // Filters live in the URL, so reloading, sharing and the back button keep them.
  const query = useMemo(() => Object.fromEntries(params.entries()), [params]);
  const [search, setSearch] = useState(query.q ?? '');
  const debounced = useDebounced(search);

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

  const queryKey = params.toString();
  const load = useCallback(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: s.data.length ? 'refreshing' : 'loading', error: null }));
    clientsApi
      .list(Object.fromEntries(new URLSearchParams(queryKey)), ctrl.signal)
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
    {
      key: 'name',
      header: 'Brand',
      render: (c) => (
        <div className="min-w-0">
          <Link to={`/brands/${c.id}`} className="block truncate font-medium text-slate-900 hover:text-brand-700 hover:underline">{c.name}</Link>
          <p className="truncate text-xs text-slate-500">{[TYPE_LABEL[c.type], c.website && domain(c.website)].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Stage', render: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'contact',
      header: 'Contact',
      render: (c) => (c.primaryContact ? (
        <div className="min-w-0">
          <p className="truncate">{c.primaryContact.name}</p>
          {c.primaryContact.email && <p className="truncate text-xs text-slate-500">{c.primaryContact.email}</p>}
        </div>
      ) : <span className="text-slate-400">—</span>),
    },
    { key: 'category', header: 'Category', render: (c) => [c.category, c.industry].filter(Boolean).join(' · ') || <span className="text-slate-400">—</span> },
    { key: 'last', header: 'Last contact', render: (c) => (c.lastContactAt ? timeAgo(c.lastContactAt) : <span className="text-slate-400">Never</span>) },
    { key: 'followUp', header: 'Follow-up', render: (c) => <FollowUp item={c} /> },
    { key: 'campaigns', header: 'Active campaigns', className: 'text-right', render: (c) => c.activeCampaigns || <span className="text-slate-400">0</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Brands</h2>
          <p className="mt-1 text-sm text-slate-500">The brands, agencies and people you work with: contacts, rates, history and follow-ups.</p>
        </div>
        <Button icon={Plus} onClick={() => navigate('/brands/new')}>New brand</Button>
      </div>

      <section aria-label="Filters" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search brands" className="pl-9" placeholder="Search name, contact, email, industry, notes…" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
          </div>
          <Select className="col-span-2 lg:col-span-1" aria-label="Sort by" value={query.sort ?? 'name'} onChange={(e) => update({ sort: e.target.value === 'name' ? '' : e.target.value })}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
          </Select>
          <Select className="col-span-2 lg:col-span-1" aria-label="Stage" value={query.status ?? ''} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All stages</option>
            {meta?.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          <Select aria-label="Type" value={query.type ?? ''} onChange={(e) => update({ type: e.target.value })}>
            <option value="">All types</option>
            {meta?.types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
          <Select aria-label="Category" value={query.category ?? ''} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {meta?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select aria-label="Follow-up" value={query.followUp ?? ''} onChange={(e) => update({ followUp: e.target.value })}>
            <option value="">Any follow-up</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Due today or later</option>
            <option value="none">No follow-up set</option>
          </Select>
          <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={query.archived === 'true'} onChange={(e) => update({ archived: e.target.checked ? 'true' : '' })} />
            Show archived
          </label>
          {hasFilters && <Button variant="ghost" icon={X} onClick={clear} className="justify-self-start">Clear filters</Button>}
        </div>
      </section>

      {state.status === 'error' ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <ErrorState title="Couldn’t load your brands" message={state.error?.message} onRetry={load} />
        </div>
      ) : loading ? (
        <>
          <div className="hidden md:block"><Table columns={columns} loading /></div>
          <div className="space-y-3 md:hidden" aria-hidden>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
        </>
      ) : state.data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {hasFilters ? (
            <EmptyState icon={SearchX} title="No brands match these filters" description="Try a different search, or clear the filters to see everything." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState
              icon={Building2}
              title="No brands yet"
              description="Add the brands and agencies you work with. Keep their contacts, negotiated rates, notes and follow-up dates in one place."
              action={<Button icon={Plus} onClick={() => navigate('/brands/new')}>Add your first brand</Button>}
            />
          )}
        </div>
      ) : (
        <div className={state.status === 'refreshing' ? 'opacity-60 transition-opacity' : ''} aria-busy={state.status === 'refreshing'}>
          <div className="hidden md:block"><Table columns={columns} rows={state.data} /></div>
          <Cards items={state.data} />
        </div>
      )}

      {state.meta && state.data.length > 0 && <Pagination meta={state.meta} disabled={state.status !== 'ready'} onPage={(p) => update({ page: String(p) })} />}
    </div>
  );
}
