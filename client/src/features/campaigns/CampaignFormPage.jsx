import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Card, ErrorState, FormField, Input, Select, Skeleton, Textarea, useToast } from '../../components/ui/index.js';
import { clientsApi } from '../clients/api.js';
import { toMajorText, toMinor } from '../clients/money.js';
import { campaignsApi } from './api.js';
import { label } from './parts.jsx';

const EMPTY = {
  client: '', title: '', brief: '', objectives: '', startDate: '', endDate: '', deadline: '',
  currency: '', budget: '', fee: '', requirements: [], reviewRequired: true, approverName: '', reviewNotes: '', notes: '',
};

const fromCampaign = (c) => {
  const currency = c.fee?.currency ?? c.budget?.currency ?? '';
  return {
    client: c.client.id, title: c.title, brief: c.brief ?? '', objectives: c.objectives.join('\n'),
    startDate: c.local.startDate ?? '', endDate: c.local.endDate ?? '', deadline: c.local.deadline ?? '',
    currency, budget: c.budget ? toMajorText(c.budget.amountMinor, currency) : '', fee: c.fee ? toMajorText(c.fee.amountMinor, currency) : '',
    requirements: c.requirements.map((r) => ({ platform: r.platform, format: r.format, quantity: String(r.quantity) })),
    reviewRequired: c.review.required, approverName: c.review.approverName ?? '', reviewNotes: c.review.notes ?? '', notes: c.notes ?? '',
  };
};

const nul = (s) => (s.trim() === '' ? null : s.trim());

/** Returns { payload } or { errors }. These checks mirror the server's, which stays the authority. */
function build(form) {
  const errors = {};
  if (!form.client) errors.client = 'Choose the brand this campaign is for';
  if (!form.title.trim()) errors.title = 'Campaign name is required';
  if (form.startDate && form.endDate && form.endDate < form.startDate) errors.endDate = 'End date must not be before the start date';
  if (form.startDate && form.deadline && form.deadline < form.startDate) errors.deadline = 'Deadline must not be before the start date';

  const cur = form.currency.trim().toUpperCase();
  const money = (key) => {
    if (!form[key].trim()) return null;
    if (!/^[A-Z]{3}$/.test(cur)) {
      errors.currency = 'Use a 3-letter currency code, e.g. INR';
      return null;
    }
    const minor = toMinor(form[key], cur);
    if (minor == null) {
      errors[key] = 'Enter an amount like 1500 or 1500.50';
      return null;
    }
    return { amountMinor: minor, currency: cur };
  };
  const budget = money('budget');
  const fee = money('fee');

  const requirements = [];
  const seen = new Set();
  form.requirements.forEach((r, i) => {
    const q = Number(r.quantity);
    if (!Number.isInteger(q) || q < 1) errors[`requirements.${i}.quantity`] = 'A whole number, at least 1';
    if (seen.has(`${r.platform}/${r.format}`)) errors[`requirements.${i}.format`] = 'Already listed; raise its quantity instead';
    seen.add(`${r.platform}/${r.format}`);
    requirements.push({ platform: r.platform, format: r.format, quantity: q });
  });

  const objectives = form.objectives.split('\n').map((s) => s.trim()).filter(Boolean);
  if (Object.keys(errors).length) return { errors };
  return {
    payload: {
      client: form.client, title: form.title.trim(), brief: nul(form.brief), objectives,
      startDate: form.startDate || null, endDate: form.endDate || null, deadline: form.deadline || null,
      budget, fee, requirements,
      review: { required: form.reviewRequired, approverName: nul(form.approverName), notes: nul(form.reviewNotes) },
      notes: nul(form.notes),
    },
  };
}

