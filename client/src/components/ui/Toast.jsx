import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** Short-lived confirmations ("Saved") and non-blocking errors. Announced politely to screen readers. */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone, message) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ success: (m) => push('success', m), error: (m) => push('error', m) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg ${
              t.tone === 'error' ? 'border-red-200' : 'border-emerald-200'
            }`}
          >
            {t.tone === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />}
            <p className="min-w-0 flex-1 text-slate-800">{t.message}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded p-0.5 text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
