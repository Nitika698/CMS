/** How campaign statuses are grouped. Used by the dashboard and by the client page so they always agree. */
export const ACTIVE_CAMPAIGN = ['confirmed', 'in_progress'];
export const PIPELINE_CAMPAIGN = ['proposed', 'negotiating'];
export const PAST_CAMPAIGN = ['delivered', 'completed'];
/** Statuses whose fee counts as "agreed" money. */
export const AGREED_CAMPAIGN = ['confirmed', 'in_progress', 'delivered', 'completed'];

export function campaignGroup(status) {
  if (ACTIVE_CAMPAIGN.includes(status)) return 'active';
  if (PIPELINE_CAMPAIGN.includes(status)) return 'pipeline';
  if (PAST_CAMPAIGN.includes(status)) return 'past';
  return 'cancelled';
}
