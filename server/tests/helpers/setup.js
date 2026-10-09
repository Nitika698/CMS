// Must be imported FIRST in every DB-backed test file: it sets env before the app config is loaded.
const TEST_URI = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/creatordesk-test';

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
