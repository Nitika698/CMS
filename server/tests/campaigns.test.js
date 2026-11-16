import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { signUp, useDatabase } from './helpers/app.js';
import { camps, day, deliverableAt, deliverables, newCampaign } from './helpers/campaigns.js';
import { discussions, mkInvoice, mkPayment, newClient } from './helpers/clients.js';
import { api as contentApi, contentAt } from './helpers/content.js';
import { setTimezone } from './helpers/calendar.js';
import { Campaign } from '../src/modules/campaigns/campaign.model.js';
import { Deliverable } from '../src/modules/campaigns/deliverable.model.js';
import { Content } from '../src/modules/content/content.model.js';
import { Task } from '../src/modules/tasks/task.model.js';
import { Communication } from '../src/modules/communications/communication.model.js';

useDatabase();

const GHOST = '507f1f77bcf86cd799439011';
const codes = (body) => (body.flags ?? body.data?.flags ?? []).map((f) => f.code);
const get = async (token, id) => (await camps.get(token, id)).body.data;

describe('creating and editing campaigns', () => {
  test('creates a campaign for a brand with every planning field; it starts as Proposed', async () => {
    const a = await signUp();
    const client = await newClient(a.token, { name: 'Acme' });
    const res = await camps.create(a.token, {
      client,
      title: 'Summer launch',
      brief: 'Show the new range',
      objectives: ['Awareness', 'Sales'],
      startDate: day(1), endDate: day(30), deadline: day(20),
      budget: { amountMinor: 500_000, currency: 'inr' },
      fee: { amountMinor: 300_000, currency: 'INR' },
      requirements: [{ platform: 'instagram', format: 'reel', quantity: 3 }, { platform: 'instagram', format: 'story', quantity: 5 }],
      review: { required: true, approverName: 'Priya', notes: 'Two rounds of changes' },
    });
    assert.equal(res.status, 201);
    const c = res.body.data;
    assert.equal(c.status, 'proposed');
    assert.equal(c.client.name, 'Acme');
    assert.deepEqual(c.objectives, ['Awareness', 'Sales']);
    assert.deepEqual(c.budget, { amountMinor: 500_000, currency: 'INR' });
    assert.deepEqual(c.local, { startDate: day(1), endDate: day(30), deadline: day(20) });
    assert.equal(c.requirements.length, 2);
    assert.deepEqual(c.review, { required: true, approverName: 'Priya', notes: 'Two rounds of changes' });
    assert.equal(c.statusHistory.length, 1);
    assert.equal(c.progress.total, 0);
  });

  test('requires a brand and a name, and refuses fields that are not the client’s to set', async () => {
    const a = await signUp();
    const client = await newClient(a.token);
    assert.equal((await camps.create(a.token, { client, title: '' })).status, 400);
    assert.equal((await camps.create(a.token, { title: 'No brand' })).status, 400);
    const other = await signUp();
    for (const extra of [{ owner: other.user.id }, { status: 'completed' }, { archivedAt: new Date().toISOString() }, { progress: 100 }, { statusHistory: [] }, { _id: GHOST }]) {
      assert.equal((await camps.create(a.token, { client, ...extra })).status, 400, JSON.stringify(extra));
    }
    assert.equal(await Campaign.countDocuments(), 0);
  });

  test('rejects impossible dates, end before start, deadline before start and mismatched currencies', async () => {
    const a = await signUp();
    const client = await newClient(a.token);
    const bad = [
      { startDate: '2026-02-30' },
      { startDate: 'tomorrow' },
      { startDate: day(10), endDate: day(5) },
      { startDate: day(10), deadline: day(5) },
      { fee: { amountMinor: 1.5, currency: 'INR' } },
      { fee: { amountMinor: 100, currency: 'RUPEES' } },
      { fee: { amountMinor: 100, currency: 'INR' }, budget: { amountMinor: 200, currency: 'USD' } },
      { requirements: [{ platform: 'myspace', format: 'reel', quantity: 1 }] },
      { requirements: [{ platform: 'instagram', format: 'reel', quantity: 0 }] },
      { requirements: [{ platform: 'instagram', format: 'reel', quantity: 1 }, { platform: 'instagram', format: 'reel', quantity: 2 }] },
    ];
    for (const body of bad) assert.equal((await camps.create(a.token, { client, ...body })).status, 400, JSON.stringify(body));
  });

  test('edits fields, clears optional ones and rejects a stale version', async () => {
    const a = await signUp();
    const { id, body } = await newCampaign(a.token, { fee: { amountMinor: 100, currency: 'INR' }, deadline: day(5) });
    const edited = await camps.patch(a.token, id, { title: 'Renamed', fee: null, deadline: null, brief: 'New brief', version: body.version });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.title, 'Renamed');
    assert.equal(edited.body.data.fee, null);
    assert.equal(edited.body.data.deadline, null);
    const stale = await camps.patch(a.token, id, { title: 'Late edit', version: body.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_VERSION');
    assert.equal((await camps.patch(a.token, id, {})).status, 400);
    assert.equal((await camps.patch(a.token, id, { status: 'completed' })).status, 400); // status only moves through transitions
  });

  test('an edit that would put the end date before the start date is refused', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token, { startDate: day(1), endDate: day(10) });
    assert.equal((await camps.patch(a.token, id, { endDate: day(0) })).status, 400);
    assert.equal((await get(a.token, id)).local.endDate, day(10));
  });
});

