import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { api as contentApi } from './helpers/content.js';
import { approvedContent, newContent, notifs, posts, scheduled, setPrefs, setTimezone, T } from './helpers/calendar.js';
import { runReminderSweep } from '../src/jobs/reminders.js';
import { Notification } from '../src/modules/notifications/notification.model.js';
import { Post } from '../src/modules/posts/post.model.js';
import { User } from '../src/modules/users/user.model.js';

useDatabase();

const at = (s) => new Date(s);
const ofType = async (owner, type) => Notification.find({ owner, type }).sort({ createdAt: 1 }).lean();
const count = (owner) => Notification.countDocuments({ owner });

describe('reminders before a scheduled post', () => {
  // Scheduled for 15 June 2040, 18:00 in Kolkata = 12:30Z. Reminders: 1 day and 1 hour before.
  async function setup() {
    const a = await signUp();
    await setTimezone(a.token, 'Asia/Kolkata');
    const content = await approvedContent(a.token, { title: 'Launch reel' });
    const p = await scheduled(a.token, content, 'instagram', T(15, '18:00'), { reminderOffsets: [1440, 60] });
    return { a, content, p };
  }

  test('each reminder fires at its lead time, exactly once', async () => {
    const { a } = await setup();
    assert.deepEqual(await runReminderSweep(at('2040-06-14T12:29:59Z')), { postReminders: 0, postsReady: 0, deadlineReminders: 0, followUpReminders: 0, campaignReminders: 0, taskReminders: 0, taskOverdue: 0 }, 'one second early');
    assert.equal(await count(a.user.id), 0);

    assert.equal((await runReminderSweep(at('2040-06-14T12:30:00Z'))).postReminders, 1);
    const [day] = await ofType(a.user.id, 'post_reminder');
    assert.match(day.title, /^In 1 day: Launch reel/);
    assert.match(day.body, /Instagram at 18:00 on 2040-06-15/);
    assert.equal(day.localDate, '2040-06-15');
    assert.equal(day.entity.kind, 'post');

    assert.equal((await runReminderSweep(at('2040-06-14T13:00:00Z'))).postReminders, 0, 'running again sends nothing new');
    assert.equal((await runReminderSweep(at('2040-06-15T11:29:59Z'))).postReminders, 0);
    assert.equal((await runReminderSweep(at('2040-06-15T11:30:00Z'))).postReminders, 1);
    assert.deepEqual((await ofType(a.user.id, 'post_reminder')).map((n) => n.title.slice(0, 14)), ['In 1 day: Laun', 'In 1 hour: Lau']);
    assert.equal((await Post.findOne({ owner: a.user.id })).status, 'scheduled', 'still just a reminder; nothing was published');
  });

  test('when the time arrives the post becomes "ready to publish" and says CMS will not post it', async () => {
    const { a, p } = await setup();
    await runReminderSweep(at('2040-06-15T12:29:59Z'));
    assert.equal((await Post.findById(p.id)).status, 'scheduled');

    const stats = await runReminderSweep(at('2040-06-15T12:30:00Z'));
    assert.equal(stats.postsReady, 1);
    const post = await Post.findById(p.id);
    assert.equal(post.status, 'awaiting_confirmation');
    assert.ok(post.readyAt);
    assert.equal(post.verification, 'none');
    assert.equal(post.publishedAt, undefined);

    const [ready] = await ofType(a.user.id, 'post_ready');
    assert.match(ready.title, /^Time to publish: Launch reel/);
    assert.match(ready.body, /CMS does not post for you/);
    assert.equal(String(ready.entity.id), p.id);

    const again = await runReminderSweep(at('2040-06-15T13:00:00Z'));
    assert.equal(again.postsReady, 0);
    assert.equal((await ofType(a.user.id, 'post_ready')).length, 1);
  });

  test('a post with no reminders still gets the "time to publish" notice, and nothing before it', async () => {
    const a = await signUp();
    const p = await scheduled(a.token, await newContent(a.token, { title: 'Quiet' }), 'instagram', T(15), { reminderOffsets: [] });
    assert.equal((await runReminderSweep(at('2040-06-14T00:00:00Z'))).postReminders, 0);
    assert.equal(await count(a.user.id), 0);
    await runReminderSweep(at('2040-06-16T00:00:00Z'));
    assert.deepEqual((await Notification.find({ owner: a.user.id })).map((n) => n.type), ['post_ready']);
    assert.ok(p.id);
  });

  test('a late sweep (the server was down) still sends each notice once; very stale reminders are skipped', async () => {
    const { a, p } = await setup();
    // 30 minutes after the scheduled time: both reminders are overdue but recent, so each is sent, once.
    const late = await runReminderSweep(at('2040-06-15T13:00:00Z'));
    assert.deepEqual([late.postReminders, late.postsReady], [2, 1]);
    assert.equal((await runReminderSweep(at('2040-06-15T13:05:00Z'))).postReminders, 0);

    // Two days of downtime: reminders for something long past are pointless, but the post still becomes "ready".
    const b = await signUp();
    const stale = await scheduled(b.token, await newContent(b.token), 'instagram', T(15, '18:00'), { reminderOffsets: [60] });
    const s = await runReminderSweep(at('2040-06-17T12:00:00Z'));
    assert.equal(s.postReminders, 0);
    assert.equal((await Post.findById(stale.id)).status, 'awaiting_confirmation');
    assert.equal((await ofType(b.user.id, 'post_reminder')).length, 0);
    assert.ok(p.id && a);
  });

  test('rescheduling re-arms the reminders for the new time (and does not repeat the old ones)', async () => {
    const { a, p } = await setup();
    await runReminderSweep(at('2040-06-14T12:30:00Z')); // the 1-day reminder fires
    assert.equal(await count(a.user.id), 1);

    const moved = await posts.patch(a.token, p.id, { scheduledLocal: T(20, '18:00'), version: p.version });
    assert.equal(moved.status, 200);
    assert.equal((await runReminderSweep(at('2040-06-14T13:00:00Z'))).postReminders, 0, 'the old time no longer triggers anything');
    assert.equal((await runReminderSweep(at('2040-06-19T12:30:00Z'))).postReminders, 1, 'the new time has its own 1-day reminder');
    const titles = (await ofType(a.user.id, 'post_reminder')).map((n) => n.localDate);
    assert.deepEqual(titles, ['2040-06-15', '2040-06-20']);
  });

  test('only scheduled reminders fire: planned, cancelled, published and moved-back posts do not', async () => {
    const a = await signUp();
    const mk = async (platform) => scheduled(a.token, await approvedContent(a.token, { title: platform }), platform, T(15, '18:00'), { reminderOffsets: [60], confirmConflict: true });
    const planned = await mk('instagram');
    const cancelled = await mk('youtube');
    const published = await mk('tiktok');
    const kept = await mk('x');
    await posts.move(a.token, planned.id, 'planned');
    await posts.move(a.token, cancelled.id, 'cancelled');
    await posts.move(a.token, published.id, 'published', { publishedAt: new Date(Date.now() - 1000).toISOString() });
    const stats = await runReminderSweep(at('2040-06-15T18:30:00Z')); // these users are on UTC: due at 18:00Z
    assert.deepEqual([stats.postReminders, stats.postsReady], [1, 1]);
    assert.deepEqual((await Notification.find({ owner: a.user.id })).map((n) => String(n.entity.id)).sort(), [kept.id, kept.id].sort());
    assert.equal((await Post.findById(planned.id)).status, 'planned');
    assert.equal((await Post.findById(published.id)).status, 'published');
  });

  test('lead times are worded correctly in the singular and plural', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    for (const [offsets, platform] of [[[1], 'instagram'], [[90], 'youtube'], [[120], 'tiktok'], [[2880], 'x']]) {
      await scheduled(a.token, await newContent(a.token, { title: platform }), platform, T(15, '18:00'), { reminderOffsets: offsets });
    }
    await runReminderSweep(at('2040-06-15T17:59:00Z'));
    const titles = (await ofType(a.user.id, 'post_reminder')).map((n) => n.title.split(':')[0]).sort();
    assert.deepEqual(titles, ['In 1 minute', 'In 120 minutes'.replace('120 minutes', '2 hours'), 'In 2 days', 'In 90 minutes'].sort());
  });

  test('the notice warns when the content is not approved yet', async () => {
    const a = await signUp();
    await scheduled(a.token, await newContent(a.token, { title: 'Still a draft' }), 'instagram', T(15, '18:00'), { reminderOffsets: [60] });
    await runReminderSweep(at('2040-06-15T18:30:00Z')); // UTC user: due at 18:00Z
    const [n] = await ofType(a.user.id, 'post_ready');
    assert.match(n.body, /still "Idea"/);
  });

  test('two sweeps at the same moment (two servers) produce one notification and one status change', async () => {
    const { a, p } = await setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => runReminderSweep(at('2040-06-15T12:30:00Z'))));
    assert.equal(results.reduce((n, r) => n + r.postsReady, 0), 1);
    assert.equal((await ofType(a.user.id, 'post_ready')).length, 1);
    assert.equal((await ofType(a.user.id, 'post_reminder')).length, 2);
    assert.equal((await Post.findById(p.id)).status, 'awaiting_confirmation');
  });

  test('notifications are created for the right user only', async () => {
    const { a } = await setup();
    const b = await signUp();
    await runReminderSweep(at('2040-06-15T12:30:00Z'));
    assert.ok((await count(a.user.id)) > 0);
    assert.equal(await count(b.user.id), 0);
  });
});

