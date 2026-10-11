import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { api, files } from './helpers/content.js';
import { Campaign } from '../src/modules/campaigns/campaign.model.js';
import { Category } from '../src/modules/categories/category.model.js';
import { Client } from '../src/modules/clients/client.model.js';
import { ContentEvent } from '../src/modules/content/content-event.model.js';
import { Content } from '../src/modules/content/content.model.js';
import { MediaAsset } from '../src/modules/media/media-asset.model.js';
import { Post } from '../src/modules/posts/post.model.js';
import { Task } from '../src/modules/tasks/task.model.js';

useDatabase();

const DAY = 86_400_000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();
const makeCampaign = async (owner, title = 'Summer launch') => {
  const client = await Client.create({ owner, name: `Brand of ${title}` });
  return Campaign.create({ owner, client: client._id, title, status: 'in_progress' });
};

describe('create and read', () => {
  test('creates content that always starts at "idea", with timestamps and no leaked internals', async () => {
    const { token, user } = await signUp();
    const res = await api.create(token, { title: '  My first reel  ' });
    assert.equal(res.status, 201);
    const c = res.body.data;
    assert.equal(c.title, 'My first reel');
    assert.equal(c.status, 'idea');
    assert.equal(c.revision, 0);
    assert.equal(c.type, 'post');
    assert.deepEqual([c.platforms, c.tags, c.hashtags, c.assets], [[], [], [], []]);
    assert.ok(c.createdAt && c.updatedAt);
    assert.deepEqual(c.transitions.map((t) => t.to), ['planning']);
    const text = JSON.stringify(res.body);
    for (const leak of ['owner', 'statusRank', '__v', 'storageKey', user.id]) assert.ok(!text.includes(leak), `must not expose ${leak}`);
  });

  test('stores every supported field and normalises tags, hashtags and platforms', async () => {
    const { token } = await signUp();
    const cat = await request(app).post('/api/v1/categories').set(bearer(token)).send({ name: 'Travel' });
    const camp = await makeCampaign((await request(app).get('/api/v1/me').set(bearer(token))).body.user.id);
    const res = await api.create(token, {
      title: 'Bali vlog',
      description: 'A week in Bali',
      type: 'video',
      category: cat.body.data.id,
      campaign: String(camp._id),
      platforms: ['youtube', 'instagram', 'youtube'],
      tags: ['Travel', ' travel ', 'BALI'],
      caption: 'Found paradise',
      hashtags: ['#Bali', 'bali', '##Travel_2026'],
      brief: 'Show 3 beaches; mention the sponsor twice.',
      plannedDate: iso(10),
      deadline: iso(5),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const c = res.body.data;
    assert.deepEqual(c.platforms, ['youtube', 'instagram']);
    assert.deepEqual(c.tags, ['travel', 'bali']);
    assert.deepEqual(c.hashtags, ['Bali', 'Travel_2026']);
    assert.equal(c.category.name, 'Travel');
    assert.equal(c.campaign.title, 'Summer launch');
    assert.equal(c.campaign.clientName, 'Brand of Summer launch');
    assert.equal(c.brief, 'Show 3 beaches; mention the sponsor twice.');
    assert.equal(c.isOverdue, false);
  });

  test('GET returns the same detail; unknown and malformed ids are 404', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    const got = await api.get(token, id);
    assert.equal(got.status, 200);
    assert.equal(got.body.data.id, id);
    for (const bad of ['507f1f77bcf86cd799439011', 'abc', '123']) assert.equal((await api.get(token, bad)).status, 404, bad);
  });

  test('GET /content/meta describes the workflow and limits for the UI', async () => {
    const { token } = await signUp();
    const res = await request(app).get('/api/v1/content/meta').set(bearer(token));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.statuses.map((s) => s.key), ['idea', 'planning', 'creation', 'review', 'approved', 'published']);
    assert.ok(res.body.limits.upload.imageBytes > 0 && res.body.limits.maxAssets === 3);
  });
});

