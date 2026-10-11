import fs from 'node:fs/promises';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { detectFileType, HEAD_BYTES, sanitizeDisplayName } from '../../lib/fileType.js';
import { signAssetToken } from '../../lib/assetTokens.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { getStorage } from '../../integrations/storage/index.js';
import { ContentEvent } from '../content/content-event.model.js';
import { Content } from '../content/content.model.js';
import { MediaAsset, toPublicAsset } from './media-asset.model.js';

const MB = 1024 * 1024;

// Whole bytes: the upload parser requires an integer, and MB settings may be fractional.
export const uploadLimits = () => ({
  image: Math.floor(env.MAX_UPLOAD_IMAGE_MB * MB),
  video: Math.floor(env.MAX_UPLOAD_VIDEO_MB * MB),
  document: Math.floor(env.MAX_UPLOAD_DOC_MB * MB),
});
export const maxUploadBytes = () => Math.max(...Object.values(uploadLimits()));

export const ALLOWED_TYPES = [
  { resourceType: 'image', mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] },
  { resourceType: 'video', mimes: ['video/mp4', 'video/quicktime', 'video/webm'] },
  { resourceType: 'document', mimes: ['application/pdf'] },
];

async function readHead(file) {
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function ownedContent(userId, contentId) {
  if (!isObjectId(String(contentId))) throw notFound('Content');
  const content = await Content.findOne({ _id: contentId, owner: userId }).select('_id status archivedAt revision');
  if (!content) throw notFound('Content');
  return content;
}

/** Cheap ownership/state check used BEFORE the upload body is read, so foreign requests never write a file. */
export async function assertCanAttach(userId, contentId) {
  const content = await ownedContent(userId, contentId);
  if (content.archivedAt) throw new AppError(409, 'ARCHIVED', 'Restore this content before adding files');
  if (content.status === 'published') throw new AppError(409, 'CONTENT_LOCKED', 'Published content is locked');
  return content;
}

/**
 * Validates and stores one uploaded temp file (already size-capped by multer). The caller deletes the temp file.
 * Order: ownership -> count -> real type from bytes -> per-type size -> store -> record.
 */
export async function attachAsset(userId, contentId, file) {
  const content = await assertCanAttach(userId, contentId);
  if (!file) throw new AppError(400, 'NO_FILE', 'Attach a file in the "file" field');
  if (!file.size) throw new AppError(400, 'EMPTY_FILE', 'The file is empty');

  if ((await MediaAsset.countDocuments({ owner: userId, content: content._id })) >= env.MAX_ASSETS_PER_CONTENT) {
    throw new AppError(409, 'TOO_MANY_ASSETS', `A content item can have at most ${env.MAX_ASSETS_PER_CONTENT} files`);
  }

  const type = detectFileType(await readHead(file.path));
  if (!type) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Unsupported file. Allowed: JPEG, PNG, GIF, WebP images; MP4, MOV, WebM video; PDF.');
  }
  const limit = uploadLimits()[type.resourceType];
  if (file.size > limit) {
    const noun = { image: 'Images', video: 'Videos', document: 'Documents' }[type.resourceType];
    throw new AppError(413, 'FILE_TOO_LARGE', `${noun} can be at most ${+(limit / MB).toFixed(2)} MB`);
  }

  const storage = await getStorage();
  let saved;
  try {
    saved = await storage.save({ ownerId: userId, tempPath: file.path, ext: type.ext, mimeType: type.mime, resourceType: type.resourceType });
  } catch {
    throw new AppError(502, 'STORAGE_ERROR', 'Could not store the file. Please try again.');
  }

  try {
    const asset = await MediaAsset.create({
      owner: userId,
      content: content._id,
      provider: storage.name,
      storageKey: saved.storageKey,
      resourceType: type.resourceType,
      mimeType: type.mime,
      bytes: file.size,
      originalName: sanitizeDisplayName(file.originalname),
    });
    await ContentEvent.create({ owner: userId, content: content._id, type: 'asset_added', comment: asset.originalName, revision: content.revision, actor: userId });
    return toPublicAsset(asset);
  } catch (err) {
    await storage.remove({ storageKey: saved.storageKey, resourceType: type.resourceType }).catch(() => {}); // don't leave an orphan file
    throw err;
  }
}

export async function removeAsset(userId, contentId, assetId) {
  const content = await assertCanAttach(userId, contentId);
  if (!isObjectId(String(assetId))) throw notFound('File');
  const asset = await MediaAsset.findOne({ _id: assetId, owner: userId, content: content._id });
  if (!asset) throw notFound('File');
  const storage = await getStorage();
  try {
    await storage.remove(asset);
  } catch {
    throw new AppError(502, 'STORAGE_ERROR', 'Could not delete the stored file. Nothing was changed; try again.');
  }
  await asset.deleteOne();
  await ContentEvent.create({ owner: userId, content: content._id, type: 'asset_removed', comment: asset.originalName, revision: content.revision, actor: userId });
}

async function ownedAsset(userId, assetId) {
  if (!isObjectId(String(assetId))) throw notFound('File');
  const asset = await MediaAsset.findOne({ _id: assetId, owner: userId });
  if (!asset) throw notFound('File');
  return asset;
}

/** A short-lived link (relative to the API base) that an <img>/<video> tag can use. */
export async function createAccessLink(userId, assetId) {
  const asset = await ownedAsset(userId, assetId);
  const token = signAssetToken({ assetId: asset._id, ownerId: userId });
  return { path: `/media/${asset._id}/file?token=${token}`, expiresInSeconds: env.ASSET_TOKEN_TTL_SECONDS };
}

export async function serveAsset(userId, assetId, req, res) {
  const asset = await ownedAsset(userId, assetId);
  const storage = await getStorage();
  if (asset.provider !== storage.name) throw new AppError(500, 'STORAGE_ERROR', 'This file was stored with a different provider than the one configured');
  await storage.serve(asset, req, res);
}
