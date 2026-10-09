import { test } from 'node:test';
import assert from 'node:assert/strict';

// Must be set before the app (and its limiters) are created.
process.env.AUTH_RATE_LIMIT_MAX = '3';
const { app, request, signUp, useDatabase } = await import('./helpers/app.js');

useDatabase();

test('failed logins are rate-limited per IP with a 429 in the standard error shape', async () => {
  const { body } = await signUp({ email: 'rl@example.com' }); // success does not count
  const attempt = () => request(app).post('/api/v1/auth/login').send({ email: body.email, password: 'wrong-password-1' });
  for (let i = 0; i < 3; i++) assert.equal((await attempt()).status, 401);
  const blocked = await attempt();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  // even correct credentials are throttled once the budget is spent
  const correct = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: body.password });
  assert.equal(correct.status, 429);
});
