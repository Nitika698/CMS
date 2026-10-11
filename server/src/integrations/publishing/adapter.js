/**
 * THE CONTRACT FOR FUTURE SOCIAL-NETWORK PUBLISHING.
 *
 * Nothing in the app publishes to a network today: no adapter is registered, so every platform reports
 * "direct publishing not available" and the only way to mark a post published is the user confirming it manually.
 *
 * To add a network (Instagram Graph API, YouTube Data API, TikTok Content Posting API, ...):
 *   1. Implement this interface in its own file next to this one (OAuth/authorisation, token storage, upload, publish).
 *   2. Test it against the platform's real, supported API with real authorisation (and against a fake in unit tests).
 *   3. Register it in registry.js. Until then the rest of the system must behave exactly as it does now.
 *
 * Rules every adapter must follow:
 *   - `publish` returns `{ externalPostId }` ONLY if the platform confirmed creation. Otherwise it throws a PublishError.
 *   - Never return a made-up id or a "probably worked" result. The service treats a missing id as a failure.
 *   - Never log or return access tokens.
 *
 * @typedef {Object} PublishRequest
 * @property {{ id: string, platform: string, captionOverride?: string }} post
 * @property {{ id: string, title: string, caption?: string, hashtags: string[] }} content
 * @property {Array<{ id: string, mimeType: string, bytes: number }>} assets   metadata only; fetch bytes via the storage layer
 * @property {{ id: string }} user
 *
 * @typedef {Object} PublishResult
 * @property {string} externalPostId   the platform's id for the new post (required)
 * @property {string} [externalUrl]
 * @property {Date}   [publishedAt]    the platform's timestamp, if it reports one
 *
 * @typedef {Object} PublishingAdapter
 * @property {string} platform                       one of the platform keys in content.constants.js
 * @property {() => Promise<boolean>} isConfigured   app credentials present AND the user's account connected
 * @property {(req: PublishRequest) => Promise<PublishResult>} publish
 * @property {(externalPostId: string) => Promise<{ live: boolean }>} [getStatus]
 */

/** Thrown by adapters for expected failures. `userMessage` is safe to store and show; nothing else is. */
export class PublishError extends Error {
  constructor(userMessage, { retryable = false } = {}) {
    super(userMessage);
    this.name = 'PublishError';
    this.userMessage = userMessage;
    this.retryable = retryable;
  }
}

/** @param {any} a */
export function assertAdapter(a) {
  if (!a || typeof a.platform !== 'string' || typeof a.isConfigured !== 'function' || typeof a.publish !== 'function') {
    throw new TypeError('A publishing adapter needs { platform, isConfigured(), publish() }');
  }
}
