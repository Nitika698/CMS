import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { api, contentAt, files } from './helpers/content.js';
import { Content } from '../src/modules/content/content.model.js';

useDatabase();

const ISO_AGO = (ms) => new Date(Date.now() - ms).toISOString();
const ISO_IN = (ms) => new Date(Date.now() + ms).toISOString();
const stages = async (token) => {
  const res = await request(app).get('/api/v1/dashboard').set(bearer(token));
  return Object.fromEntries(res.body.sections.contentPipeline.stages.map((s) => [s.key, s.count]));
};

describe('the happy path: Idea > Planning > Creation > Review > Approved > Published', () => {
  test('walks the whole workflow, one controlled step at a time, leaving a history', async () => {
    const { token } = await signUp();
    const id = (await api.create(token, { title: 'Launch reel' })).body.data.id;
    const seen = [];
    for (const to of ['planning', 'creation']) {
      const r = await api.move(token, id, to);
      assert.equal(r.status, 200, to);
      seen.push(r.body.data.status);
    }

    // Quality gate: nothing to review yet (no caption, no assets)
    const gated = await api.move(token, id, 'review');
    assert.equal(gated.status, 422);
    assert.equal(gated.body.error.code, 'TRANSITION_BLOCKED');
    assert.equal((await api.get(token, id)).body.data.status, 'creation');

    await api.patch(token, id, { caption: 'Ready to go' });
    const inReview = await api.move(token, id, 'review');
    assert.equal(inReview.status, 200);
    seen.push(inReview.body.data.status);

    const approved = await api.move(token, id, 'approved', { approverName: 'Jane at Acme', comment: 'Looks great' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.approval.approverName, 'Jane at Acme');
    assert.equal(approved.body.data.approval.isCurrent, true);
    seen.push(approved.body.data.status);

    const publishedAt = ISO_AGO(60_000);
    const published = await api.move(token, id, 'published', { publishedAt, publishedUrl: 'https://instagram.com/p/abc' });
    assert.equal(published.status, 200);
    const d = published.body.data;
    assert.deepEqual([...seen, d.status], ['planning', 'creation', 'review', 'approved', 'published']);
    assert.equal(d.publishedAt, publishedAt);
    assert.equal(d.publishedUrl, 'https://instagram.com/p/abc');
    assert.equal(d.publishedVerification, 'manual'); // honest: declared by the user, not confirmed by a platform
    assert.deepEqual(d.transitions, []);

    const history = (await api.history(token, id)).body.data.map((e) => [e.type, e.from, e.to]).reverse();
    assert.deepEqual(history, [
      ['created', null, null],
      ['status_changed', 'idea', 'planning'],
      ['status_changed', 'planning', 'creation'],
      ['updated', null, null],
      ['status_changed', 'creation', 'review'],
      ['approved', 'review', 'approved'],
      ['status_changed', 'approved', 'published'],
    ]);
  });

  test('the dashboard pipeline follows the real statuses', async () => {
    const { token } = await signUp();
    await api.create(token);
    await contentAt(token, 'planning');
    await contentAt(token, 'review');
    await contentAt(token, 'published');
    assert.deepEqual(await stages(token), { idea: 1, planning: 1, creation: 0, review: 1, approved: 0, published: 1 });
  });

  test('going back one step is allowed where defined', async () => {
    const { token } = await signUp();
    const id = await contentAt(token, 'creation');
    assert.equal((await api.move(token, id, 'planning')).body.data.status, 'planning');
    assert.equal((await api.move(token, id, 'idea')).body.data.status, 'idea');
  });
});

describe('controlled transitions: everything else is refused', () => {
  const ORDER = ['idea', 'planning', 'creation', 'review', 'approved', 'published'];
  const ALLOWED = { idea: ['planning'], planning: ['creation', 'idea'], creation: ['review', 'planning'], review: ['approved', 'creation'], approved: ['published', 'review'], published: [] };

  test('every disallowed move from every status returns 409 with the allowed list, and nothing changes', async () => {
    const { token } = await signUp();
    for (const from of ORDER) {
      const id = await contentAt(token, from === 'idea' ? 'idea' : from);
      for (const to of ORDER) {
        if (ALLOWED[from].includes(to)) continue;
        const extra = to === 'published' ? { publishedAt: ISO_AGO(1000) } : to === 'creation' && from === 'review' ? { comment: 'x' } : {};
        const res = await api.move(token, id, to, extra);
        assert.equal(res.status, 409, `${from} -> ${to}`);
        assert.equal(res.body.error.code, 'INVALID_TRANSITION');
        assert.deepEqual(res.body.error.details.allowed, ALLOWED[from], `${from} -> ${to}`);
      }
      assert.equal((await api.get(token, id)).body.data.status, from, `${from} must be unchanged`);
    }
  });

  test('skipping straight to Review, Approved or Published is impossible from the start', async () => {
    const { token } = await signUp();
    const id = (await api.create(token, { caption: 'c' })).body.data.id;
    for (const to of ['review', 'approved', 'published']) assert.equal((await api.move(token, id, to, { publishedAt: ISO_AGO(1000) })).status, 409, to);
    assert.equal(await Content.countDocuments({ status: 'idea' }), 1);
  });

  test('unknown or missing target status, and unknown fields, are validation errors', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    for (const body of [{ to: 'live' }, {}, { to: 'planning', status: 'published' }, { to: 'planning', owner: 'x' }, { to: 'planning', revision: 9 }]) {
      const res = await request(app).post(`/api/v1/content/${id}/transition`).set(bearer(token)).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  test('"moving" to the current status is refused', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    assert.equal((await api.move(token, id, 'idea')).status, 409);
  });

  test('archived content cannot change status until restored', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    await api.archive(token, id);
    const res = await api.move(token, id, 'planning');
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ARCHIVED');
    await api.restore(token, id);
    assert.equal((await api.move(token, id, 'planning')).status, 200);
  });

  test('two simultaneous moves from the same state: exactly one wins', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    const results = await Promise.all(Array.from({ length: 6 }, () => api.move(token, id, 'planning')));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 409));
    const events = (await api.history(token, id)).body.data.filter((e) => e.type === 'status_changed');
    assert.equal(events.length, 1);
  });
});

