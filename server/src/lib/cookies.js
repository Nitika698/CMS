import { env } from '../config/env.js';

export const REFRESH_COOKIE = 'cd_refresh';

// Scoped to the auth routes only, so the browser never sends it to other endpoints.
const base = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: 'strict',
  path: '/api/v1/auth',
});

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, { ...base(), maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, base());
}