describe('deadlines', () => {
  test('a date-only deadline is not overdue until that day is over; a past timestamp is; signed-off content never is', async () => {
    const { token } = await signUp();
    const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
    const today = (await api.create(token, { title: 'due today', deadline: day(0) })).body.data;
    const yesterday = (await api.create(token, { title: 'due yesterday', deadline: day(-1) })).body.data;
    const stamp = (await api.create(token, { title: 'due an hour ago', deadline: new Date(Date.now() - 3_600_000).toISOString() })).body.data;
    const none = (await api.create(token, { title: 'no deadline' })).body.data;
    assert.deepEqual([today, yesterday, stamp, none].map((c) => c.isOverdue), [false, true, true, false]);

    // approved content is no longer "overdue", whatever its deadline
    const late = (await api.create(token, { title: 'late but approved', caption: 'c', deadline: new Date(Date.now() - 5 * DAY).toISOString() })).body.data.id;
    for (const to of ['planning', 'creation', 'review', 'approved']) await api.move(token, late, to);
    assert.equal((await api.get(token, late)).body.data.isOverdue, false);
  });
});

describe('update', () => {
  test('edits fields, clears optional ones with null, and moves updatedAt', async () => {
    const { token } = await signUp();
    const created = (await api.create(token, { caption: 'old', deadline: iso(3) })).body.data;
    await new Promise((r) => setTimeout(r, 15));
    const res = await api.patch(token, created.id, { title: 'New title', caption: 'new', deadline: null, tags: ['a', 'b'] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.title, 'New title');
    assert.equal(res.body.data.caption, 'new');
    assert.equal(res.body.data.deadline, null);
    assert.deepEqual(res.body.data.tags, ['a', 'b']);
    assert.ok(new Date(res.body.data.updatedAt) > new Date(created.updatedAt));
    assert.equal(res.body.data.status, 'idea'); // editing never changes status
  });

  test('an empty patch is rejected', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    assert.equal((await api.patch(token, id, {})).status, 400);
  });

  test('status, revision, approval, publication and ownership cannot be set through PATCH or POST', async () => {
    const { token, user } = await signUp();
    const other = await signUp();
    const id = (await api.create(token)).body.data.id;
    const forbidden = [{ status: 'published' }, { revision: 5 }, { approval: { approvedAt: iso(0) } }, { publishedAt: iso(-1) }, { publishedVerification: 'manual' },
      { owner: other.user.id }, { _id: other.user.id }, { statusRank: 5 }, { archivedAt: iso(0) }, { assets: ['507f1f77bcf86cd799439011'] }];
    for (const body of forbidden) {
      assert.equal((await api.patch(token, id, body)).status, 400, `PATCH ${JSON.stringify(body)}`);
      assert.equal((await api.create(token, body)).status, 400, `POST ${JSON.stringify(body)}`);
    }
    const doc = await Content.findById(id);
    assert.equal(doc.status, 'idea');
    assert.equal(String(doc.owner), user.id);
  });

  test('the published link can only be set on published content', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    const res = await api.patch(token, id, { publishedUrl: 'https://example.com/p/1' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].path, 'publishedUrl');
  });
});

describe('validation', () => {
  test('rejects bad input with field-level details', async () => {
    const { token } = await signUp();
    const cases = {
      'missing title': [{ title: undefined }, 'title'],
      'blank title': [{ title: '   ' }, 'title'],
      'title too long': [{ title: 'x'.repeat(201) }, 'title'],
      'bad type': [{ type: 'hologram' }, 'type'],
      'bad platform': [{ platforms: ['myspace'] }, 'platforms.0'],
      'too many tags': [{ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, 'tags'],
      'tag too long': [{ tags: ['x'.repeat(31)] }, 'tags.0'],
      'empty tag': [{ tags: ['  '] }, 'tags.0'],
      'hashtag with spaces': [{ hashtags: ['two words'] }, 'hashtags.0'],
      'hashtag with punctuation': [{ hashtags: ['no-dashes!'] }, 'hashtags.0'],
      'too many hashtags': [{ hashtags: Array.from({ length: 31 }, (_, i) => `h${i}`) }, 'hashtags'],
      'invalid date': [{ plannedDate: 'next tuesday' }, 'plannedDate'],
      'impossible date': [{ deadline: '2026-13-45' }, 'deadline'],
      'deadline after planned date': [{ plannedDate: iso(2), deadline: iso(9) }, 'deadline'],
      'title as number': [{ title: 42 }, 'title'],
      'tags as string': [{ tags: 'a,b' }, 'tags'],
      'caption too long': [{ caption: 'x'.repeat(20_001) }, 'caption'],
      'category not an id': [{ category: 'nope' }, 'category'],
    };
    for (const [name, [override, path]] of Object.entries(cases)) {
      const body = { title: 'ok', ...override };
      const res = await request(app).post('/api/v1/content').set(bearer(token)).send(body);
      assert.equal(res.status, 400, name);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR', name);
      assert.ok(res.body.error.details.some((d) => d.path === path), `${name}: expected a detail for "${path}" in ${JSON.stringify(res.body.error.details)}`);
    }
    assert.equal(await Content.countDocuments(), 0);
  });

  test('date-only and offset date-times are accepted', async () => {
    const { token } = await signUp();
    const res = await api.create(token, { plannedDate: '2027-01-15', deadline: '2027-01-10T09:00:00+05:30' });
    assert.equal(res.status, 201);
  });

  test('a deadline cannot be moved after the planned date through an edit either', async () => {
    const { token } = await signUp();
    const id = (await api.create(token, { plannedDate: iso(5) })).body.data.id;
    const res = await api.patch(token, id, { deadline: iso(20) });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].path, 'deadline');
  });
});

