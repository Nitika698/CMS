import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app, bearer, CSRF, PASSWORD, refreshCookie, request, signUp, useDatabase } from './helpers/app.js';
import { Session } from '../src/modules/auth/session.model.js';
import { User } from '../src/modules/users/user.model.js';

const SECRET = process.env.JWT_ACCESS_SECRET;
useDatabase();

describe('signup', () => {
  test('creates a user, returns a token, sets a hardened refresh cookie, and leaks nothing sensitive', async () => {
    const { res, body } = await signUp({ email: '  Mixed.Case@Example.COM ' });
    assert.equal(res.body.user.email, 'mixed.case@example.com');
    assert.ok(res.body.accessToken);
    assert.equal(res.headers['cache-control'], 'no-store');

    const cookie = refreshCookie(res);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api\/v1\/auth/);

    const text = JSON.stringify(res.body);
    for (const secret of [body.password, 'passwordHash', 'currentHash', 'failedLoginCount', 'lockedUntil', '$2']) {
      assert.ok(!text.includes(secret), `response must not contain ${secret}`);
    }
    assert.ok(!text.includes(cookie.split(';')[0].split('=')[1]), 'refresh token must not be in the JSON body');
  });

  test('stores a bcrypt hash, never the password; stores only a hash of the refresh token', async () => {
    const { res, body } = await signUp();
    const stored = await User.findOne({ email: body.email }).select('+passwordHash');
    assert.match(stored.passwordHash, /^\$2[aby]\$/);
    assert.notEqual(stored.passwordHash, body.password);
    const raw = refreshCookie(res).split(';')[0].split('=')[1];
    const session = await Session.findOne({ user: stored._id });
    assert.notEqual(session.currentHash, raw);
    assert.equal(session.currentHash.length, 64);
  });

  test('rejects duplicate email, case-insensitively, with 409', async () => {
    await signUp({ email: 'dup@example.com' });
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'DUP@example.com', password: PASSWORD, name: 'X' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  test('validates input and rejects unknown fields (mass assignment)', async () => {
    const post = (b) => request(app).post('/api/v1/auth/register').send(b);
    const ok = { email: 'v@example.com', password: PASSWORD, name: 'V' };
    for (const bad of [
      { ...ok, email: 'not-an-email' },
      { ...ok, password: 'short1!' },
      { ...ok, password: 'onlylettersnonumber' },
      { ...ok, password: 'a1'.repeat(40) }, // > 72 bytes
      { ...ok, name: '' },
      { ...ok, timezone: 'Mars/Phobos' },
      { ...ok, role: 'admin' },
      { ...ok, _id: '507f1f77bcf86cd799439011' },
      { ...ok, passwordHash: 'x' },
    ]) {
      const res = await post(bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(Array.isArray(res.body.error.details));
    }
    assert.equal(await User.countDocuments(), 0);
  });

  test('malformed JSON returns the standard error shape', async () => {
    const res = await request(app).post('/api/v1/auth/register').set('Content-Type', 'application/json').send('{bad');
    assert.equal(res.status, 400);
    assert.ok(res.body.error.code && res.body.error.message);
  });
});

describe('login', () => {
  test('succeeds with correct credentials (email is case-insensitive)', async () => {
    const { body } = await signUp({ email: 'login@example.com' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'LOGIN@example.com', password: body.password });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken);
    assert.ok(refreshCookie(res));
    assert.equal((await Session.countDocuments()), 2);
  });

  test('wrong password and unknown email give the identical generic 401', async () => {
    const { body } = await signUp({ email: 'who@example.com' });
    const wrong = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: 'wrong-password-1' });
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password-1' });
    for (const r of [wrong, unknown]) {
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, 'INVALID_CREDENTIALS');
      assert.equal(r.body.error.message, 'Invalid email or password');
      assert.equal(refreshCookie(r), undefined);
    }
  });

  test('locks the account after repeated failures, even for the correct password', async () => {
    const { body } = await signUp({ email: 'lock@example.com' });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: body.email, password: 'wrong-password-1' });
    }
    const res = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: body.password });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS'); // no enumeration of lock state
    await User.updateOne({ email: body.email }, { lockedUntil: new Date(Date.now() - 1000) });
    const after = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: body.password });
    assert.equal(after.status, 200);
  });
});

