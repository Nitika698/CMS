import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { clients, discussions, fee, mkCampaign, mkInvoice, mkPayment, newClient } from './helpers/clients.js';
import { cal, notifs, setTimezone } from './helpers/calendar.js';
import { MODULES } from '../src/config/modules.js';
import { runReminderSweep } from '../src/jobs/reminders.js';
import { getDashboard } from '../src/modules/dashboard/dashboard.service.js';
import { Client } from '../src/modules/clients/client.model.js';
import { Communication } from '../src/modules/communications/communication.model.js';
import { Notification } from '../src/modules/notifications/notification.model.js';
import { Task } from '../src/modules/tasks/task.model.js';

useDatabase();

const DAY = 86_400_000;
const GHOST = '507f1f77bcf86cd799439011';
const ago = (days) => new Date(Date.now() - days * DAY);
const iso = (d) => d.toISOString();

describe('campaigns are read through the reference, never stored on the brand', () => {
  async function setup() {
    const a = await signUp();
    const acme = await newClient(a.token, { name: 'Acme' });
    const other = await newClient(a.token, { name: 'Other Brand' });
    const mk = (title, status, extra) => mkCampaign(a.user.id, acme, title, status, extra);
    await mk('Summer launch', 'in_progress', { endDate: ago(-10), ...fee(100_000, 'INR') });
    await mk('Autumn drop', 'confirmed', { endDate: ago(-40), ...fee(50_000, 'INR') });
    await mk('Winter pitch', 'proposed', fee(70_000, 'INR'));
    await mk('Haggling', 'negotiating');
    await mk('Last year', 'completed', { endDate: ago(300), ...fee(25_000, 'USD') });
    await mk('Delivered', 'delivered', { endDate: ago(30), ...fee(10_000, 'INR') });
    await mk('Dropped', 'cancelled', fee(999_999, 'INR'));
    await mk('Archived', 'in_progress', { ...fee(888_888, 'INR'), archivedAt: new Date() });
    await mkCampaign(a.user.id, other, 'Not theirs', 'in_progress', fee(5_000_000, 'INR'));
    return { a, acme, other };
  }

  test('lists the brand\'s campaigns grouped as active, pipeline, past and cancelled; archived and other brands\' are excluded', async () => {
    const { a, acme } = await setup();
    const res = await clients.campaigns(a.token, acme);
    assert.equal(res.status, 200);
    const titles = (g) => res.body.groups[g].map((c) => c.title).sort();
    assert.deepEqual(titles('active'), ['Autumn drop', 'Summer launch']);
    assert.deepEqual(titles('pipeline'), ['Haggling', 'Winter pitch']);
    assert.deepEqual(titles('past'), ['Delivered', 'Last year']);
    assert.deepEqual(titles('cancelled'), ['Dropped']);
    assert.equal(res.body.data.length, 7);
    assert.ok(!JSON.stringify(res.body).match(/Not theirs|Archived/));
    const summer = res.body.data.find((c) => c.title === 'Summer launch');
    assert.deepEqual(summer.fee, { amountMinor: 100_000, currency: 'INR' });
    assert.equal(summer.group, 'active');
  });

  test('the detail summary counts campaigns by group and totals AGREED fees per currency', async () => {
    const { a, acme } = await setup();
    const { summary } = (await clients.get(a.token, acme)).body.data;
    assert.deepEqual(summary.campaigns, { active: 2, pipeline: 2, past: 2, cancelled: 1, total: 7 });
    const money = Object.fromEntries(summary.money.map((m) => [m.currency, m.agreed]));
    // agreed = confirmed + in progress + delivered + completed, never proposed/cancelled/archived, never summed across currencies
    assert.deepEqual(money, { INR: 100_000 + 50_000 + 10_000, USD: 25_000 });
  });

  test('nothing about campaigns or money is stored on the client document', async () => {
    const { a, acme } = await setup();
    const raw = await Client.findById(acme).lean();
    const keys = Object.keys(raw);
    for (const forbidden of ['campaigns', 'invoices', 'payments', 'fees', 'agreed', 'invoiced', 'outstanding', 'lastContactAt', 'communications']) {
      assert.ok(!keys.includes(forbidden), `${forbidden} must not be stored on the client`);
    }
    assert.ok(!JSON.stringify(raw).includes('Summer launch'));
    assert.ok(a);
  });

  test('changing a campaign shows up on the brand immediately because it is read, not copied', async () => {
    const { a, acme } = await setup();
    const { Campaign } = await import('../src/modules/campaigns/campaign.model.js');
    await Campaign.updateOne({ title: 'Summer launch' }, { 'fee.amountMinor': 300_000, status: 'completed' });
    const { summary } = (await clients.get(a.token, acme)).body.data;
    assert.equal(summary.money.find((m) => m.currency === 'INR').agreed, 300_000 + 50_000 + 10_000);
    assert.equal(summary.campaigns.active, 1);
    assert.equal(summary.campaigns.past, 3);
  });

  test('the list shows the number of active campaigns per brand', async () => {
    const { a, acme, other } = await setup();
    const rows = Object.fromEntries((await clients.list(a.token)).body.data.map((c) => [c.id, c.activeCampaigns]));
    assert.deepEqual([rows[acme], rows[other]], [2, 1]);
  });

  describe('module availability is reported honestly', () => {
    const saved = { campaigns: MODULES.campaigns.ready, payments: MODULES.payments.ready };
    afterEach(() => Object.assign(MODULES, { campaigns: { ...MODULES.campaigns, ready: saved.campaigns }, payments: { ...MODULES.payments, ready: saved.payments } }));

    test('says whether the Campaigns and Payments modules have features yet, so the UI never implies a made-up zero', async () => {
      const { token } = await signUp();
      const id = await newClient(token);
      const before = (await clients.get(token, id)).body.data.summary.modules;
      assert.deepEqual([before.campaigns.ready, before.payments.ready], [true, true]); // both modules have shipped
      assert.equal((await clients.campaigns(token, id)).body.available, true);
      assert.equal((await clients.invoices(token, id)).body.available, true);
      MODULES.campaigns.ready = false;
      MODULES.payments.ready = false;
      assert.equal((await clients.campaigns(token, id)).body.available, false);
      assert.equal((await clients.invoices(token, id)).body.available, false);
    });
  });
});