describe('references are validated against the owner', () => {
  test("another user's category/campaign and a non-existent one give the same answer", async () => {
    const a = await signUp();
    const b = await signUp();
    const aCat = (await request(app).post('/api/v1/categories').set(bearer(a.token)).send({ name: 'Mine' })).body.data.id;
    const aCamp = String((await makeCampaign(a.user.id))._id);
    const ghost = '507f1f77bcf86cd799439011';

    for (const field of ['category', 'campaign']) {
      const foreign = await api.create(b.token, { [field]: field === 'category' ? aCat : aCamp });
      const missing = await api.create(b.token, { [field]: ghost });
      assert.equal(foreign.status, 400, field);
      assert.deepEqual(foreign.body, missing.body, `${field}: foreign and missing must be indistinguishable`);
      assert.equal(foreign.body.error.details[0].path, field);
    }
    assert.equal(await Content.countDocuments({ owner: b.user.id }), 0);

    const own = (await api.create(b.token)).body.data.id;
    assert.equal((await api.patch(b.token, own, { category: aCat })).status, 400);
    assert.equal((await api.patch(b.token, own, { campaign: aCamp })).status, 400);
  });

  test('own category and campaign can be attached, changed and detached', async () => {
    const a = await signUp();
    const c1 = (await request(app).post('/api/v1/categories').set(bearer(a.token)).send({ name: 'One' })).body.data.id;
    const c2 = (await request(app).post('/api/v1/categories').set(bearer(a.token)).send({ name: 'Two' })).body.data.id;
    const id = (await api.create(a.token, { category: c1 })).body.data.id;
    assert.equal((await api.patch(a.token, id, { category: c2 })).body.data.category.name, 'Two');
    assert.equal((await api.patch(a.token, id, { category: null })).body.data.category, null);
  });

  test('deleting a category leaves its content in place, uncategorised', async () => {
    const a = await signUp();
    const cat = (await request(app).post('/api/v1/categories').set(bearer(a.token)).send({ name: 'Temp' })).body.data.id;
    const id = (await api.create(a.token, { category: cat })).body.data.id;
    assert.equal((await request(app).delete(`/api/v1/categories/${cat}`).set(bearer(a.token))).status, 204);
    const got = (await api.get(a.token, id)).body.data;
    assert.equal(got.category, null);
    assert.equal(await Category.countDocuments(), 0);
  });

  test('GET /campaigns is a read-only, owner-scoped lookup', async () => {
    const a = await signUp();
    const b = await signUp();
    await makeCampaign(a.user.id, 'Alpha');
    await makeCampaign(b.user.id, 'Bravo');
    const res = await request(app).get('/api/v1/campaigns').set(bearer(a.token));
    assert.deepEqual(res.body.data.map((c) => c.title), ['Alpha']);
    assert.equal((await request(app).post('/api/v1/campaigns').set(bearer(a.token)).send({ title: 'x' })).status, 404);
  });
});

