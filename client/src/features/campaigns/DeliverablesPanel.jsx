import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, FormField, Input, Modal, Select, Textarea, useToast } from '../../components/ui/index.js';
import { contentApi } from '../content/api.js';
import { campaignsApi } from './api.js';
import { DELIVERABLE_ACTION, DeliverableBadge, Flags, label, ymdLabel } from './parts.jsx';

function DeliverableDialog({ open, onClose, campaign, deliverable, meta, onSaved }) {
  const toast = useToast();
  const editing = !!deliverable;
  const [form, setForm] = useState({});
  const [content, setContent] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      deliverable
        ? { title: deliverable.title, description: deliverable.description ?? '', platform: deliverable.platform ?? '', format: deliverable.format ?? '', dueDate: deliverable.dueLocal ?? '', requiresApproval: deliverable.requiresApproval, content: deliverable.content?.id ?? '', quantity: '1' }
        : { title: '', description: '', platform: '', format: '', dueDate: '', requiresApproval: campaign.review.required, content: '', quantity: '1' },
    );
    setErrors({});
    setError('');
    setBusy(false);
    // Only content that is free (not in another campaign) or already in this one can be attached.
    contentApi.list({ limit: 100 }).then((r) => setContent(r.data.filter((c) => !c.campaign || c.campaign.id === campaign.id))).catch(() => {});
  }, [open, deliverable, campaign.id, campaign.review.required]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const next = {};
    if (!form.title.trim()) next.title = 'Give the deliverable a title';
    const qty = Number(form.quantity);
    if (!editing && (!Number.isInteger(qty) || qty < 1 || qty > (meta?.limits.bulk ?? 50))) next.quantity = `A whole number from 1 to ${meta?.limits.bulk ?? 50}`;
    setErrors(next);
    if (Object.keys(next).length) return;

    const body = {
      title: form.title.trim(), description: form.description.trim() || null, platform: form.platform || null, format: form.format || null,
      dueDate: form.dueDate || null, requiresApproval: form.requiresApproval, content: form.content || null,
    };
    setBusy(true);
    try {
      if (editing) await campaignsApi.updateDeliverable(campaign.id, deliverable.id, { ...body, version: deliverable.version });
      else await campaignsApi.addDeliverables(campaign.id, { ...body, ...(qty > 1 && { quantity: qty }), ...(qty > 1 && { content: undefined }) });
      toast.success(editing ? 'Deliverable saved' : qty > 1 ? `${qty} deliverables added` : 'Deliverable added');
      onSaved();
    } catch (ex) {
      setBusy(false);
      setErrors(ex.fieldErrors ?? {});
      setError(ex.code === 'STALE_VERSION' ? 'This deliverable was changed elsewhere. Close this window to see the latest version.' : ex.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={editing ? 'Edit deliverable' : 'Add a deliverable'}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} loading={busy}>{editing ? 'Save' : 'Add'}</Button></>}
    >
      <div className="space-y-4">
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <FormField label="Title" required error={errors.title}>{(p) => <Input value={form.title ?? ''} onChange={set('title')} maxLength={200} error={!!errors.title} autoFocus {...p} />}</FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Platform">
            {(p) => <Select value={form.platform ?? ''} onChange={set('platform')} {...p}><option value="">Not set</option>{(meta?.platforms ?? []).map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}
          </FormField>
          <FormField label="Format">
            {(p) => <Select value={form.format ?? ''} onChange={set('format')} {...p}><option value="">Not set</option>{(meta?.formats ?? []).map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}
          </FormField>
          <FormField label="Due date" error={errors.dueDate} hint={campaign.local.deadline ? `Campaign deadline: ${ymdLabel(campaign.local.deadline)}` : undefined}>
            {(p) => <Input type="date" value={form.dueDate ?? ''} onChange={set('dueDate')} error={!!errors.dueDate} {...p} />}
          </FormField>
          {!editing && (
            <FormField label="How many" error={errors.quantity} hint="Each one is tracked separately">
              {(p) => <Input inputMode="numeric" value={form.quantity ?? '1'} onChange={set('quantity')} error={!!errors.quantity} {...p} />}
            </FormField>
          )}
        </div>
        <FormField label="Notes" error={errors.description}>{(p) => <Textarea rows={2} value={form.description ?? ''} onChange={set('description')} maxLength={2000} {...p} />}</FormField>
        <FormField label="Linked content" error={errors.content} hint={!editing && Number(form.quantity) > 1 ? 'Link content after adding, since one piece of content belongs to one deliverable.' : 'Optional. The deliverable can only be marked published once its content is.'}>
          {(p) => (
            <Select value={form.content ?? ''} onChange={set('content')} disabled={!editing && Number(form.quantity) > 1} {...p}>
              <option value="">No linked content</option>
              {content.map((c) => <option key={c.id} value={c.id}>{c.title} ({c.statusLabel ?? c.status})</option>)}
              {deliverable?.content && !content.some((c) => c.id === deliverable.content.id) && <option value={deliverable.content.id}>{deliverable.content.title}</option>}
            </Select>
          )}
        </FormField>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={!!form.requiresApproval} onChange={(e) => setForm((f) => ({ ...f, requiresApproval: e.target.checked }))} />
          The brand must approve this before it is published
        </label>
      </div>
    </Modal>
  );
}