describe('invoices and money are read through the reference too', () => {
  async function setup() {
    const a = await signUp();
    const acme = await newClient(a.token, { name: 'Acme' });
    const user = a.user.id;
    const past = new Date(Date.now() - 10 * DAY);
    const future = new Date(Date.now() + 10 * DAY);
    const partial = await mkInvoice(user, acme, 'INR', 100_000, 'sent', future);
    await mkPayment(user, partial, 30_000);
    const overdue = await mkInvoice(user, acme, 'INR', 50_000, 'sent', past);
    const paid = await mkInvoice(user, acme, 'INR', 20_000, 'sent', past);
    await mkPayment(user, paid, 20_000);
    const unpaid = await mkInvoice(user, acme, 'USD', 8_000, 'sent', future);
    const draft = await mkInvoice(user, acme, 'INR', 77_777, 'draft', future);
    const voided = await mkInvoice(user, acme, 'INR', 5_000, 'void', future);
    await mkPayment(user, voided, 5_000);
    const campaign = await mkCampaign(user, acme, 'Summer', 'in_progress', fee(150_000, 'INR'));
    return { a, acme, ids: { partial, overdue, paid, unpaid, draft, voided }, campaign };
  }

  test('each invoice reports its paid amount, balance and a display status derived from payments and due date', async () => {
    const { a, acme, ids } = await setup();
    const res = await clients.invoices(a.token, acme);
    assert.equal(res.status, 200);
    const by = Object.fromEntries(res.body.data.map((i) => [i.id, i]));
    const row = (inv) => by[String(inv._id)];
    assert.deepEqual([row(ids.partial).displayStatus, row(ids.partial).paidMinor, row(ids.partial).balanceMinor], ['partially_paid', 30_000, 70_000]);
    assert.deepEqual([row(ids.overdue).displayStatus, row(ids.overdue).balanceMinor], ['overdue', 50_000]);
    assert.deepEqual([row(ids.paid).displayStatus, row(ids.paid).balanceMinor], ['paid', 0]);
    assert.deepEqual([row(ids.unpaid).displayStatus, row(ids.unpaid).currency], ['sent', 'USD']);
    assert.deepEqual([row(ids.draft).displayStatus, row(ids.draft).balanceMinor], ['draft', 0]);
    assert.deepEqual([row(ids.voided).displayStatus, row(ids.voided).balanceMinor], ['void', 0]);
  });

  test('totals count only SENT invoices, per currency, with outstanding never below zero', async () => {
    const { a, acme } = await setup();
    const { totals } = (await clients.invoices(a.token, acme)).body;
    assert.deepEqual(totals, [
      { currency: 'INR', invoiced: 170_000, collected: 50_000, outstanding: 120_000, overdue: 50_000 },
      { currency: 'USD', invoiced: 8_000, collected: 0, outstanding: 8_000, overdue: 0 },
    ]);
  });

  test('the brand summary uses the very same rules as the dashboard (one shared definition)', async () => {
    const { a, acme } = await setup();
    const money = (await clients.get(a.token, acme)).body.data.summary.money.find((m) => m.currency === 'INR');
    const all = Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, { ...m, ready: true }]));
    const dash = await getDashboard({ id: a.user.id, timezone: 'UTC' }, { modules: all, log: { error() {} } });
    const inr = dash.sections.payments.currencies.find((c) => c.currency === 'INR');
    for (const k of ['agreed', 'invoiced', 'collected', 'outstanding', 'overdue']) assert.equal(money[k], inr[k], k);
    assert.deepEqual([money.agreed, money.invoiced, money.collected, money.outstanding], [150_000, 170_000, 50_000, 120_000]);
  });

  test('an invoice links to its campaign by reference', async () => {
    const { a, acme, campaign } = await setup();
    await (await import('../src/modules/invoices/invoice.model.js')).Invoice.updateOne({ currency: 'USD' }, { campaign: campaign._id });
    const row = (await clients.invoices(a.token, acme)).body.data.find((i) => i.currency === 'USD');
    assert.deepEqual(row.campaign, { id: String(campaign._id), title: 'Summer' });
  });

  test('another brand\'s and another user\'s invoices never appear', async () => {
    const { a, acme } = await setup();
    const other = await newClient(a.token, { name: 'Other' });
    await mkInvoice(a.user.id, other, 'INR', 999, 'sent', new Date());
    const b = await signUp();
    const bc = await newClient(b.token, { name: 'Acme' });
    await mkInvoice(b.user.id, bc, 'EUR', 123, 'sent', new Date());
    const res = (await clients.invoices(a.token, acme)).body;
    assert.equal(res.data.length, 6);
    assert.ok(!res.totals.some((t) => t.currency === 'EUR'));
    assert.deepEqual((await clients.invoices(b.token, bc)).body.totals.map((t) => t.currency), ['EUR']);
  });

  test('a brand with no invoices or campaigns gets honest empty results', async () => {
    const { token } = await signUp();
    const id = await newClient(token);
    const camp = (await clients.campaigns(token, id)).body;
    assert.deepEqual([camp.data, camp.groups.active, camp.groups.past], [[], [], []]);
    const inv = (await clients.invoices(token, id)).body;
    assert.deepEqual([inv.data, inv.totals], [[], []]);
    const { summary } = (await clients.get(token, id)).body.data;
    assert.deepEqual([summary.campaigns.total, summary.money, summary.lastContactAt, summary.communicationCount], [0, [], null, 0]);
  });
});