describe('archiving and deleting', () => {
  test('archive hides a campaign from the default list, blocks edits, and restore brings it back', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    const arch = await camps.archive(a.token, id);
    assert.equal(arch.status, 200);
    assert.equal(arch.body.data.archived, true);
    assert.equal((await camps.list(a.token)).body.data.length, 0);
    assert.equal((await camps.list(a.token, 'archived=true')).body.data.length, 1);
    assert.equal((await camps.patch(a.token, id, { title: 'x' })).status, 409);
    assert.equal((await camps.move(a.token, id, 'negotiating')).status, 409);
    assert.equal((await deliverables.create(a.token, id)).status, 409);
    assert.equal((await camps.lookup(a.token)).body.data.length, 0);
    assert.equal((await camps.restore(a.token, id)).body.data.archived, false);
    assert.equal((await camps.list(a.token)).body.data.length, 1);
  });

  test('archiving warns about unfinished deliverables but still archives', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    await deliverables.create(a.token, id);
    const res = await camps.archive(a.token, id);
    assert.equal(res.body.warnings[0].code, 'OPEN_DELIVERABLES');
    assert.equal(res.body.data.archived, true);
  });

  test('permanent deletion needs archiving first, is blocked by invoices, and detaches linked records', async () => {
    const a = await signUp();
    const { id, client } = await newCampaign(a.token);
    assert.equal((await camps.remove(a.token, id)).status, 409);
    const contentId = (await contentApi.create(a.token, { title: 'Linked' })).body.data.id;
    assert.equal((await camps.linkContent(a.token, id, contentId)).status, 200);
    await discussions.create(a.token, client, { campaign: id });
    await Task.create({ owner: a.user.id, title: 'Shoot', links: { campaign: id } });
    await deliverables.create(a.token, id);
    const inv = await mkInvoice(a.user.id, client, 'INR', 1000, 'sent', new Date(), { campaign: id });

    await camps.archive(a.token, id);
    const blocked = await camps.remove(a.token, id);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'HAS_RELATED');
    await inv.deleteOne();

    const done = await camps.remove(a.token, id);
    assert.equal(done.status, 200);
    assert.equal(done.body.deliverablesDeleted, 1);
    assert.equal(await Campaign.countDocuments(), 0);
    assert.equal(await Deliverable.countDocuments(), 0);
    assert.equal((await Content.findById(contentId)).campaign, null); // the content survives
    assert.equal((await Task.findOne({ owner: a.user.id })).links.campaign, null);
    assert.equal((await Communication.findOne({ owner: a.user.id })).campaign, null);
  });
});

describe('filtering, searching and sorting', () => {
  async function seed() {
    const a = await signUp();
    const acme = await newClient(a.token, { name: 'Acme' });
    const zed = await newClient(a.token, { name: 'Zed' });
    const mk = (title, extra) => newCampaign(a.token, { title, ...extra }).then((c) => c.id);
    const ids = {
      soon: await mk('Soon', { client: acme, deadline: day(3), brief: 'sneakers launch' }),
      later: await mk('Later', { client: acme, deadline: day(40) }),
      past: await mk('Past', { client: zed, deadline: day(-4) }),
      none: await mk('Undated', { client: zed, objectives: ['Grow newsletter'] }),
    };
    await camps.move(a.token, ids.soon, 'confirmed');
    await camps.move(a.token, ids.past, 'confirmed');
    await camps.move(a.token, ids.later, 'confirmed');
    return { a, acme, zed, ids };
  }
  const titles = (res) => res.body.data.map((c) => c.title);

  test('by status, brand and free text (brief, objectives, name)', async () => {
    const { a, acme, zed } = await seed();
    assert.deepEqual(titles(await camps.list(a.token, 'status=confirmed&sort=title')), ['Later', 'Past', 'Soon']);
    assert.deepEqual(titles(await camps.list(a.token, 'status=proposed')), ['Undated']);
    assert.deepEqual(titles(await camps.list(a.token, `client=${acme}&sort=title`)), ['Later', 'Soon']);
    assert.deepEqual(titles(await camps.list(a.token, `client=${zed}&sort=title`)), ['Past', 'Undated']);
    assert.deepEqual(titles(await camps.list(a.token, 'q=sneakers')), ['Soon']);
    assert.deepEqual(titles(await camps.list(a.token, 'q=newsletter')), ['Undated']);
    assert.deepEqual(titles(await camps.list(a.token, 'q=.*')), []); // text is never treated as a regular expression
    assert.equal((await camps.list(a.token, 'status=bogus')).status, 400);
  });

  test('by deadline range and by what needs attention', async () => {
    const { a } = await seed();
    assert.deepEqual(titles(await camps.list(a.token, `deadlineFrom=${day(0)}&deadlineTo=${day(3)}`)), ['Soon']); // the end day is included
    assert.deepEqual(titles(await camps.list(a.token, 'attention=deadline_soon')), ['Soon']);
    assert.deepEqual(titles(await camps.list(a.token, 'attention=overdue')), ['Past']);
    assert.deepEqual(titles(await camps.list(a.token, 'attention=any&sort=title')), ['Past', 'Soon']);
    assert.equal((await camps.list(a.token, 'attention=any')).body.meta.needAttention, 2);
  });

  test('sorts by deadline (undated last, both directions), and paginates', async () => {
    const { a } = await seed();
    assert.deepEqual(titles(await camps.list(a.token)), ['Past', 'Soon', 'Later', 'Undated']);
    assert.deepEqual(titles(await camps.list(a.token, 'sort=-deadline')), ['Later', 'Soon', 'Past', 'Undated']);
    const page2 = await camps.list(a.token, 'limit=3&page=2');
    assert.deepEqual(titles(page2), ['Undated']);
    assert.deepEqual([page2.body.meta.total, page2.body.meta.pages], [4, 2]);
  });

  test('list rows are summaries with progress and warnings; other users’ campaigns never appear', async () => {
    const { a, ids } = await seed();
    const b = await signUp();
    await newCampaign(b.token, { title: 'Not yours' });
    await deliverableAt(a.token, ids.soon, 'delivered');
    const res = await camps.list(a.token);
    const soon = res.body.data.find((c) => c.title === 'Soon');
    assert.equal(soon.progress.percent, 100);
    assert.ok(soon.flags.some((f) => f.code === 'deadline_soon'));
    assert.equal(soon.brief, undefined);
    assert.ok(!JSON.stringify(res.body).includes('Not yours'));
  });
});

