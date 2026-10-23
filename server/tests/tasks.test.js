import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { newClient, clients } from './helpers/clients.js';
import { camps, newCampaign } from './helpers/campaigns.js';
import { newContent, setPrefs, setTimezone } from './helpers/calendar.js';
import { api as contentApi } from './helpers/content.js';
import { day, newTask, tasks } from './helpers/tasks.js';
import { runReminderSweep } from '../src/jobs/reminders.js';
import { Notification } from '../src/modules/notifications/notification.model.js';
import { Task } from '../src/modules/tasks/task.model.js';
import { dueState } from '../src/modules/tasks/task.logic.js';
import { listTasks, taskSummary } from '../src/modules/tasks/tasks.service.js';

useDatabase();

const at = (s) => new Date(s);
const ofType = (owner, type) => Notification.find({ owner, type }).sort({ createdAt: 1 }).lean();

describe('task CRUD', () => {
  test('creates a task with sensible defaults and returns the full public shape', async () => {
    const a = await signUp();
    const res = await tasks.create(a.token, { title: '  Edit the reel  ' });
    assert.equal(res.status, 201);
    const t = res.body.data;
    assert.equal(t.title, 'Edit the reel');
    assert.deepEqual([t.status, t.priority, t.dueDate, t.dueState, t.overdue, t.assignee, t.completedAt, t.archivedAt], ['todo', 'normal', null, 'none', false, null, null, null]);
    assert.deepEqual(t.links, { campaign: null, client: null, content: null });
    assert.equal(t.version, 0);
    assert.equal((await Task.findById(t.id)).owner.toString(), a.user.id);
  });

  test('validates input: title, priority, dates, times, reminders and unknown or protected fields', async () => {
    const a = await signUp();
    const bad = async (body) => (await tasks.create(a.token, body)).status;
    assert.equal(await bad({ title: '' }), 400);
    assert.equal(await bad({ title: '   ' }), 400);
    assert.equal(await bad({ title: 'x'.repeat(201) }), 400);
    assert.equal(await bad({ priority: 'asap' }), 400);
    assert.equal(await bad({ dueDate: '2026-02-30' }), 400);
    assert.equal(await bad({ dueDate: '31/10/2026' }), 400);
    assert.equal(await bad({ dueDate: '2026-10-31', dueTime: '25:00' }), 400);
    assert.equal(await bad({ dueTime: '10:00' }), 400, 'a time needs a date');
    assert.equal(await bad({ dueDate: day(1), remindOffsets: [-5] }), 400);
    assert.equal(await bad({ dueDate: day(1), remindOffsets: [60, 60] }), 400);
    assert.equal(await bad({ dueDate: day(1), remindOffsets: [1, 2, 3, 4, 5, 6] }), 400);
    assert.equal(await bad({ status: 'done' }), 400, 'finish a task through complete, not create');
    for (const field of [{ owner: a.user.id }, { completedAt: new Date() }, { archivedAt: new Date() }, { priorityRank: 9 }]) assert.equal(await bad(field), 400);
    assert.equal(await Task.countDocuments({}), 0);
  });

  test('edits fields, clears optional ones, and refuses an empty edit', async () => {
    const a = await signUp();
    const t = await newTask(a.token, { description: 'cut to 30s', dueDate: day(3), priority: 'low' });
    const res = await tasks.patch(a.token, t.id, { title: 'Final cut', description: '', priority: 'urgent', dueDate: null });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.data.title, res.body.data.description, res.body.data.priority, res.body.data.dueDate, res.body.data.remindOffsets], ['Final cut', null, 'urgent', null, []]);
    assert.equal((await tasks.patch(a.token, t.id, {})).status, 400);
    assert.equal((await tasks.patch(a.token, t.id, { version: 1 })).status, 400);
    assert.equal((await tasks.patch(a.token, t.id, { status: 'done' })).status, 400, 'status changes go through transition');
  });

  test('a stale screen cannot overwrite a newer edit', async () => {
    const a = await signUp();
    const t = await newTask(a.token);
    const first = await tasks.patch(a.token, t.id, { title: 'Newer', version: t.version });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.version, t.version + 1);
    const stale = await tasks.patch(a.token, t.id, { title: 'Older', version: t.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_VERSION');
    assert.equal((await tasks.get(a.token, t.id)).body.data.title, 'Newer');
  });

  test('completing stamps completedAt, reopening clears it, repeating is harmless', async () => {
    const a = await signUp();
    const t = await newTask(a.token, { dueDate: day(-2) });
    assert.equal(t.overdue, true);
    const done = await tasks.complete(a.token, t.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.data.status, 'done');
    assert.ok(done.body.data.completedAt);
    assert.equal(done.body.data.overdue, false, 'a finished task is never overdue');
    const stamp = done.body.data.completedAt;
    assert.equal((await tasks.complete(a.token, t.id)).body.data.completedAt, stamp, 'completing twice keeps the first time');
    const open = await tasks.reopen(a.token, t.id);
    assert.deepEqual([open.body.data.status, open.body.data.completedAt, open.body.data.overdue], ['todo', null, true]);
    const doing = await tasks.move(a.token, t.id, 'doing');
    assert.equal(doing.body.data.status, 'doing');
    const cancelled = await tasks.move(a.token, t.id, 'cancelled');
    assert.deepEqual([cancelled.body.data.status, cancelled.body.data.completedAt, cancelled.body.data.overdue], ['cancelled', null, false]);
    assert.equal((await tasks.move(a.token, t.id, 'finished')).status, 400);
  });

  test('archiving hides a task from the default list, blocks edits until restored, and keeps it out of open counts', async () => {
    const a = await signUp();
    const t = await newTask(a.token, { dueDate: day(-1) });
    assert.equal((await tasks.summary(a.token)).body.data.counts.overdue, 1);
    assert.equal((await tasks.archive(a.token, t.id)).status, 200);
    assert.equal((await tasks.list(a.token)).body.meta.total, 0);
    assert.equal((await tasks.list(a.token, 'archived=true')).body.data.length, 1);
    assert.equal((await tasks.summary(a.token)).body.data.counts.overdue, 0, 'archived tasks are not overdue');
    assert.equal((await tasks.patch(a.token, t.id, { title: 'nope' })).status, 409);
    assert.equal((await tasks.complete(a.token, t.id)).status, 409);
    assert.equal((await tasks.restore(a.token, t.id)).status, 200);
    assert.equal((await tasks.list(a.token)).body.meta.total, 1);
    assert.equal((await tasks.patch(a.token, t.id, { title: 'ok now' })).status, 200);
  });

  test('deleting removes the task for good', async () => {
    const a = await signUp();
    const t = await newTask(a.token);
    assert.equal((await tasks.remove(a.token, t.id)).status, 200);
    assert.equal((await tasks.get(a.token, t.id)).status, 404);
    assert.equal((await tasks.remove(a.token, t.id)).status, 404);
    assert.equal(await Task.countDocuments({}), 0);
  });

  test('assignee: empty by default, can be yourself, never someone else', async () => {
    const a = await signUp();
    const b = await signUp();
    const t = await newTask(a.token);
    assert.equal(t.assignee, null);
    const mine = await tasks.patch(a.token, t.id, { assignee: a.user.id });
    assert.equal(mine.body.data.assignee.id, a.user.id);
    assert.equal((await tasks.list(a.token, 'assignee=me')).body.data.length, 1);
    assert.equal((await tasks.list(a.token, 'assignee=unassigned')).body.data.length, 0);
    const other = await tasks.patch(a.token, t.id, { assignee: b.user.id });
    assert.equal(other.status, 400);
    assert.equal((await tasks.create(a.token, { assignee: b.user.id })).status, 400);
    assert.equal((await tasks.patch(a.token, t.id, { assignee: null })).body.data.assignee, null);
  });
});

