import { api } from '../../lib/apiClient.js';

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const contentApi = {
  meta: () => api('/content/meta'),
  list: (params, signal) => api(`/content${qs(params)}`, { signal }),
  get: (id, signal) => api(`/content/${id}`, { signal }),
  create: (body) => api('/content', { method: 'POST', body }),
  update: (id, body) => api(`/content/${id}`, { method: 'PATCH', body }),
  transition: (id, body) => api(`/content/${id}/transition`, { method: 'POST', body }),
  comment: (id, comment) => api(`/content/${id}/comments`, { method: 'POST', body: { comment } }),
  history: (id, params, signal) => api(`/content/${id}/history${qs(params)}`, { signal }),
  archive: (id) => api(`/content/${id}/archive`, { method: 'POST' }),
  restore: (id) => api(`/content/${id}/restore`, { method: 'POST' }),
  remove: (id) => api(`/content/${id}`, { method: 'DELETE' }),
  upload: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return api(`/content/${id}/assets`, { method: 'POST', body: form });
  },
  removeAsset: (id, assetId) => api(`/content/${id}/assets/${assetId}`, { method: 'DELETE' }),
  accessLink: (assetId) => api(`/media/${assetId}/access`),
  categories: () => api('/categories'),
  createCategory: (name) => api('/categories', { method: 'POST', body: { name } }),
  campaigns: () => api('/campaigns'),
};
