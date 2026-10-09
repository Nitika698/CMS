import { useState } from 'react';
import { Plus, Clapperboard } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Modal,
  PlaceholderBanner,
  Select,
  Spinner,
  Table,
  Textarea,
} from '../../components/ui/index.js';

const SAMPLE_ROWS = [
  { id: 1, name: 'Sample item A', status: 'Draft' },
  { id: 2, name: 'Sample item B', status: 'Ready' },
];

const COLUMNS = [
  { key: 'name', header: 'Name' },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <Badge tone={r.status === 'Ready' ? 'success' : 'neutral'}>{r.status}</Badge>,
  },
];

export default function DesignSystemPage() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Design system</h2>
        <p className="mt-1 text-slate-500">Reusable building blocks used across every module.</p>
      </div>
      <PlaceholderBanner phase="Developer reference">
        Everything on this page is sample UI for reference. Nothing here is real or saved.
      </PlaceholderBanner>

      <Card title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button icon={Plus}>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </Card>

      <Card title="Status labels">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="brand">Brand</Badge>
          <Badge tone="success" dot>Success</Badge>
          <Badge tone="warning" dot>Warning</Badge>
          <Badge tone="danger" dot>Danger</Badge>
          <Badge tone="info" dot>Info</Badge>
        </div>
      </Card>

      <Card title="Forms">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Title" required hint="Helper text appears here.">
            {(p) => <Input placeholder="Enter a title" {...p} />}
          </FormField>
          <FormField label="With error" error="This field is required.">
            {(p) => <Input error defaultValue="" {...p} />}
          </FormField>
          <FormField label="Type">
            {(p) => (
              <Select {...p}>
                <option>Reel</option>
                <option>Post</option>
              </Select>
            )}
          </FormField>
          <FormField label="Notes">{(p) => <Textarea rows={3} {...p} />}</FormField>
        </div>
      </Card>

      <Card title="Table states" padded={false}>
        <div className="space-y-4 p-5">
          <p className="text-sm font-medium text-slate-700">Loaded (sample rows)</p>
          <Table columns={COLUMNS} rows={SAMPLE_ROWS} />
          <p className="text-sm font-medium text-slate-700">Loading</p>
          <Table columns={COLUMNS} loading />
          <p className="text-sm font-medium text-slate-700">Empty</p>
          <Table
            columns={COLUMNS}
            rows={[]}
            empty={<EmptyState icon={Clapperboard} title="No content yet" description="Create your first item to get started." />}
          />
          <p className="text-sm font-medium text-slate-700">Error</p>
          <Table columns={COLUMNS} error="Could not load data." onRetry={() => {}} />
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Loading"><Spinner /></Card>
        <Card title="Error state"><ErrorState message="A friendly explanation of what failed." onRetry={() => {}} /></Card>
      </div>

      <Card title="Modal">
        <Button variant="secondary" onClick={() => setOpen(true)}>Open modal</Button>
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Example modal"
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => setOpen(false)}>Confirm</Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Press Escape, click outside, or use the buttons to close.</p>
        </Modal>
      </Card>
    </div>
  );
}