describe('linked records', () => {
  test('links a campaign (and fills in its brand), a brand, and content', async () => {
    const a = await signUp();
    const { id: campaign, client } = await newCampaign(a.token, { title: 'Summer' });
    const t = await newTask(a.token, { campaign });
    assert.equal(t.links.campaign.id, campaign);
    assert.equal(t.links.campaign.title, 'Summer');
    assert.equal(t.links.client.id, client, 'the brand follows from the campaign');

    const brand = await newClient(a.token, { name: 'Solo brand' });
    const t2 = await newTask(a.token, { client: brand });
    assert.deepEqual([t2.links.client.name, t2.links.campaign], ['Solo brand', null]);

    const content = await newContent(a.token, { title: 'Hero video' });
    const t3 = await newTask(a.token, { content });
    assert.equal(t3.links.content.title, 'Hero video');
  });

  test('content that belongs to a campaign pulls its campaign and brand in, and must agree with an explicit campaign', async () => {
    const a = await signUp();
    const { id: campaign, client } = await newCampaign(a.token);
    const other = await newCampaign(a.token);
    const content = await newContent(a.token, { title: 'In campaign' });
    assert.equal((await camps.linkContent(a.token, campaign, content)).status, 200);
    const t = await newTask(a.token, { content });
    assert.deepEqual([t.links.campaign.id, t.links.client.id], [campaign, client]);
    const clash = await tasks.create(a.token, { content, campaign: other.id });
    assert.equal(clash.status, 400);
    assert.equal(clash.body.error.details[0].path, 'content');
  });

  test('the brand must match the campaign', async () => {
    const a = await signUp();
    const { id: campaign } = await newCampaign(a.token);
    const stranger = await newClient(a.token, { name: 'Different brand' });
    const res = await tasks.create(a.token, { campaign, client: stranger });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].path, 'client');
  });

  test('another user\'s records cannot be linked, and the answer matches a missing id', async () => {
    const a = await signUp();
    const b = await signUp();
    const theirs = await newCampaign(b.token);
    const theirContent = await newContent(b.token, { title: 'Secret' });
    const theirBrand = await newClient(b.token, { name: 'Secret brand' });
    const ghost = '64b64b64b64b64b64b64b64b';
    for (const [field, foreign] of [['campaign', theirs.id], ['content', theirContent], ['client', theirBrand]]) {
      const real = await tasks.create(a.token, { [field]: foreign });
      const missing = await tasks.create(a.token, { [field]: ghost });
      assert.equal(real.status, 400, field);
      assert.deepEqual(real.body, missing.body, `${field}: foreign and missing look identical`);
      const t = await newTask(a.token);
      assert.equal((await tasks.patch(a.token, t.id, { [field]: foreign })).status, 400, `${field} on edit`);
    }
    assert.equal((await tasks.list(a.token, `campaign=${theirs.id}`)).body.data.length, 0);
    assert.ok(!JSON.stringify((await tasks.list(a.token)).body).includes('Secret'));
    assert.equal(await Task.countDocuments({ owner: a.user.id, $or: [{ 'links.campaign': { $ne: null } }, { 'links.content': { $ne: null } }, { 'links.client': { $ne: null } }] }), 0);
  });

  test('filters tasks by campaign, brand and content, and the campaign page lists its tasks', async () => {
    const a = await signUp();
    const c1 = await newCampaign(a.token, { title: 'One' });
    const c2 = await newCampaign(a.token, { title: 'Two' });
    await newTask(a.token, { title: 'A', campaign: c1.id });
    await newTask(a.token, { title: 'B', campaign: c1.id });
    await newTask(a.token, { title: 'C', campaign: c2.id });
    await newTask(a.token, { title: 'Loose' });
    const titles = async (q) => (await tasks.list(a.token, q)).body.data.map((t) => t.title).sort();
    assert.deepEqual(await titles(`campaign=${c1.id}`), ['A', 'B']);
    assert.deepEqual(await titles(`client=${c2.client}`), ['C']);
    const detail = await camps.get(a.token, c1.id);
    assert.deepEqual(detail.body.data.linked.tasks.map((t) => t.title).sort(), ['A', 'B']);
  });

  test('changing or clearing a link works; clearing the campaign keeps the brand', async () => {
    const a = await signUp();
    const c1 = await newCampaign(a.token);
    const c2 = await newCampaign(a.token);
    const t = await newTask(a.token, { campaign: c1.id });
    const moved = await tasks.patch(a.token, t.id, { campaign: c2.id, client: c2.client });
    assert.equal(moved.body.data.links.campaign.id, c2.id);
    const cleared = await tasks.patch(a.token, t.id, { campaign: null });
    assert.deepEqual([cleared.body.data.links.campaign, cleared.body.data.links.client.id], [null, c2.client]);
  });

  test('an archived brand cannot get new tasks, but existing links survive its archiving', async () => {
    const a = await signUp();
    const { id: campaign, client } = await newCampaign(a.token);
    const t = await newTask(a.token, { campaign });
    assert.equal((await clients.archive(a.token, client)).status, 200);
    assert.equal((await tasks.create(a.token, { client })).status, 400);
    const edited = await tasks.patch(a.token, t.id, { title: 'Still editable' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.links.client.id, client);
  });

  test('deleting the linked content or campaign leaves the task, unlinked', async () => {
    const a = await signUp();
    const content = await newContent(a.token, { title: 'Temp' });
    const t = await newTask(a.token, { content });
    assert.equal((await contentApi.archive(a.token, content)).status, 200); // content is archived before it can be deleted
    assert.equal((await contentApi.remove(a.token, content)).status < 300, true);
    assert.equal((await tasks.get(a.token, t.id)).body.data.links.content, null);
  });
});

