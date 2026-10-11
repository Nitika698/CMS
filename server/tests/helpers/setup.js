// Must be imported FIRST in every DB-backed test file: it sets env before the app config is loaded.
const TEST_URI = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/cms-test';

// Safety: tests wipe collections, so refuse to run against anything that isn't clearly a test database.
if (!/-test(\?|$)/.test(TEST_URI)) {
  throw new Error('MONGODB_URI_TEST must point at a database whose name ends in "-test"');
}

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = TEST_URI;
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.BCRYPT_COST = '4'; // fast hashing in tests only
process.env.AUTH_RATE_LIMIT_MAX ??= '1000';
process.env.RATE_LIMIT_MAX = '100000';

// --- media storage: a private temp folder per test process, and tiny limits so size rules are cheap to test
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.STORAGE_PROVIDER = 'local';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `cms-test-uploads-${process.pid}`);
process.env.MAX_UPLOAD_IMAGE_MB = '0.01'; // ~10 KB
process.env.MAX_UPLOAD_DOC_MB = '0.02'; // ~20 KB
process.env.MAX_UPLOAD_VIDEO_MB = '0.05'; // ~50 KB (also the hard cap enforced while streaming)
process.env.MAX_ASSETS_PER_CONTENT = '3';
process.env.ASSET_TOKEN_TTL_SECONDS = '300';
process.on('exit', () => fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }));
