import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { api as contentApi } from './helpers/content.js';
import { approvedContent, newContent, posts, scheduled, setPrefs, setTimezone, T } from './helpers/calendar.js';
import { runReminderSweep } from '../src/jobs/reminders.js';
import { Post } from '../src/modules/posts/post.model.js';

useDatabase();

const ISO = (ms) => new Date(Date.now() + ms).toISOString();
const DAY = 86_400_000;

describe('creating calendar entries', () => {
  test('a planned post is a tentative slot: no date needed, no reminders, linked to its content', async () => {
    const { token } = await signUp();
    const content = await newContent(token, { title: 'Spring reel', platforms: ['instagram'] });
    const res = await posts.create(token, { content, platform: 'instagram' });
    assert.equal(res.status, 201);
    const p = res.body.data;
    assert.equal(p.status, 'planned');
    assert.equal(p.stage.key, 'planned');
    assert.equal(p.stage.label, 'Planned');
    assert.equal(p.scheduledAt, null);
    assert.equal(p.localDate, null);
    assert.deepEqual(p.transitions.map((t) => t.to), ['scheduled', 'cancelled']);
    assert.equal(p.contentId, content);
    assert.deepEqual([p.content.title, p.content.status, p.content.statusLabel, p.contentApproved], ['Spring reel', 'idea', 'Idea', false]);
    assert.deepEqual(res.body.warnings, []);
    assert.ok(p.createdAt && p.updatedAt);
  });

  test('a scheduled reminder needs a future time; it is described as a reminder, never as publishing', async () => {
    const { token } = await signUp();
    const content = await newContent(token);
    const missing = await posts.create(token, { content, platform: 'instagram', status: 'scheduled' });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.details[0].path, 'scheduledLocal');

    const past = await posts.create(token, { content, platform: 'instagram', status: 'scheduled', scheduledLocal: '2020-01-01T10:00' });
    assert.equal(past.status, 400);
    assert.match(past.body.error.details[0].message, /future/i);
    assert.equal(await Post.countDocuments(), 0);

    const ok = await posts.create(token, { content, platform: 'instagram', status: 'scheduled', scheduledLocal: T(15) });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.stage.key, 'reminder');
    assert.equal(ok.body.data.stage.label, 'Scheduled reminder');
    assert.match(ok.body.data.stage.description, /Nothing is posted automatically/);
    assert.equal(ok.body.data.verification, 'none');
    assert.equal(ok.body.data.publishedAt, null);
  });

  test('a planned post may carry a tentative date, even one that has passed', async () => {
    const { token } = await signUp();
    const content = await newContent(token);
    const res = await posts.create(token, { content, platform: 'youtube', scheduledLocal: '2020-03-01T09:00' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'planned');
    assert.equal(res.body.data.localDate, '2020-03-01');
  });

  test('reminders: defaults come from the user, an explicit empty list means none, duplicates collapse', async () => {
    const { token } = await signUp();
    const mk = async (extra, platform) => (await posts.create(token, { content: await newContent(token), platform, status: 'scheduled', scheduledLocal: T(15), ...extra })).body.data;
    assert.deepEqual((await mk({}, 'instagram')).reminderOffsets, [60]); // user default
    assert.deepEqual((await mk({ reminderOffsets: [] }, 'tiktok')).reminderOffsets, []);
    assert.deepEqual((await mk({ reminderOffsets: [60, 1440, 60] }, 'youtube')).reminderOffsets, [1440, 60]);
    await setPrefs(token, { defaultReminderOffsets: [30, 2880] });
    assert.deepEqual((await mk({}, 'x')).reminderOffsets, [2880, 30]);
  });

  test('every entry belongs to a content item of the same user', async () => {
    const a = await signUp();
    const b = await signUp();
    const aContent = await newContent(a.token);
    const foreign = await posts.create(b.token, { content: aContent, platform: 'instagram' });
    const ghost = await posts.create(b.token, { content: '507f1f77bcf86cd799439011', platform: 'instagram' });
    assert.equal(foreign.status, 400);
    assert.deepEqual(foreign.body, ghost.body, 'a foreign content id is indistinguishable from a missing one');
    assert.equal(foreign.body.error.details[0].path, 'content');
    assert.equal(await Post.countDocuments(), 0);
  });

  test('archived content cannot be added to the calendar', async () => {
    const { token } = await signUp();
    const content = await newContent(token);
    await contentApi.archive(token, content);
    const res = await posts.create(token, { content, platform: 'instagram' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ARCHIVED');
  });

  test('records calendar activity in the content history', async () => {
    const { token } = await signUp();
    const content = await newContent(token);
    const p = await scheduled(token, content, 'instagram', T(15));
    await posts.patch(token, p.id, { scheduledLocal: T(16), version: p.version });
    await posts.move(token, p.id, 'cancelled');
    const types = (await contentApi.history(token, content)).body.data.map((e) => e.type);
    assert.deepEqual(types.slice(0, 3), ['post_status_changed', 'post_rescheduled', 'post_created']);
  });
});

describe('validation', () => {
  test('rejects malformed requests with field details and creates nothing', async () => {
    const { token } = await signUp();
    const content = await newContent(token);
    const ok = { content, platform: 'instagram' };
    const bad = {
      'no body': [{}, 'content'],
      'bad platform': [{ ...ok, platform: 'myspace' }, 'platform'],
      'content not an id': [{ ...ok, content: 'abc' }, 'content'],
      'unknown content': [{ ...ok, content: '507f1f77bcf86cd799439011' }, 'content'],
      'status published': [{ ...ok, status: 'published' }, 'status'],
      'status awaiting': [{ ...ok, status: 'awaiting_confirmation' }, 'status'],
      'scheduledAt without an offset': [{ ...ok, scheduledAt: '2040-06-15T18:30:00' }, 'scheduledAt'],
      'scheduledAt not a date': [{ ...ok, scheduledAt: 'tomorrow' }, 'scheduledAt'],
      'scheduledLocal wrong shape': [{ ...ok, scheduledLocal: '2040-06-15 18:30' }, 'scheduledLocal'],
      'scheduledLocal with offset': [{ ...ok, scheduledLocal: '2040-06-15T18:30Z' }, 'scheduledLocal'],
      'both time fields': [{ ...ok, scheduledAt: '2040-06-15T13:00:00Z', scheduledLocal: T(15) }, 'scheduledLocal'],
      'impossible date': [{ ...ok, scheduledLocal: '2040-02-30T10:00' }, 'scheduledLocal'],
      'year too early': [{ ...ok, scheduledLocal: '1999-06-15T10:00' }, 'scheduledLocal'],
      'year too late': [{ ...ok, scheduledLocal: '2101-06-15T10:00' }, 'scheduledLocal'],
      'reminder of 0 minutes': [{ ...ok, reminderOffsets: [0] }, 'reminderOffsets.0'],
      'reminder over 30 days': [{ ...ok, reminderOffsets: [43_201] }, 'reminderOffsets.0'],
      'fractional reminder': [{ ...ok, reminderOffsets: [1.5] }, 'reminderOffsets.0'],
      'six reminders': [{ ...ok, reminderOffsets: [1, 2, 3, 4, 5, 6] }, 'reminderOffsets'],
      'reminders not a list': [{ ...ok, reminderOffsets: 60 }, 'reminderOffsets'],
      'caption too long': [{ ...ok, captionOverride: 'x'.repeat(20_001) }, 'captionOverride'],
    };
    for (const [name, [body, path]] of Object.entries(bad)) {
      const res = await posts.create(token, body);
      assert.equal(res.status, 400, name);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR', name);
      assert.ok(res.body.error.details.some((d) => d.path === path), `${name}: expected "${path}" in ${JSON.stringify(res.body.error.details)}`);
    }
    assert.equal(await Post.countDocuments(), 0);
  });

  test('server-controlled fields can never be set by a client', async () => {
    const a = await signUp();
    const b = await signUp();
    const content = await newContent(a.token);
    for (const extra of [{ owner: b.user.id }, { active: false }, { verification: 'platform' }, { externalPostId: 'x' }, { publishedAt: ISO(-1000) }, { readyAt: ISO(0) }, { _id: b.user.id }, { version: 0 }]) {
      assert.equal((await posts.create(a.token, { content, platform: 'instagram', ...extra })).status, 400, JSON.stringify(extra));
    }
    const p = (await posts.create(a.token, { content, platform: 'instagram' })).body.data;
    for (const extra of [{ owner: b.user.id }, { status: 'published' }, { active: false }, { verification: 'platform' }, { content: await newContent(a.token) }]) {
      assert.equal((await posts.patch(a.token, p.id, { captionOverride: 'x', ...extra })).status, 400, JSON.stringify(extra));
    }
    assert.equal(await Post.countDocuments({ owner: b.user.id }), 0);
    assert.equal((await Post.findById(p.id)).status, 'planned');
  });
});

describe('time zones', () => {
  test('a local wall-clock time is interpreted in the user\'s profile timezone and stored as an exact instant', async () => {
    const { token } = await signUp();
    await setTimezone(token, 'Asia/Kolkata');
    const content = await newContent(token);
    const p = await scheduled(token, content, 'instagram', T(15, '18:30'));
    assert.equal(p.scheduledAt, '2040-06-15T13:00:00.000Z');
    assert.deepEqual([p.localDate, p.localTime, p.scheduledLocal, p.timezone], ['2040-06-15', '18:30', T(15, '18:30'), 'Asia/Kolkata']);
    assert.equal(p.scheduledTimezone, 'Asia/Kolkata');
  });

  test('changing the profile timezone changes how the same instant is displayed, not the instant', async () => {
    const { token } = await signUp();
    await setTimezone(token, 'Asia/Kolkata');
    const p = await scheduled(token, await newContent(token), 'instagram', T(15, '18:30'));
    await setTimezone(token, 'America/New_York');
    const after = (await posts.get(token, p.id)).body.data;
    assert.equal(after.scheduledAt, p.scheduledAt);
    assert.deepEqual([after.localDate, after.localTime, after.timezone], ['2040-06-15', '09:00', 'America/New_York']);
  });

  test('the local date can differ from the UTC date', async () => {
    const { token } = await signUp();
    await setTimezone(token, 'Asia/Kolkata');
    const p = await scheduled(token, await newContent(token), 'instagram', T(15, '00:30'));
    assert.equal(p.scheduledAt, '2040-06-14T19:00:00.000Z'); // the 14th in UTC
    assert.equal(p.localDate, '2040-06-15'); // but the 15th on the user's calendar
  });

  test('an instant sent with an offset means the same moment as the equivalent local time', async () => {
    const { token } = await signUp();
    await setTimezone(token, 'Asia/Kolkata');
    const viaOffset = (await posts.create(token, { content: await newContent(token), platform: 'instagram', status: 'scheduled', scheduledAt: '2040-06-15T18:30:00+05:30' })).body.data;
    const viaUtc = (await posts.create(token, { content: await newContent(token), platform: 'youtube', status: 'scheduled', scheduledAt: '2040-06-15T13:00:00Z' })).body.data;
    const viaLocal = await scheduled(token, await newContent(token), 'tiktok', T(15, '18:30'));
    assert.deepEqual([viaOffset.scheduledAt, viaUtc.scheduledAt, viaLocal.scheduledAt], Array(3).fill('2040-06-15T13:00:00.000Z'));
  });

  test('a local time skipped by a clock change is refused with a clear message', async () => {
    const { token } = await signUp();
    await setTimezone(token, 'America/New_York');
    const res = await posts.create(token, { content: await newContent(token), platform: 'instagram', status: 'scheduled', scheduledLocal: '2040-03-11T02:30' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].path, 'scheduledLocal');
    assert.match(res.body.error.details[0].message, /does not exist.*America\/New_York/);
    const fine = await posts.create(token, { content: await newContent(token), platform: 'instagram', status: 'scheduled', scheduledLocal: '2040-03-11T03:30' });
    assert.equal(fine.status, 201);
    assert.equal(fine.body.data.scheduledAt, '2040-03-11T07:30:00.000Z'); // EDT, UTC-4
  });

  test('a local time that happens twice uses the earlier one and warns', async () => {
    const { token } = await signUp();
    await setTimezone(token, 'America/New_York');
    const res = await posts.create(token, { content: await newContent(token), platform: 'instagram', status: 'scheduled', scheduledLocal: '2040-11-04T01:30' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.scheduledAt, '2040-11-04T05:30:00.000Z');
    assert.equal(res.body.warnings[0].code, 'AMBIGUOUS_LOCAL_TIME');
  });

  test('a reschedule keeps the wall-clock time across a daylight-saving change', async () => {
    const { token } = await signUp();
    await setTimezone(token, 'America/New_York');
    const p = await scheduled(token, await newContent(token), 'instagram', '2040-03-09T09:00'); // before DST: UTC-5
    assert.equal(p.scheduledAt, '2040-03-09T14:00:00.000Z');
    const moved = (await posts.patch(token, p.id, { scheduledLocal: '2040-03-12T09:00', version: p.version })).body.data; // after DST: UTC-4
    assert.equal(moved.scheduledAt, '2040-03-12T13:00:00.000Z');
    assert.equal(moved.localTime, '09:00');
  });
});

describe('preventing accidental duplicates and double-booking', () => {
  test('one active post per content and platform', async () => {
    const { token } = await signUp();
    const content = await newContent(token);
    const first = await posts.create(token, { content, platform: 'instagram' });
    const dup = await posts.create(token, { content, platform: 'instagram', status: 'scheduled', scheduledLocal: T(15) });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_POST');
    assert.equal(dup.body.error.details.postId, first.body.data.id);
    assert.equal(await Post.countDocuments(), 1);
    assert.equal((await posts.create(token, { content, platform: 'youtube' })).status, 201); // another platform is fine
    assert.equal((await posts.create(token, { content: await newContent(token), platform: 'instagram' })).status, 201); // another content is fine
  });

  test('finishing a post (cancelled, published, missed) frees the slot', async () => {
    const { token, user } = await signUp();
    const content = await approvedContent(token);
    const p1 = (await posts.create(token, { content, platform: 'instagram' })).body.data;
    assert.equal((await posts.move(token, p1.id, 'cancelled')).status, 200);
    const p2 = (await posts.create(token, { content, platform: 'instagram' })).body.data; // allowed again
    await Post.updateOne({ _id: p2.id }, { status: 'published', verification: 'manual', publishedAt: new Date(), active: false });
    assert.equal((await posts.create(token, { content, platform: 'instagram' })).status, 201);
    assert.equal(await Post.countDocuments({ owner: user.id, content, platform: 'instagram' }), 3);
  });

  test('simultaneous creates cannot sneak a duplicate past the check', async () => {
    const { token } = await signUp();
    const content = await newContent(token);
    const results = await Promise.all(Array.from({ length: 6 }, () => posts.create(token, { content, platform: 'tiktok' })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.error.code === 'DUPLICATE_POST'));
    assert.equal(await Post.countDocuments(), 1);
  });

  test('moving a post to a platform that already has one, or re-opening into a taken slot, is refused', async () => {
    const { token } = await signUp();
    const content = await newContent(token);
    const ig = (await posts.create(token, { content, platform: 'instagram' })).body.data;
    await posts.create(token, { content, platform: 'youtube' });
    const clash = await posts.patch(token, ig.id, { platform: 'youtube' });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, 'DUPLICATE_POST');

    await posts.move(token, ig.id, 'cancelled');
    await posts.create(token, { content, platform: 'instagram' }); // takes the freed slot
    const reopen = await posts.move(token, ig.id, 'planned');
    assert.equal(reopen.status, 409);
    assert.equal(reopen.body.error.code, 'DUPLICATE_POST');
  });

  test('two reminders for the same platform close together need an explicit "schedule anyway"', async () => {
    const { token } = await signUp();
    await scheduled(token, await newContent(token, { title: 'First' }), 'instagram', T(15, '18:00'));
    const second = await newContent(token, { title: 'Second' });
    const body = { content: second, platform: 'instagram', status: 'scheduled', scheduledLocal: T(15, '18:20') };

    const blocked = await posts.create(token, body);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'SCHEDULE_CONFLICT');
    assert.equal(blocked.body.error.details.windowMinutes, 30);
    assert.deepEqual(blocked.body.error.details.conflicts.map((c) => [c.title, c.minutesApart]), [['First', 20]]);
    assert.equal(await Post.countDocuments(), 1);

    assert.equal((await posts.create(token, { ...body, confirmConflict: true })).status, 201);
  });

  test('the conflict window is exclusive, platform-specific, and ignores plans and other users', async () => {
    const a = await signUp();
    const b = await signUp();
    await scheduled(a.token, await newContent(a.token), 'instagram', T(15, '18:00'));
    const at = async (platform, time, token = a.token, extra = {}) =>
      posts.create(token, { content: await newContent(token), platform, status: 'scheduled', scheduledLocal: T(15, time), ...extra });

    assert.equal((await at('instagram', '18:30')).status, 201, 'exactly 30 minutes apart is allowed');
    assert.equal((await at('instagram', '17:31')).status, 409, '29 minutes before conflicts');
    assert.equal((await at('youtube', '18:00')).status, 201, 'a different platform never conflicts');
    assert.equal((await at('instagram', '18:00', b.token)).status, 201, 'another user\'s calendar is separate');
    const planned = await posts.create(a.token, { content: await newContent(a.token), platform: 'instagram', scheduledLocal: T(15, '18:05') });
    assert.equal(planned.status, 201, 'a planned (tentative) slot does not block');
  });

  test('rescheduling into a conflict needs confirmation too, and a cancelled post stops conflicting', async () => {
    const { token } = await signUp();
    const first = await scheduled(token, await newContent(token), 'instagram', T(15, '18:00'));
    const other = await scheduled(token, await newContent(token), 'instagram', T(16, '10:00'));
    const move = await posts.patch(token, other.id, { scheduledLocal: T(15, '18:10'), version: other.version });
    assert.equal(move.status, 409);
    assert.equal(move.body.error.code, 'SCHEDULE_CONFLICT');
    assert.equal((await posts.get(token, other.id)).body.data.localDate, '2040-06-16', 'nothing changed');

    assert.equal((await posts.patch(token, other.id, { scheduledLocal: T(15, '18:10'), version: other.version, confirmConflict: true })).status, 200);
    await posts.move(token, first.id, 'cancelled');
    const third = await scheduled(token, await newContent(token), 'instagram', T(15, '18:05'), { confirmConflict: true });
    assert.ok(third.id);
  });
});

