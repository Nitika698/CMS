import { AppError } from '../../lib/errors.js';
import { STATUS_LABELS } from '../../modules/content/content.constants.js';
import { ContentEvent } from '../../modules/content/content-event.model.js';
import { Content } from '../../modules/content/content.model.js';
import { MediaAsset } from '../../modules/media/media-asset.model.js';
import { Post } from '../../modules/posts/post.model.js';
import { findOwnedPost, presentMany } from '../../modules/posts/posts.service.js';
import { PublishError } from './adapter.js';
import { getAdapter } from './registry.js';

const notAvailable = (platform) =>
  new AppError(501, 'NOT_IMPLEMENTED', `Direct publishing to ${platform} is not available. Publish it yourself, then mark the post as published in CMS.`, {
    platform,
    manualPublishing: true,
  });

/**
 * The ONLY path by which a post can become published with `verification: "platform"`.
 * It requires a registered, configured adapter, and the adapter must return the platform's own id for the new post.
 * With no adapter registered (today) this always refuses and changes nothing.
 */
export async function publishViaPlatform(user, postId, now = new Date()) {
  const post = await findOwnedPost(user.id, postId);
  const adapter = getAdapter(post.platform);
  if (!adapter || !(await adapter.isConfigured().catch(() => false))) throw notAvailable(post.platform);

  if (!['scheduled', 'awaiting_confirmation'].includes(post.status)) {
    throw new AppError(409, 'INVALID_TRANSITION', 'Only a scheduled or ready post can be published to a platform.', { from: post.status });
  }
  const content = await Content.findOne({ _id: post.content, owner: user.id });
  if (!content || content.archivedAt) throw new AppError(409, 'ARCHIVED', 'This content is archived.');
  if (!['approved', 'published'].includes(content.status)) {
    throw new AppError(422, 'CONTENT_NOT_APPROVED', `The content is still "${STATUS_LABELS[content.status]}". Approve it before publishing.`);
  }

  const assets = await MediaAsset.find({ owner: user.id, content: content._id }).select('mimeType bytes').lean();
  let result;
  try {
    result = await adapter.publish({
      post: { id: String(post._id), platform: post.platform, captionOverride: post.captionOverride },
      content: { id: String(content._id), title: content.title, caption: content.caption, hashtags: content.hashtags ?? [] },
      assets: assets.map((a) => ({ id: String(a._id), mimeType: a.mimeType, bytes: a.bytes })),
      user: { id: String(user.id) },
    });
  } catch (err) {
    return fail(user, post, content, err instanceof PublishError ? err.userMessage : 'The platform did not accept the post.', now);
  }

  // A result without the platform's own id is NOT evidence of publication.
  if (!result || typeof result.externalPostId !== 'string' || !result.externalPostId.trim()) {
    return fail(user, post, content, 'The platform did not confirm the post.', now);
  }

  const from = post.status;
  post.status = 'published';
  post.verification = 'platform';
  post.externalPostId = result.externalPostId;
  post.externalUrl = result.externalUrl;
  post.publishedAt = result.publishedAt ?? now;
  post.failureReason = undefined;
  post.statusChangedAt = now;
  await post.save();
  await ContentEvent.create({ owner: user.id, content: content._id, type: 'post_status_changed', from, to: 'published', comment: `${post.platform} (platform confirmed)`, revision: content.revision, actor: user.id });
  return { data: (await presentMany(user, [post]))[0], warnings: [] };
}

async function fail(user, post, content, reason, now) {
  const from = post.status;
  post.status = 'failed';
  post.failureReason = String(reason).slice(0, 300);
  post.statusChangedAt = now;
  await post.save();
  await ContentEvent.create({ owner: user.id, content: content._id, type: 'post_status_changed', from, to: 'failed', comment: post.platform, revision: content.revision, actor: user.id });
  throw new AppError(502, 'PUBLISH_FAILED', post.failureReason, { postId: String(post._id) });
}

export { Post };
