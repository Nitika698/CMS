import mongoose from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { formatLocal, zonedMidnight } from '../../lib/timezone.js';
import { STATUS_LABELS } from '../content/content.constants.js';
import { Content } from '../content/content.model.js';
import { MAX_RANGE_DAYS } from '../posts/post.constants.js';
import { Post } from '../posts/post.model.js';
import { contentSummaries, presentMany } from '../posts/posts.service.js';

const DAY = 24 * 60 * 60 * 1000;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const tzOf = (user) => user.timezone || 'UTC';
const ymdParts = (s) => s.split('-').map(Number);
const utcDay = (s) => Date.UTC(...(([y, m, d]) => [y, m - 1, d])(ymdParts(s)));
const isoDate = (d) => d.toISOString().slice(0, 10);

/** Content deadlines and planned dates are DATES stored at 00:00 UTC, so they are placed on that UTC calendar date. */
const deadlineItem = (c, today) => ({
  contentId: String(c._id),
  title: c.title,
  status: c.status,
  statusLabel: STATUS_LABELS[c.status],
  date: isoDate(c.deadline),
  done: ['approved', 'published'].includes(c.status),
  daysLeft: Math.round((utcDay(isoDate(c.deadline)) - utcDay(today)) / DAY),
});

/**
 * Everything the calendar shows for a range of LOCAL dates (inclusive, in the user's profile timezone):
 * posts (each linked to its content), content deadlines, and planned dates with no post yet.
 */
export async function getRange(user, q) {
  const tz = tzOf(user);
  const [fy, fm, fd] = ymdParts(q.from);
  const [ty, tm, td] = ymdParts(q.to);
  const spanDays = Math.round((utcDay(q.to) - utcDay(q.from)) / DAY) + 1;
  if (Number.isNaN(spanDays) || spanDays < 1) throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path: 'to', message: '"to" must not be before "from"' }]);
  if (spanDays > MAX_RANGE_DAYS) throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path: 'to', message: `Ask for at most ${MAX_RANGE_DAYS} days at a time` }]);

  const start = zonedMidnight(fy, fm, fd, tz); // local midnight at the start of `from`
  const end = zonedMidnight(ty, tm, td + 1, tz); // local midnight AFTER `to`
  const dateStart = new Date(utcDay(q.from));
  const dateEnd = new Date(utcDay(q.to) + DAY);

  // Filters that live on the content narrow the set of content ids; posts and deadlines follow.
  const contentWhere = { owner: user.id, archivedAt: null };
  if (q.category) contentWhere.category = oid(q.category);
  if (q.campaign) contentWhere.campaign = oid(q.campaign);
  if (q.contentStatus?.length) contentWhere.status = { $in: q.contentStatus };
  const narrowed = !!(q.category || q.campaign || q.contentStatus?.length);
  const allowedIds = narrowed ? await Content.find(contentWhere).distinct('_id') : null;

  const postWhere = { owner: user.id, scheduledAt: { $gte: start, $lt: end } };
  if (q.platform) postWhere.platform = q.platform;
  if (q.status?.length) postWhere.status = { $in: q.status };
  else if (!q.includeCancelled) postWhere.status = { $ne: 'cancelled' };
  if (allowedIds) postWhere.content = { $in: allowedIds };

  const deadlineWhere = { ...contentWhere, deadline: { $gte: dateStart, $lt: dateEnd } };
  const plannedWhere = { ...contentWhere, plannedDate: { $gte: dateStart, $lt: dateEnd }, status: { $ne: 'published' } };
  if (q.contentStatus?.length) plannedWhere.status = { $in: q.contentStatus.filter((s) => s !== 'published') };

  const today = formatLocal(new Date(), tz).date;
  const [posts, deadlineDocs, plannedDocs] = await Promise.all([
    Post.find(postWhere).sort({ scheduledAt: 1, _id: 1 }).limit(2000).lean(),
    // deadlines/planned dates are content-level; a platform filter narrows them to content that targets that platform
    Content.find(q.platform ? { ...deadlineWhere, platforms: q.platform } : deadlineWhere).select('title status deadline').sort({ deadline: 1 }).limit(1000).lean(),
    Content.find(q.platform ? { ...plannedWhere, platforms: q.platform } : plannedWhere).select('title status plannedDate').sort({ plannedDate: 1 }).limit(1000).lean(),
  ]);

  // A planned date is only a hint: hide it once the content already has a reminder / published post.
  const planned = plannedDocs.length
    ? await (async () => {
        const have = new Set((await Post.find({ owner: user.id, content: { $in: plannedDocs.map((c) => c._id) }, status: { $in: ['scheduled', 'awaiting_confirmation', 'published'] } }).distinct('content')).map(String));
        return plannedDocs.filter((c) => !have.has(String(c._id)));
      })()
    : [];

  return {
    range: { from: q.from, to: q.to, timezone: tz, today },
    posts: await presentMany(user, posts),
    deadlines: deadlineDocs.map((c) => deadlineItem(c, today)),
    plannedDates: planned.map((c) => ({ contentId: String(c._id), title: c.title, status: c.status, statusLabel: STATUS_LABELS[c.status], date: isoDate(c.plannedDate) })),
  };
}

/** The "what needs me" panel: deadlines in the next 14 days, posts that need action, the next reminders, undated plans. */
export async function getUpcoming(user, now = new Date(), days = 14) {
  const tz = tzOf(user);
  const today = formatLocal(now, tz).date;
  const dateStart = new Date(utcDay(today));
  const dateEnd = new Date(utcDay(today) + days * DAY);

  const open = { owner: user.id, archivedAt: null, status: { $nin: ['approved', 'published'] } };
  const [deadlines, overdue, attention, next, unscheduled] = await Promise.all([
    Content.find({ ...open, deadline: { $gte: dateStart, $lt: dateEnd } }).select('title status deadline').sort({ deadline: 1 }).limit(20).lean(),
    Content.countDocuments({ ...open, deadline: { $lt: dateStart } }),
    Post.find({ owner: user.id, $or: [{ status: 'awaiting_confirmation' }, { status: 'scheduled', scheduledAt: { $lt: now } }] }).sort({ scheduledAt: 1 }).limit(20).lean(),
    Post.find({ owner: user.id, status: 'scheduled', scheduledAt: { $gte: now, $lt: new Date(now.getTime() + 7 * DAY) } }).sort({ scheduledAt: 1 }).limit(10).lean(),
    Post.find({ owner: user.id, status: 'planned', scheduledAt: { $exists: false } }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  return {
    today,
    timezone: tz,
    windowDays: days,
    deadlines: deadlines.map((c) => deadlineItem(c, today)),
    overdueDeadlines: overdue,
    needsAttention: await presentMany(user, attention),
    nextReminders: await presentMany(user, next),
    unscheduled: await presentMany(user, unscheduled),
  };
}

export { contentSummaries };