describe('rescheduling and editing', () => {
  test('PATCH moves a post; the version advances and the old time is gone', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15, '18:00'));
    const res = await posts.patch(token, p.id, { scheduledLocal: T(17, '09:15'), version: p.version });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.data.localDate, res.body.data.localTime], ['2040-06-17', '09:15']);
    assert.ok(res.body.data.version > p.version);
    assert.equal(res.body.data.status, 'scheduled');
  });

  test('a scheduled reminder cannot be moved into the past; a planned slot can; a plan can be left undated', async () => {
    const { token } = await signUp();
    const sched = await scheduled(token, await newContent(token), 'instagram', T(15));
    const bad = await posts.patch(token, sched.id, { scheduledLocal: '2020-01-01T10:00' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error.details[0].message, /future/i);

    const plan = (await posts.create(token, { content: await newContent(token), platform: 'tiktok', scheduledLocal: T(15) })).body.data;
    assert.equal((await posts.patch(token, plan.id, { scheduledLocal: '2020-01-01T10:00' })).status, 200);
    const undated = await posts.patch(token, plan.id, { scheduledLocal: null });
    assert.equal(undated.status, 200);
    assert.equal(undated.body.data.scheduledAt, null);

    const refuse = await posts.patch(token, sched.id, { scheduledLocal: null });
    assert.equal(refuse.status, 400); // a reminder needs a time
  });

  test('a ready or missed post that is given a new future time becomes a scheduled reminder again', async () => {
    const { token, user } = await signUp();
    const mk = async (status, platform) => {
      const content = await newContent(token);
      return (await Post.create({ owner: user.id, content, platform, status, scheduledAt: new Date('2020-01-01T10:00:00Z'), readyAt: new Date() })).id;
    };
    for (const [status, platform] of [['awaiting_confirmation', 'instagram'], ['missed', 'youtube'], ['failed', 'tiktok']]) {
      const id = await mk(status, platform);
      const res = await posts.patch(token, id, { scheduledLocal: T(20) });
      assert.equal(res.status, 200, status);
      assert.equal(res.body.data.status, 'scheduled', status);
      assert.equal(res.body.data.readyAt, null, status);
    }
    const stuck = await mk('missed', 'x');
    assert.equal((await posts.patch(token, stuck, { scheduledLocal: '2020-02-02T10:00' })).status, 400); // still must be in the future
  });

  test('editing reminders and the caption does not touch the time', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15, '18:00'), { reminderOffsets: [60] });
    const res = await posts.patch(token, p.id, { reminderOffsets: [10_080, 60, 15], captionOverride: 'Tweaked for IG', version: p.version });
    assert.deepEqual(res.body.data.reminderOffsets, [10_080, 60, 15]);
    assert.equal(res.body.data.captionOverride, 'Tweaked for IG');
    assert.equal(res.body.data.scheduledAt, p.scheduledAt);
  });

  test('a published post is locked: only its link can be edited; it cannot be deleted', async () => {
    const { token } = await signUp();
    const content = await approvedContent(token);
    const p = await scheduled(token, content, 'instagram', T(15));
    await posts.move(token, p.id, 'published', { publishedAt: ISO(-60_000) });
    for (const body of [{ scheduledLocal: T(20) }, { reminderOffsets: [5] }, { captionOverride: 'x' }, { platform: 'youtube' }]) {
      const res = await posts.patch(token, p.id, body);
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(res.body.error.code, 'POST_LOCKED');
    }
    const link = await posts.patch(token, p.id, { publishedUrl: 'https://instagram.com/p/abc' });
    assert.equal(link.status, 200);
    assert.equal(link.body.data.publishedUrl, 'https://instagram.com/p/abc');
    assert.equal((await posts.remove(token, p.id)).status, 409);
  });

  test('the published link cannot be set on a post that is not published, and must be http(s)', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15));
    assert.equal((await posts.patch(token, p.id, { publishedUrl: 'https://x.example' })).status, 400);
    for (const bad of ['javascript:alert(1)', 'ftp://x.example', 'nope']) assert.equal((await posts.patch(token, p.id, { publishedUrl: bad })).status, 400, bad);
  });

  test('a cancelled post must be re-opened before it can be edited; deleting removes it', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15));
    await posts.move(token, p.id, 'cancelled');
    const edit = await posts.patch(token, p.id, { captionOverride: 'x' });
    assert.equal(edit.status, 409);
    assert.equal(edit.body.error.code, 'POST_CANCELLED');
    assert.equal((await posts.remove(token, p.id)).status, 204);
    assert.equal((await posts.get(token, p.id)).status, 404);
    assert.equal((await posts.remove(token, p.id)).status, 404);
  });

  test('a post whose content is archived cannot be edited or scheduled until the content is restored', async () => {
    const { token } = await signUp();
    const content = await newContent(token);
    const p = await scheduled(token, content, 'instagram', T(15));
    await contentApi.archive(token, content);
    assert.equal((await posts.patch(token, p.id, { scheduledLocal: T(16) })).body.error.code, 'ARCHIVED');
    assert.equal((await posts.move(token, p.id, 'planned')).body.error.code, 'ARCHIVED');
    assert.equal((await posts.move(token, p.id, 'cancelled')).status, 200); // but it can be cancelled
  });

  test('GET /posts lists the entries of one content item, newest first, for the owner only', async () => {
    const a = await signUp();
    const b = await signUp();
    const content = await newContent(a.token);
    await posts.create(a.token, { content, platform: 'instagram' });
    await scheduled(a.token, content, 'youtube', T(15));
    await posts.create(a.token, { content: await newContent(a.token), platform: 'x' });
    await posts.create(b.token, { content: await newContent(b.token), platform: 'x' });
    const res = await posts.list(a.token, `content=${content}`);
    assert.deepEqual(res.body.data.map((p) => p.platform).sort(), ['instagram', 'youtube']);
    assert.equal((await posts.list(b.token, `content=${content}`)).body.data.length, 0);
    assert.equal((await posts.list(a.token, 'content=nope')).status, 400);
  });
});

