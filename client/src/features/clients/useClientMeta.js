import { useCallback, useEffect, useState } from 'react';
import { clientsApi } from './api.js';

/** Options and the user's own categories/industries. Refetchable because a new category can appear after saving a brand. */
export function useClientMeta() {
  const [meta, setMeta] = useState(null);
  const refresh = useCallback(() => {
    clientsApi.meta().then(setMeta).catch(() => {});
  }, []);
  useEffect(() => refresh(), [refresh]);
  return { meta, refresh };
}