describe('saved discussions', () => {
  async function setup() {
    const a = await signUp();
    const id = await newClient(a.token, { name: 'Acme', contacts: [{ name: 'Wile', email: 'w@a.com' }, { name: 'Road' }] });
    const client = (await clients.get(a.token, id)).body.data;
    const campaign = await mkCampaign(a.user.id, id, 'Summer', 'in_progress');
    return { a, id, client, campaign };
  }

  test('saves a discussion with channel, direction, subject, notes, campaign and contact, all by reference', async () => {
    const { a, id, client, campaign } = await setup();
    const res = await discussions.create(a.token, id, {
      channel: 'call', direction: 'outbound', subject: 'Rates call', body: 'Agreed ₹1.5L per reel, net 30.',
      occurredAt: iso(ago(2)), campaign: String(campaign._id), contactId: client.contacts[0].id,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const d = res.body.data;
    assert.deepEqual([d.channel, d.direction, d.subject, d.body], ['call', 'outbound', 'Rates call', 'Agreed ₹1.5L per reel, net 30.']);
    assert.deepEqual(d.campaign, { id: String(campaign._id), title: 'Summer' });
    assert.deepEqual(d.contact, { id: client.contacts[0].id, name: 'Wile' });
    assert.equal(d.clientId, id);
    assert.ok(d.createdAt && d.updatedAt);
    assert.equal(await Communication.countDocuments({ owner: a.user.id, client: id }), 1);
  });

  test('defaults to "now" when no time is given, and needs a subject or notes', async () => {
    const { a, id } = await setup();
    const d = (await discussions.create(a.token, id, { subject: 'Quick note' })).body.data;
    assert.ok(Math.abs(new Date(d.occurredAt) - Date.now()) < 10_000);
    const empty = await discussions.create(a.token, id, { subject: undefined });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.details[0].path, 'subject');
  });

  test('validates input and rejects unknown fields', async () => {
    const { a, id } = await setup();
    const post = (b) => request(app).post(`/api/v1/clients/${id}/communications`).set(bearer(a.token)).send(b);
    const ok = { channel: 'email', direction: 'inbound', subject: 's' };
    const cases = {
      'no channel': [{ ...ok, channel: undefined }, 'channel'],
      'bad channel': [{ ...ok, channel: 'pigeon' }, 'channel'],
      'bad direction': [{ ...ok, direction: 'sideways' }, 'direction'],
      'subject too long': [{ ...ok, subject: 'x'.repeat(201) }, 'subject'],
      'notes too long': [{ ...ok, body: 'x'.repeat(20_001) }, 'body'],
      'bad instant': [{ ...ok, occurredAt: 'yesterday' }, 'occurredAt'],
      'instant without offset': [{ ...ok, occurredAt: '2024-01-01T10:00:00' }, 'occurredAt'],
      'bad local time': [{ ...ok, occurredLocal: '2024-01-01 10:00' }, 'occurredLocal'],
      'impossible local date': [{ ...ok, occurredLocal: '2024-02-30T10:00' }, 'occurredLocal'],
      'both time fields': [{ ...ok, occurredAt: iso(ago(1)), occurredLocal: '2024-01-01T10:00' }, 'occurredLocal'],
      'in the future': [{ ...ok, occurredAt: iso(new Date(Date.now() + 2 * DAY)) }, 'occurredAt'],
      'bad campaign id': [{ ...ok, campaign: 'nope' }, 'campaign'],
    };
    for (const [name, [body, path]] of Object.entries(cases)) {
      const res = await post(body);
      assert.equal(res.status, 400, name);
      assert.ok(res.body.error.details.some((d) => d.path === path), `${name}: ${JSON.stringify(res.body.error.details)}`);
    }
    for (const extra of [{ owner: 'x' }, { client: GHOST }, { archivedAt: iso(new Date()) }, { _id: GHOST }]) assert.equal((await post({ ...ok, ...extra })).status, 400, JSON.stringify(extra));
    assert.equal(await Communication.countDocuments(), 0);
  });

  test('a local time is read in the user\'s profile timezone', async () => {
    const { a, id } = await setup();
    await setTimezone(a.token, 'Asia/Kolkata');
    const d = (await discussions.create(a.token, id, { occurredLocal: '2024-03-05T18:30' })).body.data;
    assert.equal(d.occurredAt, '2024-03-05T13:00:00.000Z');
    assert.deepEqual([d.localDate, d.localTime], ['2024-03-05', '18:30']);
    await setTimezone(a.token, 'America/New_York'); // same instant, shown differently
    assert.deepEqual((await discussions.get(a.token, d.id)).body.data.localTime, '08:00');
  });

  test('a campaign or contact that does not belong to THIS brand is refused', async () => {
    const { a, id, campaign } = await setup();
    const otherBrand = await newClient(a.token, { name: 'Other', contacts: [{ name: 'Stranger' }] });
    const theirCampaign = await mkCampaign(a.user.id, otherBrand, 'Elsewhere', 'in_progress');
    const strangerId = (await clients.get(a.token, otherBrand)).body.data.contacts[0].id;
    const b = await signUp();
    const bBrand = await newClient(b.token, { name: 'Bravo' });
    const bCampaign = await mkCampaign(b.user.id, bBrand, 'B campaign', 'in_progress');

    const refused = [
      await discussions.create(a.token, id, { campaign: String(theirCampaign._id) }), // another brand of mine
      await discussions.create(a.token, id, { campaign: String(bCampaign._id) }), // another user's
      await discussions.create(a.token, id, { campaign: GHOST }),
    ];
    for (const r of refused) {
      assert.equal(r.status, 400);
      assert.equal(r.body.error.details[0].path, 'campaign');
    }
    assert.deepEqual(refused[0].body, refused[2].body, 'foreign and missing look the same');
    assert.equal((await discussions.create(a.token, id, { contactId: strangerId })).status, 400);
    assert.equal((await discussions.create(a.token, id, { contactId: GHOST })).status, 400);
    assert.equal((await discussions.create(a.token, id, { campaign: String(campaign._id) })).status, 201);
    assert.equal(await Communication.countDocuments({ client: id }), 1);
  });

  test('lists newest first with search, filters, a date range in the user\'s timezone, and pagination', async () => {
    const { a, id, campaign } = await setup();
    await setTimezone(a.token, 'Asia/Kolkata');
    const mk = (b) => discussions.create(a.token, id, b);
    await mk({ channel: 'email', direction: 'inbound', subject: 'Contract draft', body: 'Attached the PDF', occurredLocal: '2024-03-01T09:00' });
    await mk({ channel: 'call', direction: 'outbound', subject: 'Kickoff', body: 'Talked timelines', occurredLocal: '2024-03-02T23:30', campaign: String(campaign._id) });
    await mk({ channel: 'dm', direction: 'inbound', subject: 'Quick question', occurredLocal: '2024-03-03T00:30' });
    await mk({ channel: 'meeting', direction: 'outbound', subject: 'Review (final)', occurredLocal: '2024-03-10T12:00' });
    const subjects = (r) => r.body.data.map((d) => d.subject);
    assert.deepEqual(subjects(await discussions.list(a.token, id)), ['Review (final)', 'Quick question', 'Kickoff', 'Contract draft']);
    assert.deepEqual(subjects(await discussions.list(a.token, id, 'q=pdf')), ['Contract draft']);
    assert.deepEqual(subjects(await discussions.list(a.token, id, 'q=timelines')), ['Kickoff']);
    assert.deepEqual(subjects(await discussions.list(a.token, id, `q=${encodeURIComponent('(final)')}`)), ['Review (final)']);
    assert.equal((await discussions.list(a.token, id, `q=${encodeURIComponent('(')}`)).status, 200);
    assert.deepEqual(subjects(await discussions.list(a.token, id, 'channel=call,dm')), ['Quick question', 'Kickoff']);
    assert.deepEqual(subjects(await discussions.list(a.token, id, 'direction=outbound')), ['Review (final)', 'Kickoff']);
    assert.deepEqual(subjects(await discussions.list(a.token, id, `campaign=${campaign._id}`)), ['Kickoff']);
    // 23:30 on the 2nd and 00:30 on the 3rd are different LOCAL days even though they are an hour apart
    assert.deepEqual(subjects(await discussions.list(a.token, id, 'from=2024-03-02&to=2024-03-02')), ['Kickoff']);
    assert.deepEqual(subjects(await discussions.list(a.token, id, 'from=2024-03-03&to=2024-03-03')), ['Quick question']);
    assert.deepEqual(subjects(await discussions.list(a.token, id, 'from=2024-03-02&to=2024-03-03')), ['Quick question', 'Kickoff']);
    const p = await discussions.list(a.token, id, 'limit=3&page=2');
    assert.deepEqual([p.body.data.length, p.body.meta], [1, { page: 2, limit: 3, total: 4, pages: 2 }]);
    for (const q of ['limit=0', 'limit=101', 'channel=pigeon', 'direction=up', 'from=2024-1-1', 'campaign=nope']) assert.equal((await discussions.list(a.token, id, q)).status, 400, q);
  });

  test('can be edited and deleted; the brand it belongs to cannot be changed', async () => {
    const { a, id } = await setup();
    const d = (await discussions.create(a.token, id, { subject: 'Draft', body: 'v1', occurredAt: iso(ago(3)) })).body.data;
    const res = await discussions.patch(a.token, d.id, { subject: 'Final', body: null, channel: 'meeting', direction: 'outbound' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.data.subject, res.body.data.body, res.body.data.channel], ['Final', null, 'meeting']);
    for (const bad of [{ client: GHOST }, { owner: 'x' }, {}, { subject: null }, { occurredAt: iso(new Date(Date.now() + 3 * DAY)) }]) {
      assert.equal((await discussions.patch(a.token, d.id, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await discussions.remove(a.token, d.id)).status, 204);
    assert.equal((await discussions.get(a.token, d.id)).status, 404);
    assert.equal((await discussions.remove(a.token, d.id)).status, 404);
  });

  test('last contact is DERIVED from discussions: it tracks the newest one and falls back when it is deleted', async () => {
    const { a, id } = await setup();
    const read = async () => (await clients.get(a.token, id)).body.data.summary;
    assert.deepEqual([(await read()).lastContactAt, (await read()).communicationCount], [null, 0]);
    const older = (await discussions.create(a.token, id, { occurredAt: iso(ago(20)) })).body.data;
    const newer = (await discussions.create(a.token, id, { occurredAt: iso(ago(2)) })).body.data;
    assert.equal(new Date((await read()).lastContactAt).getTime(), new Date(newer.occurredAt).getTime());
    assert.equal((await read()).communicationCount, 2);
    const movedTo = iso(ago(1));
    await discussions.patch(a.token, older.id, { occurredAt: movedTo }); // editing a date moves "last contact"
    assert.equal(new Date((await read()).lastContactAt).toISOString(), movedTo);
    await discussions.remove(a.token, older.id);
    assert.equal(new Date((await read()).lastContactAt).getTime(), new Date(newer.occurredAt).getTime());
    await discussions.remove(a.token, newer.id);
    assert.equal((await read()).lastContactAt, null);
    assert.equal((await Client.findById(id).lean()).lastContactAt, undefined, 'never stored on the client');
  });

  test('removing a contact from the brand clears the pointer on its saved discussions, keeping the discussions', async () => {
    const { a, id, client } = await setup();
    const d = (await discussions.create(a.token, id, { contactId: client.contacts[1].id })).body.data;
    assert.equal(d.contact.name, 'Road');
    await clients.patch(a.token, id, { contacts: [{ id: client.contacts[0].id, name: 'Wile', email: 'w@a.com', isPrimary: true }] });
    const after = (await discussions.get(a.token, d.id)).body.data;
    assert.equal(after.contact, null);
    assert.equal(after.subject, 'Hello');
  });

  test('cannot add or edit discussions on an archived brand, but can once it is restored', async () => {
    const { a, id } = await setup();
    const d = (await discussions.create(a.token, id)).body.data;
    await clients.archive(a.token, id);
    assert.equal((await discussions.create(a.token, id)).body.error.code, 'ARCHIVED');
    assert.equal((await discussions.patch(a.token, d.id, { subject: 'x' })).body.error.code, 'ARCHIVED');
    assert.equal((await discussions.list(a.token, id)).body.meta.total, 1, 'history stays readable');
    await clients.restore(a.token, id);
    assert.equal((await discussions.create(a.token, id)).status, 201);
  });

  test('feed the dashboard\'s recent activity with the brand name', async () => {
    const { a, id } = await setup();
    await discussions.create(a.token, id, { subject: 'Rates call', channel: 'call', occurredAt: iso(ago(1)) });
    const res = await request(app).get('/api/v1/dashboard').set(bearer(a.token));
    assert.equal(res.body.sections.recentActivity.state, 'ok');
    const item = res.body.sections.recentActivity.items[0];
    assert.deepEqual([item.type, item.title, item.clientName, item.clientId], ['communication', 'Rates call', 'Acme', id]);
  });
});

describe('deleting and archiving have safeguards', () => {
  test('archiving warns about active campaigns and unpaid invoices but still works', async () => {
    const a = await signUp();
    const id = await newClient(a.token, { name: 'Busy Brand' });
    await mkCampaign(a.user.id, id, 'Live', 'in_progress');
    await mkCampaign(a.user.id, id, 'Also live', 'confirmed');
    await mkInvoice(a.user.id, id, 'INR', 1000, 'sent', new Date(Date.now() + DAY));
    const res = await clients.archive(a.token, id);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.warnings.map((w) => [w.code, w.count]), [['ACTIVE_CAMPAIGNS', 2], ['UNPAID_INVOICES', 1]]);
    assert.equal(res.body.data.archived, true);
    assert.deepEqual((await clients.archive(a.token, id)).body.warnings, [], 'no repeat warning when nothing changed');
  });

  test('permanent delete needs a prior archive and is refused while campaigns or invoices still point at the brand', async () => {
    const a = await signUp();
    const id = await newClient(a.token, { name: 'Linked' });
    const early = await clients.remove(a.token, id);
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'NOT_ARCHIVED');
    await mkCampaign(a.user.id, id, 'Finished', 'completed');
    await mkInvoice(a.user.id, id, 'INR', 1000, 'sent', new Date());
    await clients.archive(a.token, id);
    const blocked = await clients.remove(a.token, id);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'HAS_RELATED');
    assert.deepEqual([blocked.body.error.details.campaigns, blocked.body.error.details.invoices], [1, 1]);
    assert.equal((await clients.get(a.token, id)).status, 200, 'nothing was deleted');
  });

  test('deleting a brand with no campaigns or invoices removes it and its discussions, and unlinks tasks', async () => {
    const a = await signUp();
    const id = await newClient(a.token, { name: 'Disposable' });
    await discussions.create(a.token, id);
    await discussions.create(a.token, id, { subject: 'Second' });
    const task = await Task.create({ owner: a.user.id, title: 't', links: { client: id } });
    await clients.archive(a.token, id);
    const res = await clients.remove(a.token, id);
    assert.equal(res.status, 200);
    assert.equal(res.body.discussionsDeleted, 2);
    assert.equal((await clients.get(a.token, id)).status, 404);
    assert.equal(await Communication.countDocuments(), 0);
    assert.equal((await Task.findById(task._id)).links.client, null, 'the task survives, unlinked');
    assert.equal((await clients.remove(a.token, id)).status, 404);
  });

  test('archived brands keep their history: campaigns, invoices and discussions stay readable', async () => {
    const a = await signUp();
    const id = await newClient(a.token, { name: 'History' });
    await mkCampaign(a.user.id, id, 'Old campaign', 'completed');
    await discussions.create(a.token, id);
    await clients.archive(a.token, id);
    assert.equal((await clients.campaigns(a.token, id)).body.data.length, 1);
    assert.equal((await discussions.list(a.token, id)).body.data.length, 1);
    assert.equal((await clients.get(a.token, id)).body.data.summary.campaigns.past, 1);
  });
});

