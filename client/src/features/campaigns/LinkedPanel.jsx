import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Unlink } from 'lucide-react';
import { Badge, Button, Card, Select, useToast } from '../../components/ui/index.js';
import { formatDay } from '../content/dates.js';
import { contentApi } from '../content/api.js';
import { formatMoney, timeAgo } from '../dashboard/format.js';
import { INVOICE_STATUS } from '../clients/constants.js';
import { campaignsApi } from './api.js';

const Empty = ({ children }) => <p className="text-sm text-slate-500">{children}</p>;

function ContentCard({ campaign, locked, onChanged }) {
  const toast = useToast();
  const [options, setOptions] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const attached = new Set(campaign.deliverables.map((d) => d.content?.id).filter(Boolean));

  useEffect(() => {
    if (locked) return;
    contentApi.list({ limit: 100 }).then((r) => setOptions(r.data.filter((c) => !c.campaign))).catch(() => {});
  }, [locked, campaign.linked.content.length]);

  async function run(fn, done) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      setPick('');
      onChanged();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Content" description="Posts and videos you are making for this campaign.">
      {campaign.linked.content.length === 0 ? <Empty>No content linked yet.</Empty> : (
        <ul className="divide-y divide-slate-100">
          {campaign.linked.content.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <Link to={`/content/${c.id}`} className="block truncate font-medium text-slate-900 hover:text-brand-700 hover:underline">{c.title}</Link>
                <span className="text-xs text-slate-500">{c.type}{c.deadline ? ` · due ${formatDay(c.deadline)}` : ''}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={c.status === 'published' ? 'success' : 'neutral'}>{c.statusLabel}</Badge>
                {!locked && !attached.has(c.id) && <Button size="sm" variant="ghost" icon={Unlink} aria-label={`Unlink ${c.title}`} disabled={busy} onClick={() => run(() => campaignsApi.unlinkContent(campaign.id, c.id), 'Content unlinked')} />}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!locked && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Select aria-label="Link existing content" className="max-w-xs" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{options.length ? 'Link existing content…' : 'No unlinked content available'}</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
          <Button size="sm" variant="secondary" icon={Plus} disabled={!pick} loading={busy} onClick={() => run(() => campaignsApi.linkContent(campaign.id, pick), 'Content linked')}>Link</Button>
          <Link to="/content/new" className="text-sm font-medium text-brand-700 hover:underline">Create new content</Link>
        </div>
      )}
    </Card>
  );
}

export default function LinkedPanel({ campaign, locked, onChanged }) {
  const { tasks, communications, invoices, invoiceTotals } = campaign.linked;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ContentCard campaign={campaign} locked={locked} onChanged={onChanged} />

      <Card title="Tasks" description="Tasks that point at this campaign." action={!locked && <Link to={`/tasks?new=1&forCampaign=${campaign.id}`} className="text-sm font-medium text-brand-700 hover:underline">Add task</Link>}>
        {tasks.length === 0 ? <Empty>No tasks linked yet.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link to={`/tasks?task=${t.id}`} className="min-w-0 truncate text-slate-900 hover:text-brand-700 hover:underline">{t.title}</Link>
                <span className="flex items-center gap-2">
                  {t.dueAt && <span className={`text-xs ${t.overdue ? 'font-medium text-red-700' : 'text-slate-500'}`}>{t.overdue ? 'Overdue · ' : ''}{formatDay(t.dueAt)}</span>}
                  <Badge tone={t.status === 'done' ? 'success' : 'neutral'}>{t.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Communications" description="Saved discussions about this campaign.">
        {communications.length === 0 ? <Empty>No discussions saved for this campaign.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {communications.map((c) => (
              <li key={c.id} className="py-2 text-sm">
                <Link to={`/brands/${c.clientId}?tab=discussions`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{c.subject ?? `${c.channel} (${c.direction})`}</Link>
                <p className="text-xs text-slate-500">{c.channel} · {c.direction} · {timeAgo(c.occurredAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Invoices" description="Money billed for this campaign." action={!locked && <Link to={`/payments/new?client=${campaign.client.id}&campaign=${campaign.id}`} className="text-sm font-medium text-brand-700 hover:underline">New invoice</Link>}>
        {invoices.length === 0 ? <Empty>No invoices for this campaign yet.</Empty> : (
          <>
            <ul className="divide-y divide-slate-100">
              {invoices.map((i) => {
                const st = INVOICE_STATUS[i.displayStatus] ?? { label: i.displayStatus, tone: 'neutral' };
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link to={`/payments/${i.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{i.number}</Link>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums text-slate-700">{formatMoney(i.totalMinor, i.currency)}</span>
                      {i.balanceMinor > 0 && <span className="text-xs text-slate-500">{formatMoney(i.balanceMinor, i.currency)} outstanding</span>}
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-sm">
              {invoiceTotals.map((t) => (
                <div key={t.currency}><dt className="inline text-slate-500">Collected {t.currency}: </dt><dd className="inline font-medium tabular-nums">{formatMoney(t.collected, t.currency)} of {formatMoney(t.invoiced, t.currency)}</dd></div>
              ))}
            </dl>
          </>
        )}
      </Card>
    </div>
  );
}
