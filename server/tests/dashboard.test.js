import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { MODULES } from '../src/config/modules.js';
import { getDashboard } from '../src/modules/dashboard/dashboard.service.js';
import { Content } from '../src/modules/content/content.model.js';
import { Post } from '../src/modules/posts/post.model.js';
import { Client } from '../src/modules/clients/client.model.js';
import { Campaign } from '../src/modules/campaigns/campaign.model.js';
import { Deliverable } from '../src/modules/campaigns/deliverable.model.js';
import { Task } from '../src/modules/tasks/task.model.js';
import { Communication } from '../src/modules/communications/communication.model.js';
import { Invoice } from '../src/modules/invoices/invoice.model.js';
import { Payment } from '../src/modules/invoices/payment.model.js';

useDatabase();

// ---- fixed clock: 2026-10-14 10:00Z = 15:30 in Asia/Kolkata. "Today" there is 13th 18:30Z -> 14th 18:30Z.
const NOW = new Date('2026-10-14T10:00:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const at = (ms) => new Date(NOW.getTime() + ms);
const ALL = Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, { ...m, ready: true }]));
const noLog = { error() {} };

const dash = (u, opts = {}) => getDashboard({ id: u.id, timezone: 'Asia/Kolkata' }, { now: NOW, modules: ALL, log: noLog, ...opts });
const section = async (u, key, opts) => (await dash(u, opts)).sections[key];

// ---- tiny seed helpers (test fixtures only; nothing here exists outside the test database)
const content = (o, title, status = 'idea', extra = {}) => Content.create({ owner: o, title, status, ...extra });
const post = (o, c, status, scheduledAt, extra = {}) => Post.create({ owner: o, content: c._id ?? c, platform: 'instagram', status, scheduledAt, ...extra });
const client = (o, name) => Client.create({ owner: o, name });
const campaign = (o, cl, title, status, extra = {}) => Campaign.create({ owner: o, client: cl._id, title, status, ...extra });
const deliverable = (o, camp, title, extra = {}) => Deliverable.create({ owner: o, campaign: camp._id, title, ...extra });
const task = (o, title, dueAt, extra = {}) => Task.create({ owner: o, title, dueAt, ...extra });
const fee = (amountMinor, currency) => ({ fee: { amountMinor, currency } });
let invNo = 0;
const invoice = (o, cl, currency, totalMinor, status, dueDate) => Invoice.create({ owner: o, client: cl._id, number: `INV-${++invNo}`, currency, totalMinor, status, dueDate });
const pay = (o, inv, amountMinor, paidAt) => Payment.create({ owner: o, invoice: inv._id, amountMinor, currency: inv.currency, paidAt });

describe('modules that are not built yet', () => {
  test('every section is "unavailable" (not zero) and carries no metrics', async () => {
    const { token } = await signUp();
    const res = await request(app).get('/api/v1/dashboard').set(bearer(token));
    assert.equal(res.status, 200);
    const sections = Object.entries(res.body.sections);
    assert.equal(sections.length, 7);
    for (const [key, s] of sections) {
      assert.equal(s.state, 'unavailable', key);
      assert.ok(s.module && s.phase, key);
      assert.deepEqual(Object.keys(s).sort(), ['label', 'module', 'phase', 'state'], `${key} must not contain numbers`);
    }
  });

  test('requires authentication', async () => {
    assert.equal((await request(app).get('/api/v1/dashboard')).status, 401);
    assert.equal((await request(app).get('/api/v1/dashboard').set({ Authorization: 'Bearer nope' })).status, 401);
  });

  test('only the missing module is unavailable; ready modules still report real (possibly empty) data', async () => {
    const a = await signUp();
    const partial = { ...ALL, tasks: { ...ALL.tasks, ready: false } };
    const d = await dash(a.user, { modules: partial });
    assert.equal(d.sections.tasks.state, 'unavailable');
    assert.equal(d.sections.contentPipeline.state, 'ok');
    assert.equal(d.sections.contentPipeline.total, 0);
  });

  test('without Calendar, the pipeline shows only the three content stages and says why', async () => {
    const a = await signUp();
    await content(a.user.id, 'x', 'ready');
    const s = await section(a.user, 'contentPipeline', { modules: { ...ALL, calendar: { ...ALL.calendar, ready: false } } });
    assert.deepEqual(s.stages.map((x) => x.key), ['idea', 'drafting', 'ready']);
    assert.equal(s.stages[2].count, 1);
    assert.match(s.note, /Calendar/);
  });
});

