import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Info, Plus, Receipt, Search, SearchX, X } from 'lucide-react';
import { Button, EmptyState, ErrorState, Input, Select, Skeleton, Table } from '../../components/ui/index.js';
import { clientsApi } from '../clients/api.js';
import { formatMoney } from '../dashboard/format.js';
import { invoicesApi } from './api.js';
import { CURRENCIES, DueText, InvoiceBadge, NOT_PROCESSING } from './parts.jsx';

const FILTER_KEYS = ['q', 'status', 'client', 'currency'];
const SORTS = [['-issueDate', 'Newest first'], ['issueDate', 'Oldest first'], ['dueDate', 'Due date (soonest)'], ['-dueDate', 'Due date (latest)'], ['-balance', 'Most owed'], ['-total', 'Largest total'], ['number', 'Number']];
const STATUS_TILES = [['', 'All'], ['overdue', 'Overdue'], ['sent,partially_paid', 'Awaiting payment'], ['paid', 'Paid'], ['draft', 'Drafts'], ['void', 'Cancelled']];

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Totals({ totals }) {
  if (!totals.length) return null;
  return (
    <section aria-label="Totals by currency" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {totals.map((t) => (
        <div key={t.currency} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">{t.currency} · issued invoices</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-slate-500">Invoiced</dt><dd className="font-medium tabular-nums">{formatMoney(t.invoiced, t.currency)}</dd></div>
            <div><dt className="text-xs text-slate-500">Collected</dt><dd className="font-medium tabular-nums">{formatMoney(t.collected, t.currency)}</dd></div>
            <div><dt className="text-xs text-slate-500">Outstanding</dt><dd className="font-medium tabular-nums">{formatMoney(t.outstanding, t.currency)}</dd></div>
            <div><dt className="text-xs text-slate-500">Overdue</dt><dd className={`font-medium tabular-nums ${t.overdue ? 'text-red-700' : ''}`}>{formatMoney(t.overdue, t.currency)}</dd></div>
          </dl>
        </div>
      ))}
    </section>
  );
}

export default function PaymentsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', data: [], meta: null, error: null });
  const [brands, setBrands] = useState([]);
  const query = useMemo(() => Object.fromEntries(params.entries()), [params]);
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
    invoicesApi
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
  const newInvoice = () => navigate(query.client ? `/payments/new?client=${query.client}` : '/payments/new');

  const columns = [
    {
      key: 'number',
      header: 'Invoice',
      render: (i) => (
        <div className="min-w-0">
          <Link to={`/payments/${i.id}`} className="block truncate font-medium text-slate-900 hover:text-brand-700 hover:underline">{i.number}</Link>
          <Link to={`/brands/${i.client.id}`} className="block truncate text-xs text-slate-500 hover:underline">{i.client.name}{i.campaign?.title ? ` · ${i.campaign.title}` : ''}</Link>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (i) => <InvoiceBadge invoice={i} /> },
    { key: 'due', header: 'Due', render: (i) => <DueText invoice={i} /> },
    { key: 'total', header: 'Total', className: 'text-right', render: (i) => <span className="tabular-nums">{formatMoney(i.totalMinor, i.currency)}</span> },
    { key: 'paid', header: 'Paid', className: 'text-right', render: (i) => <span className="tabular-nums">{formatMoney(i.paidMinor, i.currency)}</span> },
    { key: 'balance', header: 'Balance', className: 'text-right', render: (i) => <span className="font-medium tabular-nums">{i.status === 'sent' ? formatMoney(i.balanceMinor, i.currency) : '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Payments</h2>
          <p className="mt-1 text-sm text-slate-500">Invoices for your brand deals and the payments you have received against them.</p>
        </div>
        <Button icon={Plus} onClick={newInvoice}>New invoice</Button>
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {NOT_PROCESSING}
      </p>

      {state.meta && <Totals totals={state.meta.totals} />}

      <section aria-label="Filters" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Status">
          {STATUS_TILES.map(([value, label]) => (
            <button key={label} type="button" aria-pressed={(query.status ?? '') === value} onClick={() => update({ status: value })} className={`rounded-full border px-3 py-1 text-sm ${(query.status ?? '') === value ? 'border-brand-500 bg-brand-50 font-medium text-brand-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search invoices" className="pl-9" placeholder="Search number, brand, notes…" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
          </div>
          <Select aria-label="Sort by" value={query.sort ?? '-issueDate'} onChange={(e) => update({ sort: e.target.value === '-issueDate' ? '' : e.target.value })}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </Select>
          <Select aria-label="Currency" value={query.currency ?? ''} onChange={(e) => update({ currency: e.target.value })}>
            <option value="">All currencies</option>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select className="col-span-2 lg:col-span-1" aria-label="Brand" value={query.client ?? ''} onChange={(e) => update({ client: e.target.value })}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          {hasFilters && <Button variant="ghost" icon={X} onClick={clear} className="justify-self-start">Clear filters</Button>}
        </div>
      </section>

      {state.status === 'error' ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><ErrorState title="Couldn’t load your invoices" message={state.error?.message} onRetry={load} /></div>
      ) : loading ? (
        <>
          <div className="hidden md:block"><Table columns={columns} loading /></div>
          <div className="space-y-3 md:hidden" aria-hidden>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        </>
      ) : state.data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {hasFilters ? (
            <EmptyState icon={SearchX} title="No invoices match these filters" description="Try a different search, or clear the filters to see everything." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={Receipt} title="No invoices yet" description="Raise an invoice for a brand, issue it, then record each payment as it arrives. Balances are worked out for you." action={<Button icon={Plus} onClick={newInvoice}>Create your first invoice</Button>} />
          )}
        </div>
      ) : (
        <div className={state.status === 'refreshing' ? 'opacity-60 transition-opacity' : ''} aria-busy={state.status === 'refreshing'}>
          <div className="hidden md:block"><Table columns={columns} rows={state.data} /></div>
          <ul className="space-y-3 md:hidden">
            {state.data.map((i) => (
              <li key={i.id}>
                <Link to={`/payments/${i.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
                  <div className="flex items-start justify-between gap-3"><p className="font-medium text-slate-900">{i.number}</p><InvoiceBadge invoice={i} /></div>
                  <p className="mt-1 truncate text-xs text-slate-500">{i.client.name}</p>
                  <div className="mt-2 flex items-center justify-between text-sm"><DueText invoice={i} /><span className="font-medium tabular-nums">{formatMoney(i.status === 'sent' ? i.balanceMinor : i.totalMinor, i.currency)}</span></div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.meta && state.meta.pages > 1 && (
        <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p aria-live="polite">Page {state.meta.page} of {state.meta.pages} · {state.meta.total} invoices</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={state.meta.page <= 1} onClick={() => update({ page: String(state.meta.page - 1) })} aria-label="Previous page" />
            <Button variant="secondary" size="sm" icon={ChevronRight} disabled={state.meta.page >= state.meta.pages} onClick={() => update({ page: String(state.meta.page + 1) })} aria-label="Next page" />
          </div>
        </nav>
      )}
    </div>
  );
}