describe('due dates and time zones', () => {
  test('a date alone means the whole local day; a time is an exact moment in the profile timezone', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'Asia/Kolkata');
    const dateOnly = await newTask(a.token, { dueDate: '2040-06-20' });
    assert.equal(new Date(dateOnly.dueAt).toISOString(), '2040-06-19T18:30:00.000Z');
    assert.deepEqual([dateOnly.dueDate, dateOnly.dueTime, dateOnly.dueHasTime], ['2040-06-20', null, false]);
    const timed = await newTask(a.token, { dueDate: '2040-06-20', dueTime: '09:15' });
    assert.equal(new Date(timed.dueAt).toISOString(), '2040-06-20T03:45:00.000Z');
    assert.deepEqual([timed.dueDate, timed.dueTime, timed.dueHasTime], ['2040-06-20', '09:15', true]);
    // changing only the time keeps the date; clearing the time makes it all-day again
    const later = await tasks.patch(a.token, timed.id, { dueTime: '17:00' });
    assert.deepEqual([later.body.data.dueDate, later.body.data.dueTime], ['2040-06-20', '17:00']);
    const allDay = await tasks.patch(a.token, timed.id, { dueTime: null });
    assert.deepEqual([allDay.body.data.dueDate, allDay.body.data.dueTime, allDay.body.data.dueHasTime], ['2040-06-20', null, false]);
    // changing only the date keeps the time
    const moved = await tasks.patch(a.token, later.body.data.id, { dueDate: '2040-06-21' });
    assert.deepEqual([moved.body.data.dueDate, moved.body.data.dueTime], ['2040-06-21', null]);
  });

  test('a wall-clock time that does not exist (clocks jump forward) is refused, one that happens twice uses the earlier', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'America/New_York');
    const skipped = await tasks.create(a.token, { dueDate: '2040-03-11', dueTime: '02:30' });
    assert.equal(skipped.status, 400);
    assert.equal(skipped.body.error.details[0].path, 'dueTime');
    const twice = await tasks.create(a.token, { dueDate: '2040-11-04', dueTime: '01:30' });
    assert.equal(twice.status, 201);
    assert.equal(new Date(twice.body.data.dueAt).toISOString(), '2040-11-04T05:30:00.000Z');
  });

  test('past due dates are accepted and shown as overdue with the number of days', async () => {
    const a = await signUp();
    const t = await newTask(a.token, { dueDate: day(-3) });
    assert.deepEqual([t.overdue, t.dueState, t.daysUntilDue], [true, 'overdue', -3]);
    const soon = await newTask(a.token, { dueDate: day(2) });
    assert.deepEqual([soon.overdue, soon.dueState, soon.daysUntilDue], [false, 'upcoming', 2]);
  });
});

