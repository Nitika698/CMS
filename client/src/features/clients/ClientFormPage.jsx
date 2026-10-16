import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Card, ErrorState, FormField, Input, Select, Skeleton, Textarea, useToast } from '../../components/ui/index.js';
import { toDateInput } from '../content/dates.js';
import { clientsApi } from './api.js';
import { CHANNEL_LABEL, RATE_UNIT_LABEL, SOCIAL_LABEL, STATUS_LABEL, TYPE_LABEL } from './constants.js';
import { toMajorText, toMinor } from './money.js';
import { useClientMeta } from './useClientMeta.js';

const blankContact = () => ({ id: undefined, name: '', role: '', email: '', phone: '', isPrimary: false });
const blankLink = () => ({ platform: 'instagram', url: '' });
const blankRate = (currency = 'USD') => ({ label: '', amount: '', currency, unit: 'per_post', notes: '' });

const EMPTY = {
  name: '', type: 'brand', status: 'lead', website: '', industry: '', category: '',
  contacts: [], socialLinks: [], pref: { channel: '', bestTime: '', notes: '' }, collaborationNotes: '',
  rates: [], defaultCurrency: '', paymentTermsDays: '', terms: { exclusivity: '', usageRights: '', other: '' },
  followUpAt: '', followUpNote: '',
};

const fromClient = (c) => ({
  name: c.name, type: c.type, status: c.status, website: c.website ?? '', industry: c.industry ?? '', category: c.category ?? '',
  contacts: c.contacts.map((x) => ({ id: x.id, name: x.name, role: x.role ?? '', email: x.email ?? '', phone: x.phone ?? '', isPrimary: x.isPrimary })),
  socialLinks: c.socialLinks.map((s) => ({ platform: s.platform, url: s.url })),
  pref: { channel: c.contactPreferences.channel ?? '', bestTime: c.contactPreferences.bestTime ?? '', notes: c.contactPreferences.notes ?? '' },
  collaborationNotes: c.collaborationNotes ?? '',
  rates: c.rates.map((r) => ({ label: r.label, amount: toMajorText(r.amountMinor, r.currency), currency: r.currency, unit: r.unit, notes: r.notes ?? '' })),
  defaultCurrency: c.defaultCurrency ?? '', paymentTermsDays: c.paymentTermsDays == null ? '' : String(c.paymentTermsDays),
  terms: { exclusivity: c.terms.exclusivity ?? '', usageRights: c.terms.usageRights ?? '', other: c.terms.other ?? '' },
  followUpAt: toDateInput(c.followUpAt), followUpNote: c.followUpNote ?? '',
});

const nul = (s) => (s.trim() === '' ? null : s.trim());

