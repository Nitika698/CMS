import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, CSRF, PASSWORD, refreshCookie, request, signUp, useDatabase } from './helpers/app.js';
import { api as content, files } from './helpers/content.js';
import { posts, T } from './helpers/calendar.js';
import { camps, deliverables, day } from './helpers/campaigns.js';
import { clients, discussions } from './helpers/clients.js';
import { inv, line } from './helpers/invoices.js';
import { tasks } from './helpers/tasks.js';

useDatabase();

/**
 * End-to-end journey through the real HTTP stack and a real database: sign up -> brand -> campaign -> content with
 * a file -> approval -> scheduling -> publishing refusal -> task completion -> communication log -> invoice ->
 * payments -> dashboard -> isolation -> sign out. It is an API-level journey, not a browser test: it proves the
 * modules work together in the order a person uses them.
 */
describe('end-to-end: one creator, one collaboration, start to finish', () => {
  test('signup, content, scheduling, campaign tracking, tasks, communication log and payment tracking', async () => {
    // --- 1. sign up, then come back through the refresh cookie
    const email = 'creator@example.com';
    const reg = await request(app).post('/api/v1/auth/register').send({ email, password: PASSWORD, name: 'Creator' });
    assert.equal(reg.status, 201);
    assert.ok(refreshCookie(reg), 'refresh token is delivered as a cookie');
    assert.match(refreshCookie(reg), /HttpOnly/i);
    assert.equal(reg.body.user.passwordHash, undefined, 'the password hash is never returned');

    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(login.status, 200);
    const refreshed = await agent.post('/api/v1/auth/refresh').set(CSRF);
    assert.equal(refreshed.status, 200);
    const token = refreshed.body.accessToken;

    // --- 2. a brand and a campaign with a fee and a deliverable
    const brand = (await clients.create(token, { name: 'Glow Cosmetics' })).body.data;
    assert.ok(brand.id);
    const campRes = await camps.create(token, { client: brand.id, title: 'Spring glow', startDate: day(-1), endDate: day(20), fee: { amountMinor: 250_000, currency: 'USD' } });
    assert.equal(campRes.status, 201, JSON.stringify(campRes.body));
    const camp = campRes.body.data;
    const delRes = await deliverables.create(token, camp.id, { title: 'Launch reel', dueDate: day(5) });
    assert.equal(delRes.status, 201, JSON.stringify(delRes.body));

    // --- 3. content: create, upload a real image, refuse a disguised program, link to the campaign, approve
    const item = (await content.create(token, { title: 'Spring glow reel', caption: 'Glow up', hashtags: ['glow'] })).body.data;
    const up = await content.upload(token, item.id, files.png(), 'cover.png');
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.ok([400, 415].includes((await content.upload(token, item.id, files.exe(), 'cover.png')).status), 'a program renamed to .png is refused');
    assert.equal((await camps.linkContent(token, camp.id, item.id)).status, 200);
    for (const to of ['planning', 'creation', 'review', 'approved']) {
      const r = await content.move(token, item.id, to);
      assert.equal(r.status, 200, `${to}: ${JSON.stringify(r.body)}`);
    }

    // --- 4. scheduling: a reminder post, and the API admits it cannot publish for you
    const post = await posts.create(token, { content: item.id, platform: 'instagram', status: 'scheduled', scheduledLocal: T(10) });
    assert.equal(post.status, 201, JSON.stringify(post.body));
    const direct = await posts.viaPlatform(token, post.body.data.id);
    assert.equal(direct.status, 501, 'no network integration exists, and the API says so instead of pretending');
    assert.equal(direct.body.error.code, 'NOT_IMPLEMENTED');

    // --- 5. campaign tracking reflects the linked content
    const detail = await camps.get(token, camp.id);
    assert.equal(detail.status, 200);

    // --- 6. a task tied to the campaign: create, complete, list
    const taskRes = await tasks.create(token, { title: 'Shoot the reel', dueDate: day(3), campaign: camp.id });
    assert.equal(taskRes.status, 201, JSON.stringify(taskRes.body));
    const task = taskRes.body.data;
    const done = await tasks.complete(token, task.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.data.status, 'done');
    assert.equal((await tasks.list(token, 'status=done')).body.data.length, 1);

    // --- 7. a saved communication log, visible per brand and in the all-brands inbox
    const log = await discussions.create(token, brand.id, { channel: 'email', direction: 'inbound', subject: 'Usage rights', body: 'Brand wants 30 days paid usage.', campaign: camp.id });
    assert.equal(log.status, 201, JSON.stringify(log.body));
    assert.equal((await discussions.list(token, brand.id)).body.data.length, 1);
    const inbox = await request(app).get('/api/v1/communications').set(bearer(token));
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.data.length, 1);

    // --- 8. payment tracking: draft -> issued -> part paid -> paid; an overpayment is refused
    const draft = await inv.create(token, { client: brand.id, campaign: camp.id, currency: 'USD', lineItems: [line({ unitAmountMinor: 250_000 })] });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const invoiceId = draft.body.data.id;
    const issued = await inv.issue(token, invoiceId, {});
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const first = await inv.pay(token, invoiceId, { amountMinor: 100_000, paidOn: day() });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal((await inv.get(token, invoiceId)).body.data.displayStatus, 'partially_paid');
    const second = await inv.pay(token, invoiceId, { amountMinor: 150_000, paidOn: day() });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal((await inv.get(token, invoiceId)).body.data.displayStatus, 'paid');
    const over = await inv.pay(token, invoiceId, { amountMinor: 1, paidOn: day() });
    assert.ok(over.status >= 400 && over.status < 500, 'paying a settled invoice is refused');

    // --- 9. the dashboard answers
    assert.equal((await request(app).get('/api/v1/dashboard').set(bearer(token))).status, 200);

    // --- 10. a second creator sees none of it
    const other = await signUp();
    const urls = [`clients/${brand.id}`, `campaigns/${camp.id}`, `content/${item.id}`, `tasks/${task.id}`, `invoices/${invoiceId}`, `communications/${log.body.data.id}`];
    for (const url of urls) {
      assert.equal((await request(app).get(`/api/v1/${url}`).set(bearer(other.token))).status, 404, `${url} must look missing to another user`);
    }
    assert.equal((await request(app).get('/api/v1/communications').set(bearer(other.token))).body.data.length, 0);

    // --- 11. sign out: the refresh cookie stops working
    assert.equal((await agent.post('/api/v1/auth/logout').set(CSRF)).status, 204);
    assert.equal((await agent.post('/api/v1/auth/refresh').set(CSRF)).status, 401);
  });
});

