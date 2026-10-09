/** Money arrives from the API as integer MINOR units (e.g. paise/cents) plus an ISO currency code. */
const exponent = (currency) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
};

export function formatMoney(minor, currency) {
  const e = exponent(currency);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: e, maximumFractionDigits: e }).format(minor / 10 ** e);
  } catch {
    return `${(minor / 10 ** e).toFixed(e)} ${currency}`;
  }
}

export const formatCount = (n) => new Intl.NumberFormat().format(n);

export function formatDate(iso, timeZone) {
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function formatDateTime(iso, timeZone) {
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatTime(iso, timeZone) {
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "today", "tomorrow", "in 3 days", "2 days ago" from a whole-day offset computed on the server in the user's timezone. */
export function daysLabel(days) {
  if (days === 0) return 'today';
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(days, 'day');
}

/** "5 minutes ago", "yesterday"... for past timestamps. */
export function timeAgo(iso, now = Date.now()) {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

export const STATUS_LABEL = {
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  scheduled: 'Scheduled',
  awaiting_confirmation: 'Awaiting confirmation',
};
