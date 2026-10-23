import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Handshake, Hourglass, Mail, MessagesSquare, Pencil, Phone, Plus, Receipt, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Select, Skeleton, useToast } from '../../components/ui/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { formatDay, formatInstant } from '../content/dates.js';
import { formatMoney } from '../dashboard/format.js';
import { clientsApi } from './api.js';
import { CAMPAIGN_STATUS_LABEL, CHANNEL_LABEL, DISCUSSION_CHANNEL_LABEL, INVOICE_STATUS, RATE_UNIT_LABEL, SOCIAL_LABEL } from './constants.js';
import DiscussionDialog from './DiscussionDialog.jsx';

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-900">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

const Unavailable = ({ what, phase }) => (
  <EmptyState
    icon={Hourglass}
    title="Not available yet"
    description={`${what} will appear here once that module is built. Nothing is shown rather than a made-up zero.`}
    action={<Badge tone="warning">{phase}</Badge>}
  />
);

function useLoader(fetcher, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    const ctrl = new AbortController();
    setState((s) => ({ status: s.data ? 'ready' : 'loading', data: s.data }));
    fetcher(ctrl.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((e) => e.name !== 'AbortError' && setState((s) => ({ status: 'error', data: s.data })));
    return () => ctrl.abort();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => load(), [load]);
  return { ...state, reload: load };
}

// ------------------------------------------------------------------ overview

