import { useEffect, useState } from 'react';

/**
 * Drag and drop uses the browser's native HTML5 API, which exists on desktop pointers (mouse/trackpad) but not on
 * touch screens. Where it isn't supported the same reschedule is available in the entry's edit dialog.
 */
let current = null;
export const startDrag = (e, item) => {
  current = item;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', item.id);
};
export const endDrag = () => {
  current = null;
};
export const dragging = () => current;

/** Props for anything that can receive a dragged entry. `onDrop(item)` is called with the dragged post. */
export function dropTarget(onDrop) {
  return {
    onDragOver: (e) => {
      if (!current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDragEnter: (e) => current && (e.currentTarget.dataset.over = 'true'),
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) delete e.currentTarget.dataset.over;
    },
    onDrop: (e) => {
      e.preventDefault();
      delete e.currentTarget.dataset.over;
      const item = current;
      current = null;
      if (item) onDrop(item);
    },
  };
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const useCanDrag = () => useMediaQuery('(pointer: fine)');