describe('progress comes from the state of each deliverable', () => {
  test('there is no progress field to set, and an empty campaign is at 0%', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    const c = await get(a.token, id);
    assert.deepEqual([c.progress.total, c.progress.percent], [0, 0]);
    assert.equal((await camps.patch(a.token, id, { progress: 80 })).status, 400);
    assert.equal((await camps.patch(a.token, id, { progressPercent: 80 })).status, 400);
  });

  test('planned, completed, approved and published deliverables are told apart, and percent follows them', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    await deliverableAt(a.token, id, 'pending', { title: 'Planned' });
    await deliverableAt(a.token, id, 'in_progress', { title: 'Shooting' });
    await deliverableAt(a.token, id, 'submitted', { title: 'With the brand' });
    await deliverableAt(a.token, id, 'approved', { title: 'Signed off' });
    await deliverableAt(a.token, id, 'delivered', { title: 'Live' });

    const { progress } = await get(a.token, id);
    assert.equal(progress.total, 5);
    assert.deepEqual(progress.stages, { planned: 2, completed: 1, approved: 1, published: 1 });
    assert.equal(progress.counts.submitted, 1);
    // pending 0 + in progress 20 + submitted 65 + approved 85 + published 100 = 270 / 5
    assert.equal(progress.percent, 54);
  });

  test('moving a deliverable changes the percent; deleting one recomputes; 100% only when everything is published', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    const d1 = await deliverableAt(a.token, id, 'pending', { title: 'One' });
    const d2 = await deliverableAt(a.token, id, 'delivered', { title: 'Two' });
    assert.equal((await get(a.token, id)).progress.percent, 50);
    await deliverables.move(a.token, id, d1, 'completed');
    assert.equal((await get(a.token, id)).progress.percent, 75);
    await deliverables.remove(a.token, id, d2);
    assert.equal((await get(a.token, id)).progress.percent, 50);
    for (const to of ['submitted', 'approved', 'delivered']) await deliverables.move(a.token, id, d1, to);
    assert.equal((await get(a.token, id)).progress.percent, 100);
  });

  test('work that needs no approval goes straight from completed to published', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token, { review: { required: false } });
    const created = await deliverables.create(a.token, id);
    assert.equal(created.body.data[0].requiresApproval, false); // inherits the campaign’s review rule
    const did = created.body.data[0].id;
    await deliverables.move(a.token, id, did, 'completed');
    assert.equal((await deliverables.move(a.token, id, did, 'submitted')).status, 409);
    assert.equal((await deliverables.move(a.token, id, did, 'delivered')).status, 200);
  });

  test('requested quantities are compared with the deliverables actually planned and published', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token, { requirements: [{ platform: 'instagram', format: 'reel', quantity: 3 }, { platform: 'youtube', format: 'video', quantity: 1 }] });
    await deliverableAt(a.token, id, 'delivered', { platform: 'instagram', format: 'reel' });
    await deliverableAt(a.token, id, 'pending', { platform: 'instagram', format: 'reel' });
    const { coverage } = await get(a.token, id);
    const reels = coverage.find((c) => c.platform === 'instagram');
    assert.deepEqual([reels.quantity, reels.planned, reels.published, reels.missing], [3, 2, 1, 1]);
    assert.equal(coverage.find((c) => c.platform === 'youtube').missing, 1);
  });

  test('a quantity creates that many individually tracked deliverables', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    const res = await deliverables.create(a.token, id, { title: 'Story', quantity: 3, platform: 'instagram', format: 'story', dueDate: day(9) });
    assert.deepEqual(res.body.data.map((d) => d.title), ['Story (1/3)', 'Story (2/3)', 'Story (3/3)']);
    await deliverables.move(a.token, id, res.body.data[0].id, 'completed');
    const c = await get(a.token, id);
    assert.equal(c.progress.total, 3);
    assert.equal(c.progress.stages.completed, 1);
    assert.equal((await deliverables.create(a.token, id, { title: 'Too many', quantity: 51 })).status, 400);
  });
});

