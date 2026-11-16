import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { clients, discussions, newClient } from './helpers/clients.js';
import { setTimezone } from './helpers/calendar.js';

useDatabase();

const list = (token, q = '') => request(app).get(`/api/v1/communications${q ? `?${q}` : ''}`).set(bearer(token));
const at = (daysAgo, hour = 12) => new Date(Date.UTC(2026, 9, 14 - daysAgo, hour)).toISOString();
const log = (token, client, body) => discussions.create(token, client, { occurredAt: at(1), ...body });

describe('discussions across all brands', () => {
  async function seed() {
    const a = await signUp();
    const glow = await newClient(a.token, { name: 'Glow Co' });
    const zest = await newClient(a.token, { name: 'Zest Foods' });
    await log(a.token, glow, { subject: 'Rates call', body: 'Agreed a revised rate card', channel: 'call', direction: 'outbound', occurredAt: at(5) });
    await log(a.token, zest, { subject: 'Shipping', body: 'Product arrives Friday', channel: 'email', direction: 'inbound', occurredAt: at(2) });
    await log(a.token, glow, { subject: 'Approval', body: 'Please approve the draft', channel: 'dm', direction: 'inbound', occurredAt: at(1) });
    return { a, glow, zest };
  }
  const subjects = async (token, q) => (await list(token, q)).body.data.map((d) => d.subject);

  test('lists every brand\'s discussions newest first, each with its brand', async () => {
    const { a, glow } = await seed();
    const res = await list(a.token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((d) => d.subject), ['Approval', 'Shipping', 'Rates call']);
    assert.deepEqual(res.body.data.map((d) => d.client.name), ['Glow Co', 'Zest Foods', 'Glow Co']);
    assert.equal(res.body.data[0].client.id, glow);
    assert.deepEqual([res.body.meta.total, res.body.meta.pages], [3, 1]);
  });

  test('filters by brand, channel, direction, search text and date range, and they combine', async () => {
    const { a, glow, zest } = await seed();
    assert.deepEqual(await subjects(a.token, `client=${glow}`), ['Approval', 'Rates call']);
    assert.deepEqual(await subjects(a.token, `client=${zest}`), ['Shipping']);
    assert.deepEqual(await subjects(a.token, 'channel=call,dm'), ['Approval', 'Rates call']);
    assert.deepEqual(await subjects(a.token, 'direction=inbound'), ['Approval', 'Shipping']);
    assert.deepEqual(await subjects(a.token, 'q=RATE'), ['Rates call'], 'subject and notes, case-insensitive');
    assert.deepEqual(await subjects(a.token, 'q=friday'), ['Shipping']);
    assert.deepEqual(await subjects(a.token, 'from=2026-10-10&to=2026-10-12'), ['Shipping']);
    assert.deepEqual(await subjects(a.token, `client=${glow}&direction=inbound&q=draft`), ['Approval']);
    assert.deepEqual(await subjects(a.token, 'q=.*'), [], 'search text is literal');
    for (const bad of ['channel=carrier-pigeon', 'direction=sideways', 'from=2026-02-30x', 'limit=1000', 'client=nope']) assert.equal((await list(a.token, bad)).status, 400, bad);
  });

  test('date filters follow the user\'s timezone', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'Asia/Kolkata');
    const brand = await newClient(a.token, { name: 'Late Co' });
    await discussions.create(a.token, brand, { subject: 'Night', occurredAt: '2026-10-13T20:00:00Z' }); // 14 Oct 01:30 in Kolkata
    assert.deepEqual(await subjects(a.token, 'from=2026-10-14&to=2026-10-14'), ['Night']);
    assert.deepEqual(await subjects(a.token, 'from=2026-10-13&to=2026-10-13'), []);
  });

  test('paginates with an exact total', async () => {
    const { a } = await seed();
    const p2 = (await list(a.token, 'limit=2&page=2')).body;
    assert.deepEqual(p2.data.map((d) => d.subject), ['Rates call']);
    assert.deepEqual([p2.meta.total, p2.meta.pages, p2.meta.page], [3, 2, 2]);
  });

  test('archived brands keep their history visible and marked', async () => {
    const { a, zest } = await seed();
    await clients.archive(a.token, zest);
    const row = (await list(a.token)).body.data.find((d) => d.subject === 'Shipping');
    assert.deepEqual([row.client.name, row.client.archived], ['Zest Foods', true]);
  });

  test('only your own discussions are ever returned', async () => {
    const { a } = await seed();
    const b = await signUp();
    const theirs = await newClient(b.token, { name: 'Stranger Brand' });
    await discussions.create(b.token, theirs, { subject: 'STRANGER SUBJECT', body: 'STRANGER BODY' });
    assert.ok(!JSON.stringify((await list(a.token)).body).includes('STRANGER'));
    assert.ok(!JSON.stringify((await list(a.token, 'q=STRANGER')).body).includes('STRANGER'));
    assert.equal((await list(a.token, 'q=STRANGER')).body.meta.total, 0);
    const foreign = await list(a.token, `client=${theirs}`);
    const missing = await list(a.token, 'client=64b64b64b64b64b64b64b64b');
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, missing.body, 'a foreign brand looks exactly like a missing one');
    const trick = await request(app).get(`/api/v1/communications?owner=${b.user.id}`).set(bearer(a.token)).set('X-User-Id', b.user.id);
    assert.equal(trick.body.meta.total, 3);
    assert.equal(b.user.id === a.user.id, false);
  });

  test('needs a signed-in user and does not hide the per-discussion routes', async () => {
    assert.equal((await request(app).get('/api/v1/communications')).status, 401);
    const { a, glow } = await seed();
    const id = (await list(a.token)).body.data[0].id;
    assert.equal((await discussions.get(a.token, id)).status, 200);
    assert.equal((await discussions.list(a.token, glow)).body.meta.total, 2);
  });
});