describe('archive and delete', () => {
  test('archive hides from the default list, restore brings it back, edits are blocked while archived', async () => {
    const { token } = await signUp();
    const id = (await api.create(token, { title: 'Keep me' })).body.data.id;
    assert.equal((await api.archive(token, id)).body.data.archived, true);
    assert.equal((await api.list(token)).body.data.length, 0);
    assert.equal((await api.list(token, 'archived=true')).body.data.length, 1);
    const edit = await api.patch(token, id, { title: 'Nope' });
    assert.equal(edit.status, 409);
    assert.equal(edit.body.error.code, 'ARCHIVED');
    assert.equal((await api.archive(token, id)).status, 200); // idempotent
    assert.equal((await api.restore(token, id)).body.data.archived, false);
    assert.equal((await api.list(token)).body.data.length, 1);
  });

  test('permanent delete needs a prior archive, then removes content, history and files', async () => {
    const { token, user } = await signUp();
    const id = (await api.create(token)).body.data.id;
    const up = await api.upload(token, id, files.png());
    assert.equal(up.status, 201);
    const task = await Task.create({ owner: user.id, title: 't', links: { content: id } });

    const early = await api.remove(token, id);
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'NOT_ARCHIVED');

    await api.archive(token, id);
    assert.equal((await api.remove(token, id)).status, 204);
    assert.equal((await api.get(token, id)).status, 404);
    assert.equal(await ContentEvent.countDocuments(), 0);
    assert.equal(await MediaAsset.countDocuments(), 0);
    assert.equal((await Task.findById(task._id)).links.content, null); // the task survives, unlinked
    assert.equal((await api.remove(token, id)).status, 404);
  });

  test('content that still has calendar posts cannot be deleted', async () => {
    const { token, user } = await signUp();
    const id = (await api.create(token)).body.data.id;
    await Post.create({ owner: user.id, content: id, platform: 'instagram', status: 'planned' });
    await api.archive(token, id);
    const res = await api.remove(token, id);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'HAS_POSTS');
    assert.equal((await api.get(token, id)).status, 200);
  });
});

