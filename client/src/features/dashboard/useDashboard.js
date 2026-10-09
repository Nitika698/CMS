import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/apiClient.js';

const POLL_MS = 60_000;

/**
 * Loads GET /dashboard. Keeps showing the last good data while a refresh is in flight (or if a refresh fails),
 * so numbers never flash to empty. status: 'loading' (first load) | 'ready' | 'error' (first load failed).
 */
export function useDashboard() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null, refreshing: false, refreshError: false });
  const abortRef = useRef(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState((s) => (s.data ? { ...s, refreshing: !silent } : { ...s, status: 'loading', error: null }));
    try {
      const data = await api('/dashboard', { signal: ctrl.signal });
      setState({ status: 'ready', data, error: null, refreshing: false, refreshError: false });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setState((s) => (s.data ? { ...s, refreshing: false, refreshError: true } : { status: 'error', data: null, error: err, refreshing: false, refreshError: false }));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load({ silent: true }), POLL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  return { ...state, reload: () => load() };
}
