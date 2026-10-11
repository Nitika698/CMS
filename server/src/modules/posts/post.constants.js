/**
 * The vocabulary of the content calendar. INTERNAL scheduling only: nothing here publishes to a social network.
 *
 * Four things are kept deliberately distinct (the user-facing "stage"):
 *   planned          a tentative slot. No reminder will ever fire.
 *   reminder         ("scheduled") CMS will remind you in-app at this time. Nothing is posted automatically.
 *   ready            ("awaiting_confirmation") the time has arrived: post it yourself, then confirm it here.
 *   published        a user (or, in future, a platform integration) CONFIRMED it is live. `verification` says which.
 */
export const POST_STATUSES = ['planned', 'scheduled', 'awaiting_confirmation', 'published', 'missed', 'failed', 'cancelled'];

/** Statuses that occupy a slot: at most one per content+platform (enforced by a partial unique index). */
export const ACTIVE_STATUSES = ['planned', 'scheduled', 'awaiting_confirmation'];

export const POST_TRANSITIONS = {
  planned: ['scheduled', 'cancelled'],
  scheduled: ['planned', 'awaiting_confirmation', 'published', 'cancelled'],
  awaiting_confirmation: ['published', 'missed', 'scheduled', 'cancelled'],
  missed: ['scheduled', 'planned', 'cancelled'],
  failed: ['scheduled', 'planned', 'cancelled'], // only reachable once platform integrations exist
  cancelled: ['planned'],
  published: [],
};

export const STAGES = {
  planned: { key: 'planned', label: 'Planned', description: 'A tentative slot. No reminder will fire.' },
  scheduled: { key: 'reminder', label: 'Scheduled reminder', description: 'CMS will remind you at this time. Nothing is posted automatically.' },
  awaiting_confirmation: { key: 'ready', label: 'Ready to publish', description: 'The time has come. Post it yourself, then confirm it here.' },
  published: { key: 'published', label: 'Published', description: 'You confirmed this is live. CMS has not verified it with the platform.' },
  missed: { key: 'missed', label: 'Missed', description: 'The time passed and it was not posted. Reschedule it or cancel it.' },
  failed: { key: 'failed', label: 'Failed', description: 'A platform publish attempt failed.' },
  cancelled: { key: 'cancelled', label: 'Cancelled', description: 'No longer going ahead.' },
};

export const MAX_REMINDERS = 5;
export const MAX_REMINDER_MINUTES = 30 * 24 * 60; // 30 days ahead
export const SCHEDULE_TOLERANCE_MS = 60_000; // a time picked "now" still counts as the future
export const PUBLISHED_FUTURE_TOLERANCE_MS = 5 * 60_000; // clock skew allowance when confirming a publication time
export const MAX_RANGE_DAYS = 62;
export const RANGE_REMINDER_STALE_MS = 24 * 60 * 60 * 1000; // a reminder is not sent for something more than a day past
