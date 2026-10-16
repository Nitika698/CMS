import { useEffect, useState } from 'react';
import { Button, FormField, Input, Modal, useToast } from '../../components/ui/index.js';
import { toDateInput } from '../content/dates.js';
import { clientsApi } from './api.js';

/** Set, change or clear the follow-up date. The brand's version is sent so a stale screen cannot overwrite a newer change. */
export default function FollowUpDialog({ open, onClose, client, onSaved }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(toDateInput(client.followUpAt));
      setNote(client.followUpNote ?? '');
      setError('');
      setBusy(false);
    }
  }, [open, client]);

  async function save(clear = false) {
    if (!clear && !date) return setError('Choose a date, or use "Clear follow-up".');
    setBusy(true);
    setError('');
    try {
      const res = await clientsApi.update(client.id, { followUpAt: clear ? null : date, ...(!clear && { followUpNote: note.trim() || null }), version: client.version });
      toast.success(clear ? 'Follow-up cleared' : 'Follow-up saved');
      onSaved(res.data);
    } catch (ex) {
      setError(ex.code === 'STALE_VERSION' ? 'This brand was changed elsewhere. Close this window to see the latest version.' : (ex.fieldErrors?.followUpAt ?? ex.message));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={client.followUpAt ? 'Change follow-up' : 'Set a follow-up'}
      size="sm"
      footer={
        <>
          {client.followUpAt && <Button variant="ghost" onClick={() => save(true)} disabled={busy} className="mr-auto">Clear follow-up</Button>}
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => save(false)} loading={busy}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <FormField label="Follow up on" required>{(p) => <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} {...p} />}</FormField>
        <FormField label="Reason" hint="Optional. Shown in the reminder.">{(p) => <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} {...p} />}</FormField>
        <p className="text-xs text-slate-500">You’ll get a reminder in CMS (the bell) at the start of that day in your timezone. No email is sent.</p>
      </div>
    </Modal>
  );
}
