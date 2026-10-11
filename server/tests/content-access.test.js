import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { api, assetTokenKey, contentAt, files } from './helpers/content.js';
import { Content } from '../src/modules/content/content.model.js';
import { ContentEvent } from '../src/modules/content/content-event.model.js';
import { MediaAsset } from '../src/modules/media/media-asset.model.js';
import { signAssetToken } from '../src/lib/assetTokens.js';

useDatabase();

const GHOST = '507f1f77bcf86cd799439011';

describe('authentication is required everywhere', () => {
  test('every content, media and campaign-lookup route answers 401 without a valid token', async () => {
    const routes = [
      ['get', '/content/meta'], ['get', '/content'], ['post', '/content'], ['get', `/content/${GHOST}`], ['patch', `/content/${GHOST}`], ['delete', `/content/${GHOST}`],
      ['post', `/content/${GHOST}/transition`], ['post', `/content/${GHOST}/comments`], ['get', `/content/${GHOST}/history`],
      ['post', `/content/${GHOST}/archive`], ['post', `/content/${GHOST}/restore`], ['post', `/content/${GHOST}/assets`], ['delete', `/content/${GHOST}/assets/${GHOST}`],
      ['get', `/media/${GHOST}/access`], ['get', `/media/${GHOST}/file`], ['get', '/campaigns'],
    ];
    for (const [method, path] of routes) {
      for (const headers of [{}, { Authorization: 'Bearer garbage' }]) {
        const res = await request(app)[method](`/api/v1${path}`).set(headers).send({});
        assert.equal(res.status, 401, `${method.toUpperCase()} ${path} ${JSON.stringify(headers)}`);
      }
    }
  });
});

describe("one user can never read or change another user's content", () => {
  async function setup() {
    const a = await signUp();
    const b = await signUp();
    const id = await contentAt(a.token, 'review', { title: 'ALPHA SECRET plan', tags: ['alpha-private'] });
    const up = await api.upload(a.token, id, files.png(), 'alpha.png');
    return { a, b, id, assetId: up.body.data.id };
  }

  test('B gets 404 (not 403) on every action against A\'s content, and nothing is changed or leaked', async () => {
    const { b, id, assetId } = await setup();
    const before = await Content.findById(id).lean();
    const eventsBefore = await ContentEvent.countDocuments();

    const attempts = {
      get: await api.get(b.token, id),
      patch: await api.patch(b.token, id, { title: 'Hacked' }),
      move: await api.move(b.token, id, 'approved'),
      comment: await api.comment(b.token, id, 'sneaky'),
      history: await api.history(b.token, id),
      reviews: await api.history(b.token, id, 'type=reviews'),
      archive: await api.archive(b.token, id),
      restore: await api.restore(b.token, id),
      remove: await api.remove(b.token, id),
      upload: await api.upload(b.token, id, files.png()),
      removeAsset: await api.removeAsset(b.token, id, assetId),
      access: await api.access(b.token, assetId),
      file: await request(app).get(`/api/v1/media/${assetId}/file`).set(bearer(b.token)),
    };
    const ghost = await api.get(b.token, GHOST);
    for (const [name, res] of Object.entries(attempts)) {
      assert.equal(res.status, 404, name);
      assert.ok(!JSON.stringify(res.body).includes('ALPHA'), `${name} must not leak content`);
    }
    // a foreign id is indistinguishable from one that never existed
    assert.deepEqual(attempts.get.body, ghost.body);

    const after = await Content.findById(id).lean();
    assert.deepEqual(after, before); // untouched, including version and timestamps
    assert.equal(await ContentEvent.countDocuments(), eventsBefore); // no events written for the intruder
    assert.equal(await MediaAsset.countDocuments({ content: id }), 1);
  });

  test("lists, searches, filters and the dashboard never include another user's content", async () => {
    const { a, b } = await setup();
    await api.create(b.token, { title: 'BRAVO note', tags: ['bravo'] });
    for (const q of ['', 'q=ALPHA', 'q=alpha-private', 'tag=alpha-private', 'status=review', 'sort=title&limit=100']) {
      const res = await api.list(b.token, q);
      assert.equal(res.status, 200);
      assert.ok(res.body.data.every((c) => c.title === 'BRAVO note'), q);
    }
    const dash = await request(app).get('/api/v1/dashboard').set(bearer(b.token));
    const counts = Object.fromEntries(dash.body.sections.contentPipeline.stages.map((s) => [s.key, s.count]));
    assert.deepEqual(counts, { idea: 1, planning: 0, creation: 0, review: 0, approved: 0, published: 0 });
    assert.equal((await api.list(a.token)).body.meta.total, 1);
  });

  test('the owner field cannot be forged on create or update', async () => {
    const { a, b } = await setup();
    const res = await api.create(b.token, { title: 'Mine', owner: a.user.id });
    assert.equal(res.status, 400);
    const mine = (await api.create(b.token, { title: 'Mine' })).body.data.id;
    assert.equal((await api.patch(b.token, mine, { owner: a.user.id })).status, 400);
    assert.equal(String((await Content.findById(mine)).owner), b.user.id);
  });

  test('a logged-out session or revoked token loses access immediately', async () => {
    const a = await signUp();
    const id = (await api.create(a.token)).body.data.id;
    await a.agent.post('/api/v1/auth/logout').set({ 'X-Requested-With': 'cms' });
    assert.equal((await api.get(a.token, id)).status, 401);
  });
});