describe('follow-up reminders', () => {
  // 2040-06-20 in Kolkata starts at 2040-06-19T18:30:00Z
  const at = (s) => new Date(s);
  async function setup(tz = 'Asia/Kolkata', body = {}) {
    const a = await signUp();
    await setTimezone(a.token, tz);
    const id = await newClient(a.token, { name: 'Acme', followUpAt: '2040-06-20', followUpNote: 'Send Q3 rate card', ...body });
    return { a, id };
  }
  const notes = (owner) => Notification.find({ owner, type: 'followup_reminder' }).lean();

  test('a notice arrives at the start of the follow-up day in the user\'s timezone, exactly once', async () => {
    const { a, id } = await setup();
    assert.equal((await runReminderSweep(at('2040-06-19T18:29:59Z'))).followUpReminders, 0, 'one second early');
    assert.equal((await runReminderSweep(at('2040-06-19T18:30:00Z'))).followUpReminders, 1);
    const [n] = await notes(a.user.id);
    assert.deepEqual([n.title, n.body, n.entity.kind, String(n.entity.id), n.localDate], ['Follow up with Acme', 'Send Q3 rate card', 'client', id, '2040-06-20']);
    assert.equal((await runReminderSweep(at('2040-06-19T20:00:00Z'))).followUpReminders, 0, 'repeat sweeps send nothing new');
    assert.equal((await runReminderSweep(at('2040-06-19T18:30:00Z'))).followUpReminders, 0);
  });

  test('follows the user\'s timezone and ignores a follow-up that is long past', async () => {
    const { a } = await setup('America/New_York'); // the 20th starts at 04:00Z
    assert.equal((await runReminderSweep(at('2040-06-20T03:59:59Z'))).followUpReminders, 0);
    assert.equal((await runReminderSweep(at('2040-06-20T04:00:00Z'))).followUpReminders, 1);
    assert.equal((await notes(a.user.id)).length, 1);
    const b = await signUp();
    await newClient(b.token, { name: 'Stale', followUpAt: '2040-06-01' });
    assert.equal((await runReminderSweep(at('2040-06-20T04:00:00Z'))).followUpReminders, 0, 'nothing for a date weeks ago');
  });

  test('a catch-up after downtime still sends it; archived brands and cleared follow-ups send nothing', async () => {
    const { a, id } = await setup();
    assert.equal((await runReminderSweep(at('2040-06-20T12:00:00Z'))).followUpReminders, 1); // hours late
    await clients.patch(a.token, id, { followUpAt: '2040-06-25' });
    const archived = await newClient(a.token, { name: 'Gone', followUpAt: '2040-06-25' });
    await clients.archive(a.token, archived);
    const cleared = await newClient(a.token, { name: 'Cleared', followUpAt: '2040-06-25' });
    await clients.patch(a.token, cleared, { followUpAt: null });
    const stats = await runReminderSweep(at('2040-06-25T12:00:00Z'));
    assert.equal(stats.followUpReminders, 1, 'only the rescheduled brand');
    const titles = (await notes(a.user.id)).map((n) => n.localDate).sort();
    assert.deepEqual(titles, ['2040-06-20', '2040-06-25'], 'moving the date re-arms the reminder');
  });

  test('uses a default message when there is no note, and notices belong to the right user only', async () => {
    const { a } = await setup('UTC', { followUpNote: undefined });
    const b = await signUp();
    await runReminderSweep(at('2040-06-20T08:00:00Z'));
    assert.match((await notes(a.user.id))[0].body, /follow up with this brand today/i);
    assert.equal((await notifs.list(b.token)).body.data.length, 0);
    const mine = (await notifs.list(a.token)).body.data[0];
    assert.deepEqual([mine.type, mine.entity.kind], ['followup_reminder', 'client']);
  });

  test('the follow-up date does not clutter the calendar or other modules (it is a brand-level reminder)', async () => {
    const { a } = await setup();
    const res = await cal.range(a.token, 'from=2040-06-01&to=2040-06-30');
    assert.deepEqual([res.body.posts, res.body.deadlines], [[], []]);
  });
});

