import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, FormField, Input } from '../../components/ui/index.js';
import AuthLayout, { FormError } from './AuthLayout.jsx';
import { useAuth } from './AuthContext.jsx';

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    const local = {};
    if (!form.name.trim()) local.name = 'Name is required';
    if (form.password.length < 10) local.password = 'Password must be at least 10 characters';
    setFields(local);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await register({ ...form, timezone: browserTimezone() });
    } catch (err) {
      setFields(err.code === 'EMAIL_TAKEN' ? { email: err.message } : (err.fieldErrors ?? {}));
      setError(err.code === 'VALIDATION_ERROR' || err.code === 'EMAIL_TAKEN' ? '' : err.message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Manage content, brands and payments in one place."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError>{error}</FormError>
        <FormField label="Name" error={fields.name} required>
          {(p) => <Input autoComplete="name" value={form.name} onChange={set('name')} error={!!fields.name} {...p} />}
        </FormField>
        <FormField label="Email" error={fields.email} required>
          {(p) => <Input type="email" autoComplete="email" value={form.email} onChange={set('email')} error={!!fields.email} {...p} />}
        </FormField>
        <FormField
          label="Password"
          error={fields.password}
          hint="At least 10 characters, with a letter and a number or symbol."
          required
        >
          {(p) => (
            <Input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={!!fields.password} {...p} />
          )}
        </FormField>
        <Button type="submit" loading={busy} className="w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
