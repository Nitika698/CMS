import { formatLocal, zonedMidnight } from '../lib/timezone.js';
import { Client } from '../modules/clients/client.model.js';
import { Content } from '../modules/content/content.model.js';
import { STATUS_LABELS } from '../modules/content/content.constants.js';
import { notifyOnce } from '../modules/notifications/notifications.service.js';
import { MAX_REMINDER_MINUTES, RANGE_REMINDER_STALE_MS } from '../modules/posts/post.constants.js';
import { Post } from '../modules/posts/post.model.js';
import { User } from '../modules/users/user.model.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const PLATFORM_NAME = { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', facebook: 'Facebook', blog: 'your blog', other: 'another platform' };
const platformName = (p) => PLATFORM_NAME[p] ?? p;

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const human = (minutes) => {
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
};

/**
 * One pass of the reminder job. Safe to run repeatedly and from several servers at once:
 *  - status changes use an atomic compare-and-set, and
 *  - every notification has a unique key (thing + reminder + scheduled time), so nothing fires twice and
 *    rescheduling naturally re-arms the reminders.
 * `now` is injectable for tests. Reminders are IN-APP only. Nothing here posts to any network.
 */
export async function runReminderSweep(now = new Date()) {
  const stats = { postReminders: 0, postsReady: 0, deadlineReminders: 0, followUpReminders: 0 };

  // ---- 1. reminders before a scheduled post (offsets chosen per post)
  const upcoming = await Post.find({
    status: 'scheduled',
    scheduledAt: { $gt: new Date(now.getTime() - RANGE_REMINDER_STALE_MS), $lte: new Date(now.getTime() + MAX_REMINDER_MINUTES * MIN) },
    'reminderOffsets.0': { $exists: true },
  }).lean();

  const needUsers = new Map();
  const userFor = async (id) => {
    const key = String(id);
    if (!needUsers.has(key)) needUsers.set(key, await User.findById(id).select('timezone calendarPrefs').lean());
    return needUsers.get(key);
  };
  const titles = new Map();
  const titleOf = async (owner, contentId) => {
    const key = String(contentId);
    if (!titles.has(key)) titles.set(key, await Content.findOne({ _id: contentId, owner }).select('title status').lean());
    return titles.get(key);
  };

  for (const post of upcoming) {
    const user = await userFor(post.owner);
    const content = await titleOf(post.owner, post.content);
    if (!user || !content) continue;
    for (const offset of post.reminderOffsets) {
      const fireAt = post.scheduledAt.getTime() - offset * MIN;
      if (fireAt > now.getTime()) continue; // not yet
      const local = formatLocal(post.scheduledAt, user.timezone || 'UTC');
      const created = await notifyOnce({
        owner: post.owner,
        type: 'post_reminder',
        title: `In ${human(offset)}: ${content.title}`,
        body: `Scheduled for ${platformName(post.platform)} at ${local.time} on ${local.date}.${['approved', 'published'].includes(content.status) ? '' : ` The content is still "${STATUS_LABELS[content.status]}".`}`,
        entity: { kind: 'post', id: post._id },
        localDate: local.date,
        dedupeKey: `post:${post._id}:remind${offset}:${post.scheduledAt.getTime()}`,
      });
      if (created) stats.postReminders += 1;
    }
  }

  // ---- 2. the time has come: scheduled -> ready to publish (compare-and-set), plus a notice
  const due = await Post.find({ status: 'scheduled', scheduledAt: { $lte: now } }).select('_id').lean();
  for (const { _id } of due) {
    const post = await Post.findOneAndUpdate(
      { _id, status: 'scheduled', scheduledAt: { $lte: now } },
      { $set: { status: 'awaiting_confirmation', readyAt: now, statusChangedAt: now, active: true }, $inc: { __v: 1 } },
      { new: true },
    );
    if (!post) continue; // someone else (another instance, or the user) changed it first
    const user = await userFor(post.owner);
    const content = await titleOf(post.owner, post.content);
    if (!user || !content) continue;
    const local = formatLocal(post.scheduledAt, user.timezone || 'UTC');
    await notifyOnce({
      owner: post.owner,
      type: 'post_ready',
      title: `Time to publish: ${content.title}`,
      body: `Post it on ${platformName(post.platform)}, then confirm it in CMS. (Scheduled for ${local.time} on ${local.date}. CMS does not post for you.)${['approved', 'published'].includes(content.status) ? '' : ` Note: the content is still "${STATUS_LABELS[content.status]}".`}`,
      entity: { kind: 'post', id: post._id },
      localDate: local.date,
      dedupeKey: `post:${post._id}:ready:${post.scheduledAt.getTime()}`,
    });
    stats.postsReady += 1;
  }

  // ---- 3. content deadlines (per-user lead times; a deadline lasts until the end of that day in the user's timezone)
  const horizon = new Date(now.getTime() + 32 * DAY);
  const deadlines = await Content.find({
    archivedAt: null,
    status: { $nin: ['approved', 'published'] },
    deadline: { $gte: new Date(now.getTime() - 2 * DAY), $lt: horizon },
  })
    .select('owner title status deadline')
    .lean();

  for (const c of deadlines) {
    const user = await userFor(c.owner);
    if (!user) continue;
    const tz = user.timezone || 'UTC';
    const [y, m, d] = c.deadline.toISOString().slice(0, 10).split('-').map(Number);
    const dueAt = zonedMidnight(y, m, d + 1, tz).getTime(); // end of the deadline day, local
    for (const offset of user.calendarPrefs?.deadlineReminderOffsets ?? [1440]) {
      const fireAt = dueAt - offset * MIN;
      if (fireAt > now.getTime() || dueAt < now.getTime() - RANGE_REMINDER_STALE_MS) continue;
      const created = await notifyOnce({
        owner: c.owner,
        type: 'deadline_reminder',
        title: `Deadline ${dueAt <= now.getTime() ? 'passed' : `in ${human(Math.max(1, Math.round((dueAt - now.getTime()) / MIN)))}`}: ${c.title}`,
        body: `Due ${c.deadline.toISOString().slice(0, 10)}. Status: ${STATUS_LABELS[c.status]}.`,
        entity: { kind: 'content', id: c._id },
        localDate: c.deadline.toISOString().slice(0, 10),
        dedupeKey: `deadline:${c._id}:remind${offset}:${c.deadline.getTime()}`,
      });
      if (created) stats.deadlineReminders += 1;
    }
  }

  // ---- 4. brand follow-ups: a notice at the start of the follow-up day in the user's timezone (once)
  const followUps = await Client.find({
    archivedAt: null,
    followUpAt: { $gte: new Date(now.getTime() - 3 * DAY), $lt: new Date(now.getTime() + 2 * DAY) },
  })
    .select('owner name followUpAt followUpNote')
    .lean();
  for (const c of followUps) {
    const user = await userFor(c.owner);
    if (!user) continue;
    const [y, m, d] = c.followUpAt.toISOString().slice(0, 10).split('-').map(Number);
    const startsAt = zonedMidnight(y, m, d, user.timezone || 'UTC').getTime();
    if (startsAt > now.getTime() || startsAt < now.getTime() - RANGE_REMINDER_STALE_MS * 2) continue; // not yet, or long past
    const created = await notifyOnce({
      owner: c.owner,
      type: 'followup_reminder',
      title: `Follow up with ${c.name}`,
      body: c.followUpNote || 'You planned to follow up with this brand today.',
      entity: { kind: 'client', id: c._id },
      localDate: c.followUpAt.toISOString().slice(0, 10),
      dedupeKey: `followup:${c._id}:${c.followUpAt.getTime()}`,
    });
    if (created) stats.followUpReminders += 1;
  }
  return stats;
}
