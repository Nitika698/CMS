/** Single source of truth for the content workflow. The client reads this through GET /content/meta. */

export const STATUSES = ['idea', 'planning', 'creation', 'review', 'approved', 'published'];
export const STATUS_LABELS = {
  idea: 'Idea',
  planning: 'Planning',
  creation: 'Creation',
  review: 'Review',
  approved: 'Approved',
  published: 'Published',
};
export const STATUS_RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));

/**
 * Allowed moves. Everything not listed is refused.
 *   review -> creation is a REJECTION ("changes requested"): it needs a comment and starts a new revision.
 *   approved -> review re-opens a decision (clears the approval).
 *   published is final: it can only be archived, never moved back.
 */
export const TRANSITIONS = {
  idea: ['planning'],
  planning: ['creation', 'idea'],
  creation: ['review', 'planning'],
  review: ['approved', 'creation'],
  approved: ['published', 'review'],
  published: [],
};

export const TYPES = ['reel', 'short', 'video', 'story', 'carousel', 'post', 'blog', 'podcast', 'other'];
export const PLATFORMS = ['instagram', 'youtube', 'tiktok', 'x', 'linkedin', 'facebook', 'blog', 'other'];

export const LIMITS = { tags: 20, hashtags: 30, titleLen: 200, textLen: 20_000, shortTextLen: 2_000 };

/** Fields recorded in the history with before/after values. Long free text only records THAT it changed. */
export const TRACKED_SHORT_FIELDS = ['title', 'type', 'category', 'campaign', 'platforms', 'plannedDate', 'deadline'];
export const TRACKED_TEXT_FIELDS = ['description', 'caption', 'brief', 'tags', 'hashtags'];

/** After publication only these can still be edited (corrections that don't rewrite what was published). */
export const PUBLISHED_EDITABLE = ['tags', 'publishedUrl'];

export const EVENT_TYPES = [
  'created', 'updated', 'status_changed', 'approved', 'changes_requested', 'comment', 'asset_added', 'asset_removed', 'archived', 'restored',
  // calendar activity on this content's posts
  'post_created', 'post_rescheduled', 'post_status_changed',
];
export const REVIEW_EVENT_TYPES = ['approved', 'changes_requested', 'comment'];