describe('a user with no data', () => {
  test('gets honest empty results from every section', async () => {
    const a = await signUp();
    const d = await dash(a.user);
    for (const [key, s] of Object.entries(d.sections)) assert.equal(s.state, 'ok', key);
    assert.equal(d.sections.contentPipeline.total, 0);
    assert.equal(d.sections.upcomingPosts.count, 0);
    assert.equal(d.sections.campaigns.activeCount, 0);
    assert.deepEqual([d.sections.tasks.dueTodayCount, d.sections.tasks.overdueCount], [0, 0]);
    assert.equal(d.sections.reviews.count, 0);
    assert.deepEqual(d.sections.payments.currencies, []);
    assert.deepEqual(d.sections.recentActivity.items, []);
  });
});

describe('content by workflow status', () => {
  test('counts each item once, in its furthest stage; excludes archived and other users; ignores foreign posts', async () => {
    const a = await signUp();
    const b = await signUp();
    const A = a.user.id;
    await content(A, 'i1', 'idea');
    await content(A, 'i2', 'idea');
    await content(A, 'd1', 'drafting');
    await content(A, 'r1', 'ready');
    const sched = await content(A, 'r2', 'ready');
    await post(A, sched, 'scheduled', at(DAY));
    const both = await content(A, 'd2', 'drafting');
    await post(A, both, 'scheduled', at(DAY));
    await post(A, both, 'published', at(-DAY), { verification: 'manual', publishedAt: at(-DAY) });
    const cancelled = await content(A, 'i3', 'idea');
    await post(A, cancelled, 'cancelled', at(DAY));
    await content(A, 'archived', 'ready', { archivedAt: at(-DAY) });
    // another user's post pointing at A's content must not change A's numbers
    const target = await content(A, 'target', 'ready');
    await post(b.user.id, target, 'published', at(-DAY), { verification: 'manual' });
    // other user's own content must not be counted
    for (let i = 0; i < 5; i++) await content(b.user.id, `b${i}`, 'ready');

    const s = await section(a.user, 'contentPipeline');
    const counts = Object.fromEntries(s.stages.map((x) => [x.key, x.count]));
    assert.deepEqual(counts, { idea: 3, drafting: 1, ready: 2, scheduled: 1, published: 1 });
    assert.equal(s.total, 8);
    assert.equal(s.total, Object.values(counts).reduce((x, y) => x + y, 0));
  });
});

