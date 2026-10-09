import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/creatordesk-test';
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app.js');
const app = createApp();

test('GET /api/v1/health returns ok without needing the database', async () => {
  const res = await request(app).get('/api/v1/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('GET /api/v1/health/ready returns 503 when the database is not connected', async () => {
  const res = await request(app).get('/api/v1/health/ready');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'degraded');
  assert.equal(res.body.database, 'disconnected');
});

test('unknown routes return the standard error shape', async () => {
  const res = await request(app).get('/api/v1/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('security headers are set and x-powered-by is hidden', async () => {
  const res = await request(app).get('/api/v1/health');
  assert.ok(res.headers['x-content-type-options']);
  assert.equal(res.headers['x-powered-by'], undefined);
});