describe('overdue calculations', () => {
  const NOW = at('2026-10-14T10:00:00Z'); // 15:30 on 14 October in Kolkata
  const KOLKATA = 'Asia/Kolkata';
  const base = { status: 'todo', archivedAt: null, dueHasTime: false };

  test('dueState: date-only tasks are due all day and late from the next day; timed tasks are late once the moment passes', () => {
    const state = (t) => dueState({ ...base, ...t }, NOW, KOLKATA);
    assert.equal(state({ dueAt: at('2026-10-13T18:30:00Z') }), 'today', 'today, date only');
    assert.equal(state({ dueAt: at('2026-10-12T18:30:00Z') }), 'overdue', 'yesterday, date only');
    assert.equal(state({ dueAt: at('2026-10-14T18:30:00Z') }), 'upcoming', 'tomorrow');
    assert.equal(state({ dueHasTime: true, dueAt: at('2026-10-14T09:59:59Z') }), 'overdue', 'one second ago');
    assert.equal(state({ dueHasTime: true, dueAt: at('2026-10-14T10:00:00Z') }), 'today', 'exactly now is not late yet');
    assert.equal(state({ dueHasTime: true, dueAt: at('2026-10-14T12:00:00Z') }), 'today', 'later today');
    assert.equal(state({ dueAt: null }), 'none');
    for (const status of ['done', 'cancelled']) assert.equal(state({ status, dueAt: at('2020-01-01T00:00:00Z') }), 'closed', status);
    assert.equal(state({ archivedAt: new Date(), dueAt: at('2020-01-01T00:00:00Z') }), 'closed');
  });

  test('the local day, not the UTC day, decides', () => {
    // 20:00Z on the 14th is already the 15th in Kolkata but still the 14th in UTC
    const due = { ...base, dueAt: at('2026-10-14T00:00:00Z') };
    assert.equal(dueState(due, at('2026-10-14T20:00:00Z'), 'UTC'), 'today');
    assert.equal(dueState({ ...base, dueAt: at('2026-10-13T18:30:00Z') }, at('2026-10-14T20:00:00Z'), KOLKATA), 'overdue');
  });

  test('list filters and the summary agree: every open task is in exactly one bucket', async () => {
    const a = await signUp();
    const user = { id: a.user.id, timezone: KOLKATA };
    const mk = (title, dueAt, extra = {}) => Task.create({ owner: a.user.id, title, dueAt, ...extra });
    await mk('yesterday', at('2026-10-12T18:30:00Z'));
    await mk('today all day', at('2026-10-13T18:30:00Z'));
    await mk('earlier today (timed)', at('2026-10-14T05:00:00Z'), { dueHasTime: true });
    await mk('later today (timed)', at('2026-10-14T14:00:00Z'), { dueHasTime: true });
    await mk('tomorrow', at('2026-10-14T18:30:00Z'));
    await mk('next month', at('2026-11-20T18:30:00Z'));
    await mk('no date', null);
    await mk('finished', at('2026-10-01T00:00:00Z'), { status: 'done' });
    await mk('cancelled', at('2026-10-01T00:00:00Z'), { status: 'cancelled' });
    await mk('archived', at('2026-10-01T00:00:00Z'), { archivedAt: NOW });

    const titles = async (due) => (await listTasks(user, { due, archived: false, sort: 'due', page: 1, limit: 50 }, NOW)).data.map((t) => t.title);
    assert.deepEqual(await titles('overdue'), ['yesterday', 'earlier today (timed)']);
    assert.deepEqual(await titles('today'), ['today all day', 'later today (timed)']);
    assert.deepEqual(await titles('upcoming'), ['tomorrow', 'next month']);
    assert.deepEqual(await titles('none'), ['no date']);

    const s = await taskSummary(user, { limit: 10 }, NOW);
    assert.deepEqual(s.counts, { overdue: 2, today: 2, upcoming: 1, noDate: 1, open: 7, doneToday: 0 }, 'the summary upcoming window is one week, the filter has no limit');
    assert.deepEqual(s.overdue.map((t) => t.title), ['yesterday', 'earlier today (timed)']);
    assert.ok(s.overdue.every((t) => t.overdue));
    const ids = [...s.overdue, ...s.today, ...s.upcoming].map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, 'no task in two buckets');
  });

  test('overdue and today follow the user\'s timezone', async () => {
    const a = await signUp();
    await Task.create({ owner: a.user.id, title: 'edge', dueAt: at('2026-10-14T00:00:00Z') });
    const now = at('2026-10-14T20:00:00Z');
    const q = { due: 'overdue', archived: false, sort: 'due', page: 1, limit: 50 };
    assert.equal((await listTasks({ id: a.user.id, timezone: 'UTC' }, q, now)).meta.total, 0);
    assert.equal((await listTasks({ id: a.user.id, timezone: 'Pacific/Auckland' }, q, now)).meta.total, 1);
  });

  test('doneToday counts tasks finished since local midnight', async () => {
    const a = await signUp();
    const t = await newTask(a.token);
    await tasks.complete(a.token, t.id);
    assert.equal((await tasks.summary(a.token)).body.data.counts.doneToday, 1);
  });
});

