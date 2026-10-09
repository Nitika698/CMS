import { RefreshCw } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Skeleton } from '../../components/ui/index.js';
import { useApiHealth } from '../../lib/useApiHealth.js';

function StatusRow({ label, loading, tone, text }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-600">{label}</span>
      {loading ? <Skeleton className="h-5 w-24" /> : <Badge tone={tone} dot>{text}</Badge>}
    </div>
  );
}

/** Live checks against the backend (real, not sample data). */
export default function SystemStatus() {
  const { loading, api, database, error, refresh } = useApiHealth();
  return (
    <Card
      title="System status"
      description="Live checks against the backend."
      action={
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>
          Refresh
        </Button>
      }
    >
      {error ? (
        <ErrorState title="Cannot reach the API" message="Start the server with `npm run dev` and check VITE_API_BASE_URL." onRetry={refresh} />
      ) : (
        <div className="divide-y divide-slate-100">
          <StatusRow label="API server" loading={loading} tone="success" text={api ? `OK · up ${api.uptimeSeconds}s` : ''} />
          <StatusRow label="Database (MongoDB)" loading={loading} tone={database?.database === 'connected' ? 'success' : 'danger'} text={database?.database ?? ''} />
          <StatusRow label="Environment" loading={loading} tone="neutral" text={api?.environment ?? ''} />
        </div>
      )}
    </Card>
  );
}
