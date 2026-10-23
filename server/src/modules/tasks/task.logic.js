import { dayRange, zonedYmd } from '../../lib/timezone.js';
import { OPEN_TASK } from './task.constants.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The single definition of "overdue / due today / upcoming", used by the task list, the summary, the dashboard
 * and the reminder job so they can never disagree.
 *   - A task with a time is overdue once that instant has passed.
 *   - A task with only a date is due for that WHOLE local day and overdue from the start of the next one.
 *   - Done, cancelled and archived tasks are never overdue.
 */
export function dueWindows(now, tz) {
  const today = dayRange(now, tz);
  return { now, start: today.start, end: today.end };
}

const open = { status: { $in: OPEN_TASK }, archivedAt: null };

export function overdueQuery({ now, start }) {
  return { ...open, dueAt: { $ne: null }, $or: [{ dueHasTime: true, dueAt: { $lt: now } }, { dueHasTime: { $ne: true }, dueAt: { $lt: start } }] };
}

/** Due during today's local day and not yet overdue. */
export function todayQuery({ now, start, end }) {
  return { ...open, dueAt: { $gte: start, $lt: end }, $or: [{ dueHasTime: { $ne: true } }, { dueHasTime: true, dueAt: { $gte: now } }] };
}

/** Due after today, optionally only within the next `days` local days. */
export function upcomingQuery({ end }, days) {
  return { ...open, dueAt: { $gte: end, ...(days ? { $lt: new Date(end.getTime() + days * DAY) } : {}) } };
}

/** Whole local calendar days from today to `date` (negative = past). */
export function daysFromToday(now, date, tz) {
  const a = zonedYmd(now, tz);
  const b = zonedYmd(date, tz);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY);
}

/** @returns {'overdue'|'today'|'upcoming'|'none'|'closed'} */
export function dueState(task, now, tz) {
  if (!OPEN_TASK.includes(task.status) || task.archivedAt) return 'closed';
  if (!task.dueAt) return 'none';
  const w = dueWindows(now, tz);
  if (task.dueHasTime ? task.dueAt < now : task.dueAt < w.start) return 'overdue';
  return task.dueAt < w.end ? 'today' : 'upcoming';
}

/** The moment reminders count back from: the due instant, or the END of the due day for date-only tasks. */
export function reminderReference(task, tz) {
  if (!task.dueAt) return null;
  if (task.dueHasTime) return task.dueAt;
  return dayRange(task.dueAt, tz).end;
}

/** When a task becomes overdue (same moment as the reference: its time, or the end of its day). */
export const overdueAt = reminderReference;
