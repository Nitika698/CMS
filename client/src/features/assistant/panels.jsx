import { useEffect, useRef, useState } from 'react';
import { Lightbulb, ListChecks, MessageSquare, Send, Sparkles, Type } from 'lucide-react';
import { Badge, Button, FormField, Input, Select, Textarea, useToast } from '../../components/ui/index.js';
import { clientsApi } from '../clients/api.js';
import { contentApi } from '../content/api.js';
import { aiApi } from './api.js';
import { ActionList, Bullets, CopyButton, H, patchAction, Suggestion } from './parts.jsx';

export const PLATFORMS = [['instagram', 'Instagram'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['x', 'X'], ['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['blog', 'Blog'], ['other', 'Other']];
const PRIORITY = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

/** One AI call at a time, with a visible loading state and a readable error. */
function useAi(call, onDisabled) {
  const toast = useToast();
  const [state, setState] = useState({ busy: false, result: null, errors: {} });
  const [actions, setActions] = useState([]);
  async function run(body) {
    setState({ busy: true, result: null, errors: {} });
    setActions([]);
    try {
      const r = await call(body);
      setState({ busy: false, result: r, errors: {} });
      setActions(r.actions ?? []);
    } catch (ex) {
      setState({ busy: false, result: null, errors: ex.fieldErrors ?? {} });
      if (ex.code === 'AI_DISABLED') onDisabled?.();
      if (!Object.keys(ex.fieldErrors ?? {}).length) toast.error(ex.message);
    }
  }
  return { ...state, run, actions, onAction: patchAction(setActions) };
}

const Generate = ({ busy, children = 'Generate' }) => <Button type="submit" icon={Sparkles} loading={busy}>{busy ? 'Thinking…' : children}</Button>;
const PlatformSelect = ({ value, onChange, p }) => (
  <Select {...p} value={value} onChange={onChange}>{PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
);

// ------------------------------------------------------------------ 1. ideas

export function IdeasPanel({ onDisabled }) {
  const [f, setF] = useState({ niche: '', platform: 'instagram', audience: '', goals: '', count: 5 });
  const ai = useAi((b) => aiApi.ideas(b), onDisabled);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    ai.run({ niche: f.niche, platform: f.platform, count: Number(f.count), ...(f.audience && { audience: f.audience }), ...(f.goals && { goals: f.goals }) });
  };
  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <FormField label="Your niche" required error={ai.errors.niche}>{(p) => <Input {...p} value={f.niche} onChange={set('niche')} maxLength={200} placeholder="e.g. budget travel for students" error={ai.errors.niche} />}</FormField>
        <FormField label="Platform"><PlatformSelect value={f.platform} onChange={set('platform')} p={{}} /></FormField>
        <FormField label="Audience" error={ai.errors.audience}>{(p) => <Input {...p} value={f.audience} onChange={set('audience')} maxLength={300} placeholder="Who watches you?" />}</FormField>
        <FormField label="Goals" error={ai.errors.goals}>{(p) => <Input {...p} value={f.goals} onChange={set('goals')} maxLength={300} placeholder="e.g. grow followers, get brand deals" />}</FormField>
        <FormField label="How many ideas">{(p) => <Select {...p} value={f.count} onChange={set('count')}>{[3, 5, 8, 10].map((n) => <option key={n}>{n}</option>)}</Select>}</FormField>
        <div className="flex items-end"><Generate busy={ai.busy}>Suggest ideas</Generate></div>
      </form>
      {ai.result && (
        <Suggestion meta={ai.result.meta} title="Content ideas">
          <ol className="space-y-3">
            {ai.result.data.ideas.map((i, n) => (
              <li key={n} className="rounded-lg border border-slate-200 p-3">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">{i.title} <Badge>{i.format}</Badge></p>
                <p className="mt-1 text-sm text-slate-700">{i.angle}</p>
                {i.whyItWorks && <p className="mt-1 text-xs text-slate-500">Why it might work: {i.whyItWorks}</p>}
                <div className="mt-2 flex gap-2">
                  <CopyButton text={`${i.title}: ${i.angle}`} label="Copy idea" />
                </div>
              </li>
            ))}
          </ol>
        </Suggestion>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 2. copy

const PARTS = [['hooks', 'Hooks'], ['captions', 'Captions'], ['ctas', 'Calls to action'], ['hashtags', 'Hashtags']];

export function CopyPanel({ onDisabled }) {
  const [f, setF] = useState({ topic: '', platform: 'instagram', tone: '', audience: '', include: PARTS.map(([k]) => k), count: 3 });
  const ai = useAi((b) => aiApi.copy(b), onDisabled);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (k) => setF((x) => ({ ...x, include: x.include.includes(k) ? x.include.filter((i) => i !== k) : [...x.include, k] }));
  const submit = (e) => {
    e.preventDefault();
    ai.run({ topic: f.topic, platform: f.platform, include: f.include, count: Number(f.count), ...(f.tone && { tone: f.tone }), ...(f.audience && { audience: f.audience }) });
  };
  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2"><FormField label="What is the post about?" required error={ai.errors.topic}>{(p) => <Textarea {...p} rows={2} value={f.topic} onChange={set('topic')} maxLength={300} error={ai.errors.topic} placeholder="e.g. 3 free things to do in Goa" />}</FormField></div>
        <FormField label="Platform"><PlatformSelect value={f.platform} onChange={set('platform')} p={{}} /></FormField>
        <FormField label="Tone" error={ai.errors.tone}>{(p) => <Input {...p} value={f.tone} onChange={set('tone')} maxLength={60} placeholder="playful, calm, direct…" />}</FormField>
        <FormField label="Audience" error={ai.errors.audience}>{(p) => <Input {...p} value={f.audience} onChange={set('audience')} maxLength={300} />}</FormField>
        <FormField label="Options per section">{(p) => <Select {...p} value={f.count} onChange={set('count')}>{[2, 3, 5, 8].map((n) => <option key={n}>{n}</option>)}</Select>}</FormField>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Include</legend>
          <div className="flex flex-wrap gap-3">{PARTS.map(([k, l]) => <label key={k} className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.include.includes(k)} onChange={() => toggle(k)} />{l}</label>)}</div>
        </fieldset>
        <div><Generate busy={ai.busy}>Write suggestions</Generate></div>
      </form>
      {ai.result && (
        <Suggestion meta={ai.result.meta} title="Hooks, captions and more">
          {PARTS.filter(([k]) => ai.result.data[k]).map(([k, l]) => (
            <div key={k}>
              <H>{l}</H>
              {k === 'hashtags' ? (
                <div className="flex flex-wrap items-center gap-1.5">{ai.result.data[k].map((t) => <Badge key={t} tone="brand">{t}</Badge>)}<CopyButton text={ai.result.data[k].join(' ')} label="Copy all" /></div>
              ) : (
                <ul className="space-y-2">{ai.result.data[k].map((t, i) => <li key={i} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-sm"><span className="min-w-0 whitespace-pre-line break-words text-slate-800">{t}</span><CopyButton text={t} /></li>)}</ul>
              )}
            </div>
          ))}
        </Suggestion>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 3. campaign plan

export function PlanPanel({ onDisabled }) {
  const [campaigns, setCampaigns] = useState([]);
  const [f, setF] = useState({ campaignId: '', brief: '' });
  const ai = useAi((b) => aiApi.campaignPlan(b), onDisabled);
  useEffect(() => {
    contentApi.campaigns().then((r) => setCampaigns(r.data)).catch(() => {});
  }, []);
  const submit = (e) => {
    e.preventDefault();
    ai.run({ ...(f.campaignId && { campaignId: f.campaignId }), ...(f.brief.trim() && { brief: f.brief }) });
  };
  const r = ai.result?.data;
  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormField label="Campaign" hint="Pick one of your campaigns to plan from its saved brief and to be offered deliverables and tasks you can add.">
          {(p) => <Select {...p} value={f.campaignId} onChange={(e) => setF((x) => ({ ...x, campaignId: e.target.value }))}><option value="">None: I will paste a brief</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}{c.clientName ? ` · ${c.clientName}` : ''}</option>)}</Select>}
        </FormField>
        <FormField label={f.campaignId ? 'Extra notes (optional)' : 'Brief'} required={!f.campaignId} error={ai.errors.brief}>
          {(p) => <Textarea {...p} rows={5} value={f.brief} onChange={(e) => setF((x) => ({ ...x, brief: e.target.value }))} maxLength={4000} error={ai.errors.brief} placeholder="Paste the brand's brief or your notes…" />}
        </FormField>
        <Generate busy={ai.busy}>Propose a plan</Generate>
      </form>
      {r && (
        <Suggestion meta={ai.result.meta} title="Proposed content plan">
          {r.summary && <p className="text-sm text-slate-700">{r.summary}</p>}
          {r.contentPlan.length > 0 && <div><H>Content plan</H><ul className="space-y-2">{r.contentPlan.map((p, i) => <li key={i} className="rounded-lg border border-slate-200 p-2.5 text-sm"><p className="font-medium text-slate-900">{p.title} <Badge>{p.format} · {p.platform}</Badge>{p.suggestedDate && <span className="ml-2 text-xs text-slate-500">around {p.suggestedDate}</span>}</p>{p.description && <p className="text-slate-700">{p.description}</p>}</li>)}</ul></div>}
          {r.checklist.length > 0 && <div><H>Deliverable checklist</H><ul className="space-y-1 text-sm">{r.checklist.map((c, i) => <li key={i} className="flex items-center gap-2"><input type="checkbox" disabled className="h-4 w-4" aria-hidden /> <span>{c.title}</span>{c.priority !== 'normal' && <Badge tone={c.priority === 'low' ? 'neutral' : 'warning'}>{PRIORITY[c.priority]}</Badge>}{c.dueDate && <span className="text-xs text-slate-500">by {c.dueDate}</span>}</li>)}</ul></div>}
          {r.questions?.length > 0 && <div><H>Questions to clear up with the brand</H><Bullets items={r.questions} /></div>}
          {r.campaign ? <ActionList actions={ai.actions} onChange={ai.onAction} title={`Add to “${r.campaign.title}”`} /> : <p className="text-xs text-slate-500">Choose one of your campaigns above to be offered deliverables and tasks you can add with one confirmation each.</p>}
        </Suggestion>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 4. summaries

export function SummaryPanel({ onDisabled }) {
  const [brands, setBrands] = useState([]);
  const [f, setF] = useState({ client: '', limit: 8 });
  const ai = useAi((b) => aiApi.summarize(b), onDisabled);
  useEffect(() => {
    clientsApi.list({ limit: 100 }).then((r) => setBrands(r.data)).catch(() => {});
  }, []);
  const r = ai.result?.data;
  return (
    <div className="space-y-5">
      <form onSubmit={(e) => { e.preventDefault(); ai.run({ client: f.client, limit: Number(f.limit) }); }} className="grid gap-4 sm:grid-cols-3" noValidate>
        <FormField label="Brand" required error={ai.errors.client}>{(p) => <Select {...p} value={f.client} onChange={(e) => setF((x) => ({ ...x, client: e.target.value }))} error={ai.errors.client}><option value="">Choose a brand…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</FormField>
        <FormField label="Latest discussions">{(p) => <Select {...p} value={f.limit} onChange={(e) => setF((x) => ({ ...x, limit: e.target.value }))}>{[3, 5, 8, 15].map((n) => <option key={n}>{n}</option>)}</Select>}</FormField>
        <div className="flex items-end"><Generate busy={ai.busy}>Summarise</Generate></div>
      </form>
      <p className="text-xs text-slate-500">The text of the selected saved discussions is sent to the AI provider (long notes are shortened first).</p>
      {r && (
        <Suggestion meta={ai.result.meta} title={`Summary of ${r.basedOn.discussions} discussion${r.basedOn.discussions === 1 ? '' : 's'} with ${r.basedOn.brand}`}>
          {r.summary && <p className="text-sm text-slate-700">{r.summary}</p>}
          {r.keyPoints.length > 0 && <div><H>Key points</H><Bullets items={r.keyPoints} /></div>}
          {r.openQuestions.length > 0 && <div><H>Open questions</H><Bullets items={r.openQuestions} /></div>}
          {r.actionItems.length > 0 ? <ActionList actions={ai.actions} onChange={ai.onAction} title="Proposed action items" /> : <p className="text-sm text-slate-500">No clear action items were found.</p>}
        </Suggestion>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 5. priorities

export function PrioritiesPanel({ onDisabled }) {
  const ai = useAi(() => aiApi.priorities(), onDisabled);
  const r = ai.result?.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={Sparkles} loading={ai.busy} onClick={() => ai.run()}>{ai.busy ? 'Thinking…' : 'Suggest priorities for my open tasks'}</Button>
        <p className="text-xs text-slate-500">Looks at your open tasks, their deadlines and linked campaigns (up to 20 tasks). Task titles are sent to the AI provider.</p>
      </div>
      {r && (
        <Suggestion meta={ai.result.meta} title={`Suggested order for ${r.considered} open task${r.considered === 1 ? '' : 's'}`}>
          {r.summary && <p className="text-sm text-slate-700">{r.summary}</p>}
          <ol className="space-y-2">
            {r.ranking.map((t, i) => (
              <li key={t.taskId} className="rounded-lg border border-slate-200 p-2.5 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900"><span className="tabular-nums text-slate-400">{i + 1}.</span> {t.title}
                  <Badge tone={t.suggestedPriority === t.currentPriority ? 'neutral' : 'warning'}>{t.suggestedPriority === t.currentPriority ? PRIORITY[t.suggestedPriority] : `${PRIORITY[t.currentPriority]} → ${PRIORITY[t.suggestedPriority]}`}</Badge>
                  {t.overdue && <Badge tone="danger">Overdue</Badge>}
                </p>
                {t.reason && <p className="text-slate-600">{t.reason}</p>}
              </li>
            ))}
          </ol>
          <ActionList actions={ai.actions} onChange={ai.onAction} title="Priority changes" />
        </Suggestion>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 6. ask

const EXAMPLES = ['What is due this week?', 'Which invoices are overdue?', 'How are my active campaigns going?', 'What did I last discuss with my brands?'];

export function AskPanel({ onDisabled }) {
  const toast = useToast();
  const [turns, setTurns] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'nearest' }), [turns, busy]);

  async function ask(question) {
    const text = question.trim();
    if (!text || busy) return;
    const history = turns.slice(-6).map((t) => ({ role: t.role, content: t.text }));
    setTurns((t) => [...t, { role: 'user', text }]);
    setQ('');
    setBusy(true);
    try {
      const r = await aiApi.ask({ question: text, history });
      setTurns((t) => [...t, { role: 'assistant', text: r.data.answer, used: r.data.dataUsed, meta: r.meta }]);
    } catch (ex) {
      if (ex.code === 'AI_DISABLED') onDisabled?.();
      toast.error(ex.message);
      setTurns((t) => t.slice(0, -1));
      setQ(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Ask about your own CMS data: deadlines, tasks, campaigns, invoices and saved discussions. The assistant can only <strong>read</strong> what it needs for your question and cannot change anything.</p>
      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} type="button" onClick={() => ask(e)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50">{e}</button>)}</div>
      )}
      <ul className="space-y-3" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
            {t.role === 'user' ? (
              <p className="max-w-[85%] rounded-xl bg-brand-600 px-3.5 py-2 text-sm text-white">{t.text}</p>
            ) : (
              <Suggestion meta={t.meta} title="Answer">
                <p className="whitespace-pre-line text-sm text-slate-800">{t.text}</p>
                {t.used?.length > 0 && <p className="text-xs text-slate-500">Looked at: {[...new Set(t.used.filter((u) => u.ok).map((u) => u.tool.replace(/^get_/, '').replaceAll('_', ' ')))].join(', ') || 'nothing'}</p>}
              </Suggestion>
            )}
          </li>
        ))}
        {busy && <li className="text-sm text-slate-500">Looking through your data…</li>}
        <li ref={end} />
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
        <Input aria-label="Ask a question about your data" value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder="Ask about your deadlines, tasks, campaigns or invoices…" disabled={busy} />
        <Button type="submit" icon={Send} loading={busy} disabled={!q.trim()}>Ask</Button>
      </form>
    </div>
  );
}

export const TABS = [
  { key: 'ask', label: 'Ask my data', icon: MessageSquare, Panel: AskPanel },
  { key: 'ideas', label: 'Content ideas', icon: Lightbulb, Panel: IdeasPanel },
  { key: 'copy', label: 'Hooks & captions', icon: Type, Panel: CopyPanel },
  { key: 'plan', label: 'Campaign plan', icon: ListChecks, Panel: PlanPanel },
  { key: 'summary', label: 'Discussions', icon: MessageSquare, Panel: SummaryPanel },
  { key: 'priorities', label: 'Task priorities', icon: ListChecks, Panel: PrioritiesPanel },
];