describe('current user and unauthorized access', () => {
  test('GET /me returns the profile for a valid token', async () => {
    const { token, user } = await signUp();
    const res = await request(app).get('/api/v1/me').set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, user.id);
    assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
  });

  test('protected routes reject missing, malformed, tampered, wrong-secret and alg=none tokens with 401', async () => {
    const { token, user } = await signUp();
    const noneToken = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: user.id, sid: user.id, iss: 'creatordesk' }),
    ).toString('base64url')}.`;
    const wrongSecret = jwt.sign({ sid: user.id }, 'another-secret-another-secret-another-1', { subject: user.id, issuer: 'creatordesk' });
    const headers = [
      {},
      { Authorization: 'Bearer' },
      { Authorization: 'Bearer garbage' },
      { Authorization: `Bearer ${token}x` },
      { Authorization: `Bearer ${noneToken}` },
      { Authorization: `Bearer ${wrongSecret}` },
      { Authorization: `Basic ${token}` },
    ];
    for (const path of ['/api/v1/me', '/api/v1/categories']) {
      for (const h of headers) {
        const res = await request(app).get(path).set(h);
        assert.equal(res.status, 401, `${path} ${JSON.stringify(h)}`);
        assert.equal(res.body.error.code, 'UNAUTHENTICATED');
      }
    }
  });

  test('an expired access token is rejected with TOKEN_EXPIRED so the client can refresh', async () => {
    const { user } = await signUp();
    const session = await Session.findOne({ user: user.id });
    const expired = jwt.sign({ sid: String(session._id) }, SECRET, {
      algorithm: 'HS256', subject: user.id, issuer: 'creatordesk', expiresIn: -10,
    });
    const res = await request(app).get('/api/v1/me').set(bearer(expired));
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'TOKEN_EXPIRED');
  });
});

describe('refresh, expiry and logout', () => {
  test('refresh rotates the token and issues a working access token', async () => {
    const { agent, res: reg } = await signUp();
    const before = refreshCookie(reg);
    const res = await agent.post('/api/v1/auth/refresh').set(CSRF);
    assert.equal(res.status, 200);
    assert.notEqual(refreshCookie(res).split(';')[0], before.split(';')[0]);
    const me = await request(app).get('/api/v1/me').set(bearer(res.body.accessToken));
    assert.equal(me.status, 200);
  });

  test('refresh without a cookie is 401 SESSION/UNAUTH; without the CSRF header is 403; with a foreign Origin is 403', async () => {
    const { agent } = await signUp();
    assert.equal((await request(app).post('/api/v1/auth/refresh').set(CSRF)).status, 401);
    assert.equal((await agent.post('/api/v1/auth/refresh')).status, 403);
    const evil = await agent.post('/api/v1/auth/refresh').set(CSRF).set('Origin', 'https://evil.example');
    assert.equal(evil.status, 403);
    assert.equal(evil.body.error.code, 'CSRF_REJECTED');
    const okOrigin = await agent.post('/api/v1/auth/refresh').set(CSRF).set('Origin', 'http://localhost:5173');
    assert.equal(okOrigin.status, 200);
    // dev server behind the Vite proxy: any localhost port (non-production only)
    const devProxy = await agent.post('/api/v1/auth/refresh').set(CSRF).set('Origin', 'http://localhost:5174');
    assert.equal(devProxy.status, 200);
    // look-alike hosts must not slip through the localhost rule
    for (const o of ['http://localhost.evil.example', 'http://localhost:5173.evil.example', 'https://localhost:5173']) {
      assert.equal((await agent.post('/api/v1/auth/refresh').set(CSRF).set('Origin', o)).status, 403, o);
    }
  });

  test('an expired refresh session cannot be refreshed and the stale cookie is cleared', async () => {
    const { agent } = await signUp();
    await Session.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    const res = await agent.post('/api/v1/auth/refresh').set(CSRF);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'SESSION_EXPIRED');
    assert.match(refreshCookie(res), /cd_refresh=;/);
  });

  test('an expired session also invalidates a still-unexpired access token', async () => {
    const { token } = await signUp();
    await Session.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    const res = await request(app).get('/api/v1/me').set(bearer(token));
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'SESSION_EXPIRED');
  });

  test('replaying a just-rotated refresh token (multi-tab race) is a retryable 409 and does not kill the session', async () => {
    const { agent, res: reg } = await signUp();
    const old = refreshCookie(reg).split(';')[0];
    assert.equal((await agent.post('/api/v1/auth/refresh').set(CSRF)).status, 200);
    const race = await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', old);
    assert.equal(race.status, 409);
    assert.equal(race.body.error.code, 'REFRESH_CONFLICT');
    assert.equal((await agent.post('/api/v1/auth/refresh').set(CSRF)).status, 200);
  });

  test('replaying an old refresh token after the grace window revokes the whole session (theft detection)', async () => {
    const { agent, res: reg } = await signUp();
    const stolen = refreshCookie(reg).split(';')[0];
    assert.equal((await agent.post('/api/v1/auth/refresh').set(CSRF)).status, 200);
    await Session.updateMany({}, { rotatedAt: new Date(Date.now() - 60_000) });

    const replay = await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', stolen);
    assert.equal(replay.status, 401);
    assert.ok((await Session.findOne()).revokedAt, 'session must be revoked');
    // the legitimate holder is signed out as well
    assert.equal((await agent.post('/api/v1/auth/refresh').set(CSRF)).status, 401);
  });

  test('logout revokes the session: access token and refresh cookie both stop working; cookie is cleared', async () => {
    const { agent, token } = await signUp();
    const out = await agent.post('/api/v1/auth/logout').set(CSRF);
    assert.equal(out.status, 204);
    assert.match(refreshCookie(out), /cd_refresh=;/);
    assert.equal((await request(app).get('/api/v1/me').set(bearer(token))).status, 401);
    assert.equal((await agent.post('/api/v1/auth/refresh').set(CSRF)).status, 401);
  });

  test('logout is idempotent and needs the CSRF header', async () => {
    assert.equal((await request(app).post('/api/v1/auth/logout').set(CSRF)).status, 204);
    assert.equal((await request(app).post('/api/v1/auth/logout')).status, 403);
  });

  test('logout-all signs out every device', async () => {
    const a = await signUp({ email: 'multi@example.com' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'multi@example.com', password: PASSWORD });
    const out = await request(app).post('/api/v1/auth/logout-all').set(bearer(a.token));
    assert.equal(out.status, 204);
    assert.equal((await request(app).get('/api/v1/me').set(bearer(b.body.accessToken))).status, 401);
  });
});

describe('profile editing', () => {
  test('updates allowed fields only', async () => {
    const { token } = await signUp();
    const res = await request(app).patch('/api/v1/me').set(bearer(token)).send({ name: 'New Name', timezone: 'Asia/Kolkata', defaultCurrency: 'inr' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'New Name');
    assert.equal(res.body.user.timezone, 'Asia/Kolkata');
    assert.equal(res.body.user.defaultCurrency, 'INR');
  });

  test('rejects email/password/unknown fields and invalid values', async () => {
    const { token } = await signUp();
    for (const bad of [{ email: 'x@y.com' }, { passwordHash: 'x' }, { _id: 'x' }, { name: '' }, { timezone: 'Nope/Nope' }, { defaultCurrency: 'DOLLARS' }, {}]) {
      const res = await request(app).patch('/api/v1/me').set(bearer(token)).send(bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  });

  test('a user can only ever edit their own profile (no id in the route)', async () => {
    const a = await signUp({ name: 'Alice' });
    const b = await signUp({ name: 'Bob' });
    await request(app).patch('/api/v1/me').set(bearer(a.token)).send({ name: 'Alice 2' });
    const bob = await request(app).get('/api/v1/me').set(bearer(b.token));
    assert.equal(bob.body.user.name, 'Bob');
    assert.equal((await request(app).patch('/api/v1/me/' + b.user.id).set(bearer(a.token)).send({ name: 'Pwn' })).status, 404);
  });

  test('change password: needs the current password, signs out other devices, new password works', async () => {
    const a = await signUp({ email: 'pw@example.com' });
    const other = await request(app).post('/api/v1/auth/login').send({ email: 'pw@example.com', password: PASSWORD });
    const bad = await request(app).post('/api/v1/me/change-password').set(bearer(a.token)).send({ currentPassword: 'nope-nope-nope1', newPassword: 'brand-new-pass-1' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_CURRENT_PASSWORD');

    const ok = await request(app).post('/api/v1/me/change-password').set(bearer(a.token)).send({ currentPassword: PASSWORD, newPassword: 'brand-new-pass-1' });
    assert.equal(ok.status, 204);
    assert.equal((await request(app).get('/api/v1/me').set(bearer(a.token))).status, 200); // this device stays signed in
    assert.equal((await request(app).get('/api/v1/me').set(bearer(other.body.accessToken))).status, 401);
    assert.equal((await request(app).post('/api/v1/auth/login').send({ email: 'pw@example.com', password: PASSWORD })).status, 401);
    assert.equal((await request(app).post('/api/v1/auth/login').send({ email: 'pw@example.com', password: 'brand-new-pass-1' })).status, 200);
  });
});
