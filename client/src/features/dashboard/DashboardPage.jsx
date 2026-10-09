import { RefreshCw } from 'lucide-react';
import { Button, ErrorState } from '../../components/ui/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDashboard } from './useDashboard.js';
import { formatTime } from './format.js';
import SummaryCards from './SummaryCards.jsx';
import ContentPipelineCard from './ContentPipelineCard.jsx';
import UpcomingPostsCard from './UpcomingPostsCard.jsx';
import CampaignsCard from './CampaignsCard.jsx';
import TasksCard from './TasksCard.jsx';
import ReviewsCard from './ReviewsCard.jsx';
import PaymentsCard from './PaymentsCard.jsx';
import ActivityCard from './ActivityCard.jsx';
import SystemStatus from './SystemStatus.jsx';

export default function DashboardPage() {
  const { user } = useAuth();
  const { status, data, reload, refreshing, refreshError } = useDashboard();
  const loading = status === 'loading';
  const sections = data?.sections;
  const defs = data?.definitions;
  const tz = data?.timezone ?? user.timezone;
  const common = (key, definition) => ({ section: sections?.[key], loading, onRetry: reload, definition, definitions: defs, timezone: tz });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome, {user.name.split(' ')[0]}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {data
              ? `Figures use your timezone (${tz}). Updated ${formatTime(data.generatedAt, tz)}.`
              : 'Your content and business at a glance.'}
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} loading={refreshing} onClick={reload}>
          Refresh
        </Button>
      </div>

      {refreshError && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Couldn’t refresh just now. Showing the last data we loaded.
        </div>
      )}

      {status === 'error' ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <ErrorState title="Couldn’t load your dashboard" message="Check that the server is running and try again." onRetry={reload} />
        </div>
      ) : (
        <>
          <SummaryCards sections={sections} loading={loading} />

          <div className="grid items-start gap-6 lg:grid-cols-2">
            <ContentPipelineCard {...common('contentPipeline', defs?.contentPipeline)} />
            <UpcomingPostsCard {...common('upcomingPosts', defs?.upcomingPosts)} />
            <TasksCard {...common('tasks')} />
            <CampaignsCard {...common('campaigns')} />
            <ReviewsCard {...common('reviews', defs?.pendingReviews)} />
            <ActivityCard {...common('recentActivity', defs?.recentActivity)} />
          </div>

          <PaymentsCard {...common('payments', defs?.payments)} />
        </>
      )}

      <SystemStatus />
    </div>
  );
}