describe('rejection and the revision workflow', () => {
  test('rejecting needs a comment; it returns content to Creation, starts a new revision and withdraws any approval', async () => {
    const { token } = await signUp();
    const id = await contentAt(token, 'review');

    const silent = await api.move(token, id, 'creation');
    assert.equal(silent.status, 400);
    assert.equal(silent.body.error.details[0].path, 'comment');
    assert.equal((await api.move(token, id, 'creation', { comment: 'x' })).status, 400); // too short to be useful
    assert.equal((await api.get(token, id)).body.data.status, 'review');

    const rejected = await api.move(token, id, 'creation', { comment: 'Logo is too small, redo the intro' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.status, 'creation');
    assert.equal(rejected.body.data.revision, 1);
    assert.equal(rejected.body.data.approval, null);

    const reviews = (await api.history(token, id, 'type=reviews')).body.data;
    assert.deepEqual(reviews.map((e) => [e.type, e.comment, e.revision]), [['changes_requested', 'Logo is too small, redo the intro', 1]]);
  });

  test('after a rejection the content goes around again and a later approval belongs to the new revision', async () => {
    const { token } = await signUp();
    const id = await contentAt(token, 'review');
    await api.move(token, id, 'creation', { comment: 'Please shorten' });
    await api.patch(token, id, { caption: 'Shorter caption' });
    assert.equal((await api.move(token, id, 'review')).status, 200);
    await api.move(token, id, 'creation', { comment: 'Still too long' });
    await api.move(token, id, 'review');
    const approved = await api.move(token, id, 'approved');
    assert.equal(approved.body.data.revision, 2);
    assert.deepEqual([approved.body.data.approval.revision, approved.body.data.approval.isCurrent], [2, true]);

    const types = (await api.history(token, id, 'type=reviews')).body.data.map((e) => e.type);
    assert.deepEqual(types, ['approved', 'changes_requested', 'changes_requested']);
  });

  test('re-opening approved content withdraws the approval and blocks publishing until it is approved again', async () => {
    const { token } = await signUp();
    const id = await contentAt(token, 'approved');
    const reopened = await api.move(token, id, 'review', { comment: 'Legal wants one more look' });
    assert.equal(reopened.body.data.status, 'review');
    assert.equal(reopened.body.data.approval, null);
    assert.equal((await api.move(token, id, 'published', { publishedAt: ISO_AGO(1000) })).status, 409); // review -> published is not a move
    await api.move(token, id, 'approved');
    assert.equal((await api.move(token, id, 'published', { publishedAt: ISO_AGO(1000) })).status, 200);
  });

  test('approved content cannot be rejected directly; it must be re-opened first', async () => {
    const { token } = await signUp();
    const id = await contentAt(token, 'approved');
    assert.equal((await api.move(token, id, 'creation', { comment: 'nope' })).status, 409);
  });
});

describe('publishing is a declaration the user makes, and it is checked', () => {
  test('needs a publication time that is not in the future, and a valid http(s) link', async () => {
    const { token } = await signUp();
    const id = await contentAt(token, 'approved');

    const missing = await api.move(token, id, 'published');
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.details[0].path, 'publishedAt');

    const future = await api.move(token, id, 'published', { publishedAt: ISO_IN(3 * 86_400_000) });
    assert.equal(future.status, 400);
    assert.match(future.body.error.details[0].message, /future/i);

    for (const bad of ['javascript:alert(1)', 'ftp://x.example/file', 'not a url', 'data:text/html,hi']) {
      assert.equal((await api.move(token, id, 'published', { publishedAt: ISO_AGO(1000), publishedUrl: bad })).status, 400, bad);
    }
    assert.equal((await api.get(token, id)).body.data.status, 'approved');

    assert.equal((await api.move(token, id, 'published', { publishedAt: ISO_AGO(1000) })).status, 200);
  });

  test('publication details and approver names are only accepted on the transitions they belong to', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    const a = await api.move(token, id, 'planning', { publishedAt: ISO_AGO(1000) });
    assert.equal(a.status, 400);
    const b = await api.move(token, id, 'planning', { approverName: 'Someone' });
    assert.equal(b.status, 400);
  });

  test('published content is locked: only tags and the link can change', async () => {
    const { token } = await signUp();
    const id = await contentAt(token, 'published', { title: 'Done deal' });
    for (const body of [{ title: 'Edited' }, { caption: 'Edited' }, { deadline: null }, { platforms: ['x'] }]) {
      const res = await api.patch(token, id, body);
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(res.body.error.code, 'CONTENT_LOCKED');
    }
    assert.equal((await api.patch(token, id, { tags: ['evergreen'] })).status, 200);
    assert.equal((await api.patch(token, id, { publishedUrl: 'https://youtu.be/xyz' })).body.data.publishedUrl, 'https://youtu.be/xyz');
    assert.equal((await api.upload(token, id, files.png())).status, 409); // no new files on published content
    assert.equal((await api.move(token, id, 'review')).status, 409); // published is final
    assert.equal((await api.archive(token, id)).status, 200); // but it can be archived
  });
});

describe('review comments', () => {
  test('comments are stored with the revision, shown in review history, and validated', async () => {
    const { token } = await signUp();
    const id = (await api.create(token)).body.data.id;
    assert.equal((await api.comment(token, id, 'Needs a stronger hook')).status, 201);
    assert.equal((await api.comment(token, id, '   ')).status, 400);
    assert.equal((await api.comment(token, id, 'x'.repeat(5001))).status, 400);
    const bad = await request(app).post(`/api/v1/content/${id}/comments`).set(bearer(token)).send({ comment: 'ok', actor: 'someone-else' });
    assert.equal(bad.status, 400);

    const reviews = (await api.history(token, id, 'type=reviews')).body.data;
    assert.deepEqual(reviews.map((e) => [e.type, e.comment, e.revision]), [['comment', 'Needs a stronger hook', 0]]);
  });

  test('comments can still be added after publication', async () => {
    const { token } = await signUp();
    const id = await contentAt(token, 'published');
    assert.equal((await api.comment(token, id, 'Performed well')).status, 201);
  });
});
