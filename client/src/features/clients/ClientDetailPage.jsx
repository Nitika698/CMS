import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Archive, ArchiveRestore, ArrowLeft, CalendarClock, Pencil, Trash2 } from 'lucide-react';
import { Badge, Button, ErrorState, Modal, Skeleton, useToast } from '../../components/ui/index.js';
import { formatDay } from '../content/dates.js';
import { formatMoney, timeAgo } from '../dashboard/format.js';
import { clientsApi } from './api.js';
import { StatusBadge } from './ClientsLibraryPage.jsx';
import { CollaborationsTab, DiscussionsTab, InvoicesTab, OverviewTab } from './ClientTabs.jsx';
import { TYPE_LABEL } from './constants.js';
import FollowUpDialog from './FollowUpDialog.jsx';
import LinkedTasks from '../tasks/LinkedTasks.jsx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'collaborations', label: 'Collaborations' },
  { key: 'discussions', label: 'Discussions' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'invoices', label: 'Invoices' },
];

function Tile({ label, children, hint, tone }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 break-words text-lg font-semibold ${tone ?? 'text-slate-900'}`}>{children}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview';

  const [state, setState] = useState({ status: 'loading', data: null });
  const [busy, setBusy] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'archive' | 'delete'

  const load = useCallback(() => {
    const ctrl = new AbortController();
    clientsApi
      .get(id, ctrl.signal)
      .then((r) => setState({ status: 'ready', data: r.data }))
      .catch((err) => err.name !== 'AbortError' && setState((s) => ({ status: err.status === 404 ? 'missing' : 'error', data: s.data })));
    return () => ctrl.abort();
  }, [id]);
  useEffect(() => load(), [load]);

  async function archiveOrRestore(c) {
    setBusy(true);
    try {
      const res = await (c.archived ? clientsApi.restore(id) : clientsApi.archive(id));
      setState({ status: 'ready', data: res.data });
      toast.success(c.archived ? 'Brand restored' : 'Brand archived');
      setConfirm(null);
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await clientsApi.remove(id);
      toast.success('Brand deleted permanently');
      navigate('/brands');
    } catch (ex) {
      toast.error(ex.message);
      setConfirm(null);
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="space-y-5" aria-busy>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (state.status === 'missing' || (state.status === 'error' && !state.data)) {
    const missing = state.status === 'missing';
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <ErrorState title={missing ? 'Brand not found' : 'Couldn’t load this brand'} message={missing ? 'It may have been deleted, or it belongs to another account.' : 'Please try again.'} onRetry={missing ? undefined : load} />
        <p className="pb-6 text-center text-sm"><Link to="/brands" className="font-medium text-brand-600 hover:underline">Back to Brands</Link></p>
      </div>
    );
  }

  const c = state.data;
  const s = c.summary;
  const warnPending = !c.archived && (s.campaigns.active > 0 || s.money.some((m) => m.openInvoices > 0));

  return (
    <div className="space-y-6">
      <div>
        <Link to="/brands" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Brands</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-slate-900">{c.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} />
              {c.archived && <Badge>Archived</Badge>}
              <span className="text-sm text-slate-500">{[TYPE_LABEL[c.type], c.industry].filter(Boolean).join(' · ')}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!c.archived && <Button variant="secondary" size="sm" icon={Pencil} onClick={() => navigate(`/brands/${id}/edit`)}>Edit</Button>}
            {c.archived ? (
              <Button variant="secondary" size="sm" icon={ArchiveRestore} loading={busy} onClick={() => archiveOrRestore(c)}>Restore</Button>
            ) : (
              <Button variant="secondary" size="sm" icon={Archive} onClick={() => (warnPending ? setConfirm('archive') : archiveOrRestore(c))} loading={busy && !confirm}>Archive</Button>
            )}
            {c.archived && <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirm('delete')}>Delete permanently</Button>}
          </div>
        </div>
      </div>

      {c.archived && <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">This brand is archived. Restore it to edit it or log new discussions.</p>}

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Last contact" hint={s.communicationCount ? `${s.communicationCount} saved discussion${s.communicationCount === 1 ? '' : 's'}` : 'No discussions saved'}>
          {s.lastContactAt ? timeAgo(s.lastContactAt) : 'Never'}
        </Tile>
        <Tile
          label="Follow-up"
          tone={c.followUpOverdue ? 'text-red-700' : undefined}
          hint={
            <span className="inline-flex flex-wrap items-center gap-x-2">
              {c.followUpNote && <span>{c.followUpNote}</span>}
              {!c.archived && <button type="button" onClick={() => setFollowUp(true)} className="font-medium text-brand-700 hover:underline">{c.followUpAt ? 'Change' : 'Set follow-up'}</button>}
            </span>
          }
        >
          {c.followUpAt ? (
            <span className="inline-flex items-center gap-1">{c.followUpOverdue ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <CalendarClock className="h-4 w-4" aria-hidden />}{formatDay(c.followUpAt)}{c.followUpOverdue && <span className="text-sm font-medium"> overdue</span>}</span>
          ) : 'Not set'}
        </Tile>
        <Tile label="Active campaigns" hint={s.modules.campaigns.ready ? `${s.campaigns.total} in total` : `Campaigns arrive in ${s.modules.campaigns.phase}`}>
          {s.modules.campaigns.ready ? s.campaigns.active : '—'}
        </Tile>
        <Tile label="Outstanding" hint={s.modules.payments.ready ? 'Sent invoices, unpaid' : `Payments arrive in ${s.modules.payments.phase}`}>
          {!s.modules.payments.ready ? '—' : s.money.filter((m) => m.outstanding > 0).length === 0 ? 'Nothing' : s.money.filter((m) => m.outstanding > 0).map((m) => formatMoney(m.outstanding, m.currency)).join(' · ')}
        </Tile>
      </section>

      <div role="tablist" aria-label="Brand sections" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => setParams(t.key === 'overview' ? {} : { tab: t.key }, { replace: true })}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <OverviewTab c={c} />}
        {tab === 'collaborations' && <CollaborationsTab clientId={id} summary={s} />}
        {tab === 'discussions' && <DiscussionsTab client={c} onChanged={load} />}
        {tab === 'tasks' && <LinkedTasks kind="client" id={id} />}
        {tab === 'invoices' && <InvoicesTab clientId={id} />}
      </div>

      <FollowUpDialog open={followUp} onClose={() => setFollowUp(false)} client={c} onSaved={(data) => { setFollowUp(false); setState({ status: 'ready', data: { ...c, ...data, summary: c.summary } }); load(); }} />

      <Modal
        open={confirm === 'archive'}
        onClose={() => !busy && setConfirm(null)}
        title={`Archive ${c.name}?`}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button onClick={() => archiveOrRestore(c)} loading={busy}>Archive anyway</Button></>}
      >
        <div className="space-y-3 text-sm text-slate-600">
          {s.campaigns.active > 0 && <p><strong className="text-slate-900">{s.campaigns.active}</strong> campaign{s.campaigns.active === 1 ? ' is' : 's are'} still active with this brand.</p>}
          {s.money.some((m) => m.openInvoices > 0) && <p>Some invoices for this brand are still unpaid.</p>}
          <p>Archiving hides the brand from your list. Campaigns, invoices and discussions are kept, and you can restore it at any time.</p>
        </div>
      </Modal>
      <Modal
        open={confirm === 'delete'}
        onClose={() => !busy && setConfirm(null)}
        title={`Delete ${c.name} permanently?`}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button variant="danger" onClick={remove} loading={busy}>Delete permanently</Button></>}
      >
        <p className="text-sm text-slate-600">This removes the brand and its saved discussions for good. It can’t be undone. A brand that still has campaigns or invoices can’t be deleted.</p>
      </Modal>
    </div>
  );
}
