import { app, bearer, request } from './app.js';
import { newClient } from './clients.js';

const base = '/api/v1/campaigns';

export const camps = {
  create: (token, body = {}) => request(app).post(base).set(bearer(token)).send({ title: 'Summer launch', ...body }),
  get: (token, id) => request(app).get(`${base}/${id}`).set(bearer(token)),
  patch: (token, id, body) => request(app).patch(`${base}/${id}`).set(bearer(token)).send(body),
  list: (token, q = '') => request(app).get(`${base}${q ? `?${q}` : ''}`).set(bearer(token)),
  meta: (token) => request(app).get(`${base}/meta`).set(bearer(token)),
  lookup: (token) => request(app).get(`${base}/lookup`).set(bearer(token)),
  move: (token, id, to, extra = {}) => request(app).post(`${base}/${id}/transition`).set(bearer(token)).send({ to, ...extra }),
  archive: (token, id) => request(app).post(`${base}/${id}/archive`).set(bearer(token)),
  restore: (token, id) => request(app).post(`${base}/${id}/restore`).set(bearer(token)),
  remove: (token, id) => request(app).delete(`${base}/${id}`).set(bearer(token)),
  linkContent: (token, id, contentId) => request(app).post(`${base}/${id}/content`).set(bearer(token)).send({ contentId }),
  unlinkContent: (token, id, contentId) => request(app).delete(`${base}/${id}/content/${contentId}`).set(bearer(token)),
};

export const deliverables = {
  create: (token, id, body = {}) => request(app).post(`${base}/${id}/deliverables`).set(bearer(token)).send({ title: 'Reel', ...body }),
  patch: (token, id, did, body) => request(app).patch(`${base}/${id}/deliverables/${did}`).set(bearer(token)).send(body),
  move: (token, id, did, to, extra = {}) => request(app).post(`${base}/${id}/deliverables/${did}/transition`).set(bearer(token)).send({ to, ...extra }),
  remove: (token, id, did) => request(app).delete(`${base}/${id}/deliverables/${did}`).set(bearer(token)),
};

/** A YYYY-MM-DD date `n` days from today (UTC; test users default to UTC). */
export const day = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Creates a brand + campaign through the API and returns both ids. */
export async function newCampaign(token, body = {}) {
  const client = body.client ?? (await newClient(token, { name: `Brand ${Math.random().toString(36).slice(2, 8)}` }));
  const res = await camps.create(token, { client, ...body });
  if (res.status !== 201) throw new Error(`newCampaign failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.data.id, client, body: res.body.data };
}

/** Creates a deliverable and walks it to `status` along the allowed path; returns its id. */
export async function deliverableAt(token, campaignId, status, body = {}) {
  const res = await deliverables.create(token, campaignId, body);
  if (res.status !== 201) throw new Error(`deliverable failed: ${res.status} ${JSON.stringify(res.body)}`);
  const did = res.body.data[0].id;
  const approval = body.requiresApproval !== false;
  const path = {
    pending: [],
    in_progress: ['in_progress'],
    completed: ['completed'],
    submitted: ['completed', 'submitted'],
    changes_requested: ['completed', 'submitted', 'changes_requested'],
    approved: ['completed', 'submitted', 'approved'],
    delivered: approval ? ['completed', 'submitted', 'approved', 'delivered'] : ['completed', 'delivered'],
  }[status];
  for (const to of path) {
    const r = await deliverables.move(token, campaignId, did, to, to === 'changes_requested' ? { note: 'Make it shorter' } : {});
    if (r.status !== 200) throw new Error(`deliverableAt(${status}) failed at ${to}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return did;
}
