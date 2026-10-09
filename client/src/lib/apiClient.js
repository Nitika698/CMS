const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
  /** Server-side validation problems as { fieldName: message } for forms. */
  get fieldErrors() {
    const out = {};
    for (const d of this.body?.error?.details ?? []) if (d.path && !out[d.path]) out[d.path] = d.message;
    return out;
  }
}

// The access token lives in memory only (never localStorage), so XSS cannot read it from storage
// and a page reload simply re-establishes it from the HttpOnly refresh cookie.
let accessToken = null;
let onAuthLost = () => {};
export const setAccessToken = (t) => {
  accessToken = t;
};
/** Called when the session can no longer be recovered (expired/revoked). */
export const setAuthLostHandler = (fn) => {
  onAuthLost = fn;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'X-Requested-With': 'creatordesk', // required by the server's CSRF guard on cookie endpoints
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Is the API running?');
  }
  let data = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      /* non-JSON body */
    }
  }
  // 503 from /health/ready is a meaningful payload ("degraded"), not a transport failure.
  if (!res.ok && res.status !== 503) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? res.statusText, data);
  }
  return data;
}

let refreshing = null;

/** Single-flight: concurrent callers share one refresh request (the server rotates the cookie each time). */
export function refreshSession() {
  refreshing ??= (async () => {
    try {
      let data;
      try {
        data = await send('/auth/refresh', { method: 'POST' });
      } catch (err) {
        if (err.code !== 'REFRESH_CONFLICT') throw err;
        await sleep(300); // another tab rotated the cookie a moment ago; retry with the new one
        data = await send('/auth/refresh', { method: 'POST' });
      }
      accessToken = data.accessToken;
      return data;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * JSON fetch wrapper. On an expired access token it refreshes once and retries the request.
 * Pass { auth: false } for login/register/logout, which must never trigger a refresh.
 */
export async function api(path, options = {}) {
  const { auth = true, ...rest } = options;
  try {
    return await send(path, rest);
  } catch (err) {
    if (!auth || err.status !== 401) throw err;
    if (err.code === 'SESSION_EXPIRED') {
      accessToken = null;
      onAuthLost();
      throw err;
    }
    try {
      await refreshSession();
    } catch {
      accessToken = null;
      onAuthLost();
      throw err;
    }
    return send(path, rest);
  }
}
