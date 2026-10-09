import { useCallback, useEffect, useState } from 'react';
import { api } from './apiClient.js';

/** Polls the real backend health endpoints. Status is never faked: errors surface as errors. */
export function useApiHealth(intervalMs = 30_000) {
  const [state, setState] = useState({ loading: true, api: null, database: null, error: null });

  const refresh = useCallback(async (signal) => {
    try {
      const [live, ready] = await Promise.all([
        api('/health', { signal }),
        api('/health/ready', { signal }),
      ]);
      setState({ loading: false, api: live, database: ready, error: null });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setState({ loading: false, api: null, database: null, error: err });
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    refresh(ctrl.signal);
    const id = setInterval(() => refresh(ctrl.signal), intervalMs);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [refresh, intervalMs]);

  return { ...state, refresh: () => refresh() };
}