describe('deliverable status rules', () => {
  test('follows the approval path and refuses shortcuts', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    const did = (await deliverables.create(a.token, id)).body.data[0].id;
    for (const to of ['approved', 'delivered', 'submitted', 'changes_requested']) {
      const r = await deliverables.move(a.token, id, did, to, { note: 'x' });
      assert.equal(r.status, 409, to);
      assert.equal(r.body.error.code, 'INVALID_TRANSITION');
    }
    await deliverables.move(a.token, id, did, 'completed');
    assert.equal((await deliverables.move(a.token, id, did, 'delivered')).status, 409); // approval required first
    const submitted = (await deliverables.move(a.token, id, did, 'submitted')).body.data;
    assert.ok(submitted.submittedAt);
    assert.ok(submitted.flags.some((f) => f.code === 'awaiting_approval'));
  });

  test('changes requested needs a note, counts a revision, and sending it back clears later stamps', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    const did = await deliverableAt(a.token, id, 'submitted');
    assert.equal((await deliverables.move(a.token, id, did, 'changes_requested')).status, 400);
    const back = (await deliverables.move(a.token, id, did, 'changes_requested', { note: 'Logo bigger' })).body.data;
    assert.equal(back.revisionCount, 1);
    assert.equal(back.feedback, 'Logo bigger');
    assert.equal(back.submittedAt, null);
    assert.ok(back.flags.some((f) => f.code === 'changes_requested'));
    await deliverables.move(a.token, id, did, 'in_progress');
    await deliverables.move(a.token, id, did, 'completed');
    await deliverables.move(a.token, id, did, 'submitted');
    const ok = (await deliverables.move(a.token, id, did, 'approved')).body.data;
    assert.ok(ok.approvedAt);
    assert.equal(ok.feedback, null);
  });

  test('published is final, and approval rules cannot be flipped once submitted', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    const done = await deliverableAt(a.token, id, 'delivered');
    assert.equal((await deliverables.move(a.token, id, done, 'approved')).status, 409);
    const sent = await deliverableAt(a.token, id, 'submitted');
    assert.equal((await deliverables.patch(a.token, id, sent, { requiresApproval: false })).status, 409);
    assert.equal((await deliverables.patch(a.token, id, sent, { title: 'Renamed' })).status, 200);
  });

  test('a deliverable linked to content cannot be published before that content is', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token, { review: { required: false } });
    const contentId = (await contentApi.create(a.token, { title: 'Reel cut' })).body.data.id;
    const did = (await deliverables.create(a.token, id, { content: contentId })).body.data[0].id;
    await deliverables.move(a.token, id, did, 'completed');
    const early = await deliverables.move(a.token, id, did, 'delivered');
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'CONTENT_NOT_PUBLISHED');
    await Content.updateOne({ _id: contentId }, { status: 'published', publishedAt: new Date() });
    assert.equal((await deliverables.move(a.token, id, did, 'delivered')).status, 200);
  });

  test('closed campaigns do not accept deliverable changes until re-opened', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    const did = await deliverableAt(a.token, id, 'pending');
    await camps.move(a.token, id, 'cancelled');
    assert.equal((await deliverables.create(a.token, id)).body.error.code, 'CAMPAIGN_CLOSED');
    assert.equal((await deliverables.move(a.token, id, did, 'in_progress')).status, 409);
    assert.equal((await deliverables.remove(a.token, id, did)).status, 409);
  });
});

