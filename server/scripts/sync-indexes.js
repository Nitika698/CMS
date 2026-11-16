// Creates or updates every MongoDB index declared in the models. Run on each deploy BEFORE starting the new version:
//   npm run db:indexes -w server           (reads server/.env or the real environment)
//   npm run db:indexes -w server -- --dry-run   (only lists what would change)
// Production runs with DB_AUTO_INDEX=false so a restart never triggers an index build under load.
import mongoose from 'mongoose';
import '../src/config/env.js';
import { env } from '../src/config/env.js';

const dry = process.argv.includes('--dry-run');
mongoose.set('autoIndex', false);

// Importing the route table loads every model.
await import('../src/routes.js');

await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
let failed = false;
for (const model of Object.values(mongoose.models)) {
  try {
    if (dry) {
      const diff = await model.diffIndexes();
      const todo = [...diff.toCreate.map((i) => `create ${JSON.stringify(i)}`), ...diff.toDrop.map((n) => `drop ${n}`)];
      console.log(`${model.modelName}: ${todo.length ? todo.join('; ') : 'up to date'}`);
    } else {
      const dropped = await model.syncIndexes();
      console.log(`${model.modelName}: ok${dropped.length ? ` (dropped ${dropped.join(', ')})` : ''}`);
    }
  } catch (err) {
    failed = true;
    console.error(`${model.modelName}: FAILED (${err.codeName ?? err.name}) ${err.message}`);
  }
}
await mongoose.disconnect();
process.exit(failed ? 1 : 0);
