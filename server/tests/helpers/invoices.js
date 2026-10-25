import { app, bearer, request } from './app.js';
import { newClient } from './clients.js';

const base = '/api/v1/invoices';

export const inv = {
  create: (token, body = {}) => request(app).post(base).set(bearer(token)).send(body),
  get: (token, id) => request(app).get(`${base}/${id}`).set(bearer(token)),
  patch: (token, id, body) => request(app).patch(`${base}/${id}`).set(bearer(token)).send(body),
  list: (token, q = '') => request(app).get(`${base}${q ? `?${q}` : ''}`).set(bearer(token)),
  meta: (token) => request(app).get(`${base}/meta`).set(bearer(token)),
  context: (token, campaign) => request(app).get(`${base}/context?campaign=${campaign}`).set(bearer(token)),
  issue: (token, id, body = {}) => request(app).post(`${base}/${id}/issue`).set(bearer(token)).send(body),
  revert: (token, id) => request(app).post(`${base}/${id}/revert`).set(bearer(token)),
  cancel: (token, id, body = {}) => request(app).post(`${base}/${id}/cancel`).set(bearer(token)).send(body),
  remove: (token, id) => request(app).delete(`${base}/${id}`).set(bearer(token)),
  download: (token, id) => request(app).get(`${base}/${id}/download`).set(bearer(token)),
  pay: (token, id, body = {}) => request(app).post(`${base}/${id}/payments`).set(bearer(token)).send(body),
  patchPayment: (token, id, pid, body) => request(app).patch(`${base}/${id}/payments/${pid}`).set(bearer(token)).send(body),
  removePayment: (token, id, pid) => request(app).delete(`${base}/${id}/payments/${pid}`).set(bearer(token)),
};

export const line = (over = {}) => ({ description: 'Instagram reel', quantity: 1, unitAmountMinor: 100_000, taxRatePct: 0, ...over });

/** A draft invoice for a fresh (or given) brand; returns the public invoice plus the brand id. */
export async function newInvoice(token, body = {}) {
  const client = body.client ?? (await newClient(token, { name: `Brand ${Math.random().toString(36).slice(2, 8)}` }));
  const res = await inv.create(token, { client, currency: 'USD', lineItems: [line()], ...body });
  if (res.status !== 201) throw new Error(`newInvoice failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body.data, clientId: client };
}

/** An issued invoice (draft then issue). */
export async function issuedInvoice(token, body = {}, issue = {}) {
  const draft = await newInvoice(token, body);
  const res = await inv.issue(token, draft.id, issue);
  if (res.status !== 200) throw new Error(`issue failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body.data, clientId: draft.clientId };
}
