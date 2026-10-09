import { useState } from 'react';
import { Badge, Button, Card, FormField, Input, Select } from '../../components/ui/index.js';
import { FormError } from '../auth/AuthLayout.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED', 'JPY'];

function timezones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

function ProfileForm() {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({ name: user.name, timezone: user.timezone, defaultCurrency: user.defaultCurrency });
  const [state, setState] = useState({ busy: false, error: '', saved: false, fields: {} });

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setState((s) => ({ ...s, saved: false }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    setState({ busy: true, error: '', saved: false, fields: {} });
    try {
      await updateProfile(form);
      setState({ busy: false, error: '', saved: true, fields: {} });
    } catch (err) {
      setState({ busy: false, error: err.code === 'VALIDATION_ERROR' ? '' : err.message, saved: false, fields: err.fieldErrors ?? {} });
    }
  }

  const zones = timezones();
  return (
    <Card title="Profile" description="How you appear in CreatorDesk.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError>{state.error}</FormError>
        <FormField label="Email" hint="Email cannot be changed yet.">
          {(p) => <Input value={user.email} disabled {...p} />}
        </FormField>
        <FormField label="Name" error={state.fields.name} required>
          {(p) => <Input value={form.name} onChange={set('name')} error={!!state.fields.name} {...p} />}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Timezone" error={state.fields.timezone}>
            {(p) => (
              <Select value={form.timezone} onChange={set('timezone')} {...p}>
                {!zones.includes(form.timezone) && <option>{form.timezone}</option>}
                {zones.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Default currency" error={state.fields.defaultCurrency}>
            {(p) => (
              <Select value={form.defaultCurrency} onChange={set('defaultCurrency')} {...p}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </FormField>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={state.busy}>
            Save changes
          </Button>
          {state.saved && (
            <span role="status" className="text-sm text-emerald-700">
              Saved
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const { changePassword } = useAuth();
  const [form, setForm] = useState({ current: '', next: '' });
  const [state, setState] = useState({ busy: false, error: '', saved: false, fields: {} });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setState({ busy: true, error: '', saved: false, fields: {} });
    try {
      await changePassword(form.current, form.next);
      setForm({ current: '', next: '' });
      setState({ busy: false, error: '', saved: true, fields: {} });
    } catch (err) {
      const fields = err.code === 'INVALID_CURRENT_PASSWORD' ? { currentPassword: err.message } : (err.fieldErrors ?? {});
      setState({ busy: false, error: Object.keys(fields).length ? '' : err.message, saved: false, fields });
    }
  }

  return (
    <Card title="Password" description="Changing it signs you out on all other devices.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError>{state.error}</FormError>
        <FormField label="Current password" error={state.fields.currentPassword} required>
          {(p) => (
            <Input type="password" autoComplete="current-password" value={form.current} onChange={set('current')} error={!!state.fields.currentPassword} {...p} />
          )}
        </FormField>
        <FormField label="New password" error={state.fields.newPassword} hint="At least 10 characters, with a letter and a number or symbol." required>
          {(p) => (
            <Input type="password" autoComplete="new-password" value={form.next} onChange={set('next')} error={!!state.fields.newPassword} {...p} />
          )}
        </FormField>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={state.busy}>
            Update password
          </Button>
          {state.saved && (
            <span role="status" className="text-sm text-emerald-700">
              Password updated
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const { logoutAll } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Sessions" description="Sign out everywhere, including this device.">
      <Button
        variant="danger"
        loading={busy}
        onClick={() => {
          setBusy(true);
          logoutAll().catch(() => setBusy(false));
        }}
      >
        Sign out of all devices
      </Button>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h2>
        <p className="mt-1 flex items-center gap-2 text-slate-500">
          Signed in as {user.email} <Badge tone="success" dot>Active</Badge>
        </p>
      </div>
      <ProfileForm />
      <PasswordForm />
      <SessionsCard />
    </div>
  );
}
