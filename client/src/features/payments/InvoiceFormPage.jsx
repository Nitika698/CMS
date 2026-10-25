import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button, Card, ErrorState, FormField, Input, Select, Skeleton, Textarea, useToast } from '../../components/ui/index.js';
import { campaignsApi } from '../campaigns/api.js';
import { clientsApi } from '../clients/api.js';
import { toMajorText, toMinor } from '../clients/money.js';
import { formatMoney } from '../dashboard/format.js';
import { invoicesApi } from './api.js';
import { CURRENCIES, NOT_PROCESSING } from './parts.jsx';

const blankLine = () => ({ description: '', quantity: '1', unit: '', tax: '0' });
const round = (n) => Math.round(n + Number.EPSILON);

/** Mirrors the server's maths for the live preview. The server recalculates and is the only source of truth. */
function preview(lines, currency) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const unit = toMinor(l.unit, currency);
    const qty = Number(l.quantity);
    if (unit === null || !Number.isFinite(qty) || qty <= 0) continue;
    const net = round((Math.round(qty * 1000) * unit) / 1000);
    subtotal += net;
    tax += round((net * (Number(l.tax) || 0)) / 100);
  }
  return { subtotal, tax, total: subtotal + tax };
}

export default function InvoiceFormPage({ mode }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const editing = mode === 'edit';
  const [loaded, setLoaded] = useState(editing ? 'loading' : 'ready');
  const [invoice, setInvoice] = useState(null);
  const [brands, setBrands] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [context, setContext] = useState(null);
  const [form, setForm] = useState({ client: params.get('client') ?? '', campaign: params.get('campaign') ?? '', number: '', currency: '', issueDate: '', dueDate: '', notes: '', billToAddress: '', lines: [blankLine()] });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const issued = invoice?.status === 'sent';

  useEffect(() => {
    clientsApi.list({ limit: 100 }).then((r) => setBrands(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editing) return;
    invoicesApi
      .get(id)
      .then((r) => {
        const i = r.data;
        setInvoice(i);
        setForm({
          client: i.client.id, campaign: i.campaign?.id ?? '', number: i.number, currency: i.currency, issueDate: i.issueDay ?? '', dueDate: i.dueDay ?? '', notes: i.notes ?? '', billToAddress: i.billToAddress ?? '',
          lines: i.lineItems.length ? i.lineItems.map((l) => ({ description: l.description, quantity: String(l.quantity), unit: toMajorText(l.unitAmountMinor, i.currency), tax: String(l.taxRatePct) })) : [blankLine()],
        });
        setLoaded('ready');
      })
      .catch(() => setLoaded('error'));
  }, [editing, id]);

  useEffect(() => {
    if (!form.client) return setCampaigns([]);
    campaignsApi.list({ client: form.client, limit: 100 }).then((r) => setCampaigns(r.data)).catch(() => setCampaigns([]));
  }, [form.client]);

  useEffect(() => {
    if (!form.campaign) return setContext(null);
    invoicesApi.context(form.campaign).then((r) => setContext(r.data)).catch(() => setContext(null));
  }, [form.campaign]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k) => (e) => setForm((f) => ({ ...f, lines: f.lines.map((l, n) => (n === i ? { ...l, [k]: e.target.value } : l)) }));
  const currency = form.currency || context?.fee?.currency || 'USD';
  const totals = useMemo(() => preview(form.lines, currency), [form.lines, currency]);

  function pickCampaign(e) {
    const campaign = e.target.value;
    const c = campaigns.find((x) => x.id === campaign);
    setForm((f) => ({ ...f, campaign, currency: !f.currency && c?.fee ? c.fee.currency : f.currency }));
  }

  function addRemainingFee() {
    if (!context?.fee || context.remainingToInvoiceMinor == null) return;
    setForm((f) => ({
      ...f,
      currency: f.currency || context.fee.currency,
      lines: [...f.lines.filter((l) => l.description || l.unit), { description: `${context.campaign.title} (balance of agreed fee)`, quantity: '1', unit: toMajorText(context.remainingToInvoiceMinor, context.fee.currency), tax: '0' }],
    }));
  }

  function buildPayload() {
    const fe = {};
    const lineItems = [];
    form.lines.forEach((l, i) => {
      if (!l.description.trim() && !l.unit.trim()) return; // an untouched row is ignored
      const unitAmountMinor = toMinor(l.unit, currency);
      const quantity = Number(l.quantity);
      if (!l.description.trim()) fe[`lineItems.${i}.description`] = 'Describe this line';
      if (unitAmountMinor === null) fe[`lineItems.${i}.unitAmountMinor`] = `Enter an amount like 1500.00 (${currency})`;
      if (!Number.isFinite(quantity) || quantity <= 0) fe[`lineItems.${i}.quantity`] = 'More than 0';
      lineItems.push({ description: l.description.trim(), quantity, unitAmountMinor: unitAmountMinor ?? 0, taxRatePct: Number(l.tax) || 0 });
    });
    return { fe, lineItems };
  }

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    const { fe, lineItems } = buildPayload();
    if (!form.client) fe.client = 'Choose a brand';
    if (Object.keys(fe).length) return setErrors(fe);
    setBusy(true);
    try {
      let saved;
      if (issued) {
        saved = (await invoicesApi.update(id, { dueDate: form.dueDate || null, notes: form.notes, version: invoice.version })).data;
      } else {
        const body = { client: form.client, campaign: form.campaign || null, currency, issueDate: form.issueDate || null, dueDate: form.dueDate || null, lineItems, notes: form.notes, billToAddress: form.billToAddress };
        if (form.number.trim() && (!editing || form.number !== invoice.number)) body.number = form.number.trim();
        saved = (editing ? await invoicesApi.update(id, { ...body, version: invoice.version }) : await invoicesApi.create(body)).data;
      }
      toast.success(editing ? 'Invoice saved' : 'Draft created');
      navigate(`/payments/${saved.id}`);
    } catch (ex) {
      if (ex.code === 'STALE_VERSION') toast.error('This invoice was changed elsewhere. Reload the page to see the latest version.');
      else if (ex.fieldErrors && Object.keys(ex.fieldErrors).length) setErrors(ex.fieldErrors);
      else toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }

  if (loaded === 'loading') return <Skeleton className="h-96 w-full" />;
  if (loaded === 'error') return <ErrorState title="Couldn’t load this invoice" onRetry={() => window.location.reload()} />;
  if (invoice?.status === 'void') return <ErrorState title="This invoice is cancelled" message="Cancelled invoices cannot be changed." />;
  const lock = issued; // issued invoices keep amounts, brand and number
  const lineError = (i, k) => errors[`lineItems.${i}.${k}`];

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-6" noValidate>
      <div>
        <Link to={editing ? `/payments/${id}` : '/payments'} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> {editing ? 'Back to invoice' : 'All invoices'}</Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{editing ? `Edit ${invoice.number}` : 'New invoice'}</h2>
        <p className="mt-1 text-sm text-slate-500">{NOT_PROCESSING}</p>
        {lock && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This invoice is issued, so its amounts, brand and number are locked. You can still change the due date and notes. To change the rest, move it back to draft (only possible before any payment) or cancel it and raise a new one.</p>}
      </div>

      <Card title="Who and what">
        <fieldset disabled={lock} className="grid gap-4 sm:grid-cols-2">
          <FormField label="Brand" required error={errors.client}>
            {(p) => (
              <Select {...p} value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value, campaign: '' }))} error={errors.client}>
                <option value="">Choose a brand…</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Campaign" error={errors.campaign} hint={form.client ? undefined : 'Choose a brand first'}>
            {(p) => (
              <Select {...p} value={form.campaign} onChange={pickCampaign} disabled={!form.client}>
                <option value="">No campaign</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Invoice number" error={errors.number} hint={editing ? undefined : 'Leave blank to number it automatically'}>
            {(p) => <Input {...p} value={form.number} onChange={set('number')} maxLength={40} placeholder="INV-0001" error={errors.number} />}
          </FormField>
          <FormField label="Currency" error={errors.currency}>
            {(p) => (
              <Select {...p} value={currency} onChange={set('currency')}>
                {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
              </Select>
            )}
          </FormField>
        </fieldset>
        {context?.fee && (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="fee-context">
            Agreed fee <strong>{formatMoney(context.fee.amountMinor, context.fee.currency)}</strong>
            {context.invoiced.find((x) => x.currency === context.fee.currency) && <> · already invoiced <strong>{formatMoney(context.invoiced.find((x) => x.currency === context.fee.currency).invoiced, context.fee.currency)}</strong></>}
            {' '}· left to invoice <strong>{formatMoney(context.remainingToInvoiceMinor, context.fee.currency)}</strong>
            {!lock && context.remainingToInvoiceMinor > 0 && <button type="button" className="ml-2 font-medium text-brand-700 underline" onClick={addRemainingFee}>Add as a line</button>}
          </p>
        )}
      </Card>

      <Card title="Line items" description="Amounts are in the invoice currency. Tax is worked out per line.">
        <fieldset disabled={lock} className="space-y-3">
          {form.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 rounded-lg border border-slate-200 p-3">
              <div className="col-span-12 sm:col-span-5">
                <FormField label="Description" error={lineError(i, 'description')}>{(p) => <Input {...p} value={l.description} onChange={setLine(i, 'description')} maxLength={300} placeholder="e.g. Instagram reel" error={lineError(i, 'description')} />}</FormField>
              </div>
              <div className="col-span-4 sm:col-span-2"><FormField label="Qty" error={lineError(i, 'quantity')}>{(p) => <Input {...p} inputMode="decimal" value={l.quantity} onChange={setLine(i, 'quantity')} error={lineError(i, 'quantity')} />}</FormField></div>
              <div className="col-span-5 sm:col-span-2"><FormField label="Unit price" error={lineError(i, 'unitAmountMinor')}>{(p) => <Input {...p} inputMode="decimal" value={l.unit} onChange={setLine(i, 'unit')} placeholder="0.00" error={lineError(i, 'unitAmountMinor')} />}</FormField></div>
              <div className="col-span-3 sm:col-span-2"><FormField label="Tax %" error={lineError(i, 'taxRatePct')}>{(p) => <Input {...p} inputMode="decimal" value={l.tax} onChange={setLine(i, 'tax')} error={lineError(i, 'taxRatePct')} />}</FormField></div>
              <div className="col-span-12 flex items-end justify-end sm:col-span-1">
                <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove line ${i + 1}`} disabled={form.lines.length === 1} onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, n) => n !== i) }))} />
              </div>
            </div>
          ))}
          {errors.lineItems && <p className="text-sm text-red-600">{errors.lineItems}</p>}
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>Add line</Button>
        </fieldset>
        <dl className="mt-5 ml-auto w-full max-w-xs space-y-1 text-sm" aria-label="Totals preview">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{formatMoney(totals.subtotal, currency)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd className="tabular-nums">{formatMoney(totals.tax, currency)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(totals.total, currency)}</dd></div>
        </dl>
      </Card>

      <Card title="Dates and notes">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Issue date" error={errors.issueDate} hint="Set when you issue it if left blank">
            {(p) => <Input {...p} type="date" value={form.issueDate} onChange={set('issueDate')} disabled={lock} error={errors.issueDate} />}
          </FormField>
          <FormField label="Due date" error={errors.dueDate} hint="Defaults from your payment terms when you issue it">
            {(p) => <Input {...p} type="date" value={form.dueDate} onChange={set('dueDate')} error={errors.dueDate} />}
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Brand billing address" error={errors.billToAddress}>
              {(p) => <Textarea {...p} rows={3} value={form.billToAddress} onChange={set('billToAddress')} disabled={lock} maxLength={500} error={errors.billToAddress} />}
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField label="Notes" error={errors.notes} hint="Printed at the bottom of the invoice">
              {(p) => <Textarea {...p} rows={3} value={form.notes} onChange={set('notes')} maxLength={2000} error={errors.notes} />}
            </FormField>
          </div>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate(editing ? `/payments/${id}` : '/payments')} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>{editing ? 'Save invoice' : 'Save draft'}</Button>
      </div>
    </form>
  );
}
