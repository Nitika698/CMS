export const CLIENT_TYPES = ['brand', 'agency', 'individual', 'other'];
export const CLIENT_STATUSES = ['lead', 'active', 'past', 'blocked'];
export const CHANNELS = ['email', 'phone', 'whatsapp', 'dm', 'meeting'];
export const RATE_UNITS = ['per_post', 'per_video', 'per_story', 'per_campaign', 'per_hour', 'flat', 'other'];
export const SOCIAL_PLATFORMS = ['instagram', 'youtube', 'tiktok', 'x', 'linkedin', 'facebook', 'other'];

/** Communication channels differ slightly from "preferred contact" channels: a logged conversation can be a call, a DM, ... */
export const COMMUNICATION_CHANNELS = ['email', 'call', 'meeting', 'dm', 'whatsapp', 'other'];
export const DIRECTIONS = ['inbound', 'outbound'];

export const LIMITS = {
  contacts: 10,
  socialLinks: 10,
  rates: 20,
  name: 120,
  longText: 20_000,
  shortText: 1_000,
};

/** Suggestions only: category and industry are free text, so a user can use their own words. */
export const COMMON_CATEGORIES = ['Beauty', 'Fashion', 'Food & Drink', 'Travel', 'Tech', 'Fitness', 'Gaming', 'Home & Living', 'Finance', 'Health', 'Education', 'Entertainment'];

export const SORTS = ['name', 'updatedAt', 'createdAt', 'status', 'followUpAt', 'lastContact'];
