import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, MessageSquare, RotateCcw } from 'lucide-react';
import { Button, EmptyState, ErrorState, FormField, Skeleton, Textarea, useToast } from '../../components/ui/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { contentApi } from './api.js';
import { formatInstant } from './dates.js';

const KIND = {
  approved: { label: 'Approved', icon: CheckCircle2, color: 'text-emerald-600' },
  changes_requested: { label: 'Changes requested', icon: RotateCcw, color: 'text-amber-600' },
  comment: { label: 'Comment', icon: MessageSquare, color: 'text-slate-500' },
};

export default function ReviewPanel({ content, refreshKey, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const [state, setState] = useState({ status: 'loading', items: [] });
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const ctrl = new AbortController();
    contentApi
      .history(content.id, { type: 'reviews', limit: 50 }, ctrl.signal)
      .then((r) => setState({ status: 'ready', items: r.data }))
      .catch((e) => e.name !== 'AbortError' && setState({ status: 'error', items: [] }));
    return () => ctrl.abort();
  }, [content.id]);
  useEffect(() => load(), [load, refreshKey]);

  async function submit(e) {
    e.preventDefault();
    if (!comment.trim()) return setError('Write a comment first');
    setBusy(true);
    setError('');
    try {
      await contentApi.comment(content.id, comment.trim());
      setComment('');
      toast.success('Comment added');
      onChanged();
    } catch (ex) {
      setError(ex.fieldErrors?.comment ?? ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <FormField label="Add a review comment" error={error}>
          {(p) => <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} error={!!error} maxLength={5000} placeholder="Notes for yourself or feedback from the brand…" {...p} />}
        </FormField>
        <Button type="submit" loading={busy} size="sm">
          Add comment
        </Button>
      </form>

      {state.status === 'loading' ? (
        <div className="space-y-3" aria-hidden>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : state.status === 'error' ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <ErrorState title="Couldn’t load review activity" onRetry={load} />
        </div>
      ) : state.items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={MessageSquare} title="No review activity yet" description="Comments, approvals and requested changes will appear here." />
        </div>
      ) : (
        <ol className="space-y-3">
          {state.items.map((e) => {
            const k = KIND[e.type];
            const Icon = k.icon;
            return (
              <li key={e.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${k.color}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold text-slate-900">{k.label}</span>
                    <span className="text-xs text-slate-500">
                      revision {e.revision} · {formatInstant(e.createdAt, user.timezone)}
                    </span>
                  </p>
                  {e.comment && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{e.comment}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
