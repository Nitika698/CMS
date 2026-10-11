import { app, bearer, request } from './app.js';
import { api as contentApi, contentAt } from './content.js';

// All scheduling tests use 2040 so "must be in the future" never depends on today's date.
export const T = (day, time = '18:00') => `2040-06-${String(day).padStart(2, '0')}T${time}`;

export const posts = {
  create: (token, body) => request(app).post('/api/v1/posts').set(bearer(token)).send(body),
  get: (token, id) => request(app).get(`/api/v1/posts/${id}`).set(bearer(token)),
  patch: (token, id, body) => request(app).patch(`/api/v1/posts/${id}`).set(bearer(token)).send(body),
  move: (token, id, to, extra = {}) => request(app).post(`/api/v1/posts/${id}/transition`).set(bearer(token)).send({ to, ...extra }),
  remove: (token, id) => request(app).delete(`/api/v1/posts/${id}`).set(bearer(token)),
  list: (token, q = '') => request(app).get(`/api/v1/posts${q ? `?${q}` : ''}`).set(bearer(token)),
  viaPlatform: (token, id) => request(app).post(`/api/v1/posts/${id}/publish-via-platform`).set(bearer(token)),
};

export const cal = {
  range: (token, q) => request(app).get(`/api/v1/calendar?${q}`).set(bearer(token)),
  upcoming: (token) => request(app).get('/api/v1/calendar/upcoming').set(bearer(token)),
  meta: (token) => request(app).get('/api/v1/calendar/meta').set(bearer(token)),
  integrations: (token) => request(app).get('/api/v1/calendar/integrations').set(bearer(token)),
};

export const notifs = {
  list: (token, q = '') => request(app).get(`/api/v1/notifications${q ? `?${q}` : ''}`).set(bearer(token)),
  read: (token, id) => request(app).post(`/api/v1/notifications/${id}/read`).set(bearer(token)),
  readAll: (token) => request(app).post('/api/v1/notifications/read-all').set(bearer(token)),
};

export const setTimezone = (token, timezone) => request(app).patch('/api/v1/me').set(bearer(token)).send({ timezone });
export const setPrefs = (token, calendarPrefs) => request(app).patch('/api/v1/me').set(bearer(token)).send({ calendarPrefs });

/** Fresh content in the "idea" stage; returns its id. */
export async function newContent(token, body = {}) {
  const res = await contentApi.create(token, { title: 'A content item', ...body });
  if (res.status !== 201) throw new Error(`newContent failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

export const approvedContent = (token, body = {}) => contentAt(token, 'approved', { title: 'Approved content', ...body });

/** Creates a scheduled reminder post and returns the response body's `data`. */
export async function scheduled(token, contentId, platform, local, extra = {}) {
  const res = await posts.create(token, { content: contentId, platform, status: 'scheduled', scheduledLocal: local, ...extra });
  if (res.status !== 201) throw new Error(`scheduled() failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}
