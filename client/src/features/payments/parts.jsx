import { AlertCircle } from 'lucide-react';
import { Badge } from '../../components/ui/index.js';
import { INVOICE_STATUS } from '../clients/constants.js';
import { formatDay } from '../content/dates.js';

export const ymdLabel = (ymd) => (ymd ? formatDay(`${ymd}T00:00:00Z`) : '—');

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED', 'JPY'];

export function InvoiceBadge({ invoice }) {
  const s = INVOICE_STATUS[invoice.displayStatus] ?? { label: invoice.displayLabel, tone: 'neutral' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** "Overdue by 3 days" in words and an icon, never colour alone. */
export function DueText({ invoice }) {
  if (!invoice.dueDay) return <span className="text-slate-400">No due date</span>;
  if (invoice.displayStatus === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-red-700">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden /> Overdue · {ymdLabel(invoice.dueDay)} ({invoice.overdueDays} day{invoice.overdueDays === 1 ? '' : 's'})
      </span>
    );
  }
  return <span className="text-slate-600">{ymdLabel(invoice.dueDay)}</span>;
}

export const NOT_PROCESSING = 'CMS tracks invoices and the payments you record. It does not send invoices, charge brands or process payments.';