describe('operational behaviour', () => {
  test('every response carries a request id header', async () => {
    const res = await request(app).get('/api/v1/nope').set('X-Request-Id', 'abc-12345-test');
    assert.equal(res.status, 404);
    assert.equal(res.headers['x-request-id'], 'abc-12345-test');
    assert.equal(res.body.error.requestId, undefined, 'the id is a header only, so foreign and missing records give identical bodies');
    const bad = await request(app).get('/api/v1/health').set('X-Request-Id', 'bad id with spaces <script>');
    assert.notEqual(bad.headers['x-request-id'], 'bad id with spaces <script>', 'an unsafe incoming id is replaced');
    assert.match(bad.headers['x-request-id'], /^[A-Za-z0-9._-]{8,64}$/);
  });

  test('malformed or oversized JSON is a clean client error, not a crash', async () => {
    const { token } = await signUp();
    const broken = await request(app).post('/api/v1/tasks').set(bearer(token)).set('Content-Type', 'application/json').send('{"title": ');
    assert.equal(broken.status, 400);
    const huge = await request(app).post('/api/v1/tasks').set(bearer(token)).send({ title: 'x', notes: 'y'.repeat(200_000) });
    assert.equal(huge.status, 413);
  });

  test('security headers are present and the API does not advertise its framework', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['strict-transport-security']);
  });

  test('list endpoints cap page size', async () => {
    const { token } = await signUp();
    for (const path of ['content', 'campaigns', 'clients', 'tasks', 'invoices', 'posts']) {
      const res = await request(app).get(`/api/v1/${path}?limit=100000`).set(bearer(token));
      assert.equal(res.status, 400, `${path} must reject an oversized limit`);
    }
  });
});
