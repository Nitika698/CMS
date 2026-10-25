import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2, Download, Info, Pencil, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { Badge, Button, Card, ErrorState, FormField, Input, Modal, Select, Skeleton, Textarea, useToast } from '../../components/ui/index.js';
import { toMajorText, toMinor } from '../clients/money.js';
import { formatMoney } from '../dashboard/format.js';
import { invoicesApi } from './api.js';
import { DueText, InvoiceBadge, NOT_PROCESSING, ymdLabel } from './parts.jsx';

const todayYmd = () => new Date().toLocaleDateString('en-CA'); // the browser's local day, YYYY-MM-DD

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

function Party({ title, p }) {
  if (!p) return null;
  return (
    <div className="min-w-0 text-sm">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <p className="font-medium text-slate-900">{p.name}</p>
      {[p.contactName, p.address, p.email, p.phone, p.website, p.taxId && `${p.taxIdLabel || 'Tax ID'}: ${p.taxId}`].filter(Boolean).map((x) => <p key={x} className="whitespace-pre-line break-words text-slate-600">{x}</p>)}
    </div>
  );
}

function IssueDialog({ open, invoice, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ issueDate: '', dueDate: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ issueDate: invoice.issueDay ?? todayYmd(), dueDate: invoice.dueDay ?? '' });
      setErrors({});
    }
  }, [open, invoice]);
  async function go(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await invoicesApi.issue(invoice.id, { issueDate: form.issueDate || undefined, ...(form.dueDate ? { dueDate: form.dueDate } : {}) });
      toast.success('Invoice issued');
      onDone();
    } catch (ex) {
      if (ex.fieldErrors && Object.keys(ex.fieldErrors).length) setErrors(ex.fieldErrors);
      else toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Issue ${invoice.number}`} footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form="issue-form" loading={busy}>Issue invoice</Button></>}>
      <form id="issue-form" onSubmit={go} className="space-y-4" noValidate>
        <p className="text-sm text-slate-600">Issuing locks the amounts, brand and number and keeps a copy of your business details as they are now. It does not send anything to the brand. Give them the downloaded file yourself.</p>
        {errors.lineItems && <p className="text-sm text-red-600">{errors.lineItems}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Issue date" error={errors.issueDate}>{(p) => <Input {...p} type="date" value={form.issueDate} onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))} error={errors.issueDate} />}</FormField>
          <FormField label="Due date" error={errors.dueDate} hint="Blank = issue date + payment terms">{(p) => <Input {...p} type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} error={errors.dueDate} />}</FormField>
        </div>
      </form>
    </Modal>
  );
}

function PaymentDialog({ open, invoice, payment, meta, onClose, onDone }) {
  const toast = useToast();
  const editing = !!payment;
  const [form, setForm] = useState({ amount: '', paidOn: '', kind: 'installment', method: '', reference: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      payment
        ? { amount: toMajorText(payment.amountMinor, invoice.currency), paidOn: payment.paidOn, kind: payment.kind, method: payment.method ?? '', reference: payment.reference ?? '', notes: payment.notes ?? '' }
        : { amount: toMajorText(invoice.balanceMinor, invoice.currency), paidOn: todayYmd(), kind: invoice.paidMinor === 0 ? 'advance' : 'installment', method: '', reference: '', notes: '' },
    );
  }, [open, payment, invoice]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function go(e) {
    e.preventDefault();
    const amountMinor = toMinor(form.amount, invoice.currency);
    if (amountMinor === null || amountMinor < 1) return setErrors({ amountMinor: `Enter an amount like 250.00 (${invoice.currency})` });
    setBusy(true);
    setErrors({});
    const body = { amountMinor, paidOn: form.paidOn || undefined, kind: form.kind, method: form.method || null, reference: form.reference, notes: form.notes };
    try {
      await (editing ? invoicesApi.updatePayment(invoice.id, payment.id, body) : invoicesApi.addPayment(invoice.id, body));
      toast.success(editing ? 'Payment updated' : 'Payment recorded');
      onDone();
    } catch (ex) {
      if (ex.code === 'OVERPAYMENT') setErrors({ amountMinor: `That is more than is still owed (${formatMoney(ex.body?.error?.details?.balanceMinor ?? 0, invoice.currency)}).` });
      else if (ex.fieldErrors && Object.keys(ex.fieldErrors).length) setErrors(ex.fieldErrors);
      else toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit payment' : 'Record a payment'} footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form="payment-form" loading={busy}>{editing ? 'Save payment' : 'Record payment'}</Button></>}>
      <form id="payment-form" onSubmit={go} className="space-y-4" noValidate>
        <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Record money you have <strong>already received</strong> (bank, UPI, PayPal…). Nothing is charged from here.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={`Amount (${invoice.currency})`} required error={errors.amountMinor} hint={`Still owed: ${formatMoney(invoice.balanceMinor + (payment?.amountMinor ?? 0), invoice.currency)}`}>{(p) => <Input {...p} inputMode="decimal" value={form.amount} onChange={set('amount')} autoFocus error={errors.amountMinor} />}</FormField>
          <FormField label="Date received" error={errors.paidOn}>{(p) => <Input {...p} type="date" max={todayYmd()} value={form.paidOn} onChange={set('paidOn')} error={errors.paidOn} />}</FormField>
          <FormField label="Type" error={errors.kind}>{(p) => <Select {...p} value={form.kind} onChange={set('kind')}>{meta.paymentKinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select>}</FormField>
          <FormField label="Method" error={errors.method}>{(p) => <Select {...p} value={form.method} onChange={set('method')}><option value="">Not specified</option>{meta.paymentMethods.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select>}</FormField>
        </div>
        <FormField label="Reference" error={errors.reference}>{(p) => <Input {...p} value={form.reference} onChange={set('reference')} maxLength={100} placeholder="Transaction id, cheque number…" error={errors.reference} />}</FormField>
        <FormField label="Notes" error={errors.notes}>{(p) => <Textarea {...p} rows={2} value={form.notes} onChange={set('notes')} maxLength={300} error={errors.notes} />}</FormField>
      </form>
    </Modal>
  );
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState({ status: 'loading', invoice: null, error: null });
  const [meta, setMeta] = useState({ paymentKinds: [], paymentMethods: [] });
  const [dialog, setDialog] = useState(null); // 'issue' | 'payment' | 'cancel' | 'delete' | { removePayment }
  const [editPayment, setEditPayment] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    invoicesApi
      .get(id)
      .then((r) => setState({ status: 'ready', invoice: r.data, error: null }))
      .catch((err) => setState({ status: 'error', invoice: null, error: err }));
  }, [id]);
  useEffect(() => {
    load();
    invoicesApi.meta().then(setMeta).catch(() => {});
  }, [load]);

  async function act(fn, done, after) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      setDialog(null);
      if (after) after();
      else load();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') return <div className="space-y-4" aria-hidden><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (state.status === 'error') return <ErrorState title={state.error?.status === 404 ? 'Invoice not found' : 'Couldn’t load this invoice'} message={state.error?.message} onRetry={load} />;
  const i = state.invoice;
  const a = i.actions;
  const done = () => { setDialog(null); setEditPayment(null); load(); };

  return (
    <div className="space-y-6">
      <div>
        <Link to="/payments" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> All invoices</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900">{i.number} <InvoiceBadge invoice={i} /></h2>
            <p className="mt-1 text-sm text-slate-600">
              <Link to={`/brands/${i.client.id}`} className="font-medium text-brand-700 hover:underline">{i.client.name}</Link>
              {i.campaign && <> · <Link to={`/campaigns/${i.campaign.id}`} className="hover:underline">{i.campaign.title}</Link></>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Download} onClick={() => invoicesApi.downloadFile(i.id).catch((ex) => toast.error(ex.message))}>Download</Button>
            {a.edit && <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/payments/${i.id}/edit`)}>Edit</Button>}
            {a.issue && <Button icon={Send} onClick={() => setDialog('issue')}>Issue</Button>}
            {a.recordPayment && <Button icon={Plus} onClick={() => { setEditPayment(null); setDialog('payment'); }}>Record payment</Button>}
          </div>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900" role="note"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {NOT_PROCESSING} Downloading or sharing this invoice never marks it paid. Only a payment you record does.</p>

      {i.status === 'void' && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">Cancelled{i.voidReason ? `: ${i.voidReason}` : ''}. It is kept for your records and is not counted in any total.</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total" value={formatMoney(i.totalMinor, i.currency)} />
        <Tile label="Received" value={formatMoney(i.paidMinor, i.currency)} />
        <Tile label="Balance" value={i.status === 'sent' ? formatMoney(i.balanceMinor, i.currency) : '—'} tone={i.displayStatus === 'overdue' ? 'text-red-700' : undefined} />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Due</p>
          <p className="mt-2 text-sm"><DueText invoice={i} /></p>
          <p className="mt-1 text-xs text-slate-500">Issued: {ymdLabel(i.issueDay)}</p>
        </div>
      </div>

      <Card title="Lines">
        {i.lineItems.length === 0 ? <p className="text-sm text-slate-500">No lines yet. Edit the draft to add what you are charging for.</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-slate-500">{['Description', 'Qty', 'Unit price', 'Tax', 'Amount'].map((h, n) => <th key={h} scope="col" className={`py-2 pr-3 font-medium ${n ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {i.lineItems.map((l, n) => (
                  <tr key={n}>
                    <td className="py-2 pr-3">{l.description}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.quantity}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(l.unitAmountMinor, i.currency)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.taxRatePct ? `${l.taxRatePct}%` : '—'}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{formatMoney(l.amountMinor, i.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{formatMoney(i.subtotalMinor, i.currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd className="tabular-nums">{formatMoney(i.taxMinor, i.currency)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(i.totalMinor, i.currency)}</dd></div>
            </dl>
          </div>
        )}
      </Card>

      <Card
        title="Payments received"
        description="Advance, partial and final payments you have recorded. The balance is worked out from these."
        action={a.recordPayment ? <Button size="sm" icon={Plus} onClick={() => { setEditPayment(null); setDialog('payment'); }}>Record payment</Button> : null}
      >
        {i.payments.length === 0 ? (
          <p className="text-sm text-slate-500">{i.status === 'draft' ? 'Issue the invoice before recording payments.' : i.status === 'void' ? 'No payments.' : 'No payments recorded yet.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {i.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums text-slate-900">{formatMoney(p.amountMinor, p.currency)} <Badge>{p.kindLabel}</Badge></p>
                  <p className="text-xs text-slate-500">{ymdLabel(p.paidOn)}{p.methodLabel ? ` · ${p.methodLabel}` : ''}{p.reference ? ` · ${p.reference}` : ''}</p>
                </div>
                {i.status === 'sent' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit payment of ${formatMoney(p.amountMinor, p.currency)}`} onClick={() => { setEditPayment(p); setDialog('payment'); }} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove payment of ${formatMoney(p.amountMinor, p.currency)}`} onClick={() => setDialog({ removePayment: p })} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Details">
        <div className="grid gap-6 sm:grid-cols-2">
          <Party title="From" p={i.issuer} />
          <Party title="Bill to" p={i.billTo} />
        </div>
        {!i.issuer && <p className="text-sm text-slate-500">Your business details and the brand's are copied onto the invoice when you issue it. Set yours in <Link to="/settings" className="font-medium text-brand-700 hover:underline">Settings</Link>.</p>}
        {i.paymentInstructions && <div className="mt-4"><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment instructions</h3><p className="whitespace-pre-line text-sm text-slate-700">{i.paymentInstructions}</p></div>}
        {i.notes && <div className="mt-4"><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</h3><p className="whitespace-pre-line text-sm text-slate-700">{i.notes}</p></div>}
      </Card>

      <div className="flex flex-wrap gap-2">
        {a.revert && <Button variant="secondary" size="sm" icon={Undo2} disabled={busy} onClick={() => act(() => invoicesApi.revert(i.id), 'Moved back to draft')}>Back to draft</Button>}
        {a.cancel && <Button variant="secondary" size="sm" icon={Ban} onClick={() => { setReason(''); setDialog('cancel'); }}>Cancel invoice</Button>}
        {a.delete && <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDialog('delete')}>Delete draft</Button>}
        {i.status === 'sent' && !a.cancel && <p className="flex items-center gap-1 text-xs text-slate-500"><CheckCircle2 className="h-4 w-4" aria-hidden /> Payments are recorded, so this invoice can’t be cancelled or moved back to draft.</p>}
      </div>

      <IssueDialog open={dialog === 'issue'} invoice={i} onClose={() => setDialog(null)} onDone={done} />
      <PaymentDialog open={dialog === 'payment'} invoice={i} payment={editPayment} meta={meta} onClose={() => { setDialog(null); setEditPayment(null); }} onDone={done} />

      <Modal open={dialog === 'cancel'} onClose={() => setDialog(null)} title={`Cancel ${i.number}?`} size="sm" footer={<><Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>Keep invoice</Button><Button variant="danger" loading={busy} onClick={() => act(() => invoicesApi.cancel(i.id, reason), 'Invoice cancelled')}>Cancel invoice</Button></>}>
        <p className="text-sm text-slate-600">A cancelled invoice is final. It stays in your records but no longer counts as money owed.</p>
        <div className="mt-3"><FormField label="Reason (optional)">{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</FormField></div>
      </Modal>

      <Modal open={dialog === 'delete'} onClose={() => setDialog(null)} title="Delete this draft?" size="sm" footer={<><Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>Keep</Button><Button variant="danger" loading={busy} onClick={() => act(() => invoicesApi.remove(i.id), 'Draft deleted', () => navigate('/payments'))}>Delete draft</Button></>}>
        <p className="text-sm text-slate-600">{i.number} will be removed for good. Drafts have no payments and are not counted anywhere.</p>
      </Modal>

      <Modal open={!!dialog?.removePayment} onClose={() => setDialog(null)} title="Remove this payment?" size="sm" footer={<><Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>Keep</Button><Button variant="danger" loading={busy} onClick={() => act(() => invoicesApi.removePayment(i.id, dialog.removePayment.id), 'Payment removed')}>Remove payment</Button></>}>
        <p className="text-sm text-slate-600">{dialog?.removePayment && `${formatMoney(dialog.removePayment.amountMinor, dialog.removePayment.currency)} received on ${ymdLabel(dialog.removePayment.paidOn)}`} will be taken off this invoice and the balance will go up. Use this to correct a mistake.</p>
      </Modal>
    </div>
  );
}
