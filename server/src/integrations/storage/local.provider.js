import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../lib/errors.js';

/**
 * Development storage on local disk. Files live at <UPLOAD_DIR>/<ownerId>/<random><ext>; the name comes from the
 * server, never from the user, so path traversal is impossible. Not for production (env validation refuses it).
 */
export function createLocalProvider({ baseDir }) {
  const root = path.resolve(baseDir);
  const resolveKey = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new AppError(500, 'STORAGE_ERROR', 'Invalid storage key'); // defence in depth
    return full;
  };

  return {
    name: 'local',

    async save({ ownerId, tempPath, ext }) {
      const key = path.posix.join(String(ownerId), `${crypto.randomBytes(16).toString('hex')}${ext}`);
      const dest = resolveKey(key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(tempPath, dest, fs.constants.COPYFILE_EXCL); // temp dir may be on another drive, so copy
      return { storageKey: key };
    },

    async remove(asset) {
      await fs.rm(resolveKey(asset.storageKey), { force: true });
    },

    /** Sends the file. Express' sendFile adds Range support, so video seeking works. */
    async serve(asset, req, res) {
      const file = resolveKey(asset.storageKey);
      await fs.access(file).catch(() => {
        throw new AppError(404, 'NOT_FOUND', 'File not found');
      });
      res.set({
        'Content-Type': asset.mimeType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=60',
        // A sandboxing CSP stops browsers' built-in PDF viewer, so it is applied to images/video only.
        ...(asset.resourceType === 'document' ? {} : { 'Content-Security-Policy': "default-src 'none'; sandbox" }),
      });
      await new Promise((resolve, reject) => res.sendFile(file, { dotfiles: 'deny', headers: {} }, (err) => (err ? reject(err) : resolve())));
    },

    /** Removes everything this provider holds for an owner (account deletion / tests). */
    async removeOwner(ownerId) {
      await fs.rm(resolveKey(String(ownerId)), { recursive: true, force: true });
    },
  };
}
