/**
 * Calendar maths on plain "YYYY-MM-DD" strings. There is deliberately NO time-zone conversion in the browser:
 * the server tells us which local day and time each entry falls on (in the user's profile timezone) and accepts local
 * wall-clock times back. These helpers only walk the calendar.
 */
const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');

export const parse = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const fmt = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
export const addDays = (ymd, n) => fmt(new Date(parse(ymd).getTime() + n * DAY));
export const weekday = (ymd) => parse(ymd).getUTCDay();

export function addMonths(ymd, n) {
  const d = parse(ymd);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d.getUTCDate(), last)); // 31 Jan + 1 month = 28/29 Feb, not 3 Mar
  return fmt(first);
}

export const startOfWeek = (ymd, weekStartsOn) => addDays(ymd, -((weekday(ymd) - weekStartsOn + 7) % 7));

/** The month grid shows whole weeks, so it begins before the 1st and ends after the last day. */
export function monthRange(ymd, weekStartsOn) {
  const d = parse(ymd);
  const first = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const last = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  return { from: startOfWeek(first, weekStartsOn), to: addDays(startOfWeek(last, weekStartsOn), 6) };
}

export function rangeFor(view, anchor, weekStartsOn) {
  if (view === 'month') return monthRange(anchor, weekStartsOn);
  if (view === 'week') {
    const from = startOfWeek(anchor, weekStartsOn);
    return { from, to: addDays(from, 6) };
  }
  return { from: anchor, to: anchor };
}

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const shiftAnchor = (view, anchor, dir) => (view === 'month' ? addMonths(anchor, dir) : addDays(anchor, dir * (view === 'week' ? 7 : 1)));

/** Today's date in the user's profile timezone (Intl formatting only). */
export const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

/** The current wall-clock time in `tz` as "YYYY-MM-DDTHH:mm" (a minute ago, so "now" is never in the future). */
export function nowLocalIn(tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(Date.now() - 60_000))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const utcFmt = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
export const monthTitle = (ymd) => utcFmt({ month: 'long', year: 'numeric' }).format(parse(ymd));
export const longDay = (ymd) => utcFmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parse(ymd));
export const shortDay = (ymd) => utcFmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(parse(ymd));
export const weekdayShort = (dow) => utcFmt({ weekday: 'short' }).format(new Date(Date.UTC(2024, 0, 7 + dow))); // 7 Jan 2024 was a Sunday
export const dayNumber = (ymd) => Number(ymd.slice(8));

/** "18:30" -> "6:30 pm" in the viewer's locale (pure formatting of a wall-clock time). */
export const timeLabel = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return utcFmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
};
export const hourLabel = (h) => timeLabel(`${pad(h)}:00`);

export function rangeTitle(view, anchor, weekStartsOn) {
  if (view === 'month') return monthTitle(anchor);
  if (view === 'day') return longDay(anchor);
  const { from, to } = rangeFor('week', anchor, weekStartsOn);
  return `${shortDay(from)} – ${shortDay(to)}, ${to.slice(0, 4)}`;
}
