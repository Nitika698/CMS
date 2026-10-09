import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, FormField, Input } from '../../components/ui/index.js';
import AuthLayout, { FormError } from './AuthLayout.jsx';
import { useAuth } from './AuthContext.jsx';

export default function LoginPage() {
  const { login, notice } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setFields({});
    setBusy(true);
    try {
      await login(form.email, form.password); // PublicOnly then redirects to the app
    } catch (err) {
      setFields(err.fieldErrors ?? {});
      setError(err.status === 429 ? err.message : err.status === 400 ? 'Please check the highlighted fields.' : err.message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back to your creator workspace."
      footer={
        <>
          New to CreatorDesk?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {notice === 'expired' && !error && (
          <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Your session expired. Please sign in again.
          </div>
        )}
        <FormError>{error}</FormError>
        <FormField label="Email" error={fields.email} required>
          {(p) => <Input type="email" autoComplete="email" value={form.email} onChange={set('email')} error={!!fields.email} required {...p} />}
        </FormField>
        <FormField label="Password" error={fields.password} required>
          {(p) => (
            <Input type="password" autoComplete="current-password" value={form.password} onChange={set('password')} error={!!fields.password} required {...p} />
          )}
        </FormField>
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