export function OverviewTab({ c }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="Contacts">
          {c.contacts.length === 0 ? (
            <p className="text-sm text-slate-500">No contacts saved yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {c.contacts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{p.name} {p.isPrimary && <Badge tone="brand">Primary</Badge>}</p>
                    {p.role && <p className="text-sm text-slate-500">{p.role}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 text-sm">
                    {p.email && <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline"><Mail className="h-3.5 w-3.5" aria-hidden />{p.email}</a>}
                    {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline"><Phone className="h-3.5 w-3.5" aria-hidden />{p.phone}</a>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Rates & terms" description="Negotiated reference terms. Actual campaign fees are on the campaigns.">
          <div className="space-y-5">
            {c.rates.length === 0 ? (
              <p className="text-sm text-slate-500">No rates saved yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm" data-testid="rates-table">
                  <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="pb-2 pr-4 font-medium">Covers</th><th className="pb-2 pr-4 font-medium">Rate</th><th className="pb-2 font-medium">Notes</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {c.rates.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-4 text-slate-900">{r.label}</td>
                        <td className="whitespace-nowrap py-2 pr-4 font-medium tabular-nums">{formatMoney(r.amountMinor, r.currency)} <span className="font-normal text-slate-500">{RATE_UNIT_LABEL[r.unit]}</span></td>
                        <td className="py-2 text-slate-600">{r.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Payment terms">{c.paymentTermsDays != null && `Net ${c.paymentTermsDays} days`}</Field>
              <Field label="Default currency">{c.defaultCurrency}</Field>
              <Field label="Exclusivity">{c.terms.exclusivity}</Field>
              <Field label="Usage rights">{c.terms.usageRights}</Field>
              <div className="sm:col-span-2"><Field label="Other terms">{c.terms.other}</Field></div>
            </dl>
          </div>
        </Card>

        <Card title="Collaboration notes">
          {c.collaborationNotes ? <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{c.collaborationNotes}</p> : <p className="text-sm text-slate-500">No notes yet. Add what worked, what they like, anything to remember.</p>}
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Online">
          <dl className="space-y-4">
            <Field label="Website">{c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">{c.website.replace(/^https?:\/\//, '')}<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>}</Field>
            <Field label="Social profiles">
              {c.socialLinks.length > 0 && (
                <ul className="space-y-1">
                  {c.socialLinks.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{SOCIAL_LABEL[s.platform]}</a></li>)}
                </ul>
              )}
            </Field>
          </dl>
        </Card>
        <Card title="Contact preferences">
          <dl className="space-y-4">
            <Field label="Preferred channel">{c.contactPreferences.channel && CHANNEL_LABEL[c.contactPreferences.channel]}</Field>
            <Field label="Best time">{c.contactPreferences.bestTime}</Field>
            <Field label="Notes">{c.contactPreferences.notes && <span className="whitespace-pre-wrap">{c.contactPreferences.notes}</span>}</Field>
          </dl>
        </Card>
        <Card title="Details">
          <dl className="space-y-4">
            <Field label="Category">{c.category}</Field>
            <Field label="Industry">{c.industry}</Field>
            <Field label="Added">{formatDay(c.createdAt)}</Field>
          </dl>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ collaborations

const GROUPS = [
  ['active', 'Active campaigns'],
  ['pipeline', 'In the pipeline'],
  ['past', 'Past collaborations'],
  ['cancelled', 'Cancelled'],
];

export function CollaborationsTab({ clientId, summary }) {
  const { status, data, reload } = useLoader((signal) => clientsApi.campaigns(clientId, signal), [clientId]);
  if (status === 'loading') return <div className="space-y-3" aria-hidden>{[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (status === 'error') return <div className="rounded-xl border border-slate-200 bg-white"><ErrorState title="Couldn’t load campaigns" onRetry={reload} /></div>;
  if (data.data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        {data.available ? (
          <EmptyState icon={Handshake} title="No collaborations yet" description="Campaigns you run with this brand will be listed here, grouped by where they are." action={<Link to={`/campaigns/new?client=${clientId}`}><Button icon={Plus}>New campaign</Button></Link>} />
        ) : (
          <Unavailable what="Campaigns linked to this brand" phase={data.phase} />
        )}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {summary.money.some((m) => m.agreed > 0) && (
        <div className="flex flex-wrap gap-3" data-testid="agreed-totals">
          {summary.money.filter((m) => m.agreed > 0).map((m) => (
            <div key={m.currency} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-500">Agreed fees · {m.currency}</p>
              <p className="text-lg font-semibold tabular-nums text-slate-900">{formatMoney(m.agreed, m.currency)}</p>
            </div>
          ))}
        </div>
      )}
      {GROUPS.map(([key, title]) => {
        const rows = data.groups[key];
        if (!rows.length) return null;
        return (
          <section key={key} aria-label={title}>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">{title} <span className="ml-1 rounded-full bg-slate-100 px-2 text-xs font-medium text-slate-600">{rows.length}</span></h3>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link to={`/campaigns/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{r.title}</span>
                      <span className="block text-xs text-slate-500">{r.startDate || r.endDate ? `${r.startDate ? formatDay(r.startDate) : '…'} → ${r.endDate ? formatDay(r.endDate) : '…'}` : 'No dates'}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      {r.fee && <span className="text-sm font-medium tabular-nums text-slate-800">{formatMoney(r.fee.amountMinor, r.fee.currency)}</span>}
                      <Badge tone={key === 'active' ? 'success' : key === 'pipeline' ? 'info' : 'neutral'}>{CAMPAIGN_STATUS_LABEL[r.status]}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ discussions

export function DiscussionsTab({ client, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // { discussion? }
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, channel]);
  useEffect(() => {
    clientsApi.campaigns(client.id).then((r) => setCampaigns(r.data)).catch(() => {});
  }, [client.id]);

  const { status, data, reload } = useLoader((signal) => clientsApi.discussions(client.id, { q: debounced, channel, page, limit: 10 }, signal), [client.id, debounced, channel, page]);
  const filtered = !!(debounced || channel);

  async function remove() {
    setBusy(true);
    try {
      await clientsApi.removeDiscussion(removing.id);
      toast.success('Discussion deleted');
      setRemoving(null);
      reload();
      onChanged();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[12rem] flex-1"><Input aria-label="Search discussions" placeholder="Search discussions…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} /></div>
        <div className="w-44">
          <Select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">All channels</option>
            {Object.entries(DISCUSSION_CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {!client.archived && <Button icon={Plus} onClick={() => setDialog({})}>Log discussion</Button>}
      </div>

      {status === 'loading' ? (
        <div className="space-y-3" aria-hidden>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : status === 'error' ? (
        <div className="rounded-xl border border-slate-200 bg-white"><ErrorState title="Couldn’t load discussions" onRetry={reload} /></div>
      ) : data.data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          {filtered ? (
            <EmptyState icon={MessagesSquare} title="No discussions match" description="Try a different search or channel." action={<Button variant="secondary" onClick={() => { setQ(''); setChannel(''); }}>Clear filters</Button>} />
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="No saved discussions yet"
              description="Keep a record of emails, calls and messages with this brand: what was said and agreed. It also sets their ‘last contact’ date."
              action={!client.archived && <Button icon={Plus} onClick={() => setDialog({})}>Log your first discussion</Button>}
            />
          )}
        </div>
      ) : (
        <ol className="space-y-3" data-testid="discussion-list">
          {data.data.map((d) => (
            <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    {d.direction === 'inbound' ? <ArrowDownLeft className="h-4 w-4 text-slate-500" aria-label="They contacted you" /> : <ArrowUpRight className="h-4 w-4 text-slate-500" aria-label="You contacted them" />}
                    {d.subject || 'Discussion'}
                    <Badge>{DISCUSSION_CHANNEL_LABEL[d.channel]}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatInstant(d.occurredAt, user.timezone)}
                    {d.contact?.name && ` · with ${d.contact.name}`}
                    {d.campaign && <> · <Link to={`/campaigns/${d.campaign.id}`} className="text-brand-700 hover:underline">{d.campaign.title}</Link></>}
                  </p>
                </div>
                {!client.archived && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setDialog({ discussion: d })} aria-label={`Edit ${d.subject || 'discussion'}`} />
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setRemoving(d)} aria-label={`Delete ${d.subject || 'discussion'}`} />
                  </div>
                )}
              </div>
              {d.body && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{d.body}</p>}
            </li>
          ))}
        </ol>
      )}

      {data && data.meta.pages > 1 && (
        <nav aria-label="Discussion pages" className="flex items-center justify-between text-sm text-slate-600">
          <span>Page {data.meta.page} of {data.meta.pages} · {data.meta.total} discussions</span>
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= data.meta.pages} onClick={() => setPage(page + 1)}>Next</Button>
          </span>
        </nav>
      )}

      <DiscussionDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        client={client}
        discussion={dialog?.discussion}
        campaigns={campaigns}
        tz={user.timezone}
        onSaved={() => {
          setDialog(null);
          reload();
          onChanged();
        }}
      />
      <Modal
        open={!!removing}
        onClose={() => !busy && setRemoving(null)}
        title="Delete this discussion?"
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button><Button variant="danger" onClick={remove} loading={busy}>Delete</Button></>}
      >
        <p className="text-sm text-slate-600">“{removing?.subject || 'This discussion'}” will be permanently deleted. If it was the latest one, the brand’s last-contact date moves back.</p>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ invoices

export function InvoicesTab({ clientId }) {
  const { status, data, reload } = useLoader((signal) => clientsApi.invoices(clientId, signal), [clientId]);
  if (status === 'loading') return <div className="space-y-3" aria-hidden>{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (status === 'error') return <div className="rounded-xl border border-slate-200 bg-white"><ErrorState title="Couldn’t load invoices" onRetry={reload} /></div>;
  if (data.data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        {data.available ? <EmptyState icon={Receipt} title="No invoices yet" description="Invoices you raise for this brand will be listed here with what has been paid." /> : <Unavailable what="Invoices for this brand" phase={data.phase} />}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {data.totals.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="invoice-totals">
          {data.totals.map((t) => (
            <div key={t.currency} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">{t.currency} · sent invoices</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-xs text-slate-500">Invoiced</dt><dd className="font-medium tabular-nums">{formatMoney(t.invoiced, t.currency)}</dd></div>
                <div><dt className="text-xs text-slate-500">Collected</dt><dd className="font-medium tabular-nums">{formatMoney(t.collected, t.currency)}</dd></div>
                <div><dt className="text-xs text-slate-500">Outstanding</dt><dd className="font-medium tabular-nums">{formatMoney(t.outstanding, t.currency)}</dd></div>
                <div><dt className="text-xs text-slate-500">Overdue</dt><dd className={`font-medium tabular-nums ${t.overdue ? 'text-red-700' : ''}`}>{formatMoney(t.overdue, t.currency)}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-slate-600">{['Invoice', 'Status', 'Due', 'Total', 'Paid', 'Balance'].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.data.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3"><Link to="/payments" className="font-medium text-brand-700 hover:underline">{i.number}</Link>{i.campaign?.title && <span className="block text-xs text-slate-500">{i.campaign.title}</span>}</td>
                <td className="px-4 py-3"><Badge tone={INVOICE_STATUS[i.displayStatus]?.tone}>{INVOICE_STATUS[i.displayStatus]?.label ?? i.displayStatus}</Badge></td>
                <td className="px-4 py-3 text-slate-600">{i.dueDate ? formatDay(i.dueDate) : '—'}</td>
                <td className="px-4 py-3 tabular-nums">{formatMoney(i.totalMinor, i.currency)}</td>
                <td className="px-4 py-3 tabular-nums">{formatMoney(i.paidMinor, i.currency)}</td>
                <td className="px-4 py-3 tabular-nums font-medium">{formatMoney(i.balanceMinor, i.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
