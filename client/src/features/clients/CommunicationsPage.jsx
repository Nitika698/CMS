import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, MessagesSquare, Search, SearchX, X } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Input, Select, Skeleton } from '../../components/ui/index.js';
import { clientsApi } from './api.js';
import { DISCUSSION_CHANNEL_LABEL } from './constants.js';

const FILTER_KEYS = ['q', 'client', 'channel', 'direction', 'from', 'to'];
const dayFmt = (ymd) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${ymd}T00:00:00Z`));

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Every saved discussion across all brands. Discussions are written on each brand's page; this is where you search them all. */
export default function CommunicationsPage() {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => Object.fromEntries(params.entries()), [params]);
  const [state, setState] = useState({ status: 'loading', data: [], meta: null, error: null });
  const [brands, setBrands] = useState([]);
  const [search, setSearch] = useState(query.q ?? '');
  const debounced = useDebounced(search);

  useEffect(() => {
    clientsApi.list({ limit: 100 }).then((r) => setBrands(r.data)).catch(() => {});
  }, []);

  const update = useCallback(
    (changes) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, v));
        if (!('page' in changes)) next.delete('page');
        return next;
      }, { replace: true }),
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
      .allDiscussions(Object.fromEntries(new URLSearchParams(queryKey)), ctrl.signal)
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

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Communications</h2>
        <p className="mt-1 text-sm text-slate-500">Every discussion you have saved, across all your brands. You write them on each brand&rsquo;s page; CMS never sends or receives messages for you.</p>
      </div>

      <section aria-label="Filters" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search discussions" className="pl-9" placeholder="Search subject and notes…" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
          </div>
          <Select aria-label="Brand" value={query.client ?? ''} onChange={(e) => update({ client: e.target.value })}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select aria-label="Channel" value={query.channel ?? ''} onChange={(e) => update({ channel: e.target.value })}>
            <option value="">Any channel</option>
            {Object.entries(DISCUSSION_CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select aria-label="Direction" value={query.direction ?? ''} onChange={(e) => update({ direction: e.target.value })}>
            <option value="">Sent and received</option>
            <option value="inbound">They contacted me</option>
            <option value="outbound">I contacted them</option>
          </Select>
          <label className="text-xs text-slate-500">From<Input aria-label="From date" type="date" value={query.from ?? ''} onChange={(e) => update({ from: e.target.value })} /></label>
          <label className="text-xs text-slate-500">To<Input aria-label="To date" type="date" value={query.to ?? ''} onChange={(e) => update({ to: e.target.value })} /></label>
          {hasFilters && <Button variant="ghost" icon={X} onClick={clear} className="justify-self-start self-end">Clear filters</Button>}
        </div>
      </section>

      {state.status === 'error' ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><ErrorState title="Couldn’t load your discussions" message={state.error?.message} onRetry={load} /></div>
      ) : state.status === 'loading' ? (
        <div className="space-y-2" aria-hidden>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : state.data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {hasFilters ? (
            <EmptyState icon={SearchX} title="No discussions match these filters" description="Try a different search, or clear the filters to see everything." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={MessagesSquare} title="No saved discussions yet" description="Open a brand and save an email, call or message there. It will show up here too, so you can search every conversation in one place." action={<Link to="/brands"><Button tabIndex={-1}>Go to brands</Button></Link>} />
          )}
        </div>
      ) : (
        <ul className={`divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm ${state.status === 'refreshing' ? 'opacity-60 transition-opacity' : ''}`} aria-busy={state.status === 'refreshing'}>
          {state.data.map((d) => {
            const Arrow = d.direction === 'inbound' ? ArrowDownLeft : ArrowUpRight;
            return (
              <li key={d.id}>
                <Link to={`/brands/${d.client.id}?tab=discussions`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                  <Arrow className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-label={d.direction === 'inbound' ? 'They contacted me' : 'I contacted them'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{d.subject ?? `${DISCUSSION_CHANNEL_LABEL[d.channel] ?? d.channel} discussion`}</p>
                    <p className="text-xs text-slate-500">{d.client.name}{d.client.archived ? ' (archived)' : ''}{d.campaign?.title ? ` · ${d.campaign.title}` : ''}{d.contact?.name ? ` · ${d.contact.name}` : ''}</p>
                    {d.body && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{d.body}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-slate-500">
                    <Badge>{DISCUSSION_CHANNEL_LABEL[d.channel] ?? d.channel}</Badge>
                    <span>{dayFmt(d.localDate)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {state.meta && state.meta.pages > 1 && (
        <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p aria-live="polite">Page {state.meta.page} of {state.meta.pages} · {state.meta.total} discussions</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={state.meta.page <= 1} onClick={() => update({ page: String(state.meta.page - 1) })} aria-label="Previous page" />
            <Button variant="secondary" size="sm" icon={ChevronRight} disabled={state.meta.page >= state.meta.pages} onClick={() => update({ page: String(state.meta.page + 1) })} aria-label="Next page" />
          </div>
        </nav>
      )}
    </div>
  );
}
