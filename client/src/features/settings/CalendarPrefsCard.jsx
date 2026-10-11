import { useState } from 'react';
import { Button, Card, FormField, Select, useToast } from '../../components/ui/index.js';
import { FormError } from '../auth/AuthLayout.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

const POST_OPTIONS = [[15, '15 minutes'], [60, '1 hour'], [180, '3 hours'], [1440, '1 day'], [2880, '2 days'], [10080, '1 week']];
const DEADLINE_OPTIONS = [[60, '1 hour'], [1440, '1 day'], [4320, '3 days'], [10080, '1 week']];
const WEEK_START = [[1, 'Monday'], [0, 'Sunday'], [6, 'Saturday']];

function Checks({ options, value, onChange, legend }) {
  const toggle = (m) => onChange((value.includes(m) ? value.filter((x) => x !== m) : [...value, m]).sort((a, b) => b - a));
  const custom = value.filter((m) => !options.some(([o]) => o === m));
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([m, label]) => {
          const on = value.includes(m);
          return (
            <label key={m} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-700'}`}>
              <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => toggle(m)} />
              {label}
            </label>
          );
        })}
        {custom.map((m) => (
          <span key={m} className="inline-flex items-center rounded-lg border border-brand-500 bg-brand-50 px-3 py-1.5 text-sm text-brand-700">
            {m} min (custom)
          </span>
        ))}
      </div>
    </fieldset>
  );
}

/** Defaults for reminders and the calendar's first day of the week. Reminders are in-app only. */
export default function CalendarPrefsCard() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const prefs = user.calendarPrefs ?? { defaultReminderOffsets: [60], deadlineReminderOffsets: [1440], weekStartsOn: 1 };
  const [form, setForm] = useState({
    defaultReminderOffsets: [...prefs.defaultReminderOffsets].sort((a, b) => b - a),
    deadlineReminderOffsets: [...prefs.deadlineReminderOffsets].sort((a, b) => b - a),
    weekStartsOn: prefs.weekStartsOn,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await updateProfile({ calendarPrefs: form });
      toast.success('Calendar settings saved');
    } catch (ex) {
      setError(ex.fieldErrors?.calendarPrefs ?? ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Calendar & reminders" description="Defaults for new scheduled posts and content deadlines.">
      <form onSubmit={save} noValidate className="space-y-5">
        <FormError>{error}</FormError>
        <Checks legend="Remind me before a scheduled post (default)" options={POST_OPTIONS} value={form.defaultReminderOffsets} onChange={(v) => setForm((f) => ({ ...f, defaultReminderOffsets: v }))} />
        <Checks legend="Remind me before a content deadline ends" options={DEADLINE_OPTIONS} value={form.deadlineReminderOffsets} onChange={(v) => setForm((f) => ({ ...f, deadlineReminderOffsets: v }))} />
        <FormField label="Week starts on">
          {(p) => (
            <Select value={form.weekStartsOn} onChange={(e) => setForm((f) => ({ ...f, weekStartsOn: Number(e.target.value) }))} className="sm:max-w-xs" {...p}>
              {WEEK_START.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </Select>
          )}
        </FormField>
        <p className="text-xs text-slate-500">
          Reminders appear in CMS only (the bell in the top bar). You always get a “time to publish” notice at the scheduled time. A deadline lasts until the end of that day in your timezone ({user.timezone}).
        </p>
        <Button type="submit" loading={busy}>Save calendar settings</Button>
      </form>
    </Card>
  );
}
