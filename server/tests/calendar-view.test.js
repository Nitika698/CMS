import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { api as contentApi } from './helpers/content.js';
import { approvedContent, cal, newContent, notifs, posts, scheduled, setTimezone, T } from './helpers/calendar.js';
import { getUpcoming } from '../src/modules/calendar/calendar.service.js';
import { Campaign } from '../src/modules/campaigns/campaign.model.js';
import { Client } from '../src/modules/clients/client.model.js';
import { Content } from '../src/modules/content/content.model.js';
import { Post } from '../src/modules/posts/post.model.js';

useDatabase();

const GHOST = '507f1f77bcf86cd799439011';
const titles = (res) => res.body.posts.map((p) => p.content.title);
const mkCategory = async (token, name) => (await request(app).post('/api/v1/categories').set(bearer(token)).send({ name })).body.data.id;
const mkCampaign = async (owner, title) => {
  const client = await Client.create({ owner, name: `${title} brand` });
  return String((await Campaign.create({ owner, client: client._id, title, status: 'in_progress' }))._id);
};

describe('the calendar range', () => {
  async function seed() {
    const a = await signUp();
    await setTimezone(a.token, 'Asia/Kolkata');
    const food = await mkCategory(a.token, 'Food');
    const spring = await mkCampaign(a.user.id, 'Spring');
    const c1 = await approvedContent(a.token, { title: 'Pasta reel', category: food, campaign: spring, platforms: ['instagram'] });
    const c2 = await newContent(a.token, { title: 'Sushi guide', platforms: ['youtube'] });
    const c3 = await newContent(a.token, { title: 'Taco short', platforms: ['tiktok'], category: food });
    const c4 = await approvedContent(a.token, { title: 'Published one', platforms: ['instagram'] });
    const c5 = await newContent(a.token, { title: 'Cancelled one' });
    const c6 = await newContent(a.token, { title: 'Far away' });
    await scheduled(a.token, c1, 'instagram', T(10, '10:00'));
    await scheduled(a.token, c2, 'youtube', T(10, '22:00'));
    await posts.create(a.token, { content: c3, platform: 'tiktok', scheduledLocal: T(11, '09:00') });
    const pub = await scheduled(a.token, c4, 'instagram', T(11, '20:00'));
    await posts.move(a.token, pub.id, 'published', { publishedAt: new Date(Date.now() - 60_000).toISOString() });
    const cx = await scheduled(a.token, c5, 'x', T(12, '08:00'));
    await posts.move(a.token, cx.id, 'cancelled');
    await scheduled(a.token, c6, 'instagram', T(25, '08:00'));
    return { a, food, spring, ids: { c1, c2, c3, c4, c5, c6 } };
  }

  test('returns posts for the visible local dates, each linked to its content with platform and stage', async () => {
    const { a, ids } = await seed();
    const res = await cal.range(a.token, 'from=2040-06-10&to=2040-06-12');
    assert.equal(res.status, 200);
    assert.deepEqual(titles(res), ['Pasta reel', 'Sushi guide', 'Taco short', 'Published one']);
    assert.deepEqual(res.body.range, { from: '2040-06-10', to: '2040-06-12', timezone: 'Asia/Kolkata', today: res.body.range.today });
    const first = res.body.posts[0];
    assert.equal(first.contentId, ids.c1);
    assert.deepEqual([first.platform, first.status, first.stage.label, first.localDate, first.localTime], ['instagram', 'scheduled', 'Scheduled reminder', '2040-06-10', '10:00']);
    assert.deepEqual([first.content.statusLabel, first.content.category.name, first.content.campaign.title], ['Approved', 'Food', 'Spring']);
    const stages = Object.fromEntries(res.body.posts.map((p) => [p.content.title, p.stage.label]));
    assert.deepEqual(stages, { 'Pasta reel': 'Scheduled reminder', 'Sushi guide': 'Scheduled reminder', 'Taco short': 'Planned', 'Published one': 'Published' });
  });

  test('cancelled posts are hidden unless asked for', async () => {
    const { a } = await seed();
    assert.ok(!titles(await cal.range(a.token, 'from=2040-06-12&to=2040-06-12')).includes('Cancelled one'));
    assert.deepEqual(titles(await cal.range(a.token, 'from=2040-06-12&to=2040-06-12&includeCancelled=true')), ['Cancelled one']);
    assert.deepEqual(titles(await cal.range(a.token, 'from=2040-06-01&to=2040-06-30&status=cancelled')), ['Cancelled one']);
  });

  test('both ends of the date range are inclusive and nothing outside leaks in', async () => {
    const { a } = await seed();
    assert.deepEqual(titles(await cal.range(a.token, 'from=2040-06-10&to=2040-06-10')), ['Pasta reel', 'Sushi guide']);
    assert.deepEqual(titles(await cal.range(a.token, 'from=2040-06-09&to=2040-06-09')), []);
    assert.deepEqual(titles(await cal.range(a.token, 'from=2040-06-25&to=2040-06-25')), ['Far away']);
    assert.equal((await cal.range(a.token, 'from=2040-06-01&to=2040-06-30')).body.posts.length, 5);
  });

  test('the visible day follows the user\'s timezone, not UTC', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'Asia/Kolkata');
    await scheduled(a.token, await newContent(a.token, { title: 'Just after midnight' }), 'instagram', T(15, '00:30')); // 2040-06-14T19:00Z
    assert.deepEqual(titles(await cal.range(a.token, 'from=2040-06-15&to=2040-06-15')), ['Just after midnight']);
    assert.deepEqual(titles(await cal.range(a.token, 'from=2040-06-14&to=2040-06-14')), []);
    await setTimezone(a.token, 'UTC'); // same instant is now the 14th
    assert.deepEqual(titles(await cal.range(a.token, 'from=2040-06-14&to=2040-06-14')), ['Just after midnight']);
    assert.deepEqual(titles(await cal.range(a.token, 'from=2040-06-15&to=2040-06-15')), []);
  });

  test('filters by platform, category, campaign, post status and content status, and they combine', async () => {
    const { a, food, spring } = await seed();
    const q = (extra) => cal.range(a.token, `from=2040-06-01&to=2040-06-30&${extra}`);
    assert.deepEqual((await titles(await q('platform=instagram'))).sort(), ['Far away', 'Pasta reel', 'Published one']);
    assert.deepEqual((await titles(await q(`category=${food}`))).sort(), ['Pasta reel', 'Taco short']);
    assert.deepEqual(titles(await q(`campaign=${spring}`)), ['Pasta reel']);
    assert.deepEqual(titles(await q('status=planned')), ['Taco short']);
    assert.deepEqual(titles(await q('status=scheduled,published')).sort(), ['Far away', 'Pasta reel', 'Published one', 'Sushi guide']);
    assert.deepEqual(titles(await q('contentStatus=approved')).sort(), ['Pasta reel', 'Published one']);
    assert.deepEqual(titles(await q(`platform=instagram&category=${food}`)), ['Pasta reel']);
    assert.deepEqual(titles(await q(`platform=youtube&category=${food}`)), []);
    assert.deepEqual(titles(await q('platform=instagram&status=published')), ['Published one']);
  });

  test('another user\'s category or campaign id used as a filter reveals nothing', async () => {
    const { a } = await seed();
    const b = await signUp();
    const bFood = await mkCategory(b.token, 'Food');
    const bCamp = await mkCampaign(b.user.id, 'Bravo');
    for (const f of [`category=${bFood}`, `campaign=${bCamp}`, `category=${GHOST}`]) {
      const res = await cal.range(a.token, `from=2040-06-01&to=2040-06-30&${f}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.posts, []);
    }
  });

  test('rejects bad ranges and unknown filter values', async () => {
    const { token } = await signUp();
    for (const q of [
      '', 'from=2040-06-10', 'from=2040-06-10&to=nope', 'from=2040-06-10T00:00&to=2040-06-11', 'from=2040-06-12&to=2040-06-10',
      'from=2040-01-01&to=2040-03-10', // 70 days: too wide
      'from=2040-06-01&to=2040-06-02&platform=myspace', 'from=2040-06-01&to=2040-06-02&status=live', 'from=2040-06-01&to=2040-06-02&category=nope',
    ]) {
      assert.equal((await cal.range(token, q)).status, 400, q);
    }
    assert.equal((await cal.range(token, 'from=2040-06-01&to=2040-08-01')).status, 200); // exactly 62 days
  });

  describe('deadlines and planned dates', () => {
    test('content deadlines appear on their date, flagged done once approved; archived content is excluded', async () => {
      const a = await signUp();
      const open = await newContent(a.token, { title: 'Due soon', deadline: '2040-06-11' });
      const done = await approvedContent(a.token, { title: 'Already approved', deadline: '2040-06-11' });
      const archived = await newContent(a.token, { title: 'Archived', deadline: '2040-06-11' });
      await contentApi.archive(a.token, archived);
      await newContent(a.token, { title: 'Elsewhere', deadline: '2040-07-01' });
      const res = await cal.range(a.token, 'from=2040-06-10&to=2040-06-12');
      assert.deepEqual(res.body.deadlines.map((d) => [d.title, d.date, d.done]).sort(), [['Already approved', '2040-06-11', true], ['Due soon', '2040-06-11', false]]);
      assert.ok(res.body.deadlines.every((d) => d.contentId && d.statusLabel));
      assert.ok(open && done);
    });

    test('deadlines follow the same filters as posts', async () => {
      const a = await signUp();
      const food = await mkCategory(a.token, 'Food');
      await newContent(a.token, { title: 'IG food', deadline: '2040-06-11', category: food, platforms: ['instagram'] });
      await newContent(a.token, { title: 'YT other', deadline: '2040-06-11', platforms: ['youtube'] });
      const q = (extra) => cal.range(a.token, `from=2040-06-10&to=2040-06-12&${extra}`);
      assert.deepEqual((await q(`category=${food}`)).body.deadlines.map((d) => d.title), ['IG food']);
      assert.deepEqual((await q('platform=youtube')).body.deadlines.map((d) => d.title), ['YT other']);
      assert.deepEqual((await q('contentStatus=review')).body.deadlines, []);
    });

    test('a planned date shows until the content has a reminder or a published post', async () => {
      const a = await signUp();
      const lonely = await newContent(a.token, { title: 'Only a plan', plannedDate: '2040-06-11' });
      const covered = await newContent(a.token, { title: 'Has a reminder', plannedDate: '2040-06-11' });
      await newContent(a.token, { title: 'Other day', plannedDate: '2040-07-11' });
      await scheduled(a.token, covered, 'instagram', T(11, '10:00'));
      const res = await cal.range(a.token, 'from=2040-06-10&to=2040-06-12');
      assert.deepEqual(res.body.plannedDates.map((d) => [d.title, d.date]), [['Only a plan', '2040-06-11']]);
      assert.equal(res.body.plannedDates[0].contentId, lonely);
    });
  });
});

describe('the "what needs me" panel', () => {
  // A fixed clock: 2040-06-10 10:00Z = 15:30 in Kolkata, so "today" there is 2040-06-10.
  const NOW = new Date('2040-06-10T10:00:00Z');

  test('lists deadlines in the next 14 days, overdue count, posts needing action, next reminders and undated plans', async () => {
    const a = await signUp();
    const user = { id: a.user.id, timezone: 'Asia/Kolkata' };
    const mk = (title, deadline, extra) => newContent(a.token, { title, ...(deadline && { deadline }), ...extra });
    await mk('Due today', '2040-06-10');
    await mk('Due in 13 days', '2040-06-23');
    await mk('Due in 14 days (outside)', '2040-06-24');
    await mk('Overdue one', '2040-06-09');
    await mk('Overdue two', '2040-06-01');
    const approved = await approvedContent(a.token, { title: 'Approved, deadline today', deadline: '2040-06-10' });
    const archived = await mk('Archived', '2040-06-12');
    await contentApi.archive(a.token, archived);

    const pc = async () => newContent(a.token);
    await Post.create({ owner: a.user.id, content: await pc(), platform: 'instagram', status: 'awaiting_confirmation', scheduledAt: new Date('2040-06-10T08:00:00Z') });
    await Post.create({ owner: a.user.id, content: await pc(), platform: 'youtube', status: 'scheduled', scheduledAt: new Date('2040-06-10T09:00:00Z') }); // time passed, never confirmed
    await Post.create({ owner: a.user.id, content: await pc(), platform: 'tiktok', status: 'scheduled', scheduledAt: new Date('2040-06-12T09:00:00Z') });
    await Post.create({ owner: a.user.id, content: await pc(), platform: 'x', status: 'scheduled', scheduledAt: new Date('2040-06-20T09:00:00Z') }); // beyond 7 days
    await Post.create({ owner: a.user.id, content: await pc(), platform: 'linkedin', status: 'planned' });
    await Post.create({ owner: a.user.id, content: await pc(), platform: 'facebook', status: 'planned', scheduledAt: new Date('2040-06-12T09:00:00Z') });
    assert.ok(approved);

    const up = await getUpcoming(user, NOW);
    assert.equal(up.today, '2040-06-10');
    assert.deepEqual(up.deadlines.map((d) => [d.title, d.daysLeft]), [['Due today', 0], ['Due in 13 days', 13]]);
    assert.equal(up.overdueDeadlines, 2);
    assert.deepEqual(up.needsAttention.map((p) => p.platform).sort(), ['instagram', 'youtube']);
    assert.deepEqual(up.nextReminders.map((p) => p.platform), ['tiktok']);
    assert.deepEqual(up.unscheduled.map((p) => p.platform), ['linkedin']);
    assert.ok(up.needsAttention.every((p) => p.contentId && p.content.title), 'each links to its content');
  });

  test('is scoped to the user and reachable over HTTP', async () => {
    const a = await signUp();
    const b = await signUp();
    await newContent(a.token, { title: 'A deadline', deadline: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) });
    assert.equal((await cal.upcoming(a.token)).body.deadlines.length, 1);
    const empty = (await cal.upcoming(b.token)).body;
    assert.deepEqual([empty.deadlines, empty.needsAttention, empty.nextReminders, empty.unscheduled, empty.overdueDeadlines], [[], [], [], [], 0]);
  });
});

describe('metadata and honesty about publishing', () => {
  test('meta describes the stages and limits for the UI', async () => {
    const { token } = await signUp();
    const m = (await cal.meta(token)).body;
    assert.deepEqual(m.postStatuses.map((s) => s.status), ['planned', 'scheduled', 'awaiting_confirmation', 'published', 'missed', 'failed', 'cancelled']); // values the API filters accept
    assert.deepEqual(m.postStatuses.map((s) => s.key), ['planned', 'reminder', 'ready', 'published', 'missed', 'failed', 'cancelled']); // user-facing stage keys
    assert.deepEqual(m.postStatuses.map((s) => s.label).slice(0, 4), ['Planned', 'Scheduled reminder', 'Ready to publish', 'Published']);
    assert.equal(m.conflictWindowMinutes, 30);
    assert.equal(m.maxRangeDays, 62);
  });

  test('no platform claims direct publishing: every one is manual', async () => {
    const { token } = await signUp();
    const list = (await cal.integrations(token)).body.data;
    assert.ok(list.length >= 8);
    for (const p of list) {
      assert.equal(p.directPublishing, false, p.platform);
      assert.equal(p.mode, 'manual', p.platform);
      assert.match(p.reason, /yourself/i);
    }
  });
});

describe('access control and isolation', () => {
  test('every calendar, post and notification route answers 401 without a valid token', async () => {
    const routes = [
      ['get', '/calendar?from=2040-06-01&to=2040-06-02'], ['get', '/calendar/upcoming'], ['get', '/calendar/meta'], ['get', '/calendar/integrations'],
      ['get', '/posts'], ['post', '/posts'], ['get', `/posts/${GHOST}`], ['patch', `/posts/${GHOST}`], ['post', `/posts/${GHOST}/transition`], ['delete', `/posts/${GHOST}`], ['post', `/posts/${GHOST}/publish-via-platform`],
      ['get', '/notifications'], ['post', '/notifications/read-all'], ['post', `/notifications/${GHOST}/read`],
    ];
    for (const [method, path] of routes) {
      for (const headers of [{}, { Authorization: 'Bearer garbage' }]) {
        const res = await request(app)[method](`/api/v1${path}`).set(headers).send({});
        assert.equal(res.status, 401, `${method.toUpperCase()} ${path} ${JSON.stringify(headers)}`);
      }
    }
  });

  test('B gets 404 on every action against A\'s post, and nothing changes', async () => {
    const a = await signUp();
    const b = await signUp();
    const p = await scheduled(a.token, await approvedContent(a.token, { title: 'ALPHA secret' }), 'instagram', T(15));
    const before = await Post.findById(p.id).lean();
    const attempts = {
      get: await posts.get(b.token, p.id),
      patch: await posts.patch(b.token, p.id, { scheduledLocal: T(20) }),
      move: await posts.move(b.token, p.id, 'cancelled'),
      remove: await posts.remove(b.token, p.id),
      viaPlatform: await posts.viaPlatform(b.token, p.id),
    };
    for (const [name, res] of Object.entries(attempts)) {
      assert.equal(res.status, 404, name);
      assert.ok(!JSON.stringify(res.body).includes('ALPHA'), `${name} must not leak`);
    }
    assert.deepEqual(attempts.get.body, (await posts.get(b.token, GHOST)).body, 'a foreign id looks like a missing one');
    assert.deepEqual(await Post.findById(p.id).lean(), before);
  });

  test('B cannot see, filter or schedule onto A\'s calendar', async () => {
    const a = await signUp();
    const b = await signUp();
    const content = await newContent(a.token, { title: 'ALPHA only' });
    await scheduled(a.token, content, 'instagram', T(15));
    assert.deepEqual((await cal.range(b.token, 'from=2040-06-01&to=2040-06-30')).body.posts, []);
    assert.deepEqual((await posts.list(b.token)).body.data, []);
    assert.equal((await posts.create(b.token, { content, platform: 'youtube' })).status, 400);
    const own = await scheduled(b.token, await newContent(b.token), 'instagram', T(15)); // same slot on B's calendar is fine
    assert.ok(own.id);
    assert.equal((await cal.range(a.token, 'from=2040-06-01&to=2040-06-30')).body.posts.length, 1);
  });

  test('a logged-out session loses calendar access immediately', async () => {
    const a = await signUp();
    await a.agent.post('/api/v1/auth/logout').set({ 'X-Requested-With': 'cms' });
    assert.equal((await cal.range(a.token, 'from=2040-06-01&to=2040-06-02')).status, 401);
    assert.equal((await notifs.list(a.token)).status, 401);
  });

  test('content owned by A cannot gain posts through B even by editing content ids', async () => {
    const a = await signUp();
    const b = await signUp();
    const aContent = await newContent(a.token);
    const bContent = await newContent(b.token);
    const p = (await posts.create(b.token, { content: bContent, platform: 'instagram' })).body.data;
    const res = await posts.patch(b.token, p.id, { content: aContent, captionOverride: 'x' });
    assert.equal(res.status, 400);
    assert.equal(String((await Post.findById(p.id)).content), bContent);
    assert.equal(await Content.countDocuments({ owner: b.user.id }), 1);
  });
});
