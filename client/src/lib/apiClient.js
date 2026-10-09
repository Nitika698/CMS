const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Minimal JSON fetch wrapper. Auth headers/refresh will be added here when auth is built. */
export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Is the API running?');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok && res.status !== 503) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? res.statusText, data);
  }
  // 503 from /health/ready is a meaningful payload ("degraded"), not a transport failure.
  return data;
}