describe('listing, filtering and sorting', () => {
  async function seed(token) {
    await newTask(token, { title: 'Banana', priority: 'low', dueDate: day(5) });
    await newTask(token, { title: 'apple', priority: 'urgent', dueDate: day(-1), description: 'Call the AGENCY' });
    await newTask(token, { title: 'Cherry', priority: 'high' });
    const done = await newTask(token, { title: 'Done one', priority: 'normal', dueDate: day(1) });
    await tasks.complete(token, done.id);
    await newTask(token, { title: 'Doing one', priority: 'normal', dueDate: day(0) });
    const doing = (await tasks.list(token, 'q=Doing')).body.data[0];
    await tasks.move(token, doing.id, 'doing');
  }
  const titles = async (token, q) => (await tasks.list(token, q)).body.data.map((t) => t.title);

  test('sorts by due date (undated last in both directions), priority, title and recency', async () => {
    const a = await signUp();
    await seed(a.token);
    assert.deepEqual(await titles(a.token, 'sort=due'), ['apple', 'Doing one', 'Done one', 'Banana', 'Cherry']);
    assert.deepEqual(await titles(a.token, 'sort=-due'), ['Banana', 'Done one', 'Doing one', 'apple', 'Cherry']);
    assert.deepEqual((await titles(a.token, 'sort=priority')).slice(0, 2), ['apple', 'Cherry'], 'most urgent first');
    assert.equal((await titles(a.token, 'sort=-priority'))[0], 'Banana');
    assert.deepEqual(await titles(a.token, 'sort=title'), ['apple', 'Banana', 'Cherry', 'Doing one', 'Done one'], 'case-insensitive');
    assert.deepEqual(await titles(a.token, 'sort=-createdAt'), ['Doing one', 'Done one', 'Cherry', 'apple', 'Banana']);
    assert.equal((await tasks.list(a.token, 'sort=nonsense')).status, 400);
  });

  test('filters by status, open/closed, priority, search text and due bucket, and they combine', async () => {
    const a = await signUp();
    await seed(a.token);
    assert.deepEqual((await titles(a.token, 'status=done')), ['Done one']);
    assert.deepEqual((await titles(a.token, 'status=doing,done')).sort(), ['Doing one', 'Done one']);
    assert.equal((await titles(a.token, 'open=true')).length, 4);
    assert.deepEqual(await titles(a.token, 'open=false'), ['Done one']);
    assert.deepEqual((await titles(a.token, 'priority=high,urgent')).sort(), ['Cherry', 'apple']);
    assert.deepEqual(await titles(a.token, 'q=agency'), ['apple'], 'search covers descriptions, ignoring case');
    assert.deepEqual(await titles(a.token, 'due=overdue'), ['apple']);
    assert.deepEqual(await titles(a.token, 'due=today'), ['Doing one']);
    assert.deepEqual(await titles(a.token, 'due=none'), ['Cherry']);
    assert.deepEqual(await titles(a.token, 'open=true&priority=urgent&due=overdue'), ['apple']);
    assert.deepEqual(await titles(a.token, 'q=.*'), [], 'search text is not a regular expression');
  });

  test('paginates with an exact total', async () => {
    const a = await signUp();
    for (let i = 0; i < 5; i++) await newTask(a.token, { title: `T${i}` });
    const p2 = (await tasks.list(a.token, 'sort=title&limit=2&page=2')).body;
    assert.deepEqual(p2.data.map((t) => t.title), ['T2', 'T3']);
    assert.deepEqual([p2.meta.total, p2.meta.pages, p2.meta.page], [5, 3, 2]);
  });

  test('meta lists the statuses and priorities', async () => {
    const a = await signUp();
    const m = (await tasks.meta(a.token)).body;
    assert.deepEqual(m.statuses.map((s) => s.key), ['todo', 'doing', 'done', 'cancelled']);
    assert.deepEqual(m.priorities.map((s) => s.key), ['low', 'normal', 'high', 'urgent']);
  });
});

