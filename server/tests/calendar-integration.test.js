import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { signUp, useDatabase } from './helpers/app.js';
import { api as contentApi } from './helpers/content.js';
import { approvedContent, cal, newContent, posts, scheduled, T } from './helpers/calendar.js';
import { assertAdapter, PublishError } from '../src/integrations/publishing/adapter.js';
import { describePlatforms, getAdapter, registerAdapter, unregisterAdapter } from '../src/integrations/publishing/registry.js';
import { Post } from '../src/modules/posts/post.model.js';

useDatabase();
afterEach(() => unregisterAdapter()); // no test may leave an adapter registered

/** A fake platform. `behaviour` decides what publish() does; `calls` records every attempt. */
function fakeAdapter(platform, behaviour = {}) {
  const calls = [];
  return {
    calls,
    platform,
    isConfigured: async () => behaviour.configured ?? true,
    publish: async (req) => {
      calls.push(req);
      if (behaviour.throws) throw behaviour.throws;
      if ('result' in behaviour) return behaviour.result; // may deliberately be null/garbage
      return { externalPostId: 'ext-123', externalUrl: 'https://platform.example/p/ext-123', publishedAt: new Date('2040-06-15T12:00:00Z') };
    },
  };
}

/** An approved content item with a scheduled instagram post. */
async function ready(token, day = 15) {
  const content = await approvedContent(token, { title: 'Ready content' });
  const p = await scheduled(token, content, 'instagram', T(day));
  return { content, p };
}

