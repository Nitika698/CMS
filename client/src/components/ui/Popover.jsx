import { useEffect, useRef, useState } from 'react';

/** Click-to-open dropdown. `trigger({ open, toggle })` renders the button; closes on outside click / Escape. */
export default function Popover({ trigger, children, align = 'right', width = 'w-72' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={`absolute top-full z-40 mt-2 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg ${width} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}
