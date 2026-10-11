export const STATUS_TONE = { idea: 'neutral', planning: 'info', creation: 'brand', review: 'warning', approved: 'success', published: 'success' };

export const PLATFORM_LABEL = { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', facebook: 'Facebook', blog: 'Blog', other: 'Other' };
export const platformLabel = (p) => PLATFORM_LABEL[p] ?? p;
export const typeLabel = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');

export const SORT_OPTIONS = [
  { value: '-updatedAt', label: 'Recently updated' },
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: '-title', label: 'Title Z–A' },
  { value: 'deadline', label: 'Deadline (soonest)' },
  { value: '-deadline', label: 'Deadline (latest)' },
  { value: 'plannedDate', label: 'Planned date (soonest)' },
  { value: 'status', label: 'Workflow stage (earliest)' },
  { value: '-status', label: 'Workflow stage (latest)' },
];

export const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
