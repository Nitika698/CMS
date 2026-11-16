import { api } from '../../lib/apiClient.js';

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const clientsApi = {
  meta: () => api('/clients/meta'),
  list: (params, signal) => api(`/clients${qs(params)}`, { signal }),
  get: (id, signal) => api(`/clients/${id}`, { signal }),
  create: (body) => api('/clients', { method: 'POST', body }),
  update: (id, body) => api(`/clients/${id}`, { method: 'PATCH', body }),
  archive: (id) => api(`/clients/${id}/archive`, { method: 'POST' }),
  restore: (id) => api(`/clients/${id}/restore`, { method: 'POST' }),
  remove: (id) => api(`/clients/${id}`, { method: 'DELETE' }),
  campaigns: (id, signal) => api(`/clients/${id}/campaigns`, { signal }),
  invoices: (id, signal) => api(`/clients/${id}/invoices`, { signal }),
  allDiscussions: (params, signal) => api(`/communications${qs(params)}`, { signal }),
  discussions: (id, params, signal) => api(`/clients/${id}/communications${qs(params)}`, { signal }),
  addDiscussion: (id, body) => api(`/clients/${id}/communications`, { method: 'POST', body }),
  updateDiscussion: (id, body) => api(`/communications/${id}`, { method: 'PATCH', body }),
  removeDiscussion: (id) => api(`/communications/${id}`, { method: 'DELETE' }),
};
