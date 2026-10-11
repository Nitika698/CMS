import path from 'node:path';
import { env } from '../../config/env.js';
import { createCloudinaryProvider } from './cloudinary.provider.js';
import { createLocalProvider } from './local.provider.js';

let provider;

/** The configured storage provider (chosen by STORAGE_PROVIDER). Services depend on this interface, never on a vendor. */
export async function getStorage() {
  if (provider) return provider;
  if (env.STORAGE_PROVIDER === 'cloudinary') {
    const { v2 } = await import('cloudinary');
    v2.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
    provider = createCloudinaryProvider({ cloudinary: v2 });
  } else {
    provider = createLocalProvider({ baseDir: path.resolve(process.cwd(), env.UPLOAD_DIR) });
  }
  return provider;
}

/** Test hook: swap the provider (e.g. a Cloudinary adapter with a fake SDK). Pass nothing to reset. */
export function setStorage(next) {
  provider = next;
}
