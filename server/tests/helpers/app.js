import './setup.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import { after, before, beforeEach } from 'node:test';

const { createApp } = await import('../../src/app.js');
export const app = createApp();

export const PASSWORD = 'correct-horse-9';
export const CSRF = { 'X-Requested-With': 'cms' };

export function useDatabase() {
  before(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoose.connection.dropDatabase();
    await mongoose.syncIndexes();
    for (const m of Object.values(mongoose.models)) await m.syncIndexes();
  });
  beforeEach(async () => {
    for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
    // every test starts with no stored files and no temp uploads, so "nothing was written" assertions are meaningful
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    fs.rmSync(path.join(os.tmpdir(), 'cms-uploads'), { recursive: true, force: true });
  });
  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

let n = 0;
/** Registers a fresh user and returns an agent that keeps its refresh cookie, plus its tokens. */
export async function signUp(overrides = {}) {
  const agent = request.agent(app);
  const body = { email: `user${++n}@example.com`, password: PASSWORD, name: `User ${n}`, ...overrides };
  const res = await agent.post('/api/v1/auth/register').send(body);
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, body, user: res.body.user, token: res.body.accessToken, res };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });
export const refreshCookie = (res) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('cd_refresh='));
export { request };