describe('access control and isolation', () => {
  test('every brand and discussion route answers 401 without a valid token', async () => {
    const routes = [
      ['get', '/clients'], ['post', '/clients'], ['get', '/clients/meta'], ['get', `/clients/${GHOST}`], ['patch', `/clients/${GHOST}`], ['delete', `/clients/${GHOST}`],
      ['post', `/clients/${GHOST}/archive`], ['post', `/clients/${GHOST}/restore`], ['get', `/clients/${GHOST}/campaigns`], ['get', `/clients/${GHOST}/invoices`],
      ['get', `/clients/${GHOST}/communications`], ['post', `/clients/${GHOST}/communications`],
      ['get', `/communications/${GHOST}`], ['patch', `/communications/${GHOST}`], ['delete', `/communications/${GHOST}`],
    ];
    for (const [method, path] of routes) {
      for (const headers of [{}, { Authorization: 'Bearer garbage' }]) {
        const res = await request(app)[method](`/api/v1${path}`).set(headers).send({});
        assert.equal(res.status, 401, `${method.toUpperCase()} ${path} ${JSON.stringify(headers)}`);
      }
    }
  });

  async function setup() {
    const a = await signUp();
    const b = await signUp();
    const id = await newClient(a.token, { name: 'ALPHA Secret Brand', contacts: [{ name: 'Alpha Contact', email: 'alpha@secret.com' }], collaborationNotes: 'ALPHA private notes' });
    const d = (await discussions.create(a.token, id, { subject: 'ALPHA private thread' })).body.data;
    await mkCampaign(a.user.id, id, 'ALPHA campaign', 'in_progress', fee(100, 'INR'));
    await mkInvoice(a.user.id, id, 'INR', 100, 'sent', new Date());
    return { a, b, id, d };
  }

  test('B gets 404 (not 403) for every action against A\'s brand and discussions, and nothing changes', async () => {
    const { a, b, id, d } = await setup();
    const before = await Client.findById(id).lean();
    const attempts = {
      get: await clients.get(b.token, id),
      patch: await clients.patch(b.token, id, { name: 'Hacked' }),
      archive: await clients.archive(b.token, id),
      restore: await clients.restore(b.token, id),
      remove: await clients.remove(b.token, id),
      campaigns: await clients.campaigns(b.token, id),
      invoices: await clients.invoices(b.token, id),
      listDiscussions: await discussions.list(b.token, id),
      createDiscussion: await discussions.create(b.token, id, { subject: 'sneaky' }),
      getDiscussion: await discussions.get(b.token, d.id),
      patchDiscussion: await discussions.patch(b.token, d.id, { subject: 'Hacked' }),
      deleteDiscussion: await discussions.remove(b.token, d.id),
    };
    for (const [name, res] of Object.entries(attempts)) {
      assert.equal(res.status, 404, name);
      assert.ok(!JSON.stringify(res.body).includes('ALPHA'), `${name} must not leak`);
    }
    assert.deepEqual(attempts.get.body, (await clients.get(b.token, GHOST)).body, 'a foreign id looks like a missing one');
    assert.deepEqual(await Client.findById(id).lean(), before);
    assert.equal(await Communication.countDocuments({ client: id }), 1);
    assert.equal((await discussions.get(a.token, d.id)).body.data.subject, 'ALPHA private thread');
  });

  test('B cannot find A\'s brands through search, filters, sorting, meta, or the dashboard', async () => {
    const { a, b } = await setup();
    await newClient(b.token, { name: 'BRAVO' });
    for (const q of ['', 'q=ALPHA', 'q=alpha@secret.com', 'q=private', 'status=lead', 'sort=-lastContact', 'sort=followUpAt', 'limit=100', 'archived=true']) {
      const res = await clients.list(b.token, q);
      assert.equal(res.status, 200, q);
      assert.ok(res.body.data.every((c) => c.name === 'BRAVO'), q);
    }
    assert.ok(!JSON.stringify((await clients.meta(b.token)).body).includes('ALPHA'));
    const dash = await request(app).get('/api/v1/dashboard').set(bearer(b.token));
    assert.ok(!JSON.stringify(dash.body).includes('ALPHA'));
    assert.equal((await clients.list(a.token)).body.meta.total, 1);
  });

  test('B cannot attach A\'s campaigns or contacts, or create brands owned by A', async () => {
    const { a, b, id } = await setup();
    const aClient = (await clients.get(a.token, id)).body.data;
    const bBrand = await newClient(b.token, { name: 'Bravo Brand' });
    const aCampaign = (await clients.campaigns(a.token, id)).body.data[0].id;
    assert.equal((await discussions.create(b.token, bBrand, { campaign: aCampaign })).status, 400);
    assert.equal((await discussions.create(b.token, bBrand, { contactId: aClient.contacts[0].id })).status, 400);
    assert.equal((await clients.create(b.token, { name: 'Mine', owner: a.user.id })).status, 400);
    assert.equal(await Client.countDocuments({ owner: a.user.id }), 1);
  });

  test('the same brand name may exist for two users without either seeing the other', async () => {
    const a = await signUp();
    const b = await signUp();
    const aId = await newClient(a.token, { name: 'Shared Name', collaborationNotes: 'a-notes' });
    const bId = await newClient(b.token, { name: 'Shared Name', collaborationNotes: 'b-notes' });
    assert.notEqual(aId, bId);
    assert.equal((await clients.get(a.token, aId)).body.data.collaborationNotes, 'a-notes');
    assert.equal((await clients.get(b.token, aId)).status, 404);
  });

  test('a logged-out session loses access immediately', async () => {
    const a = await signUp();
    const id = await newClient(a.token);
    await a.agent.post('/api/v1/auth/logout').set({ 'X-Requested-With': 'cms' });
    assert.equal((await clients.get(a.token, id)).status, 401);
    assert.equal((await clients.list(a.token)).status, 401);
  });
});