describe('list: filtering, search, sorting, pagination', () => {
  async function seed() {
    const a = await signUp();
    const cat = (await request(app).post('/api/v1/categories').set(bearer(a.token)).send({ name: 'Food' })).body.data.id;
    const camp = String((await makeCampaign(a.user.id, 'Spring'))._id);
    const mk = async (body, to) => {
      const id = (await api.create(a.token, body)).body.data.id;
      for (const s of to ?? []) await api.move(a.token, id, s);
      return id;
    };
    const ids = {
      pasta: await mk({ title: 'Pasta reel', type: 'reel', platforms: ['instagram', 'tiktok'], category: cat, tags: ['italian', 'quick'], caption: 'Dinner in 10 minutes', hashtags: ['pasta'], deadline: iso(3) }),
      sushi: await mk({ title: 'Sushi guide', type: 'video', platforms: ['youtube'], category: cat, campaign: camp, tags: ['japan'], deadline: iso(1) }, ['planning']),
      tacos: await mk({ title: 'Taco Tuesday', type: 'short', platforms: ['tiktok'], tags: ['mexican', 'quick'], plannedDate: iso(9) }, ['planning', 'creation']),
      blog: await mk({ title: 'Best pans (2026)', type: 'blog', platforms: ['blog'], description: 'Cast iron vs. steel — which one?', campaign: camp }),
      dots: await mk({ title: 'Literal .* characters (here)', type: 'post' }),
      overdue: await mk({ title: 'Late one', deadline: iso(-2) }),
    };
    return { a, ids, cat, camp };
  }
  const titles = (res) => res.body.data.map((c) => c.title);

  test('filters by status (single and comma list), type, platform, category, campaign and tag', async () => {
    const { a, ids, cat, camp } = await seed();
    assert.deepEqual(titles(await api.list(a.token, 'status=planning&sort=title')), ['Sushi guide']);
    assert.deepEqual(titles(await api.list(a.token, 'status=planning,creation&sort=title')), ['Sushi guide', 'Taco Tuesday']);
    assert.deepEqual(titles(await api.list(a.token, 'type=reel')), ['Pasta reel']);
    assert.deepEqual(titles(await api.list(a.token, 'type=reel,short&sort=title')), ['Pasta reel', 'Taco Tuesday']);
    assert.deepEqual(titles(await api.list(a.token, 'platform=tiktok&sort=title')), ['Pasta reel', 'Taco Tuesday']);
    assert.deepEqual(titles(await api.list(a.token, `category=${cat}&sort=title`)), ['Pasta reel', 'Sushi guide']);
    assert.deepEqual(titles(await api.list(a.token, `campaign=${camp}&sort=title`)), ['Best pans (2026)', 'Sushi guide']);
    assert.deepEqual(titles(await api.list(a.token, 'tag=quick&sort=title')), ['Pasta reel', 'Taco Tuesday']);
    assert.deepEqual(titles(await api.list(a.token, `status=planning&category=${cat}`)), ['Sushi guide']); // filters combine with AND
    assert.equal((await api.list(a.token, 'status=published')).body.meta.total, 0);
    assert.ok(ids.pasta);
  });

  test('search matches title, description, caption, tags and hashtags, case-insensitively', async () => {
    const { a } = await seed();
    assert.deepEqual(titles(await api.list(a.token, 'q=taco')), ['Taco Tuesday']);
    assert.deepEqual(titles(await api.list(a.token, 'q=CAST IRON')), ['Best pans (2026)']); // description
    assert.deepEqual(titles(await api.list(a.token, 'q=10 minutes')), ['Pasta reel']); // caption
    assert.deepEqual(titles(await api.list(a.token, 'q=japan')), ['Sushi guide']); // tag
    assert.deepEqual(titles(await api.list(a.token, 'q=pasta&sort=title')), ['Pasta reel']); // hashtag + title
    assert.deepEqual(titles(await api.list(a.token, 'q=zzzz')), []);
  });

  test('search text is literal, never a regular expression', async () => {
    const { a } = await seed();
    assert.deepEqual(titles(await api.list(a.token, `q=${encodeURIComponent('.*')}`)), ['Literal .* characters (here)']);
    for (const q of ['(', '[a-', '\\', '(a+)+$', '$^', '?']) {
      const res = await api.list(a.token, `q=${encodeURIComponent(q)}`);
      assert.equal(res.status, 200, `q=${q}`);
    }
    assert.deepEqual(titles(await api.list(a.token, `q=${encodeURIComponent('(2026)')}`)), ['Best pans (2026)']);
  });

  test('sorts by title, workflow status order, and dates with undated items always last', async () => {
    const { a } = await seed();
    assert.deepEqual(titles(await api.list(a.token, 'sort=title')).slice(0, 2), ['Best pans (2026)', 'Late one']);
    assert.deepEqual(titles(await api.list(a.token, 'sort=-title')).slice(0, 2), ['Taco Tuesday', 'Sushi guide']);

    const byStatus = (await api.list(a.token, 'sort=status')).body.data.map((c) => c.status);
    assert.deepEqual(byStatus, ['idea', 'idea', 'idea', 'idea', 'planning', 'creation']); // workflow order, not alphabetical
    assert.equal((await api.list(a.token, 'sort=-status')).body.data[0].status, 'creation');

    const asc = titles(await api.list(a.token, 'sort=deadline'));
    assert.deepEqual(asc.slice(0, 3), ['Late one', 'Sushi guide', 'Pasta reel']);
    const desc = titles(await api.list(a.token, 'sort=-deadline'));
    assert.deepEqual(desc.slice(0, 3), ['Pasta reel', 'Sushi guide', 'Late one']);
    for (const order of [asc, desc]) assert.deepEqual(new Set(order.slice(3)), new Set(['Taco Tuesday', 'Best pans (2026)', 'Literal .* characters (here)'])); // undated last

    assert.equal(titles(await api.list(a.token, 'sort=plannedDate'))[0], 'Taco Tuesday');
  });

  test('default order is most recently updated first', async () => {
    const { a, ids } = await seed();
    await new Promise((r) => setTimeout(r, 15));
    await api.patch(a.token, ids.blog, { caption: 'touched' });
    assert.equal(titles(await api.list(a.token))[0], 'Best pans (2026)');
  });

  test('paginates with accurate meta, stable order and no duplicates', async () => {
    const a = await signUp();
    for (let i = 1; i <= 12; i++) await api.create(a.token, { title: `Item ${String(i).padStart(2, '0')}` });
    const p1 = await api.list(a.token, 'sort=title&limit=5&page=1');
    const p2 = await api.list(a.token, 'sort=title&limit=5&page=2');
    const p3 = await api.list(a.token, 'sort=title&limit=5&page=3');
    assert.deepEqual(p1.body.meta, { page: 1, limit: 5, total: 12, pages: 3 });
    assert.deepEqual([p1, p2, p3].map((r) => r.body.data.length), [5, 5, 2]);
    const all = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((c) => c.title);
    assert.equal(new Set(all).size, 12);
    assert.deepEqual(all, [...all].sort());
    const beyond = await api.list(a.token, 'limit=5&page=9');
    assert.equal(beyond.status, 200);
    assert.deepEqual(beyond.body.data, []);
    assert.equal(beyond.body.meta.total, 12);
  });

  test('rejects out-of-range paging, unknown sorts and unknown filter values', async () => {
    const { token } = await signUp();
    for (const q of ['limit=101', 'limit=0', 'page=0', 'page=abc', 'sort=password', 'sort=-owner', 'status=bogus', 'type=bogus', 'platform=bogus', 'category=nope', 'archived=maybe']) {
      assert.equal((await api.list(token, q)).status, 400, q);
    }
  });

  test('list items carry an overdue flag, asset count and resolved category/campaign', async () => {
    const { a, ids } = await seed();
    await api.upload(a.token, ids.pasta, files.png());
    await api.upload(a.token, ids.pasta, files.jpg());
    const items = Object.fromEntries((await api.list(a.token)).body.data.map((c) => [c.title, c]));
    assert.equal(items['Late one'].isOverdue, true);
    assert.equal(items['Pasta reel'].isOverdue, false);
    assert.equal(items['Pasta reel'].assetCount, 2);
    assert.equal(items['Pasta reel'].category.name, 'Food');
    assert.equal(items['Sushi guide'].campaign.title, 'Spring');
    assert.equal(items['Pasta reel'].caption, undefined); // list rows are summaries
  });
});