describe('the four states and how a post moves between them', () => {
  const ALL = ['planned', 'scheduled', 'awaiting_confirmation', 'published', 'missed', 'failed', 'cancelled'];
  const ALLOWED = {
    planned: ['scheduled', 'cancelled'],
    scheduled: ['planned', 'awaiting_confirmation', 'published', 'cancelled'],
    awaiting_confirmation: ['published', 'missed', 'scheduled', 'cancelled'],
    missed: ['scheduled', 'planned', 'cancelled'],
    failed: ['scheduled', 'planned', 'cancelled'],
    cancelled: ['planned'],
    published: [],
  };

  test('every disallowed move from every status is refused with the allowed list, and nothing changes', async () => {
    const { token, user } = await signUp();
    for (const from of ALL) {
      const content = await approvedContent(token, { title: `in ${from}` });
      const post = await Post.create({
        owner: user.id, content, platform: 'instagram', status: from, scheduledAt: new Date('2040-06-15T13:00:00Z'),
        ...(from === 'published' && { verification: 'manual', publishedAt: new Date() }),
      });
      for (const to of ALL) {
        if (ALLOWED[from].includes(to)) continue;
        const res = await posts.move(token, post.id, to);
        assert.equal(res.status, 409, `${from} -> ${to}`);
        assert.equal(res.body.error.code, 'INVALID_TRANSITION');
        assert.deepEqual(res.body.error.details.allowed, ALLOWED[from], `${from} -> ${to}`);
      }
      assert.equal((await Post.findById(post.id)).status, from, `${from} must be unchanged`);
      assert.deepEqual((await posts.get(token, post.id)).body.data.transitions.map((t) => t.to), ALLOWED[from]);
    }
  });

  test('planned -> scheduled needs a future time (new or already stored)', async () => {
    const { token } = await signUp();
    const p = (await posts.create(token, { content: await newContent(token), platform: 'instagram' })).body.data;
    const none = await posts.move(token, p.id, 'scheduled');
    assert.equal(none.status, 400);
    const past = await posts.move(token, p.id, 'scheduled', { scheduledLocal: '2020-01-01T10:00' });
    assert.equal(past.status, 400);
    const ok = await posts.move(token, p.id, 'scheduled', { scheduledLocal: T(15) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.stage.key, 'reminder');
    assert.deepEqual(ok.body.data.reminderOffsets, [60]);

    // a plan that already holds a future tentative date can be scheduled with no new time
    const dated = (await posts.create(token, { content: await newContent(token), platform: 'youtube', scheduledLocal: T(18) })).body.data;
    assert.equal((await posts.move(token, dated.id, 'scheduled')).body.data.localDate, '2040-06-18');
  });

  test('scheduled -> planned keeps the tentative date but drops the reminder behaviour', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15));
    const res = await posts.move(token, p.id, 'planned');
    assert.equal(res.body.data.status, 'planned');
    assert.equal(res.body.data.localDate, '2040-06-15');
    assert.equal((await runReminderSweep(new Date('2040-06-16T00:00:00Z'))).postsReady, 0, 'a plan never becomes "ready"');
  });

  test('"ready to publish" is a distinct state reached by the time arriving (or by the user saying so)', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15));
    const ready = await posts.move(token, p.id, 'awaiting_confirmation');
    assert.equal(ready.status, 200);
    assert.deepEqual([ready.body.data.stage.key, ready.body.data.stage.label], ['ready', 'Ready to publish']);
    assert.ok(ready.body.data.readyAt);
    assert.equal(ready.body.data.verification, 'none');
    assert.equal(ready.body.data.publishedAt, null);
  });

  test('publishing needs approved content, a real past time, and records that YOU confirmed it', async () => {
    const { token } = await signUp();
    const draft = await newContent(token);
    const early = await scheduled(token, draft, 'instagram', T(15));
    const blocked = await posts.move(token, early.id, 'published', { publishedAt: ISO(-60_000) });
    assert.equal(blocked.status, 422);
    assert.equal(blocked.body.error.code, 'CONTENT_NOT_APPROVED');
    assert.equal((await Post.findById(early.id)).status, 'scheduled');

    const approved = await approvedContent(token);
    const p = await scheduled(token, approved, 'youtube', T(15));
    assert.equal((await posts.move(token, p.id, 'published')).status, 400); // no time given
    assert.equal((await posts.move(token, p.id, 'published', { publishedAt: ISO(2 * DAY) })).status, 400);
    assert.equal((await posts.move(token, p.id, 'published', { publishedAt: ISO(-60_000), publishedUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await Post.findById(p.id)).status, 'scheduled');

    const when = ISO(-3_600_000);
    const done = await posts.move(token, p.id, 'published', { publishedAt: when, publishedUrl: 'https://youtu.be/abc' });
    assert.equal(done.status, 200);
    const d = done.body.data;
    assert.deepEqual([d.status, d.verification, d.publishedAt, d.publishedUrl, d.externalPostId], ['published', 'manual', when, 'https://youtu.be/abc', undefined]);
    assert.equal(d.stage.label, 'Published');
    assert.match(d.stage.description, /not verified with the platform|has not verified/i);
    assert.deepEqual(d.transitions, []);
  });

  test('the publication time can be given as local wall-clock time in the profile timezone', async () => {
    const { token } = await signUp();
    await setTimezone(token, 'Asia/Kolkata');
    const p = await scheduled(token, await approvedContent(token), 'instagram', T(15));
    const bad = await posts.move(token, p.id, 'published', { publishedLocal: T(15), publishedAt: ISO(-1000) });
    assert.equal(bad.status, 400, 'both forms at once is ambiguous');
    const future = await posts.move(token, p.id, 'published', { publishedLocal: '2040-06-15T18:00' });
    assert.equal(future.status, 400);
    assert.equal(future.body.error.details[0].path, 'publishedLocal');
    const when = new Date(Date.now() - 3_600_000);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(when).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
    const ok = await posts.move(token, p.id, 'published', { publishedLocal: `${local.year}-${local.month}-${local.day}T${local.hour}:${local.minute}` });
    assert.equal(ok.status, 200);
    assert.ok(Math.abs(new Date(ok.body.data.publishedAt) - when) < 61_000, 'the same moment, interpreted in Kolkata');
    assert.equal(ok.body.data.verification, 'manual');
  });

  test('details only accepted where they belong: publication on publish, reminders on schedule', async () => {
    const { token } = await signUp();
    const p = (await posts.create(token, { content: await newContent(token), platform: 'instagram' })).body.data;
    assert.equal((await posts.move(token, p.id, 'cancelled', { publishedAt: ISO(-1000) })).status, 400);
    assert.equal((await posts.move(token, p.id, 'cancelled', { reminderOffsets: [5] })).status, 400);
    assert.equal((await posts.move(token, p.id, 'cancelled', { scheduledLocal: T(15) })).status, 400);
    assert.equal((await posts.move(token, p.id, 'published', { to: 'x' })).status, 400);
  });

  test('unknown statuses and fields in a transition are validation errors', async () => {
    const { token } = await signUp();
    const p = (await posts.create(token, { content: await newContent(token), platform: 'instagram' })).body.data;
    for (const body of [{ to: 'live' }, {}, { to: 'scheduled', status: 'published' }, { to: 'scheduled', owner: 'x' }, { to: 'scheduled', verification: 'platform' }]) {
      const res = await request(app).post(`/api/v1/posts/${p.id}/transition`).set(bearer(token)).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  test('a published confirmation never fakes platform verification', async () => {
    const { token } = await signUp();
    const content = await approvedContent(token);
    const p = await scheduled(token, content, 'tiktok', T(15));
    await posts.move(token, p.id, 'published', { publishedAt: ISO(-1000) });
    const doc = await Post.findById(p.id);
    assert.equal(doc.verification, 'manual');
    assert.equal(doc.externalPostId, undefined);
  });
});

describe('conflicting updates', () => {
  test('a stale screen cannot overwrite a newer change (version check)', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15, '18:00'));
    // tab B moves it first
    assert.equal((await posts.patch(token, p.id, { scheduledLocal: T(16, '10:00'), version: p.version })).status, 200);
    // tab A still holds the old version and tries to drag it somewhere else
    const stale = await posts.patch(token, p.id, { scheduledLocal: T(20, '10:00'), version: p.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_VERSION');
    assert.ok(stale.body.error.details.currentVersion > p.version);
    assert.equal((await posts.get(token, p.id)).body.data.localDate, '2040-06-16', 'the newer change survives');
    // the same applies to transitions
    assert.equal((await posts.move(token, p.id, 'cancelled', { version: p.version })).status, 409);
    assert.equal((await posts.get(token, p.id)).body.data.status, 'scheduled');
  });

  test('two simultaneous edits from the same version: exactly one wins', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15, '18:00'));
    const days = [16, 17, 18, 19, 20, 21];
    const results = await Promise.all(days.map((d) => posts.patch(token, p.id, { scheduledLocal: T(d, '12:00'), version: p.version })));
    const winners = results.filter((r) => r.status === 200);
    assert.equal(winners.length, 1);
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 409));
    const final = (await posts.get(token, p.id)).body.data;
    assert.equal(final.localDate, winners[0].body.data.localDate, 'the stored value is the winner\'s');
  });

  test('without a version, concurrent writers are still never silently merged', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15, '18:00'));
    const results = await Promise.all([16, 17, 18, 19].map((d) => posts.patch(token, p.id, { scheduledLocal: T(d, '12:00') })));
    assert.ok(results.every((r) => [200, 409].includes(r.status)));
    assert.ok(results.some((r) => r.status === 200));
  });

  test('simultaneous status moves: only one takes effect', async () => {
    const { token } = await signUp();
    const content = await approvedContent(token);
    const p = await scheduled(token, content, 'instagram', T(15));
    const results = await Promise.all([
      posts.move(token, p.id, 'cancelled'),
      posts.move(token, p.id, 'awaiting_confirmation'),
      posts.move(token, p.id, 'published', { publishedAt: ISO(-1000) }),
      posts.move(token, p.id, 'planned'),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 409));
    const events = (await contentApi.history(token, content)).body.data.filter((e) => e.type === 'post_status_changed');
    assert.equal(events.length, 1);
  });

  test('when the reminder job moves a post to "ready", an older screen can no longer change it blindly', async () => {
    const { token } = await signUp();
    const p = await scheduled(token, await newContent(token), 'instagram', T(15, '18:00'));
    await runReminderSweep(new Date('2040-06-15T20:00:00Z')); // past the scheduled instant
    const now = (await posts.get(token, p.id)).body.data;
    assert.equal(now.status, 'awaiting_confirmation');
    assert.ok(now.version > p.version);
    const stale = await posts.patch(token, p.id, { scheduledLocal: T(20), version: p.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_VERSION');
  });
});
