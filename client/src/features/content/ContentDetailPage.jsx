import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArchiveRestore, ArrowLeft, Archive, CheckCircle2, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Modal, Skeleton, useToast } from '../../components/ui/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import LinkedPosts from '../calendar/LinkedPosts.jsx';
import LinkedTasks from '../tasks/LinkedTasks.jsx';
import AssetsPanel from './AssetsPanel.jsx';
import { contentApi } from './api.js';
import { platformLabel, typeLabel } from './constants.js';
import { formatDay, formatInstant } from './dates.js';
import HistoryPanel from './HistoryPanel.jsx';
import ReviewPanel from './ReviewPanel.jsx';
import StatusBadge from './StatusBadge.jsx';
import TransitionDialog, { dialogKind } from './TransitionDialog.jsx';
import { useContentMeta } from './useMeta.js';
import WorkflowStepper from './WorkflowStepper.jsx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'assets', label: 'Files' },
  { key: 'review', label: 'Review' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'history', label: 'History' },
];

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-900">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function Overview({ c, tz, refreshKey }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="Creative">
          <dl className="space-y-5">
            <Field label="Description">{c.description && <span className="whitespace-pre-wrap">{c.description}</span>}</Field>
            <Field label="Creative brief">{c.brief && <span className="whitespace-pre-wrap">{c.brief}</span>}</Field>
            <Field label="Caption">{c.caption && <span className="whitespace-pre-wrap">{c.caption}</span>}</Field>
            <Field label="Hashtags">{c.hashtags.length > 0 && c.hashtags.map((h) => `#${h}`).join(' ')}</Field>
          </dl>
        </Card>
      </div>
      <div className="space-y-6">
        <LinkedPosts contentId={c.id} archived={c.archived} refreshKey={refreshKey} />
        <Card title="Details">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-1">
            <Field label="Type">{typeLabel(c.type)}</Field>
            <Field label="Category">{c.category?.name}</Field>
            <Field label="Campaign">
              {c.campaign && (
                <Link to={`/campaigns/${c.campaign.id}`} className="text-brand-700 hover:underline">
                  {c.campaign.title}
                  {c.campaign.clientName ? ` — ${c.campaign.clientName}` : ''}
                </Link>
              )}
            </Field>
            <Field label="Platforms">{c.platforms.length > 0 && c.platforms.map(platformLabel).join(', ')}</Field>
            <Field label="Tags">
              {c.tags.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {c.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </span>
              )}
            </Field>
            <Field label="Deadline">
              {c.deadline && (
                <span className={c.isOverdue ? 'font-medium text-red-700' : ''}>
                  {formatDay(c.deadline)}
                  {c.isOverdue && ' (overdue)'}
                </span>
              )}
            </Field>
            <Field label="Planned publication">{c.plannedDate && formatDay(c.plannedDate)}</Field>
            <Field label="Created">{formatInstant(c.createdAt, tz)}</Field>
            <Field label="Last modified">{formatInstant(c.updatedAt, tz)}</Field>
          </dl>
        </Card>
        <Card title="Approval & publication">
          <dl className="space-y-4">
            <Field label="Revision">{c.revision === 0 ? 'Original (no changes requested)' : `Revision ${c.revision}`}</Field>
            <Field label="Approval">
              {c.approval ? (
                <span className="inline-flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  <span>
                    Approved {formatInstant(c.approval.approvedAt, tz)}
                    {c.approval.approverName ? ` by ${c.approval.approverName}` : ''}
                  </span>
                </span>
              ) : (
                'Not approved'
              )}
            </Field>
            <Field label="Publication">
              {c.status === 'published' ? (
                <span>
                  Published {formatInstant(c.publishedAt, tz)}
                  <span className="block text-xs text-slate-500">Confirmed by you; not checked against the platform.</span>
                  {c.publishedUrl && (
                    <a href={c.publishedUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-brand-700 hover:underline">
                      View live post <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                </span>
              ) : (
                'Not published'
              )}
            </Field>
          </dl>
        </Card>
      </div>
    </div>
  );
}

export default function ContentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const meta = useContentMeta();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview';

  const [state, setState] = useState({ status: 'loading', data: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    const ctrl = new AbortController();
    contentApi
      .get(id, ctrl.signal)
      .then((r) => setState({ status: 'ready', data: r.data }))
      .catch((err) => err.name !== 'AbortError' && setState((s) => ({ status: err.status === 404 ? 'missing' : 'error', data: s.data })));
    return () => ctrl.abort();
  }, [id]);
  useEffect(() => load(), [load]);

  const changed = () => {
    setRefreshKey((k) => k + 1);
    load();
  };

  async function move(t) {
    if (dialogKind(t)) return setDialog(t);
    setBusy(true);
    setMoveError('');
    try {
      const res = await contentApi.transition(id, { to: t.to });
      setState({ status: 'ready', data: res.data });
      setRefreshKey((k) => k + 1);
      toast.success(`Moved to ${t.label}`);
    } catch (ex) {
      setMoveError(ex.message);
      if (ex.status === 409) changed(); // someone/something changed it: show the current state
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(c) {
    setBusy(true);
    try {
      const res = await (c.archived ? contentApi.restore(id) : contentApi.archive(id));
      setState({ status: 'ready', data: res.data });
      setRefreshKey((k) => k + 1);
      toast.success(c.archived ? 'Content restored' : 'Content archived');
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await contentApi.remove(id);
      toast.success('Content deleted permanently');
      navigate('/content');
    } catch (ex) {
      toast.error(ex.message);
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="space-y-5" aria-busy>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (state.status === 'missing' || (state.status === 'error' && !state.data)) {
    const missing = state.status === 'missing';
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <ErrorState title={missing ? 'Content not found' : 'Couldn’t load this content'} message={missing ? 'It may have been deleted, or it belongs to another account.' : 'Please try again.'} onRetry={missing ? undefined : load} />
        <p className="pb-6 text-center text-sm">
          <Link to="/content" className="font-medium text-brand-600 hover:underline">Back to Content</Link>
        </p>
      </div>
    );
  }

  const c = state.data;
  const canEdit = !c.archived && c.status !== 'published';
  const forward = c.transitions.filter((t) => t.kind === 'advance' || t.kind === 'publish');
  const other = c.transitions.filter((t) => t.kind !== 'advance' && t.kind !== 'publish');

  return (
    <div className="space-y-6">
      <div>
        <Link to="/content" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Content
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-slate-900">{c.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} label={c.statusLabel} />
              {c.revision > 0 && <Badge tone="warning">Revision {c.revision}</Badge>}
              {c.isOverdue && (
                <Badge tone="danger">
                  <AlertTriangle className="mr-1 h-3 w-3" aria-hidden /> Overdue
                </Badge>
              )}
              {c.archived && <Badge>Archived</Badge>}
              <span className="text-sm text-slate-500">{typeLabel(c.type)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!c.archived && (
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => navigate(`/content/${id}/edit`)}>
                {c.status === 'published' ? 'Edit tags & link' : 'Edit'}
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={c.archived ? ArchiveRestore : Archive} loading={busy} onClick={() => toggleArchive(c)}>
              {c.archived ? 'Restore' : 'Archive'}
            </Button>
            {c.archived && (
              <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Delete permanently
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card>
        {meta ? <WorkflowStepper statuses={meta.statuses} current={c.status} /> : <Skeleton className="h-12 w-full" />}
        {c.transitions.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            {moveError && (
              <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {moveError}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-medium text-slate-700">Next step:</span>
              {forward.map((t) => (
                <Button key={t.to} size="sm" loading={busy} onClick={() => move(t)}>
                  {t.kind === 'publish' ? 'Mark as published' : t.to === 'approved' ? 'Approve' : `Move to ${t.label}`}
                </Button>
              ))}
              {other.map((t) => (
                <Button key={t.to} size="sm" variant={t.kind === 'reject' ? 'danger' : 'secondary'} disabled={busy} onClick={() => move(t)}>
                  {t.kind === 'reject' ? 'Request changes' : t.kind === 'reopen' ? 'Re-open review' : `Back to ${t.label}`}
                </Button>
              ))}
            </div>
            {c.status === 'creation' && !c.caption && c.assets.length === 0 && (
              <p className="mt-3 text-xs text-slate-500">To send this for review, add a caption or at least one file.</p>
            )}
          </div>
        )}
        {c.archived && <p className="mt-4 text-sm text-slate-600">Archived. Restore this content to change its status or edit it.</p>}
      </Card>

      <div role="tablist" aria-label="Content sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => setParams(t.key === 'overview' ? {} : { tab: t.key }, { replace: true })}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
          >
            {t.label}
            {t.key === 'assets' && c.assets.length > 0 && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{c.assets.length}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <Overview c={c} tz={user.timezone} refreshKey={refreshKey} />}
        {tab === 'assets' && <AssetsPanel content={c} meta={meta} canEdit={canEdit} onChanged={changed} />}
        {tab === 'review' && <ReviewPanel content={c} refreshKey={refreshKey} onChanged={changed} />}
        {tab === 'tasks' && <LinkedTasks kind="content" id={c.id} />}
        {tab === 'history' && <HistoryPanel content={c} meta={meta} refreshKey={refreshKey} />}
      </div>

      <TransitionDialog
        open={!!dialog}
        transition={dialog}
        contentId={id}
        onClose={() => setDialog(null)}
        onDone={(data) => {
          setDialog(null);
          setState({ status: 'ready', data });
          setRefreshKey((k) => k + 1);
        }}
      />

      <Modal
        open={confirmDelete}
        onClose={() => !busy && setConfirmDelete(false)}
        title="Delete permanently?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} loading={busy}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">“{c.title}” and all of its files, review comments and history will be deleted. This cannot be undone.</p>
      </Modal>
    </div>
  );
}