describe('history of meaningful changes', () => {
  test('records creation, tracked field edits (with before/after), and ignores no-op saves', async () => {
    const { token } = await signUp();
    const id = (await api.create(token, { title: 'First', caption: 'secret caption text' })).body.data.id;
    await api.patch(token, id, { title: 'Second', tags: ['x'], caption: 'brand new secret text', deadline: iso(3) });
    await api.patch(token, id, { title: 'Second' }); // unchanged -> nothing recorded

    const h = (await api.history(token, id)).body.data;
    assert.deepEqual(h.map((e) => e.type), ['updated', 'created']);
    const fields = Object.fromEntries(h[0].fields.map((f) => [f.field, f]));
    assert.deepEqual([fields.title.from, fields.title.to], ['First', 'Second']);
    assert.deepEqual(fields.tags.to, ['x']);
    assert.ok(fields.deadline.to);
    // long free text records THAT it changed, not what it said
    assert.ok(fields.caption && fields.caption.from === undefined && fields.caption.to === undefined);
    assert.ok(!JSON.stringify(h).includes('secret'));
    assert.ok(h.every((e) => e.byYou));
  });

  test('is newest-first, filterable to review activity, and paginated', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    for (let i = 0; i < 5; i++) await api.comment(token, id, `note ${i}`);
    await api.patch(token, id, { title: 'Changed' });

    const reviews = (await api.history(token, id, 'type=reviews')).body.data;
    assert.deepEqual(reviews.map((e) => e.comment), ['note 4', 'note 3', 'note 2', 'note 1', 'note 0']);
    assert.ok(reviews.every((e) => e.type === 'comment'));

    const page1 = (await api.history(token, id, 'limit=3')).body;
    assert.equal(page1.data.length, 3);
    assert.equal(page1.meta.hasMore, true);
    const page2 = (await api.history(token, id, `limit=3&before=${encodeURIComponent(page1.meta.next)}`)).body;
    assert.equal(page2.data.length, 3);
    assert.equal(page2.meta.hasMore, true);
    const page3 = (await api.history(token, id, `limit=3&before=${encodeURIComponent(page2.meta.next)}`)).body;
    assert.equal(page3.data.length, 1); // 7 events in total
    assert.equal(page3.meta.hasMore, false);
    const seen = [...page1.data, ...page2.data, ...page3.data].map((e) => e.id);
    assert.equal(new Set(seen).size, 7); // nothing skipped or repeated, even for events created in the same millisecond
  });

  test("asset uploads and removals are part of the history; other users' events never appear", async () => {
    const a = await signUp();
    const b = await signUp();
    const id = (await api.create(a.token)).body.data.id;
    const up = await api.upload(a.token, id, files.png(), 'hero.png');
    await api.removeAsset(a.token, id, up.body.data.id);
    const types = (await api.history(a.token, id)).body.data.map((e) => e.type);
    assert.deepEqual(types, ['asset_removed', 'asset_added', 'created']);
    assert.equal((await api.history(b.token, id)).status, 404);
  });
});