describe('relationships and ownership', () => {
  test('a campaign can only be created for the user’s own brand; a stranger’s brand and a missing one look identical', async () => {
    const a = await signUp();
    const b = await signUp();
    const theirs = await newClient(b.token, { name: 'Secret brand' });
    const foreign = await camps.create(a.token, { client: theirs });
    const missing = await camps.create(a.token, { client: GHOST });
    assert.equal(foreign.status, 400);
    assert.deepEqual(foreign.body, missing.body);
    assert.equal((await camps.create(a.token, { client: 'not-an-id' })).status, 400);
    assert.equal(await Campaign.countDocuments(), 0);
  });

  test('an archived brand cannot receive new campaigns', async () => {
    const a = await signUp();
    const client = await newClient(a.token);
    const { clients } = await import('./helpers/clients.js');
    await clients.archive(a.token, client);
    const res = await camps.create(a.token, { client });
    assert.equal(res.status, 400);
    assert.match(res.body.error.details[0].message, /archived/i);
  });

  test('moving a campaign to another brand validates the brand and is blocked once discussions or invoices exist', async () => {
    const a = await signUp();
    const b = await signUp();
    const { id, client } = await newCampaign(a.token);
    const other = await newClient(a.token, { name: 'Other' });
    assert.equal((await camps.patch(a.token, id, { client: await newClient(b.token) })).status, 400);
    assert.equal((await camps.patch(a.token, id, { client: other })).body.data.client.id, other);
    await camps.patch(a.token, id, { client });
    await discussions.create(a.token, client, { campaign: id });
    const blocked = await camps.patch(a.token, id, { client: other });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'HAS_RELATED');
  });

  test('another user’s campaign is a 404 on every route and nothing changes', async () => {
    const a = await signUp();
    const b = await signUp();
    const { id } = await newCampaign(a.token);
    const did = await deliverableAt(a.token, id, 'pending');
    const contentId = (await contentApi.create(b.token, { title: 'Mine' })).body.data.id;
    const attempts = [
      camps.get(b.token, id), camps.patch(b.token, id, { title: 'Hacked' }), camps.move(b.token, id, 'confirmed'),
      camps.archive(b.token, id), camps.restore(b.token, id), camps.remove(b.token, id),
      camps.linkContent(b.token, id, contentId), camps.unlinkContent(b.token, id, contentId),
      deliverables.create(b.token, id), deliverables.patch(b.token, id, did, { title: 'Hacked' }),
      deliverables.move(b.token, id, did, 'in_progress'), deliverables.remove(b.token, id, did),
    ];
    for (const res of await Promise.all(attempts)) assert.equal(res.status, 404);
    const c = await get(a.token, id);
    assert.equal(c.title, 'Summer launch');
    assert.equal(c.deliverables[0].status, 'pending');
    assert.equal((await Content.findById(contentId)).campaign, null);
  });

  test('a deliverable of one campaign cannot be reached through another campaign’s URL', async () => {
    const a = await signUp();
    const one = await newCampaign(a.token);
    const two = await newCampaign(a.token);
    const did = await deliverableAt(a.token, one.id, 'pending');
    assert.equal((await deliverables.patch(a.token, two.id, did, { title: 'x' })).status, 404);
    assert.equal((await deliverables.remove(a.token, two.id, did)).status, 404);
  });

  test('content must be the user’s own: foreign and missing content are indistinguishable, on both link routes', async () => {
    const a = await signUp();
    const b = await signUp();
    const { id } = await newCampaign(a.token);
    const theirs = (await contentApi.create(b.token, { title: 'Theirs' })).body.data.id;
    const viaCampaign = await camps.linkContent(a.token, id, theirs);
    const missing = await camps.linkContent(a.token, id, GHOST);
    assert.equal(viaCampaign.status, 400);
    assert.deepEqual(viaCampaign.body, missing.body);
    const viaDeliverable = await deliverables.create(a.token, id, { content: theirs });
    assert.equal(viaDeliverable.status, 400);
    const did = (await deliverables.create(a.token, id)).body.data[0].id;
    assert.equal((await deliverables.patch(a.token, id, did, { content: theirs })).status, 400);
    assert.equal((await Content.findById(theirs)).campaign, null);
    assert.equal(await Deliverable.countDocuments({ content: theirs }), 0);
  });

  test('content that belongs to another campaign or deliverable cannot be taken, and archived content cannot be linked', async () => {
    const a = await signUp();
    const one = await newCampaign(a.token);
    const two = await newCampaign(a.token);
    const contentId = (await contentApi.create(a.token, { title: 'Shared?' })).body.data.id;
    await camps.linkContent(a.token, one.id, contentId);
    assert.equal((await camps.linkContent(a.token, two.id, contentId)).status, 400);
    assert.equal((await deliverables.create(a.token, two.id, { content: contentId })).status, 400);

    const did = (await deliverables.create(a.token, one.id, { content: contentId })).body.data[0].id;
    const second = (await deliverables.create(a.token, one.id)).body.data[0].id;
    assert.equal((await deliverables.patch(a.token, one.id, second, { content: contentId })).status, 409);
    assert.equal((await camps.unlinkContent(a.token, one.id, contentId)).status, 409); // still attached to a deliverable
    await deliverables.patch(a.token, one.id, did, { content: null });
    assert.equal((await camps.unlinkContent(a.token, one.id, contentId)).status, 200);

    const archived = (await contentApi.create(a.token, { title: 'Old' })).body.data.id;
    await contentApi.archive(a.token, archived);
    assert.equal((await camps.linkContent(a.token, one.id, archived)).status, 400);
  });

  test('attaching content to a deliverable also links it to the campaign, and the content API keeps that link safe', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    const other = await newCampaign(a.token);
    const contentId = (await contentApi.create(a.token, { title: 'Reel' })).body.data.id;
    const did = (await deliverables.create(a.token, id, { content: contentId })).body.data[0].id;
    assert.equal((await Content.findById(contentId)).campaign.toString(), id);
    const c = await get(a.token, id);
    assert.deepEqual(c.linked.content.map((x) => x.id), [contentId]);
    assert.equal(c.deliverables[0].content.title, 'Reel');
    const history = (await contentApi.history(a.token, contentId)).body.data;
    assert.ok(history.some((e) => e.type === 'updated' && e.fields.some((f) => f.field === 'campaign')));

    const moved = await contentApi.patch(a.token, contentId, { campaign: other.id });
    assert.equal(moved.status, 409);
    assert.equal(moved.body.error.code, 'CONTENT_IN_USE');
    assert.equal((await Content.findById(contentId)).campaign.toString(), id);

    await contentApi.archive(a.token, contentId);
    await contentApi.remove(a.token, contentId);
    assert.equal((await Deliverable.findById(did)).content, null); // deleting content never leaves a dangling reference
  });

  test('the detail page gathers content, tasks, discussions and invoices of THIS user and THIS campaign only', async () => {
    const a = await signUp();
    const b = await signUp();
    const { id, client } = await newCampaign(a.token);
    const sibling = await newCampaign(a.token, { client });
    const content = await contentAt(a.token, 'planning', { title: 'Linked post' });
    await camps.linkContent(a.token, id, content);
    await Task.create([
      { owner: a.user.id, title: 'Open task', status: 'todo', dueAt: new Date(Date.now() - 86_400_000), links: { campaign: id } },
      { owner: a.user.id, title: 'Done task', status: 'done', links: { campaign: id } },
      { owner: a.user.id, title: 'Other campaign task', links: { campaign: sibling.id } },
      { owner: b.user.id, title: 'Stranger task pointing here', links: { campaign: id } },
    ]);
    await discussions.create(a.token, client, { campaign: id, subject: 'Kick-off' });
    await discussions.create(a.token, client, { campaign: sibling.id, subject: 'Elsewhere' });
    const invoice = await mkInvoice(a.user.id, client, 'INR', 10_000, 'sent', new Date(Date.now() + 86_400_000), { campaign: id });
    await mkPayment(a.user.id, invoice, 4_000);
    await mkInvoice(a.user.id, client, 'INR', 99_000, 'sent', new Date(), { campaign: sibling.id });
    await mkInvoice(b.user.id, await newClient(b.token), 'INR', 77_000, 'sent', new Date(), { campaign: id });

    const c = await get(a.token, id);
    assert.deepEqual(c.linked.content.map((x) => x.title), ['Linked post']);
    assert.deepEqual(c.linked.tasks.map((t) => t.title).sort(), ['Done task', 'Open task']);
    assert.equal(c.linked.tasks.find((t) => t.title === 'Open task').overdue, true);
    assert.deepEqual(c.linked.communications.map((x) => x.subject), ['Kick-off']);
    assert.equal(c.linked.invoices.length, 1);
    assert.deepEqual([c.linked.invoices[0].paidMinor, c.linked.invoices[0].balanceMinor, c.linked.invoices[0].displayStatus], [4_000, 6_000, 'partially_paid']);
    assert.deepEqual(c.linked.invoiceTotals, [{ currency: 'INR', invoiced: 10_000, collected: 4_000, outstanding: 6_000, overdue: 0 }]);
    assert.equal(c.counts.openTasks, 1);
    assert.ok(!JSON.stringify(c).includes('Stranger'));
  });

  test('the brand page and the content picker see the new campaigns', async () => {
    const a = await signUp();
    const { id, client } = await newCampaign(a.token, { title: 'Picker me' });
    const { clients } = await import('./helpers/clients.js');
    assert.equal((await clients.campaigns(a.token, client)).body.data[0].title, 'Picker me');
    assert.deepEqual((await camps.lookup(a.token)).body.data, [{ id, title: 'Picker me', status: 'proposed', clientName: (await clients.get(a.token, client)).body.data.name }]);
    const content = (await contentApi.create(a.token, { title: 'x', campaign: id })).body.data;
    assert.equal(content.campaign.id, id);
    const b = await signUp();
    assert.equal((await contentApi.create(b.token, { title: 'x', campaign: id })).status, 400);
  });
});