describe('deadline reminders', () => {
  // A deadline lasts until the END of that day in the user's timezone. 2040-06-20 ends at 2040-06-20T18:30Z in Kolkata.
  test('fires at the user\'s lead time before the end of the deadline day, once', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'Asia/Kolkata');
    const content = await newContent(a.token, { title: 'Brand brief', deadline: '2040-06-20' });
    assert.equal((await runReminderSweep(at('2040-06-19T18:29:59Z'))).deadlineReminders, 0);
    assert.equal((await runReminderSweep(at('2040-06-19T18:30:00Z'))).deadlineReminders, 1);
    const [n] = await ofType(a.user.id, 'deadline_reminder');
    assert.match(n.title, /^Deadline in 1 day: Brand brief/);
    assert.equal(String(n.entity.id), content);
    assert.equal(n.entity.kind, 'content');
    assert.equal((await runReminderSweep(at('2040-06-19T19:00:00Z'))).deadlineReminders, 0);
  });

  test('follows the user\'s timezone and their configured lead times', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'America/New_York'); // end of 2040-06-20 = 2040-06-21T04:00Z
    await setPrefs(a.token, { deadlineReminderOffsets: [4320, 60] });
    await newContent(a.token, { title: 'NY deadline', deadline: '2040-06-20' });
    assert.equal((await runReminderSweep(at('2040-06-18T03:59:59Z'))).deadlineReminders, 0);
    assert.equal((await runReminderSweep(at('2040-06-18T04:00:00Z'))).deadlineReminders, 1); // 3 days before
    assert.equal((await runReminderSweep(at('2040-06-21T02:59:59Z'))).deadlineReminders, 0);
    assert.equal((await runReminderSweep(at('2040-06-21T03:00:00Z'))).deadlineReminders, 1); // 1 hour before
    assert.equal((await ofType(a.user.id, 'deadline_reminder')).length, 2);
  });

  test('is skipped for approved, published and archived content, and re-armed if the deadline moves', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    await approvedContent(a.token, { title: 'Done', deadline: '2040-06-20' });
    const archived = await newContent(a.token, { title: 'Archived', deadline: '2040-06-20' });
    await contentApi.archive(a.token, archived);
    const open = await newContent(a.token, { title: 'Open', deadline: '2040-06-20' });
    await runReminderSweep(at('2040-06-20T00:00:00Z')); // 24h before the end of the 20th
    assert.deepEqual((await ofType(a.user.id, 'deadline_reminder')).map((n) => String(n.entity.id)), [open]);

    await contentApi.patch(a.token, open, { deadline: '2040-06-25' });
    await runReminderSweep(at('2040-06-25T00:00:00Z'));
    assert.equal((await ofType(a.user.id, 'deadline_reminder')).length, 2, 'a new deadline date has its own reminder');
  });

  test('approving content stops further deadline reminders', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    const id = await newContent(a.token, { title: 'Soon done', deadline: '2040-06-20', caption: 'c' });
    for (const to of ['planning', 'creation', 'review', 'approved']) await contentApi.move(a.token, id, to);
    assert.equal((await runReminderSweep(at('2040-06-20T00:00:00Z'))).deadlineReminders, 0);
  });
});

