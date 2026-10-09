import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import DashSection from './DashSection.jsx';
import { formatMoney } from './format.js';

const SEGMENTS = [
  { key: 'collected', label: 'Collected', color: 'var(--viz-1)' },
  { key: 'outstanding', label: 'Outstanding', color: 'var(--viz-2)' },
  { key: 'notYetInvoiced', label: 'Not yet invoiced', color: 'var(--viz-3)' },
];

/**
 * One stacked bar per currency (currencies are never added together). Segments are separated by a 2px surface
 * gap, not outlines. Every segment has a text label in the legend and the figures table below, so identity
 * never relies on colour alone.
 */
function CurrencyBlock({ c }) {
  const total = SEGMENTS.reduce((sum, s) => sum + c[s.key], 0);
  const summary = SEGMENTS.map((s) => `${s.label} ${formatMoney(c[s.key], c.currency)}`).join(', ');
  const rows = [
    ['Agreed fees', c.agreed],
    ['Invoiced', c.invoiced],
    ['Collected', c.collected],
    ['Outstanding', c.outstanding],
    ['…of which overdue', c.overdue, c.overdue > 0],
    ['Collected this month', c.collectedThisMonth],
  ];
  return (
    <section aria-label={`${c.currency} payments`} className="py-4 first:pt-0 last:pb-0">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{c.currency}</h3>
        <span className="text-xs text-slate-500">
          {c.openInvoices} open invoice{c.openInvoices === 1 ? '' : 's'}
        </span>
      </div>

      {total > 0 ? (
        <div role="img" aria-label={summary} className="flex h-5 gap-0.5 overflow-hidden rounded-[4px]" style={{ background: 'var(--viz-surface)' }}>
          {SEGMENTS.filter((s) => c[s.key] > 0).map((s) => (
            <span key={s.key} title={`${s.label}: ${formatMoney(c[s.key], c.currency)}`} style={{ width: `${(c[s.key] / total) * 100}%`, background: s.color }} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No amounts to chart yet.</p>
      )}

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-hidden>
        {SEGMENTS.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label} <span className="font-medium tabular-nums text-slate-900">{formatMoney(c[s.key], c.currency)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
        {rows.map(([label, value, danger]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className={`font-medium tabular-nums ${danger ? 'text-red-700' : 'text-slate-900'}`}>{formatMoney(value, c.currency)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function PaymentsCard({ section, loading, definition, onRetry }) {
  return (
    <DashSection
      title="Payments"
      description="Agreed, collected and outstanding, per currency."
      def={definition}
      section={section}
      loading={loading}
      onRetry={onRetry}
      viewAll={{ to: '/payments', label: 'Payments' }}
      isEmpty={(s) => s.currencies.length === 0}
      empty={{
        icon: Wallet,
        title: 'No agreed fees or invoices yet',
        description: 'Campaign fees and sent invoices will be totalled here, separately for each currency.',
        action: (
          <Link to="/payments" className="text-sm font-medium text-brand-600 hover:underline">
            Go to Payments
          </Link>
        ),
      }}
    >
      {(s) => <div className="divide-y divide-slate-100">{s.currencies.map((c) => <CurrencyBlock key={c.currency} c={c} />)}</div>}
    </DashSection>
  );
}
