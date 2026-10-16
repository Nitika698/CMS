import { useEffect, useState } from 'react';
import { Button, FormField, Input, Modal, Select, Textarea, useToast } from '../../components/ui/index.js';
import { nowLocalIn } from '../calendar/dates.js';
import { clientsApi } from './api.js';
import { DISCUSSION_CHANNEL_LABEL } from './constants.js';

const CHANNELS = Object.keys(DISCUSSION_CHANNEL_LABEL);

/** Log (or edit) a saved discussion. The time is entered in the user's profile timezone; the server converts it. */
export default function DiscussionDialog({ open, onClose, client, discussion, campaigns, tz, onSaved }) {
  const toast = useToast();
  const editing = !!discussion;
  const [form, setForm] = useState({ channel: 'email', direction: 'inbound', when: '', subject: '', body: '', campaign: '', contactId: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError('');
    setBusy(false);
    setForm(
      discussion
        ? { channel: discussion.channel, direction: discussion.direction, when: discussion.occurredLocal, subject: discussion.subject ?? '', body: discussion.body ?? '', campaign: discussion.campaign?.id ?? '', contactId: discussion.contact?.id ?? '' }
        : { channel: 'email', direction: 'inbound', when: nowLocalIn(tz), subject: '', body: '', campaign: '', contactId: client.primaryContact?.id ?? '' },
    );
  }, [open, discussion, client, tz]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    const local = {};
    if (!form.subject.trim() && !form.body.trim()) local.subject = 'Add a subject or some notes';
    if (!form.when) local.occurredLocal = 'Choose when this happened';
    setErrors(local);
    if (Object.keys(local).length) return;
    const payload = {
      channel: form.channel,
      direction: form.direction,
      occurredLocal: form.when,
      subject: form.subject.trim() || null,
      body: form.body.trim() || null,
      campaign: form.campaign || null,
      contactId: form.contactId || null,
    };
    setBusy(true);
    setError('');
    try {
      const res = editing ? await clientsApi.updateDiscussion(discussion.id, payload) : await clientsApi.addDiscussion(client.id, payload);
      toast.success(editing ? 'Discussion updated' : 'Discussion saved');
      res.warnings?.forEach((w) => toast.success(w.message));
      onSaved(res.data);
    } catch (ex) {
      setBusy(false);
      setErrors(ex.fieldErrors ?? {});
      setError(ex.code === 'VALIDATION_ERROR' ? '' : ex.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={editing ? 'Edit discussion' : 'Log a discussion'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="discussion-form" loading={busy}>{editing ? 'Save changes' : 'Save discussion'}</Button>
        </>
      }
    >
      <form id="discussion-form" onSubmit={save} noValidate className="space-y-4">
        <p className="text-sm text-slate-600">A saved discussion is a note you write about a conversation with {client.name}. CMS doesn’t send or receive anything.</p>
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Channel">{(p) => <Select value={form.channel} onChange={set('channel')} {...p}>{CHANNELS.map((c) => <option key={c} value={c}>{DISCUSSION_CHANNEL_LABEL[c]}</option>)}</Select>}</FormField>
          <FormField label="Direction">
            {(p) => (
              <Select value={form.direction} onChange={set('direction')} {...p}>
                <option value="inbound">They contacted me</option>
                <option value="outbound">I contacted them</option>
              </Select>
            )}
          </FormField>
          <FormField label={`When (${tz})`} required error={errors.occurredLocal ?? errors.occurredAt} hint="Cannot be in the future.">
            {(p) => <Input type="datetime-local" value={form.when} onChange={set('when')} error={!!(errors.occurredLocal ?? errors.occurredAt)} {...p} />}
          </FormField>
          <FormField label="Contact">
            {(p) => (
              <Select value={form.contactId} onChange={set('contactId')} error={!!errors.contactId} {...p}>
                <option value="">Not specified</option>
                {client.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Campaign" error={errors.campaign} hint={campaigns.length === 0 ? 'No campaigns for this brand yet.' : 'Optional: link this discussion to one of their campaigns.'}>
              {(p) => (
                <Select value={form.campaign} onChange={set('campaign')} disabled={campaigns.length === 0 && !form.campaign} error={!!errors.campaign} {...p}>
                  <option value="">Not linked</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </Select>
              )}
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField label="Subject" error={errors.subject}>{(p) => <Input value={form.subject} onChange={set('subject')} maxLength={200} error={!!errors.subject} placeholder="e.g. Rates and timeline" {...p} />}</FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField label="Notes" error={errors.body}>{(p) => <Textarea rows={6} value={form.body} onChange={set('body')} maxLength={20000} error={!!errors.body} placeholder="What was discussed or agreed?" {...p} />}</FormField>
          </div>
        </div>
      </form>
    </Modal>
  );
}