describe('with no adapter registered (the real, current state)', () => {
  test('nothing is registered, so no platform claims direct publishing', async () => {
    assert.equal(getAdapter('instagram'), null);
    for (const p of await describePlatforms()) assert.equal(p.directPublishing, false, p.platform);
  });

  test('the publish endpoint refuses with 501 and leaves the post exactly as it was', async () => {
    const { token } = await signUp();
    const { p } = await ready(token);
    await posts.move(token, p.id, 'awaiting_confirmation');
    const before = await Post.findById(p.id).lean();

    const res = await posts.viaPlatform(token, p.id);
    assert.equal(res.status, 501);
    assert.equal(res.body.error.code, 'NOT_IMPLEMENTED');
    assert.match(res.body.error.message, /not available/i);
    assert.match(res.body.error.message, /yourself/i);
    assert.equal(res.body.error.details.manualPublishing, true);
    assert.deepEqual(await Post.findById(p.id).lean(), before);
  });

  test('the only way to publish is the user confirming it, and that is recorded as manual', async () => {
    const { token } = await signUp();
    const { p } = await ready(token);
    const done = await posts.move(token, p.id, 'published', { publishedAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal(done.body.data.verification, 'manual');
    assert.equal((await Post.findById(p.id)).externalPostId, undefined);
  });
});

describe('the adapter contract', () => {
  test('rejects adapters that do not implement the interface', () => {
    for (const bad of [null, {}, { platform: 'instagram' }, { platform: 'instagram', isConfigured: () => true }, { isConfigured: () => true, publish: () => {} }]) {
      assert.throws(() => assertAdapter(bad), TypeError);
      assert.throws(() => registerAdapter(bad), TypeError);
    }
    assert.doesNotThrow(() => registerAdapter(fakeAdapter('instagram')));
  });

  test('registering an adapter is the single switch; unregistering turns it off again', async () => {
    registerAdapter(fakeAdapter('youtube'));
    const byName = Object.fromEntries((await describePlatforms()).map((p) => [p.platform, p]));
    assert.deepEqual([byName.youtube.directPublishing, byName.youtube.mode], [true, 'api']);
    assert.equal(byName.instagram.directPublishing, false, 'other platforms are unaffected');
    unregisterAdapter('youtube');
    assert.equal((await describePlatforms()).find((p) => p.platform === 'youtube').directPublishing, false);
  });

  test('a registered but unconfigured adapter (not connected) does not count', async () => {
    registerAdapter(fakeAdapter('instagram', { configured: false }));
    const info = (await describePlatforms()).find((p) => p.platform === 'instagram');
    assert.equal(info.directPublishing, false);
    assert.match(info.reason, /not connected/i);
  });

  test('the calendar reports platform capability through the API, never more than is registered', async () => {
    const { token } = await signUp();
    registerAdapter(fakeAdapter('tiktok'));
    const list = (await cal.integrations(token)).body.data;
    assert.deepEqual(list.filter((p) => p.directPublishing).map((p) => p.platform), ['tiktok']);
  });
});

describe('publishing through an adapter', () => {
  test('success is recorded as platform-confirmed, with the platform\'s own id', async () => {
    const { token } = await signUp();
    const { content, p } = await ready(token);
    const adapter = fakeAdapter('instagram');
    registerAdapter(adapter);

    const res = await posts.viaPlatform(token, p.id);
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.deepEqual([d.status, d.verification, d.stage.label], ['published', 'platform', 'Published (platform confirmed)']);
    assert.equal(d.publishedAt, '2040-06-15T12:00:00.000Z');
    const doc = await Post.findById(p.id);
    assert.deepEqual([doc.externalPostId, doc.externalUrl], ['ext-123', 'https://platform.example/p/ext-123']);

    assert.equal(adapter.calls.length, 1);
    const req = adapter.calls[0];
    assert.deepEqual([req.post.platform, req.content.title, req.content.id], ['instagram', 'Ready content', content]);
    assert.ok(Array.isArray(req.assets));
    const history = (await contentApi.history(token, content)).body.data.map((e) => [e.type, e.to]);
    assert.deepEqual(history[0], ['post_status_changed', 'published']);
  });

  test('a platform error marks the post FAILED with a safe reason; it is never recorded as published', async () => {
    const { token } = await signUp();
    const { p } = await ready(token);
    registerAdapter(fakeAdapter('instagram', { throws: new PublishError('The video is longer than Instagram allows.') }));
    const res = await posts.viaPlatform(token, p.id);
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'PUBLISH_FAILED');
    assert.equal(res.body.error.message, 'The video is longer than Instagram allows.');
    const doc = await Post.findById(p.id);
    assert.deepEqual([doc.status, doc.verification, doc.externalPostId, doc.publishedAt, doc.failureReason], ['failed', 'none', undefined, undefined, 'The video is longer than Instagram allows.']);
    assert.equal(doc.active, false);
  });

  test('an unexpected error never leaks its details (tokens, URLs) to the user or the database', async () => {
    const { token } = await signUp();
    const { p } = await ready(token);
    registerAdapter(fakeAdapter('instagram', { throws: new Error('401 from https://graph.example?access_token=SECRET-TOKEN-123') }));
    const res = await posts.viaPlatform(token, p.id);
    assert.equal(res.status, 502);
    assert.ok(!JSON.stringify(res.body).includes('SECRET'));
    assert.ok(!JSON.stringify((await Post.findById(p.id)).toObject()).includes('SECRET'));
    assert.equal((await Post.findById(p.id)).failureReason, 'The platform did not accept the post.');
  });

  test('a "success" without the platform\'s own id is NOT treated as published', async () => {
    const { token } = await signUp();
    for (const result of [{}, { externalPostId: '' }, { externalPostId: '   ' }, { externalPostId: 123 }, null, undefined]) {
      const { p } = await ready(token);
      registerAdapter(fakeAdapter('instagram', { result }));
      const res = await posts.viaPlatform(token, p.id);
      assert.equal(res.status, 502, JSON.stringify(result));
      const doc = await Post.findById(p.id);
      assert.equal(doc.status, 'failed', JSON.stringify(result));
      assert.equal(doc.verification, 'none');
      assert.equal(doc.externalPostId, undefined);
      unregisterAdapter();
      await Post.deleteMany({}); // free the slot for the next round
    }
  });

  test('a failed post can be rescheduled and tried again', async () => {
    const { token } = await signUp();
    const { p } = await ready(token);
    registerAdapter(fakeAdapter('instagram', { throws: new PublishError('Rate limited', { retryable: true }) }));
    await posts.viaPlatform(token, p.id);
    unregisterAdapter();
    const retry = await posts.move(token, p.id, 'scheduled', { scheduledLocal: T(20) });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.status, 'scheduled');
    assert.equal(retry.body.data.failureReason, 'Rate limited', 'the last failure stays visible until it succeeds');
  });

  test('the adapter is never called unless every precondition holds', async () => {
    const a = await signUp();
    const b = await signUp();
    const adapter = fakeAdapter('instagram');
    registerAdapter(adapter);

    // not approved
    const draft = await scheduled(a.token, await newContent(a.token), 'instagram', T(14));
    const notApproved = await posts.viaPlatform(a.token, draft.id);
    assert.equal(notApproved.status, 422);
    assert.equal(notApproved.body.error.code, 'CONTENT_NOT_APPROVED');

    // only a plan
    const plan = (await posts.create(a.token, { content: await approvedContent(a.token), platform: 'instagram' })).body.data;
    assert.equal((await posts.viaPlatform(a.token, plan.id)).status, 409);

    // already published
    const { p } = await ready(a.token, 16);
    await posts.move(a.token, p.id, 'published', { publishedAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await posts.viaPlatform(a.token, p.id)).status, 409);

    // somebody else's post, and a missing one
    const mine = await ready(a.token, 17);
    assert.equal((await posts.viaPlatform(b.token, mine.p.id)).status, 404);
    assert.equal((await posts.viaPlatform(a.token, '507f1f77bcf86cd799439011')).status, 404);

    // archived content
    const arch = await ready(a.token, 18);
    await contentApi.archive(a.token, arch.content);
    assert.equal((await posts.viaPlatform(a.token, arch.p.id)).status, 409);

    assert.equal(adapter.calls.length, 0, 'publish() must not have been called for any of these');
  });

  test('an adapter for another platform is not used', async () => {
    const { token } = await signUp();
    const { p } = await ready(token); // an instagram post
    const adapter = fakeAdapter('youtube');
    registerAdapter(adapter);
    assert.equal((await posts.viaPlatform(token, p.id)).status, 501);
    assert.equal(adapter.calls.length, 0);
  });
});
