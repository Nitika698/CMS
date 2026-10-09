import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { Category } from '../src/modules/categories/category.model.js';
import { assertOwned } from '../src/lib/scoped.js';

useDatabase();

const create = (token, body) => request(app).post('/api/v1/categories').set(bearer(token)).send(body);

describe('user data isolation (Category = reference owner-scoped resource)', () => {
  test('unauthenticated requests cannot touch categories', async () => {
    for (const [method, path] of [['get', '/'], ['post', '/'], ['get', '/507f1f77bcf86cd799439011'], ['patch', '/507f1f77bcf86cd799439011'], ['delete', '/507f1f77bcf86cd799439011']]) {
      assert.equal((await request(app)[method](`/api/v1/categories${path}`).send({})).status, 401, `${method} ${path}`);
    }
  });

  test('owner can create, list, read, update and delete their own category', async () => {
    const { token } = await signUp();
    const made = await create(token, { name: 'Travel', color: '#112233' });
    assert.equal(made.status, 201);
    const id = made.body.data.id;
    assert.equal((await request(app).get('/api/v1/categories').set(bearer(token))).body.data.length, 1);
    assert.equal((await request(app).get(`/api/v1/categories/${id}`).set(bearer(token))).status, 200);
    const upd = await request(app).patch(`/api/v1/categories/${id}`).set(bearer(token)).send({ name: 'Trips' });
    assert.equal(upd.body.data.name, 'Trips');
    assert.equal((await request(app).delete(`/api/v1/categories/${id}`).set(bearer(token))).status, 204);
    assert.equal((await request(app).get(`/api/v1/categories/${id}`).set(bearer(token))).status, 404);
  });

  test("user B gets 404 (not 403) for user A's category on read, update and delete, and nothing changes", async () => {
    const a = await signUp();
    const b = await signUp();
    const id = (await create(a.token, { name: 'Secret plans' })).body.data.id;

    const get = await request(app).get(`/api/v1/categories/${id}`).set(bearer(b.token));
    const patch = await request(app).patch(`/api/v1/categories/${id}`).set(bearer(b.token)).send({ name: 'Hacked' });
    const del = await request(app).delete(`/api/v1/categories/${id}`).set(bearer(b.token));
    for (const r of [get, patch, del]) {
      assert.equal(r.status, 404);
      assert.equal(r.body.error.code, 'NOT_FOUND');
    }
    // Indistinguishable from an id that never existed:
    const ghost = await request(app).get('/api/v1/categories/507f1f77bcf86cd799439011').set(bearer(b.token));
    assert.deepEqual(ghost.body, get.body);

    const still = await Category.findById(id);
    assert.equal(still.name, 'Secret plans');
    assert.equal(String(still.owner), a.user.id);
  });

  test("lists never include another user's rows", async () => {
    const a = await signUp();
    const b = await signUp();
    await create(a.token, { name: 'A-only' });
    await create(b.token, { name: 'B-only' });
    const listB = (await request(app).get('/api/v1/categories').set(bearer(b.token))).body.data;
    assert.deepEqual(listB.map((c) => c.name), ['B-only']);
  });

  test('a client cannot choose the owner: `owner`/`_id` in the body is rejected and nothing is created for the victim', async () => {
    const a = await signUp();
    const b = await signUp();
    for (const extra of [{ owner: a.user.id }, { _id: '507f1f77bcf86cd799439011' }, { nameLower: 'x' }]) {
      const res = await create(b.token, { name: 'Injected', ...extra });
      assert.equal(res.status, 400);
    }
    assert.equal(await Category.countDocuments(), 0);
    // update cannot reassign ownership either
    const mine = (await create(b.token, { name: 'Mine' })).body.data.id;
    assert.equal((await request(app).patch(`/api/v1/categories/${mine}`).set(bearer(b.token)).send({ owner: a.user.id })).status, 400);
    assert.equal(String((await Category.findById(mine)).owner), b.user.id);
  });

  test('the same name is allowed for different users but not twice for one user', async () => {
    const a = await signUp();
    const b = await signUp();
    assert.equal((await create(a.token, { name: 'Food' })).status, 201);
    assert.equal((await create(b.token, { name: 'Food' })).status, 201);
    const dup = await create(a.token, { name: 'FOOD' });
    assert.equal(dup.status, 409);
  });

  test('malformed ids are 404, not 500, and NoSQL-injection style ids are harmless', async () => {
    const { token } = await signUp();
    for (const id of ['abc', '123', '%7B%22%24ne%22%3Anull%7D']) {
      assert.equal((await request(app).get(`/api/v1/categories/${id}`).set(bearer(token))).status, 404);
    }
    const inj = await request(app).post('/api/v1/categories').set(bearer(token)).send({ name: { $ne: null } });
    assert.equal(inj.status, 400);
  });

  test("assertOwned (used for foreign keys) rejects another user's ids", async () => {
    const a = await signUp();
    const b = await signUp();
    const id = (await create(a.token, { name: 'Shared?' })).body.data.id;
    await assertOwned(Category, id, a.user.id);
    await assert.rejects(() => assertOwned(Category, id, b.user.id), { status: 404 });
    await assert.rejects(() => assertOwned(Category, [id, '507f1f77bcf86cd799439011'], a.user.id), { status: 404 });
  });

  test("a deleted user's token stops working", async () => {
    const a = await signUp();
    const { User } = await import('../src/modules/users/user.model.js');
    await User.deleteOne({ _id: a.user.id });
    assert.equal((await request(app).get('/api/v1/me').set(bearer(a.token))).status, 401);
  });
});
