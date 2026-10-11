import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Info, RefreshCw } from 'lucide-react';
import { Badge, Button, FormField, Input, Modal, Select, Spinner, Textarea, useToast } from '../../components/ui/index.js';
import { contentApi } from '../content/api.js';
import { platformLabel } from '../content/constants.js';
import StatusBadge from '../content/StatusBadge.jsx';
import { useContentMeta } from '../content/useMeta.js';
import { postsApi } from './api.js';
import { nowLocalIn, shortDay, timeLabel, todayIn } from './dates.js';
import { STAGE_STYLE } from './stages.js';

const REMINDER_LABEL = { 15: '15 minutes', 60: '1 hour', 180: '3 hours', 1440: '1 day', 2880: '2 days', 10080: '1 week' };
const reminderLabel = (m) => REMINDER_LABEL[m] ?? (m % 1440 === 0 ? `${m / 1440} days` : m % 60 === 0 ? `${m / 60} hours` : `${m} minutes`);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function ConflictPanel({ conflict, busy, onConfirm }) {
  const { windowMinutes, conflicts } = conflict.details;
  return (
    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden /> Another post is scheduled close to this time
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-6">
        {conflicts.map((c) => (
          <li key={c.postId}>
            “{c.title}” on the same platform, {c.minutesApart} minute{c.minutesApart === 1 ? '' : 's'} apart
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">Posts on one platform less than {windowMinutes} minutes apart need your confirmation, in case this is a mistake.</p>
      <Button size="sm" variant="secondary" className="mt-3" onClick={onConfirm} loading={busy}>
        Schedule anyway
      </Button>
    </div>
  );
}

export default function PostDialog({ open, onClose, mode, post, preset, user, calMeta, integrations, onSaved }) {
  const toast = useToast();
  const contentMeta = useContentMeta();
  const tz = user.timezone;
  const editing = mode === 'edit';

  // `latest` is the freshest copy we fetched after a save/reload; until then we show the entry we were opened with.
  // (Deriving it avoids a one-frame null on the first render of the edit dialog.)
  const [latest, setLatest] = useState(post ?? null);
  const current = latest ?? (editing ? (post ?? null) : null);
  const [form, setForm] = useState({ platform: 'instagram', kind: 'planned', date: '', time: '', reminders: [], caption: '' });
  const [chosen, setChosen] = useState(null); // create mode: the content item picked
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [conflict, setConflict] = useState(null);
  const [stale, setStale] = useState(false);
  const [publishing, setPublishing] = useState(null); // { local, url } while the "mark published" form is open
  const [confirmDelete, setConfirmDelete] = useState(false);

  const status = current?.status;
  const locked = editing && ['published', 'cancelled'].includes(status);

  // ---- (re)initialise whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setError('');
    setFieldErrors({});
    setConflict(null);
    setStale(false);
    setPublishing(null);
    setConfirmDelete(false);
    if (editing && post) {
      setLatest(post);
      setChosen(null);
      setForm({
        platform: post.platform,
        kind: post.status === 'scheduled' ? 'scheduled' : 'planned',
        date: post.localDate ?? '',
        time: post.localTime ?? '',
        reminders: post.reminderOffsets,
        caption: post.captionOverride ?? '',
      });
    } else {
      setLatest(null);
      const date = preset?.date ?? '';
      const future = date && date >= todayIn(tz);
      setForm({
        platform: 'instagram',
        kind: future ? 'scheduled' : 'planned',
        date,
        time: preset?.time ?? (future ? '09:00' : ''),
        reminders: [...(user.calendarPrefs?.defaultReminderOffsets ?? [60])].sort((a, b) => b - a),
        caption: '',
      });
      setSearch('');
      setChosen(null);
      if (preset?.contentId) {
        contentApi.get(preset.contentId).then((r) => pick(r.data)).catch(() => setError('That content could not be loaded.'));
      }
    }
  }, [open, post, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(content) {
    setChosen({ id: content.id, title: content.title, status: content.status, statusLabel: content.statusLabel, platforms: content.platforms ?? [] });
    setForm((f) => ({ ...f, platform: content.platforms?.[0] ?? f.platform }));
  }

  // ---- content picker (create mode)
  useEffect(() => {
    if (!open || editing || chosen) return;
    const t = setTimeout(() => {
      setLoadingOptions(true);
      setOptionsFailed(false);
      contentApi
        .list({ q: search, limit: 15, sort: '-updatedAt' })
        .then((r) => setOptions(r.data))
        .catch(() => (setOptions([]), setOptionsFailed(true)))
        .finally(() => setLoadingOptions(false));
    }, 250);
    return () => clearTimeout(t);
  }, [open, editing, chosen, search]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const content = editing ? current?.content : chosen;
  const platformInfo = integrations?.find((p) => p.platform === form.platform);
  const approved = editing ? current?.contentApproved : ['approved', 'published'].includes(chosen?.status);

  const newLocal = form.date ? `${form.date}T${form.time || '09:00'}` : null;

  // ---- error handling shared by every action
  const handleError = useCallback((ex, retry) => {
    if (ex.code === 'SCHEDULE_CONFLICT') return setConflict({ details: ex.body.error.details, retry });
    if (ex.code === 'STALE_VERSION' || ex.code === 'CONFLICT') return setStale(true);
    if (ex.code === 'VALIDATION_ERROR') {
      setFieldErrors(ex.fieldErrors ?? {});
      return setError(ex.body?.error?.details?.length === 1 ? ex.body.error.details[0].message : 'Please fix the highlighted fields.');
    }
    if (ex.code === 'DUPLICATE_POST') return setError('This content already has an active entry on this platform. Open that one instead, or cancel it first.');
    setError(ex.message);
  }, []);

  async function run(action, successMessage, { confirmConflict = false } = {}) {
    setBusy(true);
    setError('');
    setFieldErrors({});
    setConflict(null);
    setStale(false);
    try {
      const res = await action(confirmConflict);
      toast.success(successMessage);
      res.warnings?.forEach((w) => toast.success(w.message));
      onSaved(res.data);
    } catch (ex) {
      handleError(ex, () => run(action, successMessage, { confirmConflict: true }));
    } finally {
      setBusy(false);
    }
  }

  // ---- save
  function save() {
    const local = {};
    if (!editing && !chosen) local.content = 'Choose the content this entry is for';
    if (form.kind === 'scheduled' && (!form.date || !form.time) && status !== 'awaiting_confirmation') local.scheduledLocal = 'Choose a date and time for the reminder';
    setFieldErrors(local);
    if (Object.keys(local).length) return;

    if (!editing) {
      return run(
        (confirm) =>
          postsApi.create({
            content: chosen.id,
            platform: form.platform,
            status: form.kind,
            ...(newLocal && { scheduledLocal: newLocal }),
            ...(form.kind === 'scheduled' && { reminderOffsets: form.reminders }),
            ...(form.caption.trim() && { captionOverride: form.caption.trim() }),
            ...(confirm && { confirmConflict: true }),
          }),
        'Calendar entry created',
      );
    }

    const kindChanged = (status === 'planned' && form.kind === 'scheduled') || (status === 'scheduled' && form.kind === 'planned');
    const timeChanged = newLocal !== current.scheduledLocal;
    const reminderChanged = form.kind === 'scheduled' && !sameList(form.reminders, current.reminderOffsets);
    const patch = {};
    if (form.platform !== current.platform) patch.platform = form.platform;
    if ((form.caption.trim() || null) !== current.captionOverride) patch.captionOverride = form.caption.trim() || null;
    if (!kindChanged && timeChanged) patch.scheduledLocal = newLocal;
    if (!kindChanged && reminderChanged) patch.reminderOffsets = form.reminders;
    if (!Object.keys(patch).length && !kindChanged) return onClose();

    return run(async (confirm) => {
      let latest = { data: current, warnings: [] };
      if (Object.keys(patch).length) latest = await postsApi.update(current.id, { ...patch, version: current.version, ...(confirm && { confirmConflict: true }) });
      if (kindChanged) {
        latest = await postsApi.transition(current.id, {
          to: form.kind,
          version: latest.data.version,
          ...(form.kind === 'scheduled' && { scheduledLocal: newLocal, reminderOffsets: form.reminders }),
          ...(confirm && { confirmConflict: true }),
        });
      }
      return latest;
    }, 'Changes saved');
  }

  const move = (to, message, extra = {}) =>
    run((confirm) => postsApi.transition(current.id, { to, version: current.version, ...extra, ...(confirm && { confirmConflict: true }) }), message);

  function markPublished() {
    if (!publishing.local) return setFieldErrors({ publishedLocal: 'Choose when it went live' });
    return move('published', 'Marked as published (confirmed by you)', { publishedLocal: publishing.local, ...(publishing.url.trim() && { publishedUrl: publishing.url.trim() }) });
  }

  async function reload() {
    try {
      const r = await postsApi.get(current.id);
      setLatest(r.data);
      // refresh EVERY field from the server copy, otherwise "Reload" would silently keep the stale text on screen
      setForm({
        platform: r.data.platform,
        kind: r.data.status === 'scheduled' ? 'scheduled' : 'planned',
        date: r.data.localDate ?? '',
        time: r.data.localTime ?? '',
        reminders: r.data.reminderOffsets,
        caption: r.data.captionOverride ?? '',
      });
      setStale(false);
      setError('');
      onSaved(r.data, { silent: true });
    } catch (ex) {
      setError(ex.status === 404 ? 'This entry no longer exists.' : ex.message);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await postsApi.remove(current.id);
      toast.success('Calendar entry deleted');
      onSaved(null, { deleted: current.id });
    } catch (ex) {
      setError(ex.message);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const transitions = useMemo(() => new Set(current?.transitions?.map((t) => t.to) ?? []), [current]);
  const StageIcon = current ? STAGE_STYLE[current.status]?.icon : null;
  const showTime = !locked && !(editing && status === 'published');
  const reminderPresets = calMeta?.reminderPresets ?? [15, 60, 180, 1440, 2880, 10080];
  const toggleReminder = (m) =>
    setForm((f) => ({ ...f, reminders: (f.reminders.includes(m) ? f.reminders.filter((x) => x !== m) : [...f.reminders, m]).sort((a, b) => b - a).slice(0, 5) }));

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={editing ? 'Calendar entry' : 'New calendar entry'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {locked ? 'Close' : 'Cancel'}
          </Button>
          {!locked && (
            <Button onClick={save} loading={busy && !publishing} disabled={stale}>
              {editing ? 'Save changes' : 'Create entry'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {stale && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>This entry was changed elsewhere since you opened it. Reload to see the latest version before editing.</span>
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={reload}>
              Reload
            </Button>
          </div>
        )}
        {conflict && <ConflictPanel conflict={conflict} busy={busy} onConfirm={conflict.retry} />}

        {/* ---- the linked content (every entry belongs to exactly one content item) */}
        {editing || chosen ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{content?.title ?? 'Content'}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                {content && <StatusBadge status={content.status} label={content.statusLabel} />}
                <span>{approved ? 'Content approved' : 'Content not approved yet'}</span>
              </p>
            </div>
            {editing && (
              <Link to={`/content/${current.contentId}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                Open content <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
            {!editing && !preset?.contentId && (
              <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>
                Change
              </Button>
            )}
          </div>
        ) : (
          <FormField label="Content" required error={fieldErrors.content}>
            {(p) => (
              <div className="space-y-2">
                <Input placeholder="Search your content…" value={search} onChange={(e) => setSearch(e.target.value)} error={!!fieldErrors.content} {...p} />
                <ul className="max-h-44 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200" aria-label="Matching content">
                  {loadingOptions && <li className="p-3"><Spinner label="Searching…" /></li>}
                  {!loadingOptions && optionsFailed && <li role="alert" className="p-3 text-sm text-red-700">Couldn’t search your content right now. Try typing again in a moment.</li>}
                  {!loadingOptions && !optionsFailed && options.length === 0 && <li className="p-3 text-sm text-slate-500">No matching content. Create it in Content first.</li>}
                  {options.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => pick(c)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <span className="min-w-0 truncate">{c.title}</span>
                        <StatusBadge status={c.status} label={c.statusLabel} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </FormField>
        )}

        {/* ---- where this entry is in its life, in plain words */}
        {editing && current && (
          <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${STAGE_STYLE[current.status].chip.replace('line-through', '')}`} data-testid="stage-banner">
            <StageIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">{current.stage.label}</p>
              <p className="text-xs opacity-90">{current.stage.description}</p>
              {current.status === 'published' && current.publishedAt && (
                <p className="mt-1 text-xs">
                  Confirmed {current.verification === 'platform' ? 'by the platform' : 'by you'} on {shortDay(current.localDate ?? current.publishedAt.slice(0, 10))}
                  {current.publishedUrl && (
                    <>
                      {' · '}
                      <a href={current.publishedUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        View live post
                      </a>
                    </>
                  )}
                </p>
              )}
              {current.failureReason && <p className="mt-1 text-xs">Last problem: {current.failureReason}</p>}
            </div>
          </div>
        )}

        {!locked && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Platform" error={fieldErrors.platform}>
                {(p) => (
                  <Select value={form.platform} onChange={set('platform')} disabled={editing && ['awaiting_confirmation'].includes(status)} {...p}>
                    {(contentMeta?.platforms ?? [form.platform]).map((pl) => (
                      <option key={pl} value={pl}>
                        {platformLabel(pl)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>

              {(!editing || ['planned', 'scheduled'].includes(status)) && (
                <fieldset className="sm:col-span-1">
                  <legend className="mb-1.5 text-sm font-medium text-slate-700">Entry type</legend>
                  <div className="space-y-1.5">
                    {[
                      ['planned', 'Planned', 'A tentative slot. No reminder will fire.'],
                      ['scheduled', 'Scheduled reminder', 'CMS reminds you at this time. It does not post for you.'],
                    ].map(([key, label, help]) => (
                      <label key={key} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${form.kind === key ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white'}`}>
                        <input type="radio" name="kind" className="mt-1" checked={form.kind === key} onChange={() => setForm((f) => ({ ...f, kind: key }))} />
                        <span>
                          <span className="block font-medium text-slate-900">{label}</span>
                          <span className="block text-xs text-slate-600">{help}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>

            {showTime && (
              <div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={editing && ['awaiting_confirmation', 'missed', 'failed'].includes(status) ? 'Reschedule to (date)' : 'Date'} error={fieldErrors.scheduledLocal}>
                    {(p) => <Input type="date" value={form.date} onChange={set('date')} error={!!fieldErrors.scheduledLocal} min="2000-01-01" max="2099-12-31" {...p} />}
                  </FormField>
                  <FormField label="Time">
                    {(p) => <Input type="time" value={form.time} onChange={set('time')} step="300" {...p} />}
                  </FormField>
                </div>
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Times are in <strong>{tz}</strong>, your profile timezone. <Link to="/settings" className="text-brand-700 hover:underline">Change it in Settings</Link>.
                    {form.time && ` Shown as ${timeLabel(form.time)}.`}
                  </span>
                </p>
              </div>
            )}

            {form.kind === 'scheduled' && (!editing || ['planned', 'scheduled'].includes(status)) && (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-slate-700">Remind me before</legend>
                <div className="flex flex-wrap gap-2">
                  {reminderPresets.map((m) => {
                    const on = form.reminders.includes(m);
                    return (
                      <label key={m} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-700'}`}>
                        <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => toggleReminder(m)} />
                        {reminderLabel(m)}
                      </label>
                    );
                  })}
                  {form.reminders.filter((m) => !reminderPresets.includes(m)).map((m) => (
                    <Badge key={m} tone="brand">{reminderLabel(m)}</Badge>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">You always get a notice at the scheduled time too. Reminders appear in CMS only (no email or push).</p>
              </fieldset>
            )}

            <FormField label="Caption for this platform" hint="Optional. Leave blank to use the content’s caption.">
              {(p) => <Textarea rows={2} value={form.caption} onChange={set('caption')} maxLength={20000} {...p} />}
            </FormField>
          </>
        )}

        {/* ---- the honesty note: CMS does not publish to networks */}
        <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {platformInfo?.directPublishing
              ? `Direct publishing to ${platformLabel(form.platform)} is available.`
              : `Direct publishing to ${platformLabel(form.platform)} is not available. Publish it yourself, then mark it as published here. CMS records that you confirmed it; it does not check the platform.`}
          </span>
        </p>

        {/* ---- moving an existing entry between states */}
        {editing && current && (
          <section aria-label="Entry actions" className="space-y-3 border-t border-slate-100 pt-4">
            {publishing ? (
              <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-900">Mark as published</p>
                <p className="text-xs text-slate-600">Only do this once it is actually live on {platformLabel(current.platform)}. This is your confirmation; CMS cannot verify it.</p>
                {!current.contentApproved && (
                  <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    The content is not approved yet. <Link to={`/content/${current.contentId}`} className="font-medium underline">Approve the content first</Link>.
                  </p>
                )}
                <FormField label={`Went live at (${tz})`} required error={fieldErrors.publishedLocal ?? fieldErrors.publishedAt}>
                  {(p) => <Input type="datetime-local" value={publishing.local} onChange={(e) => setPublishing({ ...publishing, local: e.target.value })} error={!!(fieldErrors.publishedLocal ?? fieldErrors.publishedAt)} {...p} />}
                </FormField>
                <FormField label="Link to the live post" error={fieldErrors.publishedUrl}>
                  {(p) => <Input type="url" inputMode="url" placeholder="https://…" value={publishing.url} onChange={(e) => setPublishing({ ...publishing, url: e.target.value })} error={!!fieldErrors.publishedUrl} {...p} />}
                </FormField>
                <div className="flex gap-2">
                  <Button size="sm" onClick={markPublished} loading={busy} disabled={!current.contentApproved}>
                    Confirm: it is live
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPublishing(null)} disabled={busy}>
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {transitions.has('awaiting_confirmation') && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => move('awaiting_confirmation', 'Marked ready to publish')}>
                    Mark ready to publish now
                  </Button>
                )}
                {transitions.has('published') && (
                  <Button size="sm" disabled={busy} onClick={() => setPublishing({ local: nowLocalIn(tz), url: '' })}>
                    Mark as published…
                  </Button>
                )}
                {transitions.has('missed') && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => move('missed', 'Marked as missed')}>
                    I missed it
                  </Button>
                )}
                {transitions.has('planned') && status !== 'cancelled' && status !== 'planned' && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => move('planned', 'Moved back to planned')}>
                    Back to planned
                  </Button>
                )}
                {status === 'cancelled' && transitions.has('planned') && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => move('planned', 'Entry reopened as planned')}>
                    Reopen as planned
                  </Button>
                )}
                {transitions.has('cancelled') && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => move('cancelled', 'Entry cancelled')}>
                    Cancel entry
                  </Button>
                )}
                {status !== 'published' &&
                  (confirmDelete ? (
                    <span className="inline-flex items-center gap-2 text-sm">
                      Delete this entry?
                      <Button size="sm" variant="danger" onClick={remove} loading={busy}>
                        Yes, delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                        No
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
                      Delete entry
                    </Button>
                  ))}
              </div>
            )}
            {status === 'published' && (
              <FormField label="Link to the live post" hint="You can still correct the link.">
                {(p) => (
                  <div className="flex gap-2">
                    <Input type="url" inputMode="url" placeholder="https://…" defaultValue={current.publishedUrl ?? ''} id={p.id} onBlur={(e) => e.target.value.trim() !== (current.publishedUrl ?? '') && run(() => postsApi.update(current.id, { publishedUrl: e.target.value.trim() || null, version: current.version }), 'Link saved')} />
                  </div>
                )}
              </FormField>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