describe('deadlines and warnings', () => {
  test('flags a deadline that is approaching, today, or passed', async () => {
    const a = await signUp();
    const soon = await newCampaign(a.token, { deadline: day(3) });
    const today = await newCampaign(a.token, { deadline: day(0) });
    const late = await newCampaign(a.token, { deadline: day(-2) });
    const far = await newCampaign(a.token, { deadline: day(30) });
    const f = async (c) => (await get(a.token, c.id)).flags;
    assert.deepEqual((await f(soon)).map((x) => [x.code, x.severity, x.message]), [['deadline_soon', 'warning', 'Deadline in 3 days']]);
    assert.equal((await f(today))[0].message, 'Deadline is today');
    assert.deepEqual((await f(late)).map((x) => [x.code, x.severity, x.message]), [['deadline_overdue', 'danger', 'Deadline passed 2 days ago']]);
    assert.deepEqual(await f(far), []);
  });

  test('“today” is the user’s own calendar day', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'Pacific/Kiritimati'); // UTC+14: its date is ahead of UTC for most of the day
    const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
    const { id } = await newCampaign(a.token, { deadline: localToday });
    const c = await get(a.token, id);
    assert.equal(c.local.deadline, localToday);
    assert.equal(c.flags[0].message, 'Deadline is today');
  });

  test('delivered, completed, cancelled and archived campaigns raise no deadline warnings', async () => {
    const a = await signUp();
    for (const to of [['confirmed', 'in_progress', 'delivered'], ['confirmed', 'in_progress', 'delivered', 'completed'], ['cancelled']]) {
      const { id } = await newCampaign(a.token, { deadline: day(-5) });
      for (const s of to) assert.equal((await camps.move(a.token, id, s)).status, 200, s);
      assert.deepEqual((await get(a.token, id)).flags, [], to.at(-1));
    }
    const { id } = await newCampaign(a.token, { deadline: day(-5) });
    await camps.archive(a.token, id);
    assert.deepEqual((await get(a.token, id)).flags, []);
  });

  test('flags overdue and soon-due deliverables, and ones due after the campaign deadline', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token, { deadline: day(20) });
    await camps.move(a.token, id, 'confirmed');
    await deliverableAt(a.token, id, 'in_progress', { title: 'Late one', dueDate: day(-1) });
    await deliverableAt(a.token, id, 'pending', { title: 'Soon one', dueDate: day(2) });
    await deliverableAt(a.token, id, 'pending', { title: 'Too late', dueDate: day(25) });
    await deliverableAt(a.token, id, 'delivered', { title: 'Done long ago', dueDate: day(-10) });
    const c = await get(a.token, id);
    const byTitle = Object.fromEntries(c.deliverables.map((d) => [d.title, d.flags.map((f) => f.code)]));
    assert.deepEqual(byTitle['Late one'], ['overdue']);
    assert.deepEqual(byTitle['Soon one'], ['due_soon']);
    assert.deepEqual(byTitle['Too late'], ['after_campaign_deadline']);
    assert.deepEqual(byTitle['Done long ago'], []); // finished work is never "overdue"
    assert.deepEqual(codes(c).sort(), ['deliverables_due_soon', 'deliverables_overdue']);
  });

  test('flags incomplete deliverables when the deadline is near, but not when it is far away', async () => {
    const a = await signUp();
    const near = await newCampaign(a.token, { deadline: day(2) });
    const far = await newCampaign(a.token, { deadline: day(60) });
    for (const c of [near, far]) {
      await camps.move(a.token, c.id, 'confirmed');
      await deliverableAt(a.token, c.id, 'in_progress');
    }
    assert.ok(codes(await get(a.token, near.id)).includes('incomplete_deliverables'));
    assert.ok(!codes(await get(a.token, far.id)).includes('incomplete_deliverables'));
    // finishing the work clears it
    const did = (await get(a.token, near.id)).deliverables[0].id;
    for (const to of ['completed', 'submitted', 'approved', 'delivered']) await deliverables.move(a.token, near.id, did, to);
    assert.ok(!codes(await get(a.token, near.id)).includes('incomplete_deliverables'));
  });

  test('a confirmed campaign warns about requested content that has no deliverable yet; once planned, the warning goes', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token, { requirements: [{ platform: 'instagram', format: 'reel', quantity: 2 }] });
    assert.ok(!codes(await get(a.token, id)).includes('requirements_unplanned')); // still only a proposal
    await camps.move(a.token, id, 'confirmed');
    const flag = (await get(a.token, id)).flags.find((f) => f.code === 'requirements_unplanned');
    assert.equal(flag.count, 2);
    await deliverables.create(a.token, id, { platform: 'instagram', format: 'reel', quantity: 2 });
    assert.ok(!codes(await get(a.token, id)).includes('requirements_unplanned'));
  });

  test('a campaign past its end date that is not delivered is flagged', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token, { startDate: day(-30), endDate: day(-1) });
    await camps.move(a.token, id, 'confirmed');
    assert.ok(codes(await get(a.token, id)).includes('past_end_date'));
  });
});

