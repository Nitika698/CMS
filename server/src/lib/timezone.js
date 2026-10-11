/** Calendar maths in an IANA timezone, without a date library. All results are real UTC instants. */

const parts = (date, timeZone) => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  return Object.fromEntries(f.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
};

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function offsetMs(date, timeZone) {
  const p = parts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The calendar date (y, m 1-12, d) that `date` falls on in `timeZone`. */
export function zonedYmd(date, timeZone) {
  const { year, month, day } = parts(date, timeZone);
  return { year, month, day };
}

/** UTC instant of 00:00 local time on y-m-d in `timeZone`. Month/day may overflow (e.g. month 13). */
export function zonedMidnight(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day);
  let t = guess - offsetMs(new Date(guess), timeZone);
  const corrected = guess - offsetMs(new Date(t), timeZone); // handles DST transitions near midnight
  if (corrected !== t) t = corrected;
  return new Date(t);
}

/** [start, end) of the local calendar day containing `now`. Day length is 23-25h around DST changes. */
export function dayRange(now, timeZone) {
  const { year, month, day } = zonedYmd(now, timeZone);
  return { start: zonedMidnight(year, month, day, timeZone), end: zonedMidnight(year, month, day + 1, timeZone) };
}

/** [start, end) of the local calendar month containing `now`. */
export function monthRange(now, timeZone) {
  const { year, month } = zonedYmd(now, timeZone);
  return { start: zonedMidnight(year, month, 1, timeZone), end: zonedMidnight(year, month + 1, 1, timeZone) };
}

export const isValidTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const pad = (n) => String(n).padStart(2, '0');

/** How an instant looks on the wall clock in `timeZone`: { date: 'YYYY-MM-DD', time: 'HH:mm', local: 'YYYY-MM-DDTHH:mm' }. */
export function formatLocal(instant, timeZone) {
  const p = parts(instant, timeZone);
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  return { date, time, local: `${date}T${time}` };
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turns a wall-clock time typed by the user ("2026-10-14T18:30") into the exact instant it means in `timeZone`.
 *   - Impossible dates (Feb 30) and times skipped by a clock change (02:30 on a spring-forward day): instant = null.
 *   - Times that happen twice (fall-back hour): the EARLIER instant is used and `ambiguous` is true.
 * @returns {{ instant: Date | null, ambiguous: boolean, reason?: 'format' | 'calendar' | 'skipped' }}
 */
export function localToInstant(local, timeZone) {
  const m = LOCAL_RE.exec(local ?? '');
  if (!m) return { instant: null, ambiguous: false, reason: 'format' };
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (wall.getUTCFullYear() !== y || wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d || h > 23 || mi > 59) {
    return { instant: null, ambiguous: false, reason: 'calendar' };
  }
  const wallMs = wall.getTime();
  // The offset can differ before and after a clock change, so try the offsets in effect a day either side.
  const candidates = new Set(
    [-DAY_MS, 0, DAY_MS].map((shift) => wallMs - offsetMs(new Date(wallMs + shift), timeZone)),
  );
  const valid = [...candidates]
    .filter((t) => {
      const p = parts(new Date(t), timeZone);
      return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi;
    })
    .sort((a, b) => a - b);
  if (!valid.length) return { instant: null, ambiguous: false, reason: 'skipped' };
  return { instant: new Date(valid[0]), ambiguous: valid.length > 1 };
}
