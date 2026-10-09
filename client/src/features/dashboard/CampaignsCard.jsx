import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { Badge } from '../../components/ui/index.js';
import DashSection from './DashSection.jsx';
import { daysLabel, formatDate, STATUS_LABEL } from './format.js';

function Group({ title, children }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

export default function CampaignsCard({ section, loading, definitions, timezone, onRetry }) {
  return (
    <DashSection
      title="Active campaigns & deadlines"
      description="Brand work in flight and what’s due soon."
      def={definitions?.activeCampaigns}
      section={section}
      loading={loading}
      onRetry={onRetry}
      viewAll={{ to: '/campaigns', label: 'Campaigns' }}
      isEmpty={(s) => s.activeCount === 0 && s.deadlines.length === 0 && s.overdue.deliverables === 0}
      empty={{
        icon: Megaphone,
        title: 'No active campaigns',
        description: 'Confirmed and in-progress brand campaigns will appear here with their deadlines.',
      }}
    >
      {(s) => {
        const overdue = s.overdue.deliverables + s.overdue.campaignsPastEndDate;
        return (
          <div className="space-y-5">
            {overdue > 0 && (
              <div role="status" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                <span className="font-medium">Overdue:</span>{' '}
                {[s.overdue.deliverables && `${s.overdue.deliverables} deliverable${s.overdue.deliverables === 1 ? '' : 's'}`,
                  s.overdue.campaignsPastEndDate && `${s.overdue.campaignsPastEndDate} campaign${s.overdue.campaignsPastEndDate === 1 ? '' : 's'} past end date`]
                  .filter(Boolean).join(' and ')}
              </div>
            )}

            <Group title={`Deadlines · next ${s.windowDays} days`}>
              {s.deadlines.length === 0 ? (
                <p className="text-sm text-slate-500">No deadlines in the next {s.windowDays} days.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {s.deadlines.map((d) => (
                    <li key={`${d.type}-${d.id}`}>
                      <Link to={`/campaigns/${d.campaignId}`} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900">{d.title}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {d.type === 'campaign_end' ? 'Campaign ends' : `Deliverable${d.campaignTitle ? ` · ${d.campaignTitle}` : ''}`}
                            {d.clientName ? ` · ${d.clientName}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-medium text-slate-900">{daysLabel(d.daysLeft)}</span>
                          <span className="block text-xs text-slate-500">{formatDate(d.dueAt, timezone)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Group>

            <Group title={`Active campaigns · ${s.activeCount}`}>
              {s.active.length === 0 ? (
                <p className="text-sm text-slate-500">No campaigns are confirmed or in progress.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {s.active.map((c) => (
                    <li key={c.id}>
                      <Link to={`/campaigns/${c.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900">{c.title}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {c.clientName ?? 'Unknown brand'} · {c.endDate ? `ends ${formatDate(c.endDate, timezone)}` : 'no end date'}
                          </span>
                        </span>
                        <Badge tone={c.status === 'in_progress' ? 'info' : 'neutral'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Group>
          </div>
        );
      }}
    </DashSection>
  );
}
