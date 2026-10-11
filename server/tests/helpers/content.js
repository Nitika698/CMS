import crypto from 'node:crypto';
import { app, bearer, request } from './app.js';

// ---- files with the REAL magic bytes of each allowed type (padding makes them any size we need)
const pad = (head, size) => Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 7)]);
export const files = {
  png: (size = 200) => pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), size),
  jpg: (size = 200) => pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), size),
  gif: (size = 200) => pad(Buffer.from('GIF89a'), size),
  webp: (size = 200) => pad(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]), size),
  pdf: (size = 200) => pad(Buffer.from('%PDF-1.7\n'), size),
  mp4: (size = 200) => pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]), size),
  mov: (size = 200) => pad(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  ')]), size),
  webm: (size = 200) => pad(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]), Buffer.from('webm')]), size),
  // things that must be rejected even when named like an image
  exe: () => pad(Buffer.from('MZ\x90\x00'), 300),
  html: () => Buffer.from('<html><script>alert(1)</script></html>'),
  svg: () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  text: () => Buffer.from('just some text, definitely not a picture'),
  heic: () => pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')]), 100),
  zip: () => pad(Buffer.from([0x50, 0x4b, 3, 4]), 100),
};

// ---- thin API helpers (token = access token from signUp())
export const api = {
  create: (token, body = {}) => request(app).post('/api/v1/content').set(bearer(token)).send({ title: 'Untitled idea', ...body }),
  get: (token, id) => request(app).get(`/api/v1/content/${id}`).set(bearer(token)),
  patch: (token, id, body) => request(app).patch(`/api/v1/content/${id}`).set(bearer(token)).send(body),
  list: (token, query = '') => request(app).get(`/api/v1/content${query ? `?${query}` : ''}`).set(bearer(token)),
  move: (token, id, to, extra = {}) => request(app).post(`/api/v1/content/${id}/transition`).set(bearer(token)).send({ to, ...extra }),
  comment: (token, id, comment) => request(app).post(`/api/v1/content/${id}/comments`).set(bearer(token)).send({ comment }),
  history: (token, id, query = '') => request(app).get(`/api/v1/content/${id}/history${query ? `?${query}` : ''}`).set(bearer(token)),
  archive: (token, id) => request(app).post(`/api/v1/content/${id}/archive`).set(bearer(token)),
  restore: (token, id) => request(app).post(`/api/v1/content/${id}/restore`).set(bearer(token)),
  remove: (token, id) => request(app).delete(`/api/v1/content/${id}`).set(bearer(token)),
  upload: (token, id, buffer, filename = 'file.png', field = 'file') =>
    request(app).post(`/api/v1/content/${id}/assets`).set(bearer(token)).attach(field, buffer, { filename }),
  removeAsset: (token, id, assetId) => request(app).delete(`/api/v1/content/${id}/assets/${assetId}`).set(bearer(token)),
  access: (token, assetId) => request(app).get(`/api/v1/media/${assetId}/access`).set(bearer(token)),
};

/** Creates content and walks it to a status through the real, allowed transitions. */
export async function contentAt(token, status, body = {}) {
  const res = await api.create(token, { caption: 'A caption', ...body });
  const id = res.body.data.id;
  const path = ['planning', 'creation', 'review', 'approved', 'published'];
  for (const to of path.slice(0, path.indexOf(status) + 1)) {
    const extra = to === 'published' ? { publishedAt: new Date(Date.now() - 60_000).toISOString() } : {};
    const r = await api.move(token, id, to, extra);
    if (r.status !== 200) throw new Error(`contentAt(${status}) failed at ${to}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return id;
}

export const assetTokenKey = (secret) => crypto.createHmac('sha256', secret).update('cms:asset-link:v1').digest();
