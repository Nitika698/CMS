import { Link } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { Badge } from '../../components/ui/index.js';
import DashSection from './DashSection.jsx';

export default function ReviewsCard({ section, loading, definition, onRetry }) {
  return (
    <DashSection
      title="Pending client reviews"
      description="Work you’ve sent that’s waiting on a brand’s approval."
      def={definition}
      section={section}
      loading={loading}
      onRetry={onRetry}
      viewAll={{ to: '/campaigns', label: 'Campaigns' }}
      isEmpty={(s) => s.count === 0}
      empty={{ icon: ClipboardCheck, title: 'No reviews pending', description: 'Deliverables you submit for approval will wait here until the brand responds.' }}
    >
      {(s) => (
        <>
          <ul className="divide-y divide-slate-100">
            {s.items.map((r) => (
              <li key={r.id}>
                <Link to={`/campaigns/${r.campaignId}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{r.title}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[r.campaignTitle, r.clientName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Badge tone={r.waitingDays >= 7 ? 'warning' : 'neutral'}>
                    {r.waitingDays === 0 ? 'today' : `waiting ${r.waitingDays}d`}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
          {s.count > s.items.length && <p className="mt-2 text-xs text-slate-500">Showing {s.items.length} of {s.count}.</p>}
        </>
      )}
    </DashSection>
  );
}