describe('upcoming scheduled posts', () => {
  test('lists only "scheduled" posts in the next 14 days, soonest first, and counts what needs confirmation', async () => {
    const a = await signUp();
    const b = await signUp();
    const A = a.user.id;
    const c = await content(A, 'Reel one', 'ready');
    await post(A, c, 'scheduled', at(2 * DAY));
    await post(A, c, 'scheduled', at(HOUR));
    await post(A, c, 'scheduled', at(14 * DAY - HOUR)); // inside
    await post(A, c, 'scheduled', at(14 * DAY + HOUR)); // outside
    await post(A, c, 'planned', at(DAY)); // not scheduled
    await post(A, c, 'published', at(DAY), { verification: 'manual' }); // not scheduled
    await post(A, c, 'cancelled', at(DAY));
    await post(A, c, 'scheduled', at(-HOUR)); // in the past, never confirmed
    await post(A, c, 'awaiting_confirmation', at(-2 * HOUR));
    await post(b.user.id, await content(b.user.id, 'B secret', 'ready'), 'scheduled', at(HOUR));

    const s = await section(a.user, 'upcomingPosts');
    assert.equal(s.count, 3);
    assert.equal(s.windowDays, 14);
    assert.deepEqual(s.items.map((i) => i.scheduledAt.getTime()), [at(HOUR), at(2 * DAY), at(14 * DAY - HOUR)].map(Number));
    assert.ok(s.items.every((i) => i.status === 'scheduled' && i.contentTitle === 'Reel one'));
    assert.equal(s.needsConfirmation, 2);
    assert.ok(!JSON.stringify(s).includes('B secret'));
  });

  test('the model refuses to store a "published" post nobody confirmed', async () => {
    const a = await signUp();
    const c = await content(a.user.id, 'x');
    await assert.rejects(() => post(a.user.id, c, 'published', at(-HOUR)), /confirmed/);
    await assert.rejects(() => post(a.user.id, c, 'published', at(-HOUR), { verification: 'platform' }), /external id/);
    await post(a.user.id, c, 'published', at(-HOUR), { verification: 'platform', externalPostId: 'abc' });
  });
});

describe('tasks due today and overdue (in the user timezone)', () => {
  test('boundaries are the start/end of the LOCAL day; done/cancelled/archived/undated tasks are ignored', async () => {
    const a = await signUp();
    const A = a.user.id;
    await task(A, 'start of today', new Date('2026-10-13T18:30:00Z')); // today (inclusive)
    await task(A, 'last second today', new Date('2026-10-14T18:29:59Z')); // today
    await task(A, 'earlier today', new Date('2026-10-14T05:00:00Z'), { status: 'doing' }); // today, not overdue
    await task(A, 'tomorrow', new Date('2026-10-14T18:30:00Z')); // neither
    await task(A, 'just yesterday', new Date('2026-10-13T18:29:59Z')); // overdue
    await task(A, 'last week', at(-7 * DAY), { status: 'doing' }); // overdue
    await task(A, 'done', at(-3 * DAY), { status: 'done' });
    await task(A, 'cancelled', at(-3 * DAY), { status: 'cancelled' });
    await task(A, 'archived', at(-3 * DAY), { archivedAt: at(-DAY) });
    await task(A, 'no date', undefined);

    const s = await section(a.user, 'tasks');
    assert.equal(s.dueTodayCount, 3);
    assert.equal(s.overdueCount, 2);
    assert.deepEqual(s.dueToday.map((t) => t.title), ['start of today', 'earlier today', 'last second today']);
    assert.deepEqual(s.overdue.map((t) => t.title), ['last week', 'just yesterday']); // oldest first
    // a task is never both
    assert.equal(s.dueToday.filter((t) => s.overdue.some((o) => o.id === t.id)).length, 0);
  });

  test('the same data gives different answers in a different timezone', async () => {
    const a = await signUp();
    await task(a.user.id, 'evening UTC', new Date('2026-10-14T20:00:00Z')); // tomorrow in Kolkata, today in UTC
    const kolkata = await section(a.user, 'tasks');
    const utc = (await getDashboard({ id: a.user.id, timezone: 'UTC' }, { now: NOW, modules: ALL, log: noLog })).sections.tasks;
    assert.equal(kolkata.dueTodayCount, 0);
    assert.equal(utc.dueTodayCount, 1);
  });

  test('lists are capped but counts are exact', async () => {
    const a = await signUp();
    for (let i = 0; i < 9; i++) await task(a.user.id, `late ${i}`, at(-(i + 2) * DAY));
    const s = await section(a.user, 'tasks');
    assert.equal(s.overdueCount, 9);
    assert.equal(s.overdue.length, 6);
  });
});