describe('status changes', () => {
  test('follows the workflow and records every change with its time and note', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    for (const to of ['negotiating', 'confirmed', 'in_progress', 'delivered', 'completed']) {
      const res = await camps.move(a.token, id, to, to === 'confirmed' ? { note: 'Contract signed' } : {});
      assert.equal(res.status, 200, to);
      assert.equal(res.body.data.status, to);
    }
    const history = (await get(a.token, id)).statusHistory;
    assert.deepEqual(history.map((h) => h.to), ['proposed', 'negotiating', 'confirmed', 'in_progress', 'delivered', 'completed']);
    assert.deepEqual(history[3].from, 'confirmed');
    assert.equal(history[2].note, 'Contract signed');
    assert.ok(history.every((h) => h.at));
  });

  test('refuses moves the workflow does not allow, and reports what is allowed', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    for (const to of ['in_progress', 'delivered', 'completed', 'proposed']) {
      const res = await camps.move(a.token, id, to);
      assert.equal(res.status, 409, to);
      assert.equal(res.body.error.code, 'INVALID_TRANSITION');
    }
    const res = await camps.move(a.token, id, 'completed');
    assert.deepEqual(res.body.error.details.allowed, ['negotiating', 'confirmed', 'cancelled']);
    assert.equal((await camps.move(a.token, id, 'bogus')).status, 400);
    assert.equal((await get(a.token, id)).status, 'proposed');
    assert.equal((await get(a.token, id)).statusHistory.length, 1);
  });

  test('cannot be marked delivered while deliverables are unfinished, nor completed until all are published', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    await camps.move(a.token, id, 'confirmed');
    await camps.move(a.token, id, 'in_progress');
    const d1 = await deliverableAt(a.token, id, 'in_progress', { title: 'Unfinished reel' });
    const blocked = await camps.move(a.token, id, 'delivered');
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'OPEN_DELIVERABLES');
    assert.match(blocked.body.error.details[0].message, /Unfinished reel/);

    for (const to of ['completed', 'submitted']) await deliverables.move(a.token, id, d1, to);
    assert.equal((await camps.move(a.token, id, 'delivered')).status, 200); // handed over, awaiting approval/publication
    const notYet = await camps.move(a.token, id, 'completed');
    assert.equal(notYet.status, 409);
    for (const to of ['approved', 'delivered']) await deliverables.move(a.token, id, d1, to);
    assert.equal((await camps.move(a.token, id, 'completed')).status, 200);
    assert.equal((await get(a.token, id)).progress.percent, 100);
  });

  test('delivered with unfinished work is flagged when a deliverable is added afterwards', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    for (const to of ['confirmed', 'in_progress', 'delivered']) await camps.move(a.token, id, to);
    await deliverables.create(a.token, id, { title: 'Forgotten extra' });
    assert.ok(codes(await get(a.token, id)).includes('incomplete_deliverables'));
  });

  test('can be cancelled and revived, completed work can be re-opened, and cancelled work cannot skip ahead', async () => {
    const a = await signUp();
    const { id } = await newCampaign(a.token);
    assert.equal((await camps.move(a.token, id, 'cancelled')).status, 200);
    assert.equal((await camps.move(a.token, id, 'confirmed')).status, 409);
    assert.equal((await camps.move(a.token, id, 'proposed')).status, 200);
    for (const to of ['confirmed', 'in_progress', 'delivered', 'completed', 'delivered']) assert.equal((await camps.move(a.token, id, to)).status, 200, to);
  });

  test('the dashboard and brand page agree with the new statuses', async () => {
    const a = await signUp();
    const { id, client } = await newCampaign(a.token, { fee: { amountMinor: 50_000, currency: 'INR' } });
    const { clients } = await import('./helpers/clients.js');
    assert.equal((await clients.get(a.token, client)).body.data.summary.campaigns.pipeline, 1);
    await camps.move(a.token, id, 'confirmed');
    const summary = (await clients.get(a.token, client)).body.data.summary;
    assert.equal(summary.campaigns.active, 1);
    assert.deepEqual(summary.money.map((m) => [m.currency, m.agreed]), [['INR', 50_000]]); // proposed fees are not "agreed" yet
  });
});

