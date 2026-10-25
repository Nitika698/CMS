import { useState } from 'react';
import { Button, Card, FormField, Input, Textarea, useToast } from '../../components/ui/index.js';
import { FormError } from '../auth/AuthLayout.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

/** The details printed on your invoices. An invoice keeps a copy of these as they were when you issued it. */
export default function BusinessProfileCard() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ ...user.businessProfile, paymentTermsDays: String(user.businessProfile?.paymentTermsDays ?? 14) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    const days = Number(form.paymentTermsDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      setBusy(false);
      return setFields({ 'businessProfile.paymentTermsDays': 'Whole days, 0 to 365' });
    }
    try {
      await updateProfile({ businessProfile: { ...form, paymentTermsDays: days } });
      toast.success('Business details saved');
    } catch (ex) {
      const fe = Object.fromEntries(Object.entries(ex.fieldErrors ?? {}));
      if (Object.keys(fe).length) setFields(fe);
      else setError(ex.message);
    } finally {
      setBusy(false);
    }
  }

  const err = (k) => fields[`businessProfile.${k}`] ?? fields[k];
  const text = (k, label, props = {}, hint) => (
    <FormField label={label} error={err(k)} hint={hint}>{(p) => <Input {...p} value={form[k] ?? ''} onChange={set(k)} error={err(k)} {...props} />}</FormField>
  );

  return (
    <Card title="Business & invoicing" description="Printed on the invoices you download. An invoice keeps the details it was issued with, so changing these later never rewrites it.">
      <form onSubmit={save} noValidate className="space-y-4">
        <FormError>{error}</FormError>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('businessName', 'Business or creator name', { maxLength: 120, placeholder: user.name })}
          {text('email', 'Billing email', { type: 'email', maxLength: 254, placeholder: user.email })}
          {text('phone', 'Phone', { maxLength: 30 })}
          {text('website', 'Website', { maxLength: 200 })}
          {text('taxIdLabel', 'Tax ID name', { maxLength: 20, placeholder: 'GSTIN, VAT no.…' })}
          {text('taxId', 'Tax ID', { maxLength: 60 })}
        </div>
        <FormField label="Address" error={err('address')}>{(p) => <Textarea {...p} rows={3} value={form.address ?? ''} onChange={set('address')} maxLength={500} error={err('address')} />}</FormField>
        <FormField label="Payment instructions" error={err('paymentInstructions')} hint="How a brand should pay you: bank details, UPI id, PayPal… Printed on every invoice.">
          {(p) => <Textarea {...p} rows={3} value={form.paymentInstructions ?? ''} onChange={set('paymentInstructions')} maxLength={1000} error={err('paymentInstructions')} />}
        </FormField>
        <FormField label="Default invoice notes" error={err('invoiceNotes')}>{(p) => <Textarea {...p} rows={2} value={form.invoiceNotes ?? ''} onChange={set('invoiceNotes')} maxLength={1000} error={err('invoiceNotes')} />}</FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('invoicePrefix', 'Invoice number prefix', { maxLength: 10, placeholder: 'INV' }, 'Numbers look like INV-0001')}
          {text('paymentTermsDays', 'Payment terms (days)', { inputMode: 'numeric' }, 'Due date = issue date + this, unless the brand has its own terms')}
        </div>
        <Button type="submit" loading={busy}>Save business details</Button>
      </form>
    </Card>
  );
}
