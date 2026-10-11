/** Planned date / deadline are DATES (stored as 00:00 UTC), so they are shown and edited in UTC to avoid off-by-one-day shifts. */
export const toDateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

export const formatDay = (iso) =>
  iso ? new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';

/** Publication / event times are instants: shown in the user's profile timezone. */
export const formatInstant = (iso, timeZone) =>
  iso ? new Intl.DateTimeFormat(undefined, { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '—';

/** <input type="datetime-local"> value for "now minus a minute" in the browser's local time. */
export function nowLocalInput() {
  const d = new Date(Date.now() - 60_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export const localInputToIso = (value) => new Date(value).toISOString();
