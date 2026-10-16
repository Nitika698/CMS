export const STATUS_LABEL = { lead: 'Lead', active: 'Active', past: 'Past', blocked: 'Blocked' };
export const STATUS_TONE = { lead: 'info', active: 'success', past: 'neutral', blocked: 'danger' };
export const TYPE_LABEL = { brand: 'Brand', agency: 'Agency', individual: 'Individual', other: 'Other' };
export const CHANNEL_LABEL = { email: 'Email', phone: 'Phone', whatsapp: 'WhatsApp', dm: 'Direct message', meeting: 'Meeting' };
export const DISCUSSION_CHANNEL_LABEL = { email: 'Email', call: 'Call', meeting: 'Meeting', dm: 'Direct message', whatsapp: 'WhatsApp', other: 'Other' };
export const RATE_UNIT_LABEL = { per_post: 'per post', per_video: 'per video', per_story: 'per story', per_campaign: 'per campaign', per_hour: 'per hour', flat: 'flat fee', other: '' };
export const SOCIAL_LABEL = { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', facebook: 'Facebook', other: 'Website / other' };
export const CAMPAIGN_STATUS_LABEL = { proposed: 'Proposed', negotiating: 'Negotiating', confirmed: 'Confirmed', in_progress: 'In progress', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled' };
export const INVOICE_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  partially_paid: { label: 'Partially paid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
  void: { label: 'Void', tone: 'neutral' },
};

export const SORT_OPTIONS = [
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
  { value: '-updatedAt', label: 'Recently updated' },
  { value: '-createdAt', label: 'Newest first' },
  { value: '-lastContact', label: 'Last contact (latest)' },
  { value: 'lastContact', label: 'Last contact (oldest)' },
  { value: 'followUpAt', label: 'Follow-up (soonest)' },
  { value: 'status', label: 'Relationship stage' },
];

export const label = (map, key) => map[key] ?? key;
