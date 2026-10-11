import { Badge } from '../../components/ui/index.js';
import { STATUS_TONE } from './constants.js';

export default function StatusBadge({ status, label }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot={status === 'published'}>
      {label ?? status}
    </Badge>
  );
}