describe('active campaigns and deadlines', () => {
  test('active = confirmed/in progress, not archived; deadlines merge campaign ends and open deliverables; overdue is separate', async () => {
    const a = await signUp();
    const b = await signUp();
    const A = a.user.id;
    const brand = await client(A, 'Acme');
    const c1 = await campaign(A, brand, 'Summer launch', 'in_progress', { endDate: at(3 * DAY) });
    await campaign(A, brand, 'Autumn', 'confirmed', { endDate: at(20 * DAY) });
    await campaign(A, brand, 'Evergreen', 'confirmed');
    await campaign(A, brand, 'Proposal', 'proposed', { endDate: at(2 * DAY) });
    const cancelled = await campaign(A, brand, 'Cancelled', 'cancelled', { endDate: at(2 * DAY) });
    await campaign(A, brand, 'Archived', 'in_progress', { endDate: at(2 * DAY), archivedAt: at(-DAY) });
    await campaign(A, brand, 'Late', 'in_progress', { endDate: at(-DAY) });

    await deliverable(A, c1, 'Due today early', { dueDate: new Date('2026-10-13T19:00:00Z'), status: 'in_progress' }); // 00:30 local today
    await deliverable(A, c1, 'Due in 2 days', { dueDate: at(2 * DAY) });
    await deliverable(A, c1, 'Too far', { dueDate: at(30 * DAY) });
    await deliverable(A, c1, 'Already approved', { dueDate: at(DAY), status: 'approved' });
    await deliverable(A, c1, 'Overdue', { dueDate: at(-2 * DAY) });
    await deliverable(A, cancelled, 'On cancelled', { dueDate: at(DAY) });

    const bBrand = await client(b.user.id, 'B Brand');
    await campaign(b.user.id, bBrand, 'B campaign', 'in_progress', { endDate: at(DAY) });

    const s = await section(a.user, 'campaigns');
    assert.equal(s.activeCount, 4); // Summer, Autumn, Evergreen, Late
    assert.deepEqual(s.active.map((c) => c.title), ['Late', 'Summer launch', 'Autumn', 'Evergreen']); // end date asc, none last
    assert.equal(s.active[1].clientName, 'Acme');
    assert.deepEqual(s.deadlines.map((d) => [d.title, d.type, d.daysLeft]), [
      ['Due today early', 'deliverable', 0],
      ['Due in 2 days', 'deliverable', 2],
      ['Summer launch', 'campaign_end', 3],
    ]);
    assert.equal(s.deadlineCount, 3);
    assert.deepEqual(s.overdue, { deliverables: 1, campaignsPastEndDate: 1 });
    assert.ok(!JSON.stringify(s).includes('B campaign'));
  });
});

describe('pending client reviews', () => {
  test('only submitted, approval-required deliverables on live campaigns, oldest first, with waiting days', async () => {
    const a = await signUp();
    const b = await signUp();
    const A = a.user.id;
    const brand = await client(A, 'Acme');
    const live = await campaign(A, brand, 'Live', 'in_progress');
    const dead = await campaign(A, brand, 'Dead', 'cancelled');
    await deliverable(A, live, 'Newer', { status: 'submitted', submittedAt: at(-1 * DAY - HOUR) });
    await deliverable(A, live, 'Older', { status: 'submitted', submittedAt: at(-3 * DAY - HOUR) });
    await deliverable(A, live, 'No approval needed', { status: 'submitted', requiresApproval: false, submittedAt: at(-DAY) });
    await deliverable(A, live, 'Still pending', { status: 'pending' });
    await deliverable(A, live, 'Changes requested', { status: 'changes_requested' });
    await deliverable(A, dead, 'On cancelled', { status: 'submitted', submittedAt: at(-DAY) });
    const bc = await campaign(b.user.id, await client(b.user.id, 'B'), 'B live', 'in_progress');
    await deliverable(b.user.id, bc, 'B review', { status: 'submitted', submittedAt: at(-DAY) });

    const s = await section(a.user, 'reviews');
    assert.equal(s.count, 2);
    assert.deepEqual(s.items.map((i) => [i.title, i.waitingDays, i.clientName]), [['Older', 3, 'Acme'], ['Newer', 1, 'Acme']]);
  });
});