describe('notifications API', () => {
  async function withNotifications() {
    const a = await signUp();
    await setTimezone(a.token, 'Asia/Kolkata');
    for (const [platform, time] of [['instagram', '10:00'], ['youtube', '12:00'], ['tiktok', '14:00']]) {
      await scheduled(a.token, await newContent(a.token, { title: platform }), platform, T(15, time), { reminderOffsets: [] });
    }
    await runReminderSweep(at('2040-06-16T00:00:00Z'));
    return a;
  }

  test('lists newest first with an unread count, and marks one or all as read', async () => {
    const a = await withNotifications();
    const list = (await notifs.list(a.token)).body;
    assert.equal(list.data.length, 3);
    assert.equal(list.meta.unread, 3);
    assert.ok(list.data.every((n) => n.type === 'post_ready' && n.read === false && n.entity.id && n.title));
    const times = list.data.map((n) => new Date(n.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((x, y) => y - x));

    const one = await notifs.read(a.token, list.data[0].id);
    assert.equal(one.body.data.read, true);
    assert.equal((await notifs.read(a.token, list.data[0].id)).status, 200, 'idempotent');
    assert.equal((await notifs.list(a.token)).body.meta.unread, 2);
    assert.equal((await notifs.list(a.token, 'unread=true')).body.data.length, 2);

    assert.equal((await notifs.readAll(a.token)).body.updated, 2);
    assert.equal((await notifs.list(a.token)).body.meta.unread, 0);
    assert.equal((await notifs.list(a.token, 'limit=2')).body.data.length, 2);
    assert.equal((await notifs.list(a.token, 'limit=0')).status, 400);
    assert.equal((await notifs.list(a.token, 'limit=101')).status, 400);
  });

  test('one user can never read or change another user\'s notifications', async () => {
    const a = await withNotifications();
    const b = await signUp();
    const [first] = (await notifs.list(a.token)).body.data;
    assert.deepEqual((await notifs.list(b.token)).body, { data: [], meta: { unread: 0 } });
    const res = await notifs.read(b.token, first.id);
    assert.equal(res.status, 404);
    assert.equal((await notifs.readAll(b.token)).body.updated, 0);
    assert.equal((await notifs.list(a.token)).body.meta.unread, 3, 'A\'s notifications are untouched');
    assert.equal((await notifs.read(b.token, 'not-an-id')).status, 404);
  });

  test('notifications expire automatically after 90 days', async () => {
    await signUp();
    const ttl = (await Notification.collection.indexes()).find((i) => i.key.createdAt === 1 && i.expireAfterSeconds);
    assert.equal(ttl.expireAfterSeconds, 90 * 24 * 60 * 60);
  });
});

describe('calendar preferences', () => {
  test('have sensible defaults and are part of the profile', async () => {
    const { token } = await signUp();
    const me = (await request(app).get('/api/v1/me').set(bearer(token))).body.user;
    assert.deepEqual(me.calendarPrefs, { defaultReminderOffsets: [60], deadlineReminderOffsets: [1440], weekStartsOn: 1 });
  });

  test('can be changed one field at a time without wiping the others', async () => {
    const { token } = await signUp();
    await setPrefs(token, { weekStartsOn: 0 });
    await setPrefs(token, { defaultReminderOffsets: [10, 1440, 10] });
    const me = (await request(app).get('/api/v1/me').set(bearer(token))).body.user;
    assert.deepEqual(me.calendarPrefs, { defaultReminderOffsets: [10, 1440], deadlineReminderOffsets: [1440], weekStartsOn: 0 });
  });

  test('rejects invalid values and unknown keys', async () => {
    const { token, user } = await signUp();
    for (const bad of [{ weekStartsOn: 3 }, { weekStartsOn: '1' }, { defaultReminderOffsets: [0] }, { defaultReminderOffsets: [43_201] }, { defaultReminderOffsets: [1, 2, 3, 4, 5, 6] },
      { deadlineReminderOffsets: ['1'] }, { deadlineReminderOffsets: [1.5] }, {}, { unknown: 1 }, { weekStartsOn: 1, owner: 'x' }]) {
      const res = await setPrefs(token, bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
    const stored = await User.findById(user.id).lean();
    assert.deepEqual(stored.calendarPrefs.defaultReminderOffsets, [60]);
  });

  test('a user can only change their own preferences', async () => {
    const a = await signUp();
    const b = await signUp();
    await setPrefs(a.token, { weekStartsOn: 6 });
    const bMe = (await request(app).get('/api/v1/me').set(bearer(b.token))).body.user;
    assert.equal(bMe.calendarPrefs.weekStartsOn, 1);
  });
});
