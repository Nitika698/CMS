import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, CheckCircle2, RotateCcw, Trash2 } from 'lucide-react';
import { Button, FormField, Input, Modal, Select, Textarea, useToast } from '../../components/ui/index.js';
import { clientsApi } from '../clients/api.js';
import { contentApi } from '../content/api.js';
import { tasksApi } from './api.js';
import { REMINDER_CHOICES } from './parts.jsx';

const empty = { title: '', description: '', priority: 'normal', dueDate: '', dueTime: '', remindOffsets: null, campaign: '', client: '', content: '' };

function fromTask(t, preset) {
  if (!t) return { ...empty, ...preset };
  return {
    title: t.title, description: t.description ?? '', priority: t.priority, dueDate: t.dueDate ?? '', dueTime: t.dueTime ?? '',
    remindOffsets: t.dueDate ? t.remindOffsets : null, campaign: t.links.campaign?.id ?? '', client: t.links.client?.id ?? '', content: t.links.content?.id ?? '',
  };
}

/** Create or edit a task. `task` null = new; `preset` pre-fills links (e.g. from a campaign page). */
export default function TaskDialog({ open, task, preset, priorities, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => fromTask(task, preset));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [options, setOptions] = useState({ campaigns: [], clients: [], content: [] });
  const editing = !!task;
  const archived = !!task?.archivedAt;

  useEffect(() => {
    if (!open) return;
    setForm(fromTask(task, preset));
    setErrors({});
    setConfirmDelete(false);
  }, [open, task, preset]);

  useEffect(() => {
    if (!open) return;
    Promise.allSettled([contentApi.campaigns(), clientsApi.list({ limit: 100 }), contentApi.list({ limit: 100 })]).then(([c, b, k]) =>
      setOptions({
        campaigns: c.status === 'fulfilled' ? c.value.data ?? [] : [],
        clients: b.status === 'fulfilled' ? b.value.data ?? [] : [],
        content: k.status === 'fulfilled' ? k.value.data ?? [] : [],
      }),
    );
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const hasDue = !!form.dueDate;
  const reminders = form.remindOffsets ?? [];

  function toggleReminder(value) {
    setForm((f) => {
      const cur = f.remindOffsets ?? [];
      return { ...f, remindOffsets: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] };
    });
  }

  function body() {
    const out = {
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
      dueDate: form.dueDate || null,
      dueTime: form.dueDate && form.dueTime ? form.dueTime : null,
      campaign: form.campaign || null,
      client: form.campaign ? undefined : form.client || null, // a campaign decides the brand
      content: form.content || null,
    };
    if (form.remindOffsets !== null) out.remindOffsets = form.dueDate ? form.remindOffsets : [];
    return out;
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const payload = body();
      if (editing) await tasksApi.update(task.id, { ...payload, version: task.version });
      else await tasksApi.create(payload);
      toast.success(editing ? 'Task saved' : 'Task added');
      onSaved();
    } catch (ex) {
      if (ex.code === 'STALE_VERSION') toast.error('This task was changed elsewhere. Close this and reopen it to see the latest.');
      else if (ex.fieldErrors && Object.keys(ex.fieldErrors).length) setErrors(ex.fieldErrors);
      else toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn, done) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onSaved();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      {!archived && <Button type="submit" form="task-form" loading={busy}>{editing ? 'Save task' : 'Add task'}</Button>}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit task' : 'New task'} size="lg" footer={footer}>
      <form id="task-form" onSubmit={submit} className="space-y-4" noValidate>
        {archived && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This task is archived. Restore it to edit it.</p>}
        <fieldset disabled={archived || busy} className="space-y-4">
          <FormField label="Title" required error={errors.title}>
            {(p) => <Input {...p} value={form.title} onChange={set('title')} maxLength={200} autoFocus placeholder="e.g. Send revised reel to the brand" error={errors.title} />}
          </FormField>
          <FormField label="Notes" error={errors.description}>
            {(p) => <Textarea {...p} rows={3} value={form.description} onChange={set('description')} maxLength={5000} error={errors.description} />}
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Priority" error={errors.priority}>
              {(p) => <Select {...p} value={form.priority} onChange={set('priority')}>{priorities.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select>}
            </FormField>
            <FormField label="Due date" error={errors.dueDate}>
              {(p) => <Input {...p} type="date" value={form.dueDate} onChange={set('dueDate')} error={errors.dueDate} />}
            </FormField>
            <FormField label="Time (optional)" error={errors.dueTime} hint={hasDue ? undefined : 'Pick a date first'}>
              {(p) => <Input {...p} type="time" value={form.dueTime} onChange={set('dueTime')} disabled={!hasDue} error={errors.dueTime} />}
            </FormField>
          </div>
          <p className="-mt-2 text-xs text-slate-500">Without a time the task is due all day and counts as overdue from the next day. Dates and times use your profile timezone.</p>

          {hasDue && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-700">Remind me in the app</legend>
              {form.remindOffsets === null ? (
                <p className="text-sm text-slate-500">Using your default reminder time from Settings. <button type="button" className="font-medium text-brand-700 underline" onClick={() => setForm((f) => ({ ...f, remindOffsets: [1440] }))}>Choose times</button></p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {REMINDER_CHOICES.map((c) => (
                    <label key={c.value} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={reminders.includes(c.value)} onChange={() => toggleReminder(c.value)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
              {errors.remindOffsets && <p className="mt-1.5 text-sm text-red-600">{errors.remindOffsets}</p>}
              <p className="mt-1.5 text-xs text-slate-500">Reminders arrive as notifications and are sent by the server, so they work even when this page is closed.</p>
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Campaign" error={errors.campaign}>
              {(p) => (
                <Select {...p} value={form.campaign} onChange={set('campaign')}>
                  <option value="">None</option>
                  {options.campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}{c.clientName ? ` · ${c.clientName}` : ''}</option>)}
                </Select>
              )}
            </FormField>
            <FormField label="Brand" error={errors.client} hint={form.campaign ? 'Set by the campaign' : undefined}>
              {(p) => (
                <Select {...p} value={form.campaign ? '' : form.client} onChange={set('client')} disabled={!!form.campaign}>
                  <option value="">{form.campaign ? 'From the campaign' : 'None'}</option>
                  {options.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
            </FormField>
            <FormField label="Content" error={errors.content}>
              {(p) => (
                <Select {...p} value={form.content} onChange={set('content')}>
                  <option value="">None</option>
                  {options.content.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </Select>
              )}
            </FormField>
          </div>
        </fieldset>
      </form>

      {editing && (
        <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
          {(task.links.campaign || task.links.client || task.links.content) && (
            <p className="text-sm text-slate-600">
              Open:{' '}
              {[
                task.links.campaign && <Link key="c" to={`/campaigns/${task.links.campaign.id}`} className="font-medium text-brand-700 hover:underline">campaign</Link>,
                task.links.client && <Link key="b" to={`/brands/${task.links.client.id}`} className="font-medium text-brand-700 hover:underline">brand</Link>,
                task.links.content && <Link key="k" to={`/content/${task.links.content.id}`} className="font-medium text-brand-700 hover:underline">content</Link>,
              ].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!archived && (task.status === 'done' || task.status === 'cancelled'
              ? <Button size="sm" variant="secondary" icon={RotateCcw} disabled={busy} onClick={() => act(() => tasksApi.reopen(task.id), 'Task reopened')}>Reopen</Button>
              : <Button size="sm" variant="secondary" icon={CheckCircle2} disabled={busy} onClick={() => act(() => tasksApi.complete(task.id), 'Task completed')}>Mark complete</Button>)}
            {archived
              ? <Button size="sm" variant="secondary" icon={ArchiveRestore} disabled={busy} onClick={() => act(() => tasksApi.restore(task.id), 'Task restored')}>Restore</Button>
              : <Button size="sm" variant="secondary" icon={Archive} disabled={busy} onClick={() => act(() => tasksApi.archive(task.id), 'Task archived')}>Archive</Button>}
            {confirmDelete ? (
              <span className="inline-flex items-center gap-2 text-sm">
                Delete for good?
                <Button size="sm" variant="danger" loading={busy} onClick={() => act(() => tasksApi.remove(task.id), 'Task deleted')}>Yes, delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