describe('payments: agreed, collected, outstanding', () => {
  async function seedMoney(A) {
    const brand = await client(A, 'Acme');
    // agreed fees (cancelled / proposed / archived excluded)
    await campaign(A, brand, 'c1', 'confirmed', fee(100000, 'INR'));
    await campaign(A, brand, 'c2', 'completed', fee(50000, 'INR'));
    await campaign(A, brand, 'c3', 'in_progress', fee(25000, 'INR'));
    await campaign(A, brand, 'c4', 'in_progress', fee(20000, 'USD'));
    await campaign(A, brand, 'c5', 'proposed', fee(999999, 'INR'));
    await campaign(A, brand, 'c6', 'cancelled', fee(888888, 'INR'));
    await campaign(A, brand, 'c7', 'confirmed', { ...fee(777777, 'INR'), archivedAt: at(-DAY) });

    const overdue = await invoice(A, brand, 'INR', 100000, 'sent', at(-10 * DAY));
    await pay(A, overdue, 30000, new Date('2026-10-02T09:00:00Z')); // this month
    await pay(A, overdue, 20000, new Date('2026-09-30T18:29:00Z')); // 1 minute before this month starts in Kolkata
    const open = await invoice(A, brand, 'INR', 40000, 'sent', at(5 * DAY));
    const settled = await invoice(A, brand, 'INR', 10000, 'sent', at(-DAY));
    await pay(A, settled, 10000, new Date('2026-10-10T09:00:00Z'));
    await invoice(A, brand, 'INR', 77777, 'draft', at(DAY)); // drafts are not "invoiced"
    const voided = await invoice(A, brand, 'INR', 5000, 'void', at(DAY));
    await pay(A, voided, 5000, new Date('2026-10-05T09:00:00Z')); // void invoice payments are not "collected"
    const usd = await invoice(A, brand, 'USD', 20000, 'sent', at(DAY));
    await pay(A, usd, 20000, new Date('2026-10-01T09:00:00Z'));
    await invoice(A, brand, 'EUR', 5000, 'sent', at(DAY));
    const over = await invoice(A, brand, 'EUR', 1000, 'sent', at(DAY));
    await pay(A, over, 1500, new Date('2026-10-03T09:00:00Z')); // defensive: overpayment must not make a negative balance
    return { open };
  }

  test('computes every figure per currency without ever mixing currencies', async () => {
    const a = await signUp();
    await seedMoney(a.user.id);
    const { currencies } = await section(a.user, 'payments');
    assert.deepEqual(currencies.map((c) => c.currency), ['EUR', 'INR', 'USD']);
    const by = Object.fromEntries(currencies.map((c) => [c.currency, c]));

    assert.deepEqual(by.INR, {
      currency: 'INR', agreed: 175000, invoiced: 150000, collected: 60000, outstanding: 90000, overdue: 50000,
      openInvoices: 2, collectedThisMonth: 40000, notYetInvoiced: 25000,
    });
    assert.deepEqual(by.USD, {
      currency: 'USD', agreed: 20000, invoiced: 20000, collected: 20000, outstanding: 0, overdue: 0,
      openInvoices: 0, collectedThisMonth: 20000, notYetInvoiced: 0,
    });
    assert.deepEqual(by.EUR, {
      currency: 'EUR', agreed: 0, invoiced: 6000, collected: 1500, outstanding: 5000, overdue: 0,
      openInvoices: 1, collectedThisMonth: 1500, notYetInvoiced: 0,
    });
    // identity: outstanding never exceeds invoiced - collected
    for (const c of currencies) assert.ok(c.outstanding >= 0 && c.outstanding >= c.invoiced - c.collected, c.currency);
  });

  test('a new payment is reflected immediately; an invoice that becomes fully paid is no longer open', async () => {
    const a = await signUp();
    const { open } = await seedMoney(a.user.id);
    await pay(a.user.id, open, 40000, new Date('2026-10-14T08:00:00Z'));
    const inr = (await section(a.user, 'payments')).currencies.find((c) => c.currency === 'INR');
    assert.equal(inr.collected, 100000);
    assert.equal(inr.outstanding, 50000);
    assert.equal(inr.openInvoices, 1);
  });

  test("another user's invoices, payments and fees never leak in", async () => {
    const a = await signUp();
    const b = await signUp();
    await seedMoney(b.user.id);
    assert.deepEqual((await section(a.user, 'payments')).currencies, []);
    // a payment owned by A attached to B's invoice must not count toward B's collected
    const bBrand = await client(b.user.id, 'BB');
    const bInv = await invoice(b.user.id, bBrand, 'GBP', 10000, 'sent', at(DAY));
    await pay(a.user.id, bInv, 9999, new Date('2026-10-10T09:00:00Z'));
    const gbp = (await section(b.user, 'payments')).currencies.find((c) => c.currency === 'GBP');
    assert.equal(gbp.collected, 0);
    assert.equal(gbp.outstanding, 10000);
  });
});

