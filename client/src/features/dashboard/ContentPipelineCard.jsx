import { Link } from 'react-router-dom';
import { Clapperboard } from 'lucide-react';
import DashSection from './DashSection.jsx';
import { formatCount } from './format.js';

/**
 * Horizontal bars, one hue (single measure, one series), thin, 4px rounded data end anchored to the baseline.
 * The value sits at the tip; the list itself is the accessible table view.
 */
function Bars({ stages }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <ul className="space-y-3" aria-label="Content items per stage">
      {stages.map((s) => (
        <li key={s.key}>
          <Link to="/content" className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 rounded-md py-0.5 hover:bg-slate-50">
            <span className="text-sm text-slate-700">{s.label}</span>
            <span className="h-4" aria-hidden>
              {s.count > 0 && (
                <span
                  className="block h-4 rounded-r-[4px]"
                  style={{ width: `${Math.max(2, (s.count / max) * 100)}%`, background: 'var(--viz-1)' }}
                />
              )}
            </span>
            <span className="w-8 text-right text-sm font-medium tabular-nums text-slate-900">{formatCount(s.count)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ContentPipelineCard({ section, loading, definition, onRetry }) {
  return (
    <DashSection
      title="Content by workflow status"
      description="Where each idea is, from first thought to published."
      def={definition}
      section={section}
      loading={loading}
      onRetry={onRetry}
      viewAll={{ to: '/content', label: 'Content' }}
      isEmpty={(s) => s.total === 0}
      empty={{
        icon: Clapperboard,
        title: 'No content yet',
        description: 'Ideas, drafts and ready-to-post content will be counted here by stage.',
        action: (
          <Link to="/content" className="text-sm font-medium text-brand-600 hover:underline">
            Go to Content
          </Link>
        ),
      }}
    >
      {(s) => (
        <>
          <Bars stages={s.stages} />
          {s.note && <p className="mt-3 text-xs text-slate-500">{s.note}</p>}
        </>
      )}
    </DashSection>
  );
}
