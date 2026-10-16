import { app, bearer, request } from './app.js';
import { Campaign } from '../../src/modules/campaigns/campaign.model.js';
import { Invoice } from '../../src/modules/invoices/invoice.model.js';
import { Payment } from '../../src/modules/invoices/payment.model.js';

export const clients = {
  create: (token, body = {}) => request(app).post('/api/v1/clients').set(bearer(token)).send({ name: 'Acme Co', ...body }),
  get: (token, id) => request(app).get(`/api/v1/clients/${id}`).set(bearer(token)),
  patch: (token, id, body) => request(app).patch(`/api/v1/clients/${id}`).set(bearer(token)).send(body),
  list: (token, q = '') => request(app).get(`/api/v1/clients${q ? `?${q}` : ''}`).set(bearer(token)),
  meta: (token) => request(app).get('/api/v1/clients/meta').set(bearer(token)),
  archive: (token, id) => request(app).post(`/api/v1/clients/${id}/archive`).set(bearer(token)),
  restore: (token, id) => request(app).post(`/api/v1/clients/${id}/restore`).set(bearer(token)),
  remove: (token, id) => request(app).delete(`/api/v1/clients/${id}`).set(bearer(token)),
  campaigns: (token, id) => request(app).get(`/api/v1/clients/${id}/campaigns`).set(bearer(token)),
  invoices: (token, id) => request(app).get(`/api/v1/clients/${id}/invoices`).set(bearer(token)),
};

export const discussions = {
  create: (token, clientId, body = {}) =>
    request(app).post(`/api/v1/clients/${clientId}/communications`).set(bearer(token)).send({ channel: 'email', direction: 'inbound', subject: 'Hello', ...body }),
  list: (token, clientId, q = '') => request(app).get(`/api/v1/clients/${clientId}/communications${q ? `?${q}` : ''}`).set(bearer(token)),
  get: (token, id) => request(app).get(`/api/v1/communications/${id}`).set(bearer(token)),
  patch: (token, id, body) => request(app).patch(`/api/v1/communications/${id}`).set(bearer(token)).send(body),
  remove: (token, id) => request(app).delete(`/api/v1/communications/${id}`).set(bearer(token)),
};

/** Creates a client and returns its id. */
export async function newClient(token, body = {}) {
  const res = await clients.create(token, body);
  if (res.status !== 201) throw new Error(`newClient failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

// ---- fixtures for the records that live in OTHER modules (their create/edit features arrive later)
export const mkCampaign = (owner, client, title, status, extra = {}) => Campaign.create({ owner, client, title, status, ...extra });
export const fee = (amountMinor, currency) => ({ fee: { amountMinor, currency } });
let n = 0;
export const mkInvoice = (owner, client, currency, totalMinor, status, dueDate, extra = {}) =>
  Invoice.create({ owner, client, number: `T-${++n}-${Date.now()}`, currency, totalMinor, status, dueDate, ...extra });
export const mkPayment = (owner, invoice, amountMinor, paidAt = new Date()) => Payment.create({ owner, invoice: invoice._id, amountMinor, currency: invoice.currency, paidAt });
