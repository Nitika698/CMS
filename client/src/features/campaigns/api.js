import { api } from '../../lib/apiClient.js';

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const campaignsApi = {
  meta: () => api('/campaigns/meta'),
  list: (params, signal) => api(`/campaigns${qs(params)}`, { signal }),
  get: (id, signal) => api(`/campaigns/${id}`, { signal }),
  create: (body) => api('/campaigns', { method: 'POST', body }),
  update: (id, body) => api(`/campaigns/${id}`, { method: 'PATCH', body }),
  move: (id, to, note) => api(`/campaigns/${id}/transition`, { method: 'POST', body: { to, ...(note && { note }) } }),
  archive: (id) => api(`/campaigns/${id}/archive`, { method: 'POST' }),
  restore: (id) => api(`/campaigns/${id}/restore`, { method: 'POST' }),
  remove: (id) => api(`/campaigns/${id}`, { method: 'DELETE' }),
  linkContent: (id, contentId) => api(`/campaigns/${id}/content`, { method: 'POST', body: { contentId } }),
  unlinkContent: (id, contentId) => api(`/campaigns/${id}/content/${contentId}`, { method: 'DELETE' }),
  addDeliverables: (id, body) => api(`/campaigns/${id}/deliverables`, { method: 'POST', body }),
  updateDeliverable: (id, did, body) => api(`/campaigns/${id}/deliverables/${did}`, { method: 'PATCH', body }),
  moveDeliverable: (id, did, to, note) => api(`/campaigns/${id}/deliverables/${did}/transition`, { method: 'POST', body: { to, ...(note && { note }) } }),
  removeDeliverable: (id, did) => api(`/campaigns/${id}/deliverables/${did}`, { method: 'DELETE' }),
};
