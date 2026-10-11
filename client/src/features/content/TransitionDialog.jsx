import { useEffect, useState } from 'react';
import { Button, FormField, Input, Modal, Textarea, useToast } from '../../components/ui/index.js';
import { contentApi } from './api.js';
import { localInputToIso, nowLocalInput } from './dates.js';

const COPY = {
  approve: { title: 'Approve this content', confirm: 'Approve', help: 'Record that this content is signed off and ready to publish.' },
  reject: { title: 'Request changes', confirm: 'Send back for changes', help: 'This returns the content to Creation and starts a new revision. Say what needs to change.' },
  reopen: { title: 'Re-open review', confirm: 'Re-open review', help: 'This withdraws the current approval. It must be approved again before publishing.' },
  publish: { title: 'Mark as published', confirm: 'Mark as published', help: 'Only do this once the post is actually live. CMS records that you confirmed it; it does not check the platform.' },
};

/** Which transitions need a dialog (extra input). Plain forward/back moves happen immediately. */
export function dialogKind(t) {
  if (t.kind === 'reject') return 'reject';
  if (t.kind === 'publish') return 'publish';
  if (t.kind === 'reopen') return 'reopen';
  return t.to === 'approved' ? 'approve' : null;
}

export default function TransitionDialog({ open, onClose, contentId, transition, onDone }) {
  const toast = useToast();
  const kind = transition ? dialogKind(transition) : null;
  const [form, setForm] = useState({ comment: '', approverName: '', publishedAt: '', publishedUrl: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ comment: '', approverName: '', publishedAt: nowLocalInput(), publishedUrl: '' });
      setErrors({});
      setError('');
      setBusy(false);
    }
  }, [open]);

  if (!transition || !kind) return null;
  const copy = COPY[kind];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (kind === 'reject' && form.comment.trim().length < 3) local.comment = 'Explain what needs to change (at least 3 characters)';
    if (kind === 'publish' && !form.publishedAt) local.publishedAt = 'Choose when it went live';
    setErrors(local);
    if (Object.keys(local).length) return;

    const body = { to: transition.to };
    if (form.comment.trim()) body.comment = form.comment.trim();
    if (kind === 'approve' && form.approverName.trim()) body.approverName = form.approverName.trim();
    if (kind === 'publish') {
      body.publishedAt = localInputToIso(form.publishedAt);
      if (form.publishedUrl.trim()) body.publishedUrl = form.publishedUrl.trim();
    }
    setBusy(true);
    setError('');
    try {
      const res = await contentApi.transition(contentId, body);
      toast.success(kind === 'reject' ? 'Sent back for changes' : kind === 'publish' ? 'Marked as published' : kind === 'approve' ? 'Content approved' : 'Review re-opened');
      onDone(res.data);
    } catch (ex) {
      setErrors(ex.fieldErrors ?? {});
      setError(ex.code === 'VALIDATION_ERROR' ? '' : ex.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={copy.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="transition-form" variant={kind === 'reject' ? 'danger' : 'primary'} loading={busy}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      <form id="transition-form" onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-slate-600">{copy.help}</p>
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {kind === 'approve' && (
          <FormField label="Approved by" hint="Optional: for example the client contact who signed off." error={errors.approverName}>
            {(p) => <Input value={form.approverName} onChange={set('approverName')} maxLength={120} {...p} />}
          </FormField>
        )}
        {kind === 'publish' && (
          <>
            <FormField label="Went live at" required error={errors.publishedAt} hint="Cannot be in the future.">
              {(p) => <Input type="datetime-local" value={form.publishedAt} onChange={set('publishedAt')} error={!!errors.publishedAt} {...p} />}
            </FormField>
            <FormField label="Link to the live post" error={errors.publishedUrl}>
              {(p) => <Input type="url" inputMode="url" placeholder="https://…" value={form.publishedUrl} onChange={set('publishedUrl')} error={!!errors.publishedUrl} {...p} />}
            </FormField>
          </>
        )}
        <FormField label={kind === 'reject' ? 'What needs to change?' : 'Comment'} required={kind === 'reject'} error={errors.comment}>
          {(p) => <Textarea rows={3} value={form.comment} onChange={set('comment')} error={!!errors.comment} maxLength={5000} autoFocus {...p} />}
        </FormField>
      </form>
    </Modal>
  );
}
