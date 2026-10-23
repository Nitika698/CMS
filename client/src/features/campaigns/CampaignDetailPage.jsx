import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ErrorState, FormField, Modal, Skeleton, Textarea, useToast } from '../../components/ui/index.js';
import { formatMoney } from '../dashboard/format.js';
import { formatInstant } from '../content/dates.js';
import { campaignsApi } from './api.js';
import DeliverablesPanel from './DeliverablesPanel.jsx';
import LinkedPanel from './LinkedPanel.jsx';
import { Flags, label, ProgressBar, StatusBadge, ymdLabel } from './parts.jsx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'linked', label: 'Content, tasks & invoices' },
];

function Tile({ label: title, children, hint }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <div className="mt-1 break-words text-lg font-semibold text-slate-900">{children}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function Overview({ c }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="Brief">{c.brief ? <p className="whitespace-pre-wrap text-sm text-slate-700">{c.brief}</p> : <p className="text-sm text-slate-500">No brief added.</p>}</Card>
        {c.objectives.length > 0 && <Card title="Objectives"><ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.objectives.map((o) => <li key={o}>{o}</li>)}</ul></Card>}
        <Card title="What was asked for" description="Compared with the deliverables you have planned.">
          {c.coverage.length === 0 ? <p className="text-sm text-slate-500">No platforms or quantities listed. Edit the campaign to add them.</p> : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-4 font-medium">Platform</th><th className="py-1 pr-4 font-medium">Format</th><th className="py-1 pr-4 text-right font-medium">Asked</th><th className="py-1 pr-4 text-right font-medium">Planned</th><th className="py-1 pr-4 text-right font-medium">Approved</th><th className="py-1 text-right font-medium">Published</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {c.coverage.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-4">{label(r.platform)}</td>
                      <td className="py-2 pr-4">{label(r.format)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.quantity}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.planned}{r.missing > 0 && <span className="ml-1 text-xs font-medium text-amber-800">({r.missing} short)</span>}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.approved}</td>
                      <td className="py-2 text-right tabular-nums">{r.published}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {c.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-sm text-slate-700">{c.notes}</p></Card>}
      </div>
      <div className="space-y-6">
        <Card title="Review & approval">
          <p className="text-sm text-slate-700">{c.review.required ? 'The brand approves deliverables before they are published.' : 'No approval needed before publishing.'}</p>
          {c.review.approverName && <p className="mt-2 text-sm text-slate-600">Approver: <strong className="text-slate-900">{c.review.approverName}</strong></p>}
          {c.review.notes && <p className="mt-1 text-sm text-slate-600">{c.review.notes}</p>}
        </Card>
        <Card title="Dates">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Start</dt><dd>{ymdLabel(c.local.startDate)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">End</dt><dd>{ymdLabel(c.local.endDate)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Deadline</dt><dd className="font-medium">{ymdLabel(c.local.deadline)}</dd></div>
          </dl>
        </Card>
        <Card title="Status history">
          <ol className="space-y-2 text-sm">
            {[...c.statusHistory].reverse().map((h, i) => (
              <li key={i}>
                <p className="text-slate-900">{h.from ? `${label(h.from.replace('_', ' '))} → ` : 'Created as '}<strong>{label(h.to.replace('_', ' '))}</strong></p>
                <p className="text-xs text-slate-500">{formatInstant(h.at)}{h.note ? ` · ${h.note}` : ''}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

export default function CampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview';

  const [state, setState] = useState({ status: 'loading', data: null });
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'archive' | 'delete'
  const [move, setMove] = useState(null); // { to, label }
  const [note, setNote] = useState('');
  const [moveError, setMoveError] = useState(null);

  const load = useCallback(() => {
    const ctrl = new AbortController();
    campaignsApi
      .get(id, ctrl.signal)
      .then((r) => setState({ status: 'ready', data: r.data }))
      .catch((err) => err.name !== 'AbortError' && setState((s) => ({ status: err.status === 404 ? 'missing' : 'error', data: s.data })));
    return () => ctrl.abort();
  }, [id]);
  useEffect(() => load(), [load]);
  useEffect(() => { campaignsApi.meta().then(setMeta).catch(() => {}); }, []);

  async function archiveOrRestore(c) {
    setBusy(true);
    try {
      const res = await (c.archived ? campaignsApi.restore(id) : campaignsApi.archive(id));
      setState({ status: 'ready', data: res.data });
      toast.success(c.archived ? 'Campaign restored' : 'Campaign archived');
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
      await campaignsApi.remove(id);
      toast.success('Campaign deleted permanently');
      navigate('/campaigns');
    } catch (ex) {
      toast.error(ex.message);
      setConfirm(null);
      setBusy(false);
    }
  }
  async function doMove() {
    setBusy(true);
    setMoveError(null);
    try {
      const res = await campaignsApi.move(id, move.to, note.trim() || undefined);
      setState({ status: 'ready', data: res.data });
      toast.success(`Marked ${move.label.toLowerCase()}`);
      setMove(null);
    } catch (ex) {
      setMoveError(ex);
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return <div className="space-y-5" aria-busy><Skeleton className="h-6 w-32" /><Skeleton className="h-10 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (state.status === 'missing' || (state.status === 'error' && !state.data)) {
    const missing = state.status === 'missing';
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <ErrorState title={missing ? 'Campaign not found' : 'Couldn’t load this campaign'} message={missing ? 'It may have been deleted, or it belongs to another account.' : 'Please try again.'} onRetry={missing ? undefined : load} />
        <p className="pb-6 text-center text-sm"><Link to="/campaigns" className="font-medium text-brand-600 hover:underline">Back to Campaigns</Link></p>
      </div>
    );
  }

  const c = state.data;
  const closed = ['completed', 'cancelled'].includes(c.status);
  const locked = c.archived || closed;
  const outstanding = c.linked.invoiceTotals.filter((t) => t.outstanding > 0);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Campaigns</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-slate-900">{c.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge campaign={c} />
              {c.archived && <Badge>Archived</Badge>}
              <Link to={`/brands/${c.client.id}`} className="text-sm text-brand-700 hover:underline">{c.client.name}</Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!c.archived && <Button variant="secondary" size="sm" icon={Pencil} onClick={() => navigate(`/campaigns/${id}/edit`)}>Edit</Button>}
            {c.archived ? (
              <Button variant="secondary" size="sm" icon={ArchiveRestore} loading={busy} onClick={() => archiveOrRestore(c)}>Restore</Button>
            ) : (
              <Button variant="secondary" size="sm" icon={Archive} onClick={() => setConfirm('archive')}>Archive</Button>
            )}
            {c.archived && <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirm('delete')}>Delete permanently</Button>}
          </div>
        </div>
        {!c.archived && c.next.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Change stage">
            <span className="text-sm text-slate-500">Move to:</span>
            {c.next.map((n) => (
              <Button key={n.to} size="sm" variant={n.to === 'cancelled' ? 'ghost' : 'secondary'} onClick={() => { setMove(n); setNote(''); setMoveError(null); }}>{n.label}</Button>
            ))}
          </div>
        )}
      </div>

      {c.client.archived && !c.archived && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">This campaign’s brand is archived.</p>}
      {c.flags.length > 0 && (
        <section aria-label="Needs attention" className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <h3 className="mb-1.5 text-sm font-semibold text-slate-900">Needs attention</h3>
          <Flags flags={c.flags} />
        </section>
      )}

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Progress" hint="Worked out from the deliverables"><ProgressBar progress={c.progress} showStages /></Tile>
        <Tile label="Deadline" hint={c.local.endDate ? `Ends ${ymdLabel(c.local.endDate)}` : undefined}>{c.local.deadline ? ymdLabel(c.local.deadline) : 'Not set'}</Tile>
        <Tile label="Agreed fee" hint={c.budget ? `Brand’s budget ${formatMoney(c.budget.amountMinor, c.budget.currency)}` : undefined}>{c.fee ? formatMoney(c.fee.amountMinor, c.fee.currency) : 'Not set'}</Tile>
        <Tile label="Outstanding" hint={`${c.counts.invoices} invoice${c.counts.invoices === 1 ? '' : 's'}`}>{outstanding.length ? outstanding.map((t) => formatMoney(t.outstanding, t.currency)).join(' · ') : 'Nothing'}</Tile>
      </section>

      <div role="tablist" aria-label="Campaign sections" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200">
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
            {t.label}{t.key === 'deliverables' && ` (${c.counts.deliverables})`}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <Overview c={c} />}
        {tab === 'deliverables' && <DeliverablesPanel campaign={c} meta={meta} locked={locked} onChanged={load} />}
        {tab === 'linked' && <LinkedPanel campaign={c} locked={c.archived} onChanged={load} />}
      </div>

      <Modal
        open={!!move}
        onClose={() => !busy && setMove(null)}
        title={`Mark as ${move?.label.toLowerCase() ?? ''}?`}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setMove(null)} disabled={busy}>Cancel</Button><Button variant={move?.to === 'cancelled' ? 'danger' : 'primary'} onClick={doMove} loading={busy}>Confirm</Button></>}
      >
        <div className="space-y-3">
          {moveError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <p>{moveError.message}</p>
              {moveError.body?.error?.details?.length > 0 && Array.isArray(moveError.body.error.details) && (
                <ul className="mt-1 list-disc pl-5">{moveError.body.error.details.map((d) => <li key={d.path}>{d.message}</li>)}</ul>
              )}
            </div>
          )}
          {move?.to === 'cancelled' && <p className="text-sm text-slate-600">Invoices and payments already recorded are not touched.</p>}
          <FormField label="Note" hint="Optional. Saved in the status history.">{(p) => <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} {...p} />}</FormField>
        </div>
      </Modal>

      <Modal
        open={confirm === 'archive'}
        onClose={() => !busy && setConfirm(null)}
        title={`Archive ${c.title}?`}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button onClick={() => archiveOrRestore(c)} loading={busy}>Archive</Button></>}
      >
        <div className="space-y-3 text-sm text-slate-600">
          {!closed && c.progress.total - c.progress.stages.published > 0 && <p><strong className="text-slate-900">{c.progress.total - c.progress.stages.published}</strong> deliverable{c.progress.total - c.progress.stages.published === 1 ? ' is' : 's are'} not published yet.</p>}
          <p>Archiving hides the campaign from your lists and stops deadline warnings. Everything is kept and you can restore it at any time.</p>
        </div>
      </Modal>
      <Modal
        open={confirm === 'delete'}
        onClose={() => !busy && setConfirm(null)}
        title={`Delete ${c.title} permanently?`}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button variant="danger" onClick={remove} loading={busy}>Delete permanently</Button></>}
      >
        <p className="text-sm text-slate-600">This removes the campaign and its deliverables for good. Linked content, tasks and discussions are kept but unlinked. A campaign that still has invoices can’t be deleted.</p>
      </Modal>
    </div>
  );
}
