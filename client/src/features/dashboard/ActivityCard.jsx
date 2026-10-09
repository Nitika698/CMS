import { Link } from 'react-router-dom';
import { MessagesSquare, Wallet } from 'lucide-react';
import DashSection from './DashSection.jsx';
import { formatMoney, timeAgo } from './format.js';

export default function ActivityCard({ section, loading, definition, onRetry }) {
  return (
    <DashSection
      title="Recent client activity"
      description="Latest conversations and payments."
      def={definition}
      section={section}
      loading={loading}
      onRetry={onRetry}
      viewAll={{ to: '/communications', label: 'Communications' }}
      isEmpty={(s) => s.items.length === 0}
      empty={{ icon: MessagesSquare, title: 'No activity yet', description: 'Logged emails, calls, DMs and received payments will appear here.' }}
    >
      {(s) => (
        <ul className="divide-y divide-slate-100">
          {s.items.map((e) => {
            const Icon = e.type === 'payment' ? Wallet : MessagesSquare;
            return (
              <li key={`${e.type}-${e.id}`}>
                <Link to={e.clientId ? `/brands/${e.clientId}` : '/communications'} className="flex items-start gap-3 py-2.5 hover:bg-slate-50">
                  <span className="mt-0.5 rounded-lg bg-slate-100 p-1.5 text-slate-600">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{e.title}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[e.clientName, e.type === 'payment' ? formatMoney(e.amountMinor, e.currency) : e.direction].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{timeAgo(e.at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashSection>
  );
}