describe('meta and access', () => {
  test('requires authentication on every route', async () => {
    const { request, app } = await import('./helpers/app.js');
    for (const [method, path] of [['get', '/'], ['post', '/'], ['get', '/meta'], ['get', '/lookup'], ['get', `/${GHOST}`], ['post', `/${GHOST}/transition`], ['post', `/${GHOST}/deliverables`], ['delete', `/${GHOST}/content/${GHOST}`]]) {
      assert.equal((await request(app)[method](`/api/v1/campaigns${path}`).send({})).status, 401, `${method} ${path}`);
    }
  });

  test('meta describes the statuses, transitions and progress weights the screens need', async () => {
    const a = await signUp();
    const m = (await camps.meta(a.token)).body;
    assert.equal(m.statuses.length, 7);
    assert.deepEqual(m.statuses.find((s) => s.value === 'proposed').next, ['negotiating', 'confirmed', 'cancelled']);
    assert.equal(m.deliverableStatuses.find((s) => s.value === 'delivered').weight, 100);
    assert.equal(m.warnDays, 7);
  });

  test('malformed ids are 404, not server errors', async () => {
    const a = await signUp();
    for (const id of ['abc', '123', GHOST]) assert.equal((await camps.get(a.token, id)).status, 404);
  });
});

describe('campaign deadline reminders', () => {
  test('fire once inside the lead time, skip delivered/archived/far campaigns, and stay in the owner’s inbox', async () => {
    const { runReminderSweep } = await import('../src/jobs/reminders.js');
    const { Notification } = await import('../src/modules/notifications/notification.model.js');
    const a = await signUp();
    const b = await signUp();
    const soon = await newCampaign(a.token, { title: 'Soon', deadline: day(0) });
    await newCampaign(a.token, { title: 'Far', deadline: day(20) });
    const done = await newCampaign(a.token, { title: 'Delivered', deadline: day(0) });
    for (const s of ['confirmed', 'in_progress', 'delivered']) await camps.move(a.token, done.id, s);
    const arch = await newCampaign(a.token, { title: 'Archived', deadline: day(0) });
    await camps.archive(a.token, arch.id);

    const first = await runReminderSweep(new Date());
    assert.equal(first.campaignReminders, 1);
    assert.equal((await runReminderSweep(new Date())).campaignReminders, 0); // idempotent
    const n = await Notification.find({ type: 'campaign_deadline' });
    assert.equal(n.length, 1);
    assert.equal(String(n[0].owner), a.user.id);
    assert.equal(String(n[0].entity.id), soon.id);
    assert.match(n[0].title, /Soon/);
    assert.equal(await Notification.countDocuments({ owner: b.user.id }), 0);
  });
});