function NoteDialog({ open, onClose, title, prompt, required, onSubmit }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setNote('');
      setError('');
      setBusy(false);
    }
  }, [open]);
  async function submit() {
    if (required && !note.trim()) return setError(prompt);
    setBusy(true);
    try {
      await onSubmit(note.trim());
    } catch (ex) {
      setError(ex.message);
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title} size="sm" footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} loading={busy}>Confirm</Button></>}>
      <FormField label={prompt} required={required} error={error}>{(p) => <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus error={!!error} {...p} />}</FormField>
    </Modal>
  );
}

export default function DeliverablesPanel({ campaign, meta, locked, onChanged }) {
  const toast = useToast();
  const [dialog, setDialog] = useState(null); // { deliverable? }
  const [revision, setRevision] = useState(null); // deliverable awaiting a "what needs to change" note
  const [removing, setRemoving] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function move(d, to, note) {
    setBusyId(d.id);
    try {
      await campaignsApi.moveDeliverable(campaign.id, d.id, to, note);
      onChanged();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusyId(null);
    }
  }
  async function remove() {
    setBusyId(removing.id);
    try {
      await campaignsApi.removeDeliverable(campaign.id, removing.id);
      toast.success('Deliverable removed');
      setRemoving(null);
      onChanged();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusyId(null);
    }
  }

  const list = campaign.deliverables;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {list.length === 0 ? 'Nothing to deliver yet.' : `${list.length} deliverable${list.length === 1 ? '' : 's'}. Each one is tracked separately, and campaign progress is worked out from them.`}
        </p>
        {!locked && <Button icon={Plus} size="sm" onClick={() => setDialog({})}>Add deliverable</Button>}
      </div>
      {locked && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{campaign.archived ? 'This campaign is archived.' : `This campaign is ${campaign.statusLabel.toLowerCase()}.`} Restore or re-open it to change its deliverables.</p>}

      {list.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState icon={ListChecks} title="No deliverables yet" description="Add each reel, post or story you owe the brand. You can move them from planned, through approval, to published." action={!locked && <Button icon={Plus} onClick={() => setDialog({})}>Add the first one</Button>} />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
          {list.map((d) => (
            <li key={d.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium text-slate-900">{d.title}</p>
                  <p className="text-xs text-slate-500">
                    {[d.platform && label(d.platform), d.format && label(d.format), d.dueLocal && `due ${ymdLabel(d.dueLocal)}`, !d.requiresApproval && 'no approval needed'].filter(Boolean).join(' · ') || 'No platform or date set'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {d.revisionCount > 0 && <Badge>{d.revisionCount} revision{d.revisionCount === 1 ? '' : 's'}</Badge>}
                  <DeliverableBadge status={d.status} text={d.statusLabel} />
                </div>
              </div>
              {d.feedback && d.status === 'changes_requested' && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong>Requested:</strong> {d.feedback}</p>}
              <Flags flags={d.flags.filter((f) => !(d.status === 'changes_requested' && f.code === 'changes_requested'))} compact />
              {d.content && (
                <p className="flex items-center gap-1.5 text-xs text-slate-600">
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                  <Link to={`/content/${d.content.id}`} className="font-medium text-brand-700 hover:underline">{d.content.title}</Link>
                  <span>· content is {d.content.statusLabel.toLowerCase()}</span>
                </p>
              )}
              {!locked && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {d.next.map((n, i) => (
                    <Button
                      key={n.to}
                      size="sm"
                      variant={i === d.next.length - 1 && n.to !== 'pending' && n.to !== 'in_progress' ? 'primary' : 'secondary'}
                      loading={busyId === d.id}
                      onClick={() => (n.to === 'changes_requested' ? setRevision(d) : move(d, n.to))}
                    >
                      {DELIVERABLE_ACTION[n.to]}
                    </Button>
                  ))}
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${d.title}`} onClick={() => setDialog({ deliverable: d })} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${d.title}`} onClick={() => setRemoving(d)} />
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <DeliverableDialog open={!!dialog} onClose={() => setDialog(null)} campaign={campaign} deliverable={dialog?.deliverable} meta={meta} onSaved={() => { setDialog(null); onChanged(); }} />
      <NoteDialog
        open={!!revision}
        onClose={() => setRevision(null)}
        title="The brand asked for changes"
        prompt="What needs to change?"
        required
        onSubmit={async (note) => { await campaignsApi.moveDeliverable(campaign.id, revision.id, 'changes_requested', note); setRevision(null); onChanged(); }}
      />
      <Modal
        open={!!removing}
        onClose={() => !busyId && setRemoving(null)}
        title="Remove this deliverable?"
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setRemoving(null)} disabled={!!busyId}>Cancel</Button><Button variant="danger" onClick={remove} loading={!!busyId}>Remove</Button></>}
      >
        <p className="text-sm text-slate-600"><strong className="text-slate-900">{removing?.title}</strong> will be removed and campaign progress recalculated. Any linked content is kept.</p>
      </Modal>
    </div>
  );
}
