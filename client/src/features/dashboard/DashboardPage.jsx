import { RefreshCw } from 'lucide-react';
import { Badge, Button, Card, ErrorState, PlaceholderBanner, Skeleton } from '../../components/ui/index.js';
import { useApiHealth } from '../../lib/useApiHealth.js';
import { NAV_ITEMS } from '../../lib/navigation.js';
import { useAuth } from '../auth/AuthContext.jsx';

function StatusRow({ label, loading, tone, text }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-600">{label}</span>
      {loading ? <Skeleton className="h-5 w-24" /> : <Badge tone={tone} dot>{text}</Badge>}
    </div>
  );
}

function SystemStatus() {
  const { loading, api, database, error, refresh } = useApiHealth();

  return (
    <Card
      title="System status"
      description="Live checks against the backend — this is real, not sample data."
      action={
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>
          Refresh
        </Button>
      }
    >
      {error ? (
        <ErrorState
          title="Cannot reach the API"
          message="Start the server with `npm run dev` and check VITE_API_BASE_URL."
          onRetry={refresh}
        />
      ) : (
        <div className="divide-y divide-slate-100">
          <StatusRow label="API server" loading={loading} tone="success" text={api ? `OK · up ${api.uptimeSeconds}s` : ''} />
          <StatusRow
            label="Database (MongoDB)"
            loading={loading}
            tone={database?.database === 'connected' ? 'success' : 'danger'}
            text={database?.database ?? ''}
          />
          <StatusRow label="Environment" loading={loading} tone="neutral" text={api?.environment ?? ''} />
        </div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const modules = NAV_ITEMS.filter((i) => i.path !== '/dashboard');
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome, {user.name.split(' ')[0]}</h2>
        <p className="mt-1 text-slate-500">Your content and business workspace.</p>
      </div>

      <SystemStatus />

      <PlaceholderBanner phase="Dashboard summaries">
        Today’s posts, due tasks and outstanding balances will appear here once those modules exist. No figures are shown until then.
      </PlaceholderBanner>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {modules.map(({ path, label, icon: Icon, phase }) => (
          <Card key={path} className="h-full">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{label}</p>
                <Badge tone="warning">{phase}</Badge>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">Not implemented yet.</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
