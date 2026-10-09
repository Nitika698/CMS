import { Card, EmptyState, PlaceholderBanner } from '../components/ui/index.js';

export default function PlaceholderPage({ item }) {
  const Icon = item.icon;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{item.label}</h2>
        <p className="mt-1 text-slate-500">{item.description}</p>
      </div>
      <PlaceholderBanner phase={item.phase} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Planned features" description="What this module will do when built.">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
            {item.planned.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
        <Card title="Your data">
          <EmptyState icon={Icon} title="No data" description="Nothing has been created or saved in this module." />
        </Card>
      </div>
    </div>
  );
}