describe('reminders', () => {
  test('a date-only task reminds at its lead time before the END of the due day in the owner\'s timezone, once', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'Asia/Kolkata'); // the 20th ends at 2040-06-20T18:30Z
    const t = await newTask(a.token, { title: 'Send invoice', dueDate: '2040-06-20' }); // default lead time: 1 day
    assert.deepEqual(t.remindOffsets, [1440]);
    assert.equal((await runReminderSweep(at('2040-06-19T18:29:59Z'))).taskReminders, 0);
    assert.equal((await runReminderSweep(at('2040-06-19T18:30:00Z'))).taskReminders, 1);
    const [n] = await ofType(a.user.id, 'task_reminder');
    assert.match(n.title, /^Task due in 1 day: Send invoice/);
    assert.deepEqual([n.entity.kind, String(n.entity.id), n.localDate], ['task', t.id, '2040-06-20']);
    assert.equal((await runReminderSweep(at('2040-06-19T19:00:00Z'))).taskReminders, 0, 'a second sweep sends nothing');
    assert.equal(await Notification.countDocuments({ owner: a.user.id }), 1);
  });

  test('a timed task counts back from its exact time, with several lead times', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'America/New_York'); // 15:00 EDT on 2040-06-20 = 19:00Z
    await newTask(a.token, { title: 'Call', dueDate: '2040-06-20', dueTime: '15:00', remindOffsets: [60, 15] });
    assert.equal((await runReminderSweep(at('2040-06-20T17:59:59Z'))).taskReminders, 0);
    assert.equal((await runReminderSweep(at('2040-06-20T18:00:00Z'))).taskReminders, 1);
    assert.equal((await runReminderSweep(at('2040-06-20T18:44:59Z'))).taskReminders, 0);
    assert.equal((await runReminderSweep(at('2040-06-20T18:45:00Z'))).taskReminders, 1);
    const titles = (await ofType(a.user.id, 'task_reminder')).map((n) => n.title);
    assert.match(titles[0], /in 1 hour: Call/);
    assert.match(titles[1], /in 15 minutes: Call/);
  });

  test('uses the lead times from the user\'s settings unless the task chooses its own', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    await setPrefs(a.token, { deadlineReminderOffsets: [180] });
    const t = await newTask(a.token, { dueDate: '2040-06-20' });
    assert.deepEqual(t.remindOffsets, [180]);
    const own = await newTask(a.token, { dueDate: '2040-06-20', remindOffsets: [] });
    assert.deepEqual(own.remindOffsets, [], 'an explicit empty list means no reminders');
    await runReminderSweep(at('2040-06-20T21:00:00Z'));
    assert.deepEqual((await ofType(a.user.id, 'task_reminder')).map((n) => String(n.entity.id)), [t.id]);
  });

  test('a task that becomes overdue gets exactly one overdue notice, even without reminders', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    const t = await newTask(a.token, { title: 'File taxes', dueDate: '2040-06-20', remindOffsets: [] });
    assert.equal((await runReminderSweep(at('2040-06-20T23:59:59Z'))).taskOverdue, 0);
    assert.equal((await runReminderSweep(at('2040-06-21T00:00:00Z'))).taskOverdue, 1);
    assert.equal((await runReminderSweep(at('2040-06-21T06:00:00Z'))).taskOverdue, 0);
    const [n] = await ofType(a.user.id, 'task_overdue');
    assert.match(n.title, /^Task overdue: File taxes/);
    assert.equal(String(n.entity.id), t.id);
  });

  test('stale tasks, finished tasks, cancelled tasks and archived tasks never notify', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    const mk = (title) => newTask(a.token, { title, dueDate: '2040-06-20', remindOffsets: [1440] });
    const done = await mk('done');
    const cancelled = await mk('cancelled');
    const archived = await mk('archived');
    const live = await mk('live');
    await tasks.complete(a.token, done.id);
    await tasks.move(a.token, cancelled.id, 'cancelled');
    await tasks.archive(a.token, archived.id);
    const stats = await runReminderSweep(at('2040-06-20T00:00:00Z'));
    assert.equal(stats.taskReminders, 1);
    assert.deepEqual((await ofType(a.user.id, 'task_reminder')).map((n) => String(n.entity.id)), [live.id]);
    // a server that was down for a week does not flood the user about long-dead tasks
    const stale = await runReminderSweep(at('2040-06-30T00:00:00Z'));
    assert.deepEqual([stale.taskReminders, stale.taskOverdue], [0, 0]);
  });

  test('completing a task before its reminder time cancels the reminder', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    const t = await newTask(a.token, { dueDate: '2040-06-20' });
    await tasks.complete(a.token, t.id);
    assert.equal((await runReminderSweep(at('2040-06-20T12:00:00Z'))).taskReminders, 0);
    assert.equal(await Notification.countDocuments({ owner: a.user.id }), 0);
  });

  test('rescheduling re-arms the reminders for the new date, without repeating the old ones', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    const t = await newTask(a.token, { dueDate: '2040-06-20' });
    await runReminderSweep(at('2040-06-20T00:00:00Z'));
    assert.equal(await Notification.countDocuments({ owner: a.user.id }), 1);
    await tasks.patch(a.token, t.id, { dueDate: '2040-06-25' });
    assert.equal((await runReminderSweep(at('2040-06-21T00:00:00Z'))).taskReminders, 0, 'the old date no longer matters');
    assert.equal((await runReminderSweep(at('2040-06-25T00:00:00Z'))).taskReminders, 1);
    assert.equal((await ofType(a.user.id, 'task_reminder')).length, 2);
    await tasks.patch(a.token, t.id, { dueDate: '2040-06-20' });
    assert.equal((await runReminderSweep(at('2040-06-20T00:00:00Z'))).taskReminders, 0, 'moving back to a date already notified does not repeat it');
  });

  test('two sweeps at the same moment (two servers) create one notification', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    await newTask(a.token, { dueDate: '2040-06-20' });
    const sent = await Promise.all([runReminderSweep(at('2040-06-20T00:00:00Z')), runReminderSweep(at('2040-06-20T00:00:00Z'))]);
    assert.equal(sent.reduce((n, s) => n + s.taskReminders, 0), 1);
    assert.equal(await Notification.countDocuments({ owner: a.user.id }), 1);
  });

  test('reminders go to the task\'s owner only, each in their own timezone', async () => {
    const a = await signUp();
    const b = await signUp();
    await setTimezone(a.token, 'Pacific/Auckland'); // the 20th ends at 2040-06-20T12:00Z
    await setTimezone(b.token, 'America/Los_Angeles'); // the 20th ends at 2040-06-21T07:00Z
    await newTask(a.token, { title: 'Auckland job', dueDate: '2040-06-20' });
    await newTask(b.token, { title: 'LA job', dueDate: '2040-06-20' });
    await runReminderSweep(at('2040-06-19T12:00:00Z'));
    assert.deepEqual((await ofType(a.user.id, 'task_reminder')).map((n) => n.title.replace(/^.*: /, '')), ['Auckland job']);
    assert.equal((await ofType(b.user.id, 'task_reminder')).length, 0);
    await runReminderSweep(at('2040-06-20T07:00:00Z'));
    assert.deepEqual((await ofType(b.user.id, 'task_reminder')).map((n) => n.title.replace(/^.*: /, '')), ['LA job']);
    assert.equal(await Notification.countDocuments({ owner: a.user.id }), 1);
  });

  test('the notification list returns task notices that point at the task', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    const t = await newTask(a.token, { dueDate: '2040-06-20' });
    await runReminderSweep(at('2040-06-20T00:00:00Z'));
    const res = await request(app).get('/api/v1/notifications').set(bearer(a.token));
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.data[0].type, res.body.data[0].entity], ['task_reminder', { kind: 'task', id: t.id }]);
  });
});