export default function CampaignFormPage({ mode }) {
  const { id } = useParams();
  const [search] = useSearchParams();
  const editing = mode === 'edit';
  const navigate = useNavigate();
  const toast = useToast();

  const [meta, setMeta] = useState(null);
  const [brands, setBrands] = useState([]);
  const [form, setForm] = useState({ ...EMPTY, client: search.get('client') ?? '' });
  const [original, setOriginal] = useState(null);
  const [load, setLoad] = useState(editing ? 'loading' : 'ready');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    campaignsApi.meta().then(setMeta).catch(() => {});
    clientsApi.list({ limit: 100 }).then((r) => setBrands(r.data)).catch(() => {});
  }, []);

  const loadCampaign = () => {
    const ctrl = new AbortController();
    campaignsApi
      .get(id, ctrl.signal)
      .then((r) => {
        setOriginal(r.data);
        setForm(fromCampaign(r.data));
        setStale(false);
        setLoad('ready');
      })
      .catch((err) => err.name !== 'AbortError' && setLoad(err.status === 404 ? 'missing' : 'error'));
    return () => ctrl.abort();
  };
  useEffect(() => (editing ? loadCampaign() : undefined), [editing, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new campaign starts in the brand's usual currency.
  async function pickBrand(clientId) {
    setForm((f) => ({ ...f, client: clientId }));
    if (!clientId || form.currency) return;
    try {
      const { data } = await clientsApi.get(clientId);
      if (data.defaultCurrency) setForm((f) => (f.client === clientId && !f.currency ? { ...f, currency: data.defaultCurrency } : f));
    } catch {
      /* optional convenience */
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setReq = (i, patch) => setForm((f) => ({ ...f, requirements: f.requirements.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const err = (path) => errors[path];

  async function onSubmit(e) {
    e.preventDefault();
    setFormError('');
    const built = build(form);
    setErrors(built.errors ?? {});
    if (built.errors) return setFormError('Please fix the highlighted fields.');

    setSaving(true);
    try {
      const res = editing ? await campaignsApi.update(id, { ...built.payload, version: original.version }) : await campaignsApi.create(built.payload);
      toast.success(editing ? 'Changes saved' : 'Campaign created');
      navigate(`/campaigns/${res.data.id}`);
    } catch (ex) {
      setSaving(false);
      if (ex.code === 'STALE_VERSION' || ex.code === 'CONFLICT') return setStale(true);
      const fe = ex.fieldErrors ?? {};
      setErrors({ ...fe, ...(fe['budget.currency'] && { currency: fe['budget.currency'] }), ...(fe['fee.currency'] && { currency: fe['fee.currency'] }) });
      setFormError(ex.code === 'VALIDATION_ERROR' ? 'Please fix the highlighted fields.' : ex.message);
    }
  }

  if (load === 'loading') return <div className="max-w-3xl space-y-4" aria-busy><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (load !== 'ready') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <ErrorState title={load === 'missing' ? 'Campaign not found' : 'Couldn’t load this campaign'} message={load === 'missing' ? 'It may have been deleted, or it belongs to another account.' : 'Please try again.'} onRetry={load === 'missing' ? undefined : loadCampaign} />
        <p className="pb-6 text-center text-sm"><Link to="/campaigns" className="font-medium text-brand-600 hover:underline">Back to Campaigns</Link></p>
      </div>
    );
  }
  const archived = original?.archived;
  // An archived brand is not offered for new campaigns, but a campaign already with one keeps showing it.
  const brandOptions = brands.some((b) => b.id === form.client) || !original ? brands : [{ id: original.client.id, name: original.client.name }, ...brands];

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
      <div>
        <Link to={editing ? `/campaigns/${id}` : '/campaigns'} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {editing ? 'Back to campaign' : 'Back to Campaigns'}
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{editing ? `Edit ${original.title}` : 'New campaign'}</h2>
      </div>

      {archived && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This campaign is archived. Restore it to edit.</p>}
      {formError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
      {stale && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>This campaign was changed elsewhere since you opened it. Reload to see the latest version (your unsaved edits here will be replaced).</span>
          <Button type="button" size="sm" variant="secondary" icon={RefreshCw} onClick={loadCampaign}>Reload</Button>
        </div>
      )}

      <Card title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Brand" required error={err('client')} hint={brands.length === 0 ? 'Add a brand first.' : undefined}>
            {(p) => (
              <Select value={form.client} onChange={(e) => pickBrand(e.target.value)} error={!!err('client')} disabled={archived} {...p}>
                <option value="">Choose a brand…</option>
                {brandOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Campaign name" required error={err('title')}>
            {(p) => <Input value={form.title} onChange={set('title')} error={!!err('title')} maxLength={200} disabled={archived} autoFocus={!editing} {...p} />}
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Brief" error={err('brief')} hint="What the brand asked for, in your words or pasted from their email.">
              {(p) => <Textarea rows={5} value={form.brief} onChange={set('brief')} maxLength={20000} disabled={archived} {...p} />}
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField label="Objectives" error={err('objectives')} hint="One per line, e.g. “Drive sign-ups for the new range”.">
              {(p) => <Textarea rows={3} value={form.objectives} onChange={set('objectives')} disabled={archived} {...p} />}
            </FormField>
          </div>
        </div>
      </Card>

      <Card title="Dates" description="Calendar days in your timezone. The deadline is when the work must be handed over.">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Start date" error={err('startDate')}>{(p) => <Input type="date" value={form.startDate} onChange={set('startDate')} error={!!err('startDate')} disabled={archived} {...p} />}</FormField>
          <FormField label="End date" error={err('endDate')}>{(p) => <Input type="date" value={form.endDate} onChange={set('endDate')} error={!!err('endDate')} disabled={archived} {...p} />}</FormField>
          <FormField label="Deadline" error={err('deadline')}>{(p) => <Input type="date" value={form.deadline} onChange={set('deadline')} error={!!err('deadline')} disabled={archived} {...p} />}</FormField>
        </div>
      </Card>

      <Card title="Money" description="The agreed fee is what counts toward your agreed totals once the campaign is confirmed.">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Currency" error={err('currency')}>{(p) => <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={3} placeholder="e.g. INR" error={!!err('currency')} disabled={archived} {...p} />}</FormField>
          <FormField label="Agreed fee" error={err('fee')}>{(p) => <Input inputMode="decimal" value={form.fee} onChange={set('fee')} placeholder="0.00" error={!!err('fee')} disabled={archived} {...p} />}</FormField>
          <FormField label="Brand’s budget" error={err('budget')} hint="Optional">{(p) => <Input inputMode="decimal" value={form.budget} onChange={set('budget')} placeholder="0.00" error={!!err('budget')} disabled={archived} {...p} />}</FormField>
        </div>
      </Card>

      <Card title="What was asked for" description="Platforms, formats and how many of each. Add the actual deliverables on the campaign page; they are compared against this list.">
        <div className="space-y-3">
          {form.requirements.length === 0 && <p className="text-sm text-slate-500">Nothing listed yet.</p>}
          {form.requirements.map((r, i) => (
            <div key={i} className="grid items-end gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_6rem_auto]">
              <FormField label="Platform">{(p) => <Select value={r.platform} onChange={(e) => setReq(i, { platform: e.target.value })} disabled={archived} {...p}>{(meta?.platforms ?? [r.platform]).map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}</FormField>
              <FormField label="Format" error={err(`requirements.${i}.format`)}>{(p) => <Select value={r.format} onChange={(e) => setReq(i, { format: e.target.value })} error={!!err(`requirements.${i}.format`)} disabled={archived} {...p}>{(meta?.formats ?? [r.format]).map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}</FormField>
              <FormField label="Quantity" error={err(`requirements.${i}.quantity`)}>{(p) => <Input inputMode="numeric" value={r.quantity} onChange={(e) => setReq(i, { quantity: e.target.value })} error={!!err(`requirements.${i}.quantity`)} disabled={archived} {...p} />}</FormField>
              <Button type="button" variant="ghost" size="sm" icon={Trash2} aria-label="Remove this line" onClick={() => setForm((f) => ({ ...f, requirements: f.requirements.filter((_, j) => j !== i) }))} />
            </div>
          ))}
          {form.requirements.length < (meta?.limits.requirements ?? 30) && (
            <Button type="button" variant="secondary" icon={Plus} disabled={archived || !meta} onClick={() => setForm((f) => ({ ...f, requirements: [...f.requirements, { platform: meta.platforms[0], format: meta.formats[0], quantity: '1' }] }))}>Add platform and format</Button>
          )}
        </div>
      </Card>

      <Card title="Review & approval" description="Whether the brand signs off on work before you publish it.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.reviewRequired} onChange={(e) => setForm((f) => ({ ...f, reviewRequired: e.target.checked }))} disabled={archived} />
            The brand must approve deliverables before they are published
          </label>
          <FormField label="Who approves" error={err('review.approverName')}>{(p) => <Input value={form.approverName} onChange={set('approverName')} maxLength={120} placeholder="e.g. Priya from marketing" disabled={archived} {...p} />}</FormField>
          <FormField label="Review notes" hint="e.g. two rounds of changes included">{(p) => <Input value={form.reviewNotes} onChange={set('reviewNotes')} maxLength={2000} disabled={archived} {...p} />}</FormField>
        </div>
      </Card>

      <Card title="Notes">
        <FormField label="Private notes" error={err('notes')} hint="Only you see these.">{(p) => <Textarea rows={4} value={form.notes} onChange={set('notes')} maxLength={20000} disabled={archived} {...p} />}</FormField>
      </Card>

      <div className="flex flex-wrap items-center gap-3 pb-4">
        <Button type="submit" loading={saving} disabled={archived || stale}>{editing ? 'Save changes' : 'Create campaign'}</Button>
        <Button type="button" variant="ghost" onClick={() => navigate(editing ? `/campaigns/${id}` : '/campaigns')}>Cancel</Button>
      </div>
    </form>
  );
}
