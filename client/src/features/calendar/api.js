import { api } from '../../lib/apiClient.js';

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const calendarApi = {
  range: (params, signal) => api(`/calendar${qs(params)}`, { signal }),
  upcoming: (signal) => api('/calendar/upcoming', { signal }),
  meta: () => api('/calendar/meta'),
  integrations: () => api('/calendar/integrations'),
};

export const postsApi = {
  get: (id) => api(`/posts/${id}`),
  forContent: (contentId, signal) => api(`/posts${qs({ content: contentId })}`, { signal }),
  create: (body) => api('/posts', { method: 'POST', body }),
  update: (id, body) => api(`/posts/${id}`, { method: 'PATCH', body }),
  transition: (id, body) => api(`/posts/${id}/transition`, { method: 'POST', body }),
  remove: (id) => api(`/posts/${id}`, { method: 'DELETE' }),
};

export const notificationsApi = {
  list: (params = {}, signal) => api(`/notifications${qs(params)}`, { signal }),
  read: (id) => api(`/notifications/${id}/read`, { method: 'POST' }),
  readAll: () => api('/notifications/read-all', { method: 'POST' }),
};
