import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button, Card, ErrorState, FormField, Input, Select, Skeleton, Textarea, useToast } from '../../components/ui/index.js';
import { contentApi } from './api.js';
import { platformLabel, typeLabel } from './constants.js';
import { toDateInput } from './dates.js';
import TagInput from './TagInput.jsx';
import { useContentMeta } from './useMeta.js';

const EMPTY = { title: '', description: '', type: 'post', category: '', campaign: '', platforms: [], tags: [], caption: '', hashtags: [], brief: '', plannedDate: '', deadline: '' };

const fromContent = (c) => ({
  title: c.title,
  description: c.description ?? '',
  type: c.type,
  category: c.category?.id ?? '',
  campaign: c.campaign?.id ?? '',
  platforms: c.platforms,
  tags: c.tags,
  caption: c.caption ?? '',
  hashtags: c.hashtags,
  brief: c.brief ?? '',
  plannedDate: toDateInput(c.plannedDate),
  deadline: toDateInput(c.deadline),
});

// Empty text/date/select fields become null so editing can clear a value.
const toPayload = (f) => ({
  title: f.title.trim(),
  description: f.description.trim() || null,
  type: f.type,
  category: f.category || null,
  campaign: f.campaign || null,
  platforms: f.platforms,
  tags: f.tags,
  caption: f.caption.trim() || null,
  hashtags: f.hashtags,
  brief: f.brief.trim() || null,
  plannedDate: f.plannedDate || null,
  deadline: f.deadline || null,
});

