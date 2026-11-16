import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Sparkles, X } from 'lucide-react';
import { Badge, Button, useToast } from '../../components/ui/index.js';
import { aiApi } from './api.js';

/** Every piece of AI output sits inside this, so it is always labelled as a suggestion. */
export function Suggestion({ meta, title, children }) {
  return (
    <section className="rounded-xl border border-violet-200 bg-white shadow-sm" aria-label={title ?? 'AI suggestion'}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 bg-violet-50/60 px-4 py-2.5">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-violet-900">
          <Sparkles className="h-4 w-4" aria-hidden /> {title ?? 'AI suggestion'} <Badge tone="info">Not verified</Badge>
        </span>
        {meta?.usage && <span className="text-xs text-slate-500">{meta.usage.inputTokens + meta.usage.outputTokens} tokens</span>}
      </header>
      <div className="space-y-4 p-4">
        {children}
        <p className="text-xs text-slate-500">{meta?.notice ?? 'AI suggestion. Check it before you use or send anything.'}</p>
      </div>
    </section>
  );
}

export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={done ? Check : Copy}
      aria-label={`${label}: ${text.slice(0, 40)}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable: nothing to do */
        }
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export const Bullets = ({ items }) => (items?.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : null);
export const H = ({ children }) => <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>;

const RESULT_LINK = { task: (r) => `/tasks?task=${r.id}`, deliverables: (r) => `/campaigns/${r.id}?tab=deliverables` };

/**
 * Suggested changes. NOTHING is applied until the person presses Confirm on a row. Dismiss throws the suggestion away.
 */
export function ActionList({ actions, onChange, title = 'Suggested changes' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  if (!actions?.length) return null;
  const pending = actions.filter((a) => a.status === 'pending');

  async function run(a, fn, ok) {
    setBusy(a.id);
    try {
      const r = await fn(a.id);
      toast.success(ok);
      onChange(r.data);
    } catch (ex) {
      toast.error(ex.message);
      if (ex.body?.error?.details?.proposal) onChange(ex.body.error.details.proposal);
    } finally {
      setBusy(null);
    }
  }

  async function confirmAll() {
    for (const a of pending) await run(a, aiApi.confirm, 'Applied');
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3" data-testid="suggested-actions">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-600">Nothing has been changed yet. Each item is only applied when you confirm it.</p>
        </div>
        {pending.length > 1 && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={confirmAll}>Confirm all {pending.length}</Button>}
      </div>
      <ul className="divide-y divide-amber-100">
        {actions.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block text-slate-900">{a.summary}</span>
              {a.reason && <span className="block text-xs text-slate-500">{a.reason}</span>}
              {a.status === 'failed' && <span className="block text-xs text-red-700">Could not be applied: {a.error}</span>}
            </span>
            {a.status === 'pending' ? (
              <span className="flex gap-1">
                <Button size="sm" icon={Check} loading={busy === a.id} disabled={busy !== null && busy !== a.id} onClick={() => run(a, aiApi.confirm, 'Applied')}>Confirm</Button>
                <Button size="sm" variant="ghost" icon={X} aria-label={`Dismiss: ${a.summary}`} disabled={busy !== null} onClick={() => run(a, aiApi.dismiss, 'Dismissed')} />
              </span>
            ) : a.status === 'applied' ? (
              <span className="flex items-center gap-2">
                <Badge tone="success">Applied</Badge>
                {a.result && RESULT_LINK[a.result.kind] && <Link to={RESULT_LINK[a.result.kind](a.result)} className="text-xs font-medium text-brand-700 hover:underline">Open</Link>}
              </span>
            ) : (
              <Badge tone={a.status === 'failed' ? 'danger' : 'neutral'}>{a.status === 'dismissed' ? 'Dismissed' : 'Not applied'}</Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Keeps a list of actions in state and lets ActionList replace one row after confirm/dismiss. */
export const patchAction = (setActions) => (updated) => setActions((list) => list.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
