import { EmptyState, ErrorState, Skeleton } from './Feedback.jsx';

/**
 * columns: [{ key, header, render?(row), className? }]
 * Handles loading / error / empty states so every list screen behaves the same.
 */
export default function Table({ columns, rows = [], rowKey = (r) => r.id, loading, error, onRetry, empty }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-4 py-3 text-left font-medium text-slate-600 ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading &&
            Array.from({ length: 4 }, (_, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3">
                    <Skeleton className="h-4 w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            !error &&
            rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-slate-50">
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 text-slate-700 ${c.className ?? ''}`}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {!loading && error && <ErrorState message={error} onRetry={onRetry} />}
      {!loading && !error && rows.length === 0 && (empty ?? <EmptyState title="Nothing here yet" />)}
    </div>
  );
}