describe('recent client activity', () => {
  test('merges communications and payments newest-first, caps at 8, skips future and archived entries', async () => {
    const a = await signUp();
    const A = a.user.id;
    const brand = await client(A, 'Acme');
    for (let i = 1; i <= 9; i++) {
      await Communication.create({ owner: A, client: brand._id, channel: 'email', direction: 'inbound', occurredAt: at(-i * DAY), subject: `mail ${i}` });
    }
    await Communication.create({ owner: A, client: brand._id, channel: 'call', direction: 'outbound', occurredAt: at(DAY), subject: 'future call' });
    await Communication.create({ owner: A, client: brand._id, channel: 'call', direction: 'outbound', occurredAt: at(-HOUR), subject: 'archived', archivedAt: at(-1) });
    const inv = await invoice(A, brand, 'INR', 1000, 'sent', at(DAY));
    await pay(A, inv, 500, at(-2 * HOUR));
    await Payment.create({ owner: A, invoice: inv._id, amountMinor: 1, currency: 'INR', paidAt: at(DAY) }); // future

    const { items } = await section(a.user, 'recentActivity');
    assert.equal(items.length, 8);
    assert.deepEqual(items.slice(0, 3).map((i) => [i.type, i.title]), [
      ['payment', `Payment received for invoice ${inv.number}`], ['communication', 'mail 1'], ['communication', 'mail 2'],
    ]);
    assert.ok(items.every((i, k) => k === 0 || items[k - 1].at >= i.at), 'sorted newest first');
    assert.ok(items.every((i) => i.at <= NOW));
    assert.equal(items[0].clientName, 'Acme');
    assert.ok(!items.some((i) => ['future call', 'archived'].includes(i.title)));
  });

  test('without the Payments module only communications are shown', async () => {
    const a = await signUp();
    const brand = await client(a.user.id, 'Acme');
    await Communication.create({ owner: a.user.id, client: brand._id, channel: 'dm', direction: 'inbound', occurredAt: at(-HOUR) });
    const inv = await invoice(a.user.id, brand, 'INR', 1000, 'sent', at(DAY));
    await pay(a.user.id, inv, 500, at(-HOUR));
    const s = await section(a.user, 'recentActivity', { modules: { ...ALL, payments: { ...ALL.payments, ready: false } } });
    assert.deepEqual(s.items.map((i) => i.type), ['communication']);
  });
});

