import { api } from '../../lib/apiClient.js';

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const tasksApi = {
  meta: () => api('/tasks/meta'),
  summary: (signal) => api('/tasks/summary', { signal }),
  list: (params, signal) => api(`/tasks${qs(params)}`, { signal }),
  get: (id, signal) => api(`/tasks/${id}`, { signal }),
  create: (body) => api('/tasks', { method: 'POST', body }),
  update: (id, body) => api(`/tasks/${id}`, { method: 'PATCH', body }),
  move: (id, to) => api(`/tasks/${id}/transition`, { method: 'POST', body: { to } }),
  complete: (id) => api(`/tasks/${id}/complete`, { method: 'POST' }),
  reopen: (id) => api(`/tasks/${id}/reopen`, { method: 'POST' }),
  archive: (id) => api(`/tasks/${id}/archive`, { method: 'POST' }),
  restore: (id) => api(`/tasks/${id}/restore`, { method: 'POST' }),
  remove: (id) => api(`/tasks/${id}`, { method: 'DELETE' }),
};