describe('signed asset links', () => {
  async function setup() {
    const a = await signUp();
    const b = await signUp();
    const id = (await api.create(a.token)).body.data.id;
    const a1 = (await api.upload(a.token, id, files.png(300), 'one.png')).body.data;
    const a2 = (await api.upload(a.token, id, files.jpg(300), 'two.jpg')).body.data;
    const bId = (await api.create(b.token)).body.data.id;
    const b1 = (await api.upload(b.token, bId, files.png(300), 'b.png')).body.data;
    return { a, b, a1, a2, b1 };
  }
  const fileUrl = (path) => `/api/v1${path}`;

  test('an access link loads the file without an Authorization header, with safe response headers', async () => {
    const { a, a1 } = await setup();
    const link = (await api.access(a.token, a1.id)).body;
    assert.match(link.path, new RegExp(`^/media/${a1.id}/file\\?token=`));
    assert.equal(link.expiresInSeconds, 300);

    const res = await request(app).get(fileUrl(link.path));
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'], /sandbox/);
    assert.match(res.headers['cache-control'], /private/);
    assert.equal(res.body.length, 300);
  });

  test('a token works only for the asset it was issued for', async () => {
    const { a, a1, a2 } = await setup();
    const token = (await api.access(a.token, a1.id)).body.path.split('token=')[1];
    assert.equal((await request(app).get(`/api/v1/media/${a1.id}/file?token=${token}`)).status, 200);
    const other = await request(app).get(`/api/v1/media/${a2.id}/file?token=${token}`); // same owner, different asset
    assert.equal(other.status, 401);
  });

  test("another user's token cannot open my file, and my token cannot open theirs", async () => {
    const { a, b, a1, b1 } = await setup();
    const aToken = (await api.access(a.token, a1.id)).body.path.split('token=')[1];
    const bToken = (await api.access(b.token, b1.id)).body.path.split('token=')[1];
    assert.equal((await request(app).get(`/api/v1/media/${a1.id}/file?token=${bToken}`)).status, 401);
    assert.equal((await request(app).get(`/api/v1/media/${b1.id}/file?token=${aToken}`)).status, 401);
    // a user cannot even mint a link for someone else's asset
    assert.equal((await api.access(b.token, a1.id)).status, 404);
  });

  test('expired, tampered, malformed and wrong-kind tokens are rejected', async () => {
    const { a, a1 } = await setup();
    const secret = process.env.JWT_ACCESS_SECRET;
    const expired = jwt.sign({ aid: a1.id, own: a.user.id }, assetTokenKey(secret), { algorithm: 'HS256', issuer: 'cms', audience: 'asset', expiresIn: -5 });
    const good = signAssetToken({ assetId: a1.id, ownerId: a.user.id });
    const wrongKey = jwt.sign({ aid: a1.id, own: a.user.id }, secret, { algorithm: 'HS256', issuer: 'cms', audience: 'asset', expiresIn: 60 });
    const noAudience = jwt.sign({ aid: a1.id, own: a.user.id }, assetTokenKey(secret), { algorithm: 'HS256', issuer: 'cms', expiresIn: 60 });
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ aid: a1.id, own: a.user.id })).toString('base64url')}.`;
    const cases = { expired, tampered: `${good}x`, 'access token used as link': a.token, 'signed with the access secret': wrongKey, 'no audience': noAudience, 'alg none': none, garbage: 'abc.def.ghi', empty: '' };
    for (const [name, token] of Object.entries(cases)) {
      const res = await request(app).get(`/api/v1/media/${a1.id}/file?token=${token}`);
      // an empty token falls through to normal auth, which also fails
      assert.equal(res.status, 401, name);
    }
    assert.equal((await request(app).get(`/api/v1/media/${a1.id}/file?token=${good}`)).status, 200);
  });

  test('an asset link is not an access token for the API', async () => {
    const { a, a1 } = await setup();
    const token = (await api.access(a.token, a1.id)).body.path.split('token=')[1];
    assert.equal((await api.get(token, GHOST)).status, 401);
    assert.equal((await request(app).get('/api/v1/me').set(bearer(token))).status, 401);
  });

  test('a link stops working once the asset is deleted', async () => {
    const { a, a1 } = await setup();
    const path = (await api.access(a.token, a1.id)).body.path;
    assert.equal((await request(app).get(`/api/v1${path}`)).status, 200);
    const contentId = (await MediaAsset.findById(a1.id)).content;
    assert.equal((await api.removeAsset(a.token, contentId, a1.id)).status, 204);
    assert.equal((await request(app).get(`/api/v1${path}`)).status, 404);
  });

  test('the file route also works with a normal Authorization header', async () => {
    const { a, b, a1 } = await setup();
    assert.equal((await request(app).get(`/api/v1/media/${a1.id}/file`).set(bearer(a.token))).status, 200);
    assert.equal((await request(app).get(`/api/v1/media/${a1.id}/file`).set(bearer(b.token))).status, 404);
  });
});