describe('user isolation across the whole dashboard', () => {
  async function seedEverything(U, tag) {
    const c = await content(U, `${tag} content`, 'ready');
    await post(U, c, 'scheduled', at(DAY));
    const brand = await client(U, `${tag} Brand`);
    const camp = await campaign(U, brand, `${tag} Campaign`, 'in_progress', { endDate: at(2 * DAY), ...fee(5000, 'JPY') });
    await deliverable(U, camp, `${tag} Review`, { status: 'submitted', submittedAt: at(-DAY) });
    await task(U, `${tag} Task`, at(-2 * DAY));
    await Communication.create({ owner: U, client: brand._id, channel: 'email', direction: 'inbound', occurredAt: at(-HOUR), subject: `${tag} Mail` });
    const inv = await invoice(U, brand, 'JPY', 5000, 'sent', at(-DAY));
    await pay(U, inv, 1000, at(-HOUR));
  }

  test("adding or removing another user's data never changes my dashboard, and none of it appears in it", async () => {
    const a = await signUp();
    const b = await signUp();
    await seedEverything(a.user.id, 'ALPHA');
    const alone = await dash(a.user);

    await seedEverything(b.user.id, 'BRAVO');
    await seedEverything(b.user.id, 'BRAVO2');
    const withNeighbours = await dash(a.user);
    assert.deepEqual(withNeighbours, alone);
    assert.ok(!/BRAVO/.test(JSON.stringify(withNeighbours)));
    assert.match(JSON.stringify(withNeighbours), /ALPHA/);

    const mine = await dash(b.user);
    assert.ok(!/ALPHA/.test(JSON.stringify(mine)));
  });

  describe('over HTTP', () => {
    const saved = Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, m.ready]));
    const enable = () => Object.values(MODULES).forEach((m) => (m.ready = true));
    afterEach(() => Object.entries(saved).forEach(([k, v]) => (MODULES[k].ready = v)));

    test("each user's token returns only their own dashboard; there is no way to name another user", async () => {
      enable();
      const a = await signUp();
      const b = await signUp();
      const now = Date.now();
      await Task.create({ owner: a.user.id, title: 'ALPHA only', dueAt: new Date(now - 3 * DAY) });
      await Task.create({ owner: b.user.id, title: 'BRAVO only', dueAt: new Date(now - 3 * DAY) });

      const ra = await request(app).get('/api/v1/dashboard').set(bearer(a.token));
      const rb = await request(app).get('/api/v1/dashboard').set(bearer(b.token));
      assert.equal(ra.status, 200);
      assert.deepEqual(ra.body.sections.tasks.overdue.map((t) => t.title), ['ALPHA only']);
      assert.deepEqual(rb.body.sections.tasks.overdue.map((t) => t.title), ['BRAVO only']);
      assert.ok(!JSON.stringify(ra.body).includes('BRAVO'));

      // query-string / header tricks do not change whose data is returned
      const trick = await request(app).get(`/api/v1/dashboard?owner=${b.user.id}&userId=${b.user.id}`).set(bearer(a.token)).set('X-User-Id', b.user.id);
      assert.deepEqual(trick.body.sections.tasks.overdue.map((t) => t.title), ['ALPHA only']);
      assert.equal(ra.headers['cache-control'], 'no-store');
    });

    test('the response documents what each metric means', async () => {
      enable();
      const a = await signUp();
      const res = await request(app).get('/api/v1/dashboard').set(bearer(a.token));
      for (const key of ['contentPipeline', 'upcomingPosts', 'tasksDueToday', 'tasksOverdue', 'pendingReviews', 'payments']) {
        const d = res.body.definitions[key];
        assert.ok(['count', 'amount', 'duration'].includes(d.kind) && d.period && d.text, key);
      }
      assert.equal(res.body.definitions.payments.kind, 'amount');
    });
  });
});

describe('failure handling', () => {
  test('a failing section reports "error" without taking the other sections down, and logs no data', async () => {
    const a = await signUp();
    await content(a.user.id, 'still counted', 'idea');
    const original = Task.countDocuments;
    const logged = [];
    Task.countDocuments = async () => {
      throw new Error('boom with secret-ish detail');
    };
    try {
      const d = await dash(a.user, { log: { error: (m) => logged.push(m) } });
      assert.deepEqual(d.sections.tasks, { state: 'error' });
      assert.equal(d.sections.contentPipeline.state, 'ok');
      assert.equal(d.sections.contentPipeline.total, 1);
      assert.equal(logged.length, 1);
      assert.ok(!logged[0].includes('secret-ish'));
    } finally {
      Task.countDocuments = original;
    }
  });
});