/** Returns { payload } or { errors } (client-side checks mirror the server's, which stays the authority). */
function build(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Brand name is required';

  const contacts = [];
  form.contacts.forEach((c, i) => {
    const any = c.name.trim() || c.role.trim() || c.email.trim() || c.phone.trim();
    if (!any) return;
    if (!c.name.trim()) errors[`contacts.${i}.name`] = 'Contact name is required';
    if (c.email.trim() && !/^\S+@\S+\.\S+$/.test(c.email.trim())) errors[`contacts.${i}.email`] = 'Enter a valid email address';
    if (c.phone.trim() && !/^\+?[\d\s().-]{6,30}$/.test(c.phone.trim())) errors[`contacts.${i}.phone`] = 'Enter a valid phone number';
    contacts.push({ ...(c.id && { id: c.id }), name: c.name.trim(), role: nul(c.role), email: nul(c.email), phone: nul(c.phone), isPrimary: c.isPrimary });
  });

  const socialLinks = form.socialLinks.filter((s) => s.url.trim()).map((s) => ({ platform: s.platform, url: s.url.trim() }));

  const rates = [];
  form.rates.forEach((r, i) => {
    if (!r.label.trim() && !r.amount.trim()) return;
    if (!r.label.trim()) errors[`rates.${i}.label`] = 'Describe what this rate is for';
    const cur = (r.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) errors[`rates.${i}.currency`] = 'Use a 3-letter currency code';
    const minor = toMinor(r.amount, cur || 'USD');
    if (minor == null) errors[`rates.${i}.amountMinor`] = 'Enter an amount like 1500 or 1500.50';
    rates.push({ label: r.label.trim(), amountMinor: minor ?? 0, currency: cur, unit: r.unit, notes: nul(r.notes) });
  });

  let paymentTermsDays = null;
  if (form.paymentTermsDays.trim()) {
    paymentTermsDays = Number(form.paymentTermsDays);
    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) errors.paymentTermsDays = 'Whole days from 0 to 365';
  }
  if (form.defaultCurrency.trim() && !/^[A-Za-z]{3}$/.test(form.defaultCurrency.trim())) errors.defaultCurrency = 'Use a 3-letter currency code';
  if (contacts.filter((c) => c.isPrimary).length > 1) errors.contacts = 'Only one contact can be primary';

  if (Object.keys(errors).length) return { errors };
  return {
    payload: {
      name: form.name.trim(), type: form.type, status: form.status,
      website: nul(form.website), industry: nul(form.industry), category: nul(form.category),
      contacts, socialLinks,
      contactPreferences: { channel: form.pref.channel || null, bestTime: nul(form.pref.bestTime), notes: nul(form.pref.notes) },
      collaborationNotes: nul(form.collaborationNotes),
      rates, defaultCurrency: nul(form.defaultCurrency)?.toUpperCase() ?? null, paymentTermsDays,
      terms: { exclusivity: nul(form.terms.exclusivity), usageRights: nul(form.terms.usageRights), other: nul(form.terms.other) },
      followUpAt: form.followUpAt || null, followUpNote: form.followUpAt ? nul(form.followUpNote) : null,
    },
  };
}

function Row({ children, onRemove, label }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      <div className="mt-2 flex justify-end">
        <Button type="button" variant="ghost" size="sm" icon={Trash2} onClick={onRemove}>Remove {label}</Button>
      </div>
    </div>
  );
}