describe('access control', () => {
  test('every task endpoint requires a signed-in user', async () => {
    const calls = [
      request(app).get('/api/v1/tasks'), request(app).get('/api/v1/tasks/summary'), request(app).get('/api/v1/tasks/meta'),
      request(app).post('/api/v1/tasks').send({ title: 'x' }), request(app).get('/api/v1/tasks/64b64b64b64b64b64b64b64b'),
      request(app).patch('/api/v1/tasks/64b64b64b64b64b64b64b64b').send({ title: 'x' }), request(app).delete('/api/v1/tasks/64b64b64b64b64b64b64b64b'),
      request(app).post('/api/v1/tasks/64b64b64b64b64b64b64b64b/complete'),
    ];
    for (const res of await Promise.all(calls)) assert.equal(res.status, 401);
  });

  test('another user\'s task looks exactly like a missing one for read, edit, move, archive and delete', async () => {
    const a = await signUp();
    const b = await signUp();
    const mine = await newTask(a.token, { title: 'Private plan' });
    const ghost = '64b64b64b64b64b64b64b64b';
    const probes = (id) => [
      (tk) => tasks.get(tk, id), (tk) => tasks.patch(tk, id, { title: 'hijack' }), (tk) => tasks.complete(tk, id), (tk) => tasks.move(tk, id, 'doing'),
      (tk) => tasks.reopen(tk, id), (tk) => tasks.archive(tk, id), (tk) => tasks.restore(tk, id), (tk) => tasks.remove(tk, id),
    ];
    for (const [i, probe] of probes(mine.id).entries()) {
      const foreign = await probe(b.token);
      const missing = await probes(ghost)[i](b.token);
      assert.equal(foreign.status, 404, `probe ${i}`);
      assert.deepEqual(foreign.body, missing.body, `probe ${i}: no information leaks`);
    }
    assert.equal((await tasks.get(a.token, 'not-an-id')).status, 404);
    const still = await Task.findById(mine.id);
    assert.deepEqual([still.title, still.status, still.archivedAt], ['Private plan', 'todo', null]);
  });

  test('lists, summaries and filters only ever contain the caller\'s tasks', async () => {
    const a = await signUp();
    const b = await signUp();
    await newTask(a.token, { title: 'ALPHA', dueDate: day(-1) });
    await newTask(b.token, { title: 'BRAVO', dueDate: day(-1) });
    const seen = async (tk) => JSON.stringify([(await tasks.list(tk)).body, (await tasks.list(tk, 'due=overdue&q=A')).body, (await tasks.summary(tk)).body]);
    assert.ok(!(await seen(a.token)).includes('BRAVO'));
    assert.ok(!(await seen(b.token)).includes('ALPHA'));
    assert.equal((await tasks.summary(a.token)).body.data.counts.overdue, 1);
    const trick = await request(app).get(`/api/v1/tasks?owner=${b.user.id}&userId=${b.user.id}`).set(bearer(a.token)).set('X-User-Id', b.user.id);
    assert.deepEqual(trick.body.data.map((t) => t.title), ['ALPHA']);
  });

  test('the owner cannot be chosen or changed through the API', async () => {
    const a = await signUp();
    const b = await signUp();
    assert.equal((await tasks.create(a.token, { owner: b.user.id })).status, 400);
    const t = await newTask(a.token);
    assert.equal((await tasks.patch(a.token, t.id, { owner: b.user.id })).status, 400);
    assert.equal((await Task.findById(t.id)).owner.toString(), a.user.id);
  });
});

describe('dashboard and module availability', () => {
  test('the dashboard task section uses the same buckets and adds the upcoming list', async () => {
    const a = await signUp();
    await newTask(a.token, { title: 'late', dueDate: day(-2) });
    await newTask(a.token, { title: 'now', dueDate: day(0) });
    await newTask(a.token, { title: 'soon', dueDate: day(3) });
    const res = await request(app).get('/api/v1/dashboard').set(bearer(a.token));
    const s = res.body.sections.tasks;
    assert.equal(s.state, 'ok');
    assert.deepEqual([s.overdueCount, s.dueTodayCount, s.upcomingCount], [1, 1, 1]);
    assert.deepEqual([s.overdue[0].title, s.dueToday[0].title, s.upcoming[0].title], ['late', 'now', 'soon']);
  });
});
