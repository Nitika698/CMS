import { useCallback, useEffect, useState } from 'react';
import { Info, ShieldCheck, Sparkles } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Card, ErrorState, Skeleton } from '../../components/ui/index.js';
import { aiApi } from './api.js';
import { ActionList, patchAction } from './parts.jsx';
import { TABS } from './panels.jsx';

function Disabled({ status }) {
  return (
    <Card title="The AI assistant is switched off" description={status.reason}>
      <div className="space-y-3 text-sm text-slate-700">
        <p>Everything else in CMS works as normal. To turn the assistant on, whoever runs this server needs to add a key from an AI provider:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open <code className="rounded bg-slate-100 px-1">server/.env</code> and set <code className="rounded bg-slate-100 px-1">AI_API_KEY=…</code></li>
          <li>Optionally set <code className="rounded bg-slate-100 px-1">AI_MODEL</code>, <code className="rounded bg-slate-100 px-1">AI_DAILY_REQUEST_LIMIT</code> and the other <code className="rounded bg-slate-100 px-1">AI_*</code> options (see the README).</li>
          <li>Restart the server.</li>
        </ol>
        <p className="text-slate-500">The key stays on the server. It is never sent to this page. To switch AI off again, remove the key or set <code className="rounded bg-slate-100 px-1">AI_ENABLED=false</code>.</p>
      </div>
    </Card>
  );
}

/** Suggestions from earlier visits that are still waiting for a yes or no. */
function Waiting({ refreshKey }) {
  const [actions, setActions] = useState([]);
  useEffect(() => {
    aiApi.actions('pending').then((r) => setActions(r.data)).catch(() => {});
  }, [refreshKey]);
  if (!actions.length) return null;
  return <ActionList actions={actions} onChange={patchAction(setActions)} title={`Waiting for your confirmation (${actions.length})`} />;
}

export default function AssistantPage() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const tab = TABS.find((t) => t.key === params.get('tab')) ?? TABS[0];

  const load = useCallback(() => {
    aiApi
      .status()
      .then((r) => setState({ status: 'ready', data: r.data, error: null }))
      .catch((error) => setState({ status: 'error', data: null, error }));
  }, []);
  useEffect(() => load(), [load]);

  const s = state.data;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900"><Sparkles className="h-6 w-6 text-violet-600" aria-hidden /> AI Assistant</h2>
        <p className="mt-1 text-sm text-slate-500">Ideas, writing help, plans and answers about your own CMS data. Everything it produces is a suggestion for you to check.</p>
      </div>

      {state.status === 'loading' && <Skeleton className="h-40 w-full" />}
      {state.status === 'error' && <div className="rounded-xl border border-slate-200 bg-white"><ErrorState title="Couldn’t check the assistant" message={state.error?.message} onRetry={load} /></div>}
      {s && !s.enabled && <Disabled status={s} />}

      {s?.enabled && (
        <>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p className="flex items-start gap-2 rounded-lg bg-violet-50 px-3 py-2 text-violet-900" role="note"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> AI can be wrong. It suggests; you decide. It never sends messages, publishes, schedules or touches invoices, and changes only happen when you press Confirm.</p>
            <p className="flex items-start gap-2 rounded-lg bg-slate-100 px-3 py-2 text-slate-700" role="note"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> What you type and the records needed for your question are sent to the AI provider ({s.provider}). Contact details and payment instructions are not. Today: {s.usageToday.requests} of {s.limits.dailyRequests} requests.</p>
          </div>

          <div role="tablist" aria-label="Assistant tools" className="-mb-px flex gap-1 overflow-x-auto border-b border-slate-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                id={`ai-tab-${t.key}`}
                aria-selected={tab.key === t.key}
                aria-controls={`ai-panel-${t.key}`}
                onClick={() => setParams(t.key === 'ask' ? {} : { tab: t.key }, { replace: true })}
                className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${tab.key === t.key ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
              >
                <t.icon className="h-4 w-4" aria-hidden /> {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`ai-panel-${tab.key}`} aria-labelledby={`ai-tab-${tab.key}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <tab.Panel key={tab.key} onDisabled={load} />
          </div>

          <Waiting refreshKey={tab.key} />
        </>
      )}
    </div>
  );
}
