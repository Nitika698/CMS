/** Calendar maths in an IANA timezone, without a date library. All results are real UTC instants. */

const parts = (date, timeZone) => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  return Object.fromEntries(f.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
};

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetMs(date, timeZone) {
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
