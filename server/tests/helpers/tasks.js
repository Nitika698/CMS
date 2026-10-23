import { app, bearer, request } from './app.js';

const base = '/api/v1/tasks';

export const tasks = {
  create: (token, body = {}) => request(app).post(base).set(bearer(token)).send({ title: 'Edit the reel', ...body }),
  get: (token, id) => request(app).get(`${base}/${id}`).set(bearer(token)),
  patch: (token, id, body) => request(app).patch(`${base}/${id}`).set(bearer(token)).send(body),
  list: (token, q = '') => request(app).get(`${base}${q ? `?${q}` : ''}`).set(bearer(token)),
  summary: (token) => request(app).get(`${base}/summary`).set(bearer(token)),
  meta: (token) => request(app).get(`${base}/meta`).set(bearer(token)),
  move: (token, id, to) => request(app).post(`${base}/${id}/transition`).set(bearer(token)).send({ to }),
  complete: (token, id) => request(app).post(`${base}/${id}/complete`).set(bearer(token)),
  reopen: (token, id) => request(app).post(`${base}/${id}/reopen`).set(bearer(token)),
  archive: (token, id) => request(app).post(`${base}/${id}/archive`).set(bearer(token)),
  restore: (token, id) => request(app).post(`${base}/${id}/restore`).set(bearer(token)),
  remove: (token, id) => request(app).delete(`${base}/${id}`).set(bearer(token)),
};

/** Creates a task through the API and returns its public form. */
export async function newTask(token, body = {}) {
  const res = await tasks.create(token, body);
  if (res.status !== 201) throw new Error(`newTask failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** A YYYY-MM-DD date `n` days from today (UTC; test users default to UTC). */
export const day = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