export default function ContentFormPage({ mode }) {
  const { id } = useParams();
  const editing = mode === 'edit';
  const navigate = useNavigate();
  const toast = useToast();
  const meta = useContentMeta();

  const [form, setForm] = useState(EMPTY);
  const [original, setOriginal] = useState(null);
  const [publishedUrl, setPublishedUrl] = useState('');
  const [load, setLoad] = useState(editing ? 'loading' : 'ready');
  const [categories, setCategories] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [newCategory, setNewCategory] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    contentApi.categories().then((r) => setCategories(r.data)).catch(() => {});
    contentApi.campaigns().then((r) => setCampaigns(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editing) return;
    const ctrl = new AbortController();
    contentApi
      .get(id, ctrl.signal)
      .then((r) => {
        setOriginal(r.data);
        setForm(fromContent(r.data));
        setPublishedUrl(r.data.publishedUrl ?? '');
        setLoad('ready');
      })
      .catch((err) => err.name !== 'AbortError' && setLoad(err.status === 404 ? 'missing' : 'error'));
    return () => ctrl.abort();
  }, [editing, id]);

  const locked = original?.status === 'published'; // after publication only tags and the link can change
  const archived = original?.archived;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k) => errors[k];

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    try {
      const { data } = await contentApi.createCategory(name);
      setCategories((c) => [...c, data].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, category: data.id }));
      setNewCategory('');
      toast.success(`Category “${data.name}” created`);
    } catch (e) {
      toast.error(e.status === 409 ? 'You already have a category with that name.' : e.message);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setFormError('');
    const local = {};
    if (!form.title.trim()) local.title = 'Title is required';
    if (form.plannedDate && form.deadline && form.deadline > form.plannedDate) local.deadline = 'Deadline must be on or before the planned date';
    setErrors(local);
    if (Object.keys(local).length) return;

    setSaving(true);
    try {
      let payload = toPayload(form);
      if (locked) payload = { tags: form.tags, publishedUrl: publishedUrl.trim() || null };
      const res = editing ? await contentApi.update(id, payload) : await contentApi.create(payload);
      toast.success(editing ? 'Changes saved' : 'Content created');
      navigate(`/content/${res.data.id}`);
    } catch (ex) {
      setErrors(ex.fieldErrors ?? {});
      setFormError(ex.code === 'VALIDATION_ERROR' ? 'Please fix the highlighted fields.' : ex.message);
      setSaving(false);
    }
  }

  if (load === 'loading') {
    return (
      <div className="max-w-3xl space-y-4" aria-busy>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (load !== 'ready') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <ErrorState
          title={load === 'missing' ? 'Content not found' : 'Couldn’t load this content'}
          message={load === 'missing' ? 'It may have been deleted, or it belongs to another account.' : 'Please try again.'}
          onRetry={load === 'missing' ? undefined : () => window.location.reload()}
        />
        <p className="pb-6 text-center text-sm"><Link to="/content" className="font-medium text-brand-600 hover:underline">Back to Content</Link></p>
      </div>
    );
  }

  const lockedAll = !!archived;
  const disabledMain = locked || lockedAll;

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
      <div>
        <Link to={editing ? `/content/${id}` : '/content'} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {editing ? 'Back to content' : 'Back to library'}
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{editing ? 'Edit content' : 'New content'}</h2>
        {!editing && <p className="mt-1 text-sm text-slate-500">New content starts as an <strong>Idea</strong>. You move it through the workflow from its page.</p>}
      </div>

      {lockedAll && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This content is archived. Restore it to edit.</p>}
      {locked && !lockedAll && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Published content is locked. You can still change its tags and the link to the live post.
        </p>
      )}
      {formError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}

      <Card title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField label="Title" required error={err('title')}>
              {(p) => <Input value={form.title} onChange={set('title')} error={!!err('title')} maxLength={200} disabled={disabledMain} autoFocus={!editing} {...p} />}
            </FormField>
          </div>
          <FormField label="Content type" error={err('type')}>
            {(p) => (
              <Select value={form.type} onChange={set('type')} disabled={disabledMain} {...p}>
                {(meta?.types ?? [form.type]).map((t) => (
                  <option key={t} value={t}>{typeLabel(t)}</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Category" error={err('category')}>
            {(p) => (
              <Select value={form.category} onChange={set('category')} disabled={disabledMain} {...p}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            )}
          </FormField>
          {!disabledMain && (
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-slate-600" htmlFor="new-category">Need a new category?</label>
              <div className="flex gap-2">
                <Input id="new-category" value={newCategory} maxLength={60} placeholder="e.g. Travel" onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCategory())} />
                <Button type="button" variant="secondary" icon={Plus} onClick={addCategory} disabled={!newCategory.trim()}>Add</Button>
              </div>
            </div>
          )}
          <div className="sm:col-span-2">
            <FormField label="Campaign" error={err('campaign')} hint={campaigns.length === 0 ? 'No campaigns yet. Create one under Campaigns, then you can link content to it here.' : 'Optional: connect this content to a brand campaign.'}>
              {(p) => (
                <Select value={form.campaign} onChange={set('campaign')} disabled={disabledMain || (campaigns.length === 0 && !form.campaign)} {...p}>
                  <option value="">No campaign</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}{c.clientName ? ` — ${c.clientName}` : ''}</option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField label="Platforms" error={err('platforms')}>
              {() => (
                <div role="group" aria-label="Platforms" className="flex flex-wrap gap-2">
                  {(meta?.platforms ?? []).map((p) => {
                    const on = form.platforms.includes(p);
                    return (
                      <label key={p} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-700'} ${disabledMain ? 'pointer-events-none opacity-60' : ''}`}>
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={on} disabled={disabledMain} onChange={() => setVal('platforms')(on ? form.platforms.filter((x) => x !== p) : [...form.platforms, p])} />
                        {platformLabel(p)}
                      </label>
                    );
                  })}
                </div>
              )}
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField label="Tags" error={err('tags')} hint="Press Enter or comma to add. For your own organising; lowercase, up to 20.">
              {(p) => <TagInput value={form.tags} onChange={setVal('tags')} normalize={(s) => s.trim().toLowerCase().slice(0, 30)} placeholder="e.g. travel, tutorial" max={20} disabled={lockedAll} {...p} />}
            </FormField>
          </div>
        </div>
      </Card>

      <Card title="Creative" description="What you’re making and how you’ll present it.">
        <div className="space-y-4">
          <FormField label="Description" error={err('description')}>
            {(p) => <Textarea rows={3} value={form.description} onChange={set('description')} error={!!err('description')} maxLength={20000} disabled={disabledMain} {...p} />}
          </FormField>
          <FormField label="Creative brief" error={err('brief')} hint="Direction, requirements and anything the brand asked for.">
            {(p) => <Textarea rows={4} value={form.brief} onChange={set('brief')} error={!!err('brief')} maxLength={20000} disabled={disabledMain} {...p} />}
          </FormField>
          <FormField label="Caption" error={err('caption')} hint={`${form.caption.length.toLocaleString()} / 20,000 characters. A caption (or a file) is needed before sending for review.`}>
            {(p) => <Textarea rows={4} value={form.caption} onChange={set('caption')} error={!!err('caption')} maxLength={20000} disabled={disabledMain} {...p} />}
          </FormField>
          <FormField label="Hashtags" error={err('hashtags')} hint="Without the # sign. Letters, numbers and underscores. Up to 30.">
            {(p) => <TagInput value={form.hashtags} onChange={setVal('hashtags')} normalize={(s) => s.trim().replace(/^#+/, '').replace(/\s+/g, '')} placeholder="e.g. travel2026" max={30} disabled={disabledMain} {...p} />}
          </FormField>
        </div>
      </Card>

      <Card title="Schedule" description="Dates only. Posting itself is tracked from the Calendar.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Deadline" error={err('deadline')} hint="When this must be finished.">
            {(p) => <Input type="date" value={form.deadline} onChange={set('deadline')} error={!!err('deadline')} disabled={disabledMain} {...p} />}
          </FormField>
          <FormField label="Planned publication date" error={err('plannedDate')} hint="When you intend to post it.">
            {(p) => <Input type="date" value={form.plannedDate} onChange={set('plannedDate')} error={!!err('plannedDate')} disabled={disabledMain} {...p} />}
          </FormField>
        </div>
      </Card>

      {locked && !lockedAll && (
        <Card title="Published link">
          <FormField label="Link to the live post" error={err('publishedUrl')}>
            {(p) => <Input type="url" inputMode="url" placeholder="https://…" value={publishedUrl} onChange={(e) => setPublishedUrl(e.target.value)} error={!!err('publishedUrl')} {...p} />}
          </FormField>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3 pb-4">
        <Button type="submit" loading={saving} disabled={lockedAll}>{editing ? 'Save changes' : 'Create content'}</Button>
        <Button type="button" variant="ghost" onClick={() => navigate(editing ? `/content/${id}` : '/content')}>Cancel</Button>
      </div>
    </form>
  );
}