export default function ClientFormPage({ mode }) {
  const { id } = useParams();
  const editing = mode === 'edit';
  const navigate = useNavigate();
  const toast = useToast();
  const { meta, refresh: refreshMeta } = useClientMeta();

  const [form, setForm] = useState(EMPTY);
  const [original, setOriginal] = useState(null);
  const [load, setLoad] = useState(editing ? 'loading' : 'ready');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [duplicate, setDuplicate] = useState(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadClient = () => {
    const ctrl = new AbortController();
    clientsApi
      .get(id, ctrl.signal)
      .then((r) => {
        setOriginal(r.data);
        setForm(fromClient(r.data));
        setStale(false);
        setLoad('ready');
      })
      .catch((err) => err.name !== 'AbortError' && setLoad(err.status === 404 ? 'missing' : 'error'));
    return () => ctrl.abort();
  };
  useEffect(() => (editing ? loadClient() : undefined), [editing, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setIn = (group, k) => (e) => setForm((f) => ({ ...f, [group]: { ...f[group], [k]: e.target.value } }));
  const setRow = (list, i, patch) => setForm((f) => ({ ...f, [list]: f[list].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const addRow = (list, row) => setForm((f) => ({ ...f, [list]: [...f[list], row] }));
  const dropRow = (list, i) => setForm((f) => ({ ...f, [list]: f[list].filter((_, j) => j !== i) }));
  const err = (path) => errors[path];

  async function onSubmit(e) {
    e.preventDefault();
    setFormError('');
    setDuplicate(null);
    const built = build(form);
    setErrors(built.errors ?? {});
    if (built.errors) return setFormError('Please fix the highlighted fields.');

    setSaving(true);
    try {
      const res = editing ? await clientsApi.update(id, { ...built.payload, version: original.version }) : await clientsApi.create(built.payload);
      toast.success(editing ? 'Changes saved' : 'Brand created');
      refreshMeta();
      navigate(`/brands/${res.data.id}`);
    } catch (ex) {
      setSaving(false);
      if (ex.code === 'DUPLICATE_NAME') {
        setErrors({ name: 'You already have a brand with this name.' });
        setDuplicate(ex.body?.error?.details?.existingId ?? null);
        return;
      }
      if (ex.code === 'STALE_VERSION' || ex.code === 'CONFLICT') return setStale(true);
      setErrors(ex.fieldErrors ?? {});
      setFormError(ex.code === 'VALIDATION_ERROR' ? 'Please fix the highlighted fields.' : ex.message);
    }
  }

  if (load === 'loading') return <div className="max-w-3xl space-y-4" aria-busy><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (load !== 'ready') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <ErrorState title={load === 'missing' ? 'Brand not found' : 'Couldn’t load this brand'} message={load === 'missing' ? 'It may have been deleted, or it belongs to another account.' : 'Please try again.'} onRetry={load === 'missing' ? undefined : loadClient} />
        <p className="pb-6 text-center text-sm"><Link to="/brands" className="font-medium text-brand-600 hover:underline">Back to Brands</Link></p>
      </div>
    );
  }
  const archived = original?.archived;

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
      <div>
        <Link to={editing ? `/brands/${id}` : '/brands'} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {editing ? 'Back to brand' : 'Back to Brands'}
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{editing ? `Edit ${original.name}` : 'New brand'}</h2>
      </div>

      {archived && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This brand is archived. Restore it to edit.</p>}
      {formError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
      {stale && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>This brand was changed elsewhere since you opened it. Reload to see the latest version (your unsaved edits here will be replaced).</span>
          <Button type="button" size="sm" variant="secondary" icon={RefreshCw} onClick={loadClient}>Reload</Button>
        </div>
      )}

      <Card title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField label="Brand name" required error={err('name')}>
              {(p) => <Input value={form.name} onChange={set('name')} error={!!err('name')} maxLength={120} disabled={archived} autoFocus={!editing} {...p} />}
            </FormField>
            {duplicate && <p className="mt-1.5 text-sm"><Link to={`/brands/${duplicate}`} className="font-medium text-brand-700 hover:underline">Open the existing brand</Link></p>}
          </div>
          <FormField label="Type">
            {(p) => <Select value={form.type} onChange={set('type')} disabled={archived} {...p}>{(meta?.types ?? [form.type]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select>}
          </FormField>
          <FormField label="Relationship stage">
            {(p) => <Select value={form.status} onChange={set('status')} disabled={archived} {...p}>{(meta?.statuses ?? [form.status]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>}
          </FormField>
          <FormField label="Category" hint="e.g. Beauty, Travel. Pick a suggestion or type your own.">
            {(p) => (
              <>
                <Input list="client-categories" value={form.category} onChange={set('category')} maxLength={60} disabled={archived} {...p} />
                <datalist id="client-categories">{meta?.categories.map((c) => <option key={c} value={c} />)}</datalist>
              </>
            )}
          </FormField>
          <FormField label="Industry">
            {(p) => (
              <>
                <Input list="client-industries" value={form.industry} onChange={set('industry')} maxLength={80} disabled={archived} {...p} />
                <datalist id="client-industries">{meta?.industries.map((c) => <option key={c} value={c} />)}</datalist>
              </>
            )}
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Website" error={err('website')} hint="e.g. brand.com">
              {(p) => <Input value={form.website} onChange={set('website')} error={!!err('website')} maxLength={500} disabled={archived} {...p} />}
            </FormField>
          </div>
        </div>
      </Card>

      <Card title="Contacts" description="The people you deal with. Mark one as the primary contact.">
        <div className="space-y-3">
          {form.contacts.length === 0 && <p className="text-sm text-slate-500">No contacts yet.</p>}
          {err('contacts') && <p role="alert" className="text-sm text-red-600">{err('contacts')}</p>}
          {form.contacts.map((c, i) => (
            <Row key={c.id ?? `new-${i}`} label="contact" onRemove={() => dropRow('contacts', i)}>
              <FormField label="Name" required error={err(`contacts.${i}.name`)}>{(p) => <Input value={c.name} onChange={(e) => setRow('contacts', i, { name: e.target.value })} error={!!err(`contacts.${i}.name`)} {...p} />}</FormField>
              <FormField label="Role">{(p) => <Input value={c.role} onChange={(e) => setRow('contacts', i, { role: e.target.value })} placeholder="e.g. Partnerships manager" {...p} />}</FormField>
              <FormField label="Email" error={err(`contacts.${i}.email`)}>{(p) => <Input type="email" value={c.email} onChange={(e) => setRow('contacts', i, { email: e.target.value })} error={!!err(`contacts.${i}.email`)} {...p} />}</FormField>
              <FormField label="Phone" error={err(`contacts.${i}.phone`)}>{(p) => <Input type="tel" value={c.phone} onChange={(e) => setRow('contacts', i, { phone: e.target.value })} error={!!err(`contacts.${i}.phone`)} {...p} />}</FormField>
              <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                <input type="radio" name="primary-contact" checked={c.isPrimary} onChange={() => setForm((f) => ({ ...f, contacts: f.contacts.map((x, j) => ({ ...x, isPrimary: j === i })) }))} /> Primary contact
              </label>
            </Row>
          ))}
          {form.contacts.length < (meta?.limits.contacts ?? 10) && <Button type="button" variant="secondary" icon={Plus} onClick={() => addRow('contacts', { ...blankContact(), isPrimary: form.contacts.length === 0 })}>Add contact</Button>}
        </div>
      </Card>

      <Card title="Online presence">
        <div className="space-y-3">
          {form.socialLinks.map((s, i) => (
            <Row key={i} label="link" onRemove={() => dropRow('socialLinks', i)}>
              <FormField label="Platform">{(p) => <Select value={s.platform} onChange={(e) => setRow('socialLinks', i, { platform: e.target.value })} {...p}>{(meta?.socialPlatforms ?? [s.platform]).map((x) => <option key={x} value={x}>{SOCIAL_LABEL[x]}</option>)}</Select>}</FormField>
              <FormField label="Profile link" error={err(`socialLinks.${i}.url`)}>{(p) => <Input value={s.url} onChange={(e) => setRow('socialLinks', i, { url: e.target.value })} placeholder="instagram.com/brand" error={!!err(`socialLinks.${i}.url`)} {...p} />}</FormField>
            </Row>
          ))}
          {form.socialLinks.length < (meta?.limits.socialLinks ?? 10) && <Button type="button" variant="secondary" icon={Plus} onClick={() => addRow('socialLinks', blankLink())}>Add social link</Button>}
        </div>
      </Card>

      <Card title="Contact preferences" description="How and when they like to be reached.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Preferred channel">
            {(p) => (
              <Select value={form.pref.channel} onChange={setIn('pref', 'channel')} {...p}>
                <option value="">No preference</option>
                {(meta?.channels ?? []).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Best time to reach them">{(p) => <Input value={form.pref.bestTime} onChange={setIn('pref', 'bestTime')} maxLength={200} placeholder="e.g. weekday afternoons" {...p} />}</FormField>
          <div className="sm:col-span-2">
            <FormField label="Preference notes">{(p) => <Textarea rows={2} value={form.pref.notes} onChange={setIn('pref', 'notes')} maxLength={1000} {...p} />}</FormField>
          </div>
        </div>
      </Card>

      <Card title="Rates & terms" description="The rates you negotiated with this brand. These are reference terms; actual campaign fees live on the campaigns themselves.">
        <div className="space-y-4">
          <div className="space-y-3">
            {form.rates.map((r, i) => (
              <Row key={i} label="rate" onRemove={() => dropRow('rates', i)}>
                <FormField label="What it covers" error={err(`rates.${i}.label`)}>{(p) => <Input value={r.label} onChange={(e) => setRow('rates', i, { label: e.target.value })} placeholder="e.g. Instagram reel" error={!!err(`rates.${i}.label`)} {...p} />}</FormField>
                <FormField label="Unit">{(p) => <Select value={r.unit} onChange={(e) => setRow('rates', i, { unit: e.target.value })} {...p}>{(meta?.rateUnits ?? [r.unit]).map((u) => <option key={u} value={u}>{RATE_UNIT_LABEL[u] || 'other'}</option>)}</Select>}</FormField>
                <FormField label="Amount" error={err(`rates.${i}.amountMinor`)}>{(p) => <Input inputMode="decimal" value={r.amount} onChange={(e) => setRow('rates', i, { amount: e.target.value })} placeholder="1500.00" error={!!err(`rates.${i}.amountMinor`)} {...p} />}</FormField>
                <FormField label="Currency" error={err(`rates.${i}.currency`)}>{(p) => <Input value={r.currency} onChange={(e) => setRow('rates', i, { currency: e.target.value.toUpperCase() })} maxLength={3} error={!!err(`rates.${i}.currency`)} {...p} />}</FormField>
                <div className="sm:col-span-2"><FormField label="Notes">{(p) => <Input value={r.notes} onChange={(e) => setRow('rates', i, { notes: e.target.value })} maxLength={300} placeholder="e.g. includes one revision" {...p} />}</FormField></div>
              </Row>
            ))}
            {form.rates.length < (meta?.limits.rates ?? 20) && <Button type="button" variant="secondary" icon={Plus} onClick={() => addRow('rates', blankRate(form.defaultCurrency.trim().toUpperCase() || 'USD'))}>Add rate</Button>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default currency" error={err('defaultCurrency')}>{(p) => <Input value={form.defaultCurrency} onChange={(e) => setForm((f) => ({ ...f, defaultCurrency: e.target.value.toUpperCase() }))} maxLength={3} placeholder="e.g. INR" error={!!err('defaultCurrency')} {...p} />}</FormField>
            <FormField label="Payment terms (days)" error={err('paymentTermsDays')} hint="e.g. 30 for net 30">{(p) => <Input inputMode="numeric" value={form.paymentTermsDays} onChange={set('paymentTermsDays')} error={!!err('paymentTermsDays')} {...p} />}</FormField>
            <div className="sm:col-span-2"><FormField label="Exclusivity">{(p) => <Textarea rows={2} value={form.terms.exclusivity} onChange={setIn('terms', 'exclusivity')} maxLength={1000} {...p} />}</FormField></div>
            <div className="sm:col-span-2"><FormField label="Usage rights">{(p) => <Textarea rows={2} value={form.terms.usageRights} onChange={setIn('terms', 'usageRights')} maxLength={1000} {...p} />}</FormField></div>
            <div className="sm:col-span-2"><FormField label="Other terms">{(p) => <Textarea rows={2} value={form.terms.other} onChange={setIn('terms', 'other')} maxLength={2000} {...p} />}</FormField></div>
          </div>
        </div>
      </Card>

      <Card title="Notes & follow-up">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField label="Collaboration notes" error={err('collaborationNotes')} hint="What worked, what they like, anything to remember.">
              {(p) => <Textarea rows={5} value={form.collaborationNotes} onChange={set('collaborationNotes')} maxLength={20000} {...p} />}
            </FormField>
          </div>
          <FormField label="Follow-up date" error={err('followUpAt')} hint="You’ll get a reminder in CMS on this day.">
            {(p) => <Input type="date" value={form.followUpAt} onChange={set('followUpAt')} error={!!err('followUpAt')} {...p} />}
          </FormField>
          <FormField label="Follow-up reason" hint="Optional">
            {(p) => <Input value={form.followUpNote} onChange={set('followUpNote')} maxLength={200} disabled={!form.followUpAt} {...p} />}
          </FormField>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3 pb-4">
        <Button type="submit" loading={saving} disabled={archived || stale}>{editing ? 'Save changes' : 'Create brand'}</Button>
        <Button type="button" variant="ghost" onClick={() => navigate(editing ? `/brands/${id}` : '/brands')}>Cancel</Button>
      </div>
    </form>
  );
}
