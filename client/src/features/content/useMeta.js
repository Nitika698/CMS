import { useEffect, useState } from 'react';
import { contentApi } from './api.js';

let cached = null;

/** Workflow, types, platforms and upload limits come from the server so the UI can never disagree with it. */
export function useContentMeta() {
  const [meta, setMeta] = useState(cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    contentApi.meta().then((m) => {
      cached = m;
      if (live) setMeta(m);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return meta;
}
