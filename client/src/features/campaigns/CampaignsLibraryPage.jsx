import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Megaphone, Plus, Search, SearchX, X } from 'lucide-react';
import { Button, EmptyState, ErrorState, Input, Select, Skeleton, Table } from '../../components/ui/index.js';
import { clientsApi } from '../clients/api.js';
import { formatMoney } from '../dashboard/format.js';
import { campaignsApi } from './api.js';
import { Flags, ProgressBar, StatusBadge, ymdLabel } from './parts.jsx';

const FILTER_KEYS = ['q', 'status', 'client', 'attention', 'archived'];
const SORTS = [
  ['deadline', 'Deadline (soonest)'], ['-deadline', 'Deadline (latest)'], ['-updatedAt', 'Recently updated'], ['title', 'Name A–Z'],
  ['-progress', 'Most progress'], ['progress', 'Least progress'], ['status', 'Stage'], ['endDate', 'End date'],
];

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
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

const Deadline = ({ c }) => (c.local.deadline ? ymdLabel(c.local.deadline) : <span className="text-slate-400">—</span>);

function Cards({ items }) {
  return (
    <ul className="space-y-3 md:hidden">
      {items.map((c) => (
        <li key={c.id}>
          <Link to={`/campaigns/${c.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium text-slate-900">{c.title}</p>
              <StatusBadge campaign={c} />
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">{c.client.name}{c.local.deadline ? ` · due ${ymdLabel(c.local.deadline)}` : ''}</p>
            <div className="mt-3"><ProgressBar progress={c.progress} /></div>
            {c.flags.length > 0 && <div className="mt-2"><Flags flags={c.flags} compact /></div>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function CampaignsLibraryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', data: [], meta: null, error: null });
  const [brands, setBrands] = useState([]);
  const [statuses, setStatuses] = useState([]);

  const query = useMemo(() => Object.fromEntries(params.entries()), [params]);
  const [search, setSearch] = useState(query.q ?? '');
  const debounced = useDebounced(search);

  useEffect(() => {
    clientsApi.list({ limit: 100 }).then((r) => setBrands(r.data)).catch(() => {});
    campaignsApi.meta().then((m) => setStatuses(m.statuses)).catch(() => {});
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

  const queryKey = params.toString();
  const load = useCallback(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: s.data.length ? 'refreshing' : 'loading', error: null }));
    campaignsApi
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
      key: 'title',
      header: 'Campaign',
      render: (c) => (
        <div className="min-w-0">
          <Link to={`/campaigns/${c.id}`} className="block truncate font-medium text-slate-900 hover:text-brand-700 hover:underline">{c.title}</Link>
          <Link to={`/brands/${c.client.id}`} className="block truncate text-xs text-slate-500 hover:underline">{c.client.name}</Link>
        </div>
      ),
    },
    { key: 'status', header: 'Stage', render: (c) => <StatusBadge campaign={c} /> },
    { key: 'deadline', header: 'Deadline', render: (c) => <Deadline c={c} /> },
    { key: 'progress', header: 'Progress', render: (c) => <ProgressBar progress={c.progress} /> },
    { key: 'fee', header: 'Agreed fee', className: 'text-right', render: (c) => (c.fee ? <span className="tabular-nums">{formatMoney(c.fee.amountMinor, c.fee.currency)}</span> : <span className="text-slate-400">—</span>) },
    { key: 'flags', header: 'Needs attention', render: (c) => (c.flags.length ? <Flags flags={c.flags} compact /> : <span className="text-slate-400">—</span>) },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Campaigns</h2>
          <p className="mt-1 text-sm text-slate-500">Brand deals with their deliverables, deadlines and approvals. Progress is worked out from the deliverables.</p>
        </div>
        <Button icon={Plus} onClick={() => navigate(query.client ? `/campaigns/new?client=${query.client}` : '/campaigns/new')}>New campaign</Button>
      </div>

      <section aria-label="Filters" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search campaigns" className="pl-9" placeholder="Search name, brief, objectives…" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
          </div>
          <Select className="col-span-2 lg:col-span-1" aria-label="Sort by" value={query.sort ?? 'deadline'} onChange={(e) => update({ sort: e.target.value === 'deadline' ? '' : e.target.value })}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </Select>
          <Select className="col-span-2 lg:col-span-1" aria-label="Stage" value={query.status ?? ''} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All stages</option>
            {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <Select aria-label="Brand" value={query.client ?? ''} onChange={(e) => update({ client: e.target.value })}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select aria-label="Needs attention" value={query.attention ?? ''} onChange={(e) => update({ attention: e.target.value })}>
            <option value="">Any campaign</option>
            <option value="any">Needs attention</option>
            <option value="deadline_soon">Deadline approaching</option>
            <option value="overdue">Overdue</option>
            <option value="incomplete">Incomplete deliverables</option>
          </Select>
          <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={query.archived === 'true'} onChange={(e) => update({ archived: e.target.checked ? 'true' : '' })} />
            Show archived
          </label>
          {hasFilters && <Button variant="ghost" icon={X} onClick={clear} className="justify-self-start">Clear filters</Button>}
        </div>
      </section>

      {state.meta && state.meta.needAttention > 0 && !query.attention && (
        <p className="text-sm text-amber-800" role="status">
          {state.meta.needAttention} campaign{state.meta.needAttention === 1 ? ' needs' : 's need'} attention.{' '}
          <button type="button" className="font-medium underline" onClick={() => update({ attention: 'any' })}>Show them</button>
        </p>
      )}

      {state.status === 'error' ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><ErrorState title="Couldn’t load your campaigns" message={state.error?.message} onRetry={load} /></div>
      ) : loading ? (
        <>
          <div className="hidden md:block"><Table columns={columns} loading /></div>
          <div className="space-y-3 md:hidden" aria-hidden>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
        </>
      ) : state.data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {hasFilters ? (
            <EmptyState icon={SearchX} title="No campaigns match these filters" description="Try a different search, or clear the filters to see everything." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={Megaphone} title="No campaigns yet" description="Create a campaign for a brand, add what you owe them, and track each deliverable from planned to published." action={<Button icon={Plus} onClick={() => navigate('/campaigns/new')}>Create your first campaign</Button>} />
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
