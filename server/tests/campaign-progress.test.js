import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignFlags, coverageOf, daysUntil, deliverableFlags, progressOf } from '../src/modules/campaigns/campaign.progress.js';
import { nextDeliverableStatuses } from '../src/modules/campaigns/campaign.constants.js';

// Pure rules, no database: a fixed "now" makes every date assertion exact.
const NOW = new Date('2026-10-16T10:00:00Z');
const D = (ymd) => new Date(`${ymd}T00:00:00Z`);
const d = (status, extra = {}) => ({ status, ...extra });

describe('progressOf', () => {
  test('is 0 with no deliverables and 100 only when all are published', () => {
    assert.equal(progressOf([]).percent, 0);
    assert.equal(progressOf([d('delivered'), d('delivered')]).percent, 100);
    assert.equal(progressOf([d('delivered'), d('approved')]).percent < 100, true);
  });

  test('averages the weight of each state', () => {
    assert.equal(progressOf([d('pending'), d('delivered')]).percent, 50);
    assert.equal(progressOf([d('completed'), d('completed')]).percent, 50);
    assert.equal(progressOf([d('pending'), d('pending'), d('delivered')]).percent, 33);
  });

  test('every state moves progress forward in pipeline order', () => {
    const order = ['pending', 'in_progress', 'completed', 'submitted', 'approved', 'delivered'];
    const scores = order.map((s) => progressOf([d(s)]).percent);
    assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
    assert.equal(new Set(scores).size, order.length);
  });

  test('groups states into planned, completed, approved and published', () => {
    const { stages, counts } = progressOf([d('pending'), d('in_progress'), d('changes_requested'), d('completed'), d('submitted'), d('approved'), d('delivered')]);
    assert.deepEqual(stages, { planned: 3, completed: 2, approved: 1, published: 1 });
    assert.equal(counts.changes_requested, 1);
  });
});

describe('coverageOf', () => {
  test('counts planned, approved and published per requested platform and format', () => {
    const req = [{ _id: 'r1', platform: 'instagram', format: 'reel', quantity: 3 }];
    const ds = [
      d('delivered', { platform: 'instagram', format: 'reel' }),
      d('approved', { platform: 'instagram', format: 'reel' }),
      d('pending', { platform: 'instagram', format: 'story' }),
    ];
    assert.deepEqual(coverageOf(req, ds), [{ id: 'r1', platform: 'instagram', format: 'reel', quantity: 3, planned: 2, approved: 2, published: 1, missing: 1 }]);
  });

  test('never reports a negative shortfall when more were planned than requested', () => {
    const ds = [d('pending', { platform: 'x', format: 'post' }), d('pending', { platform: 'x', format: 'post' })];
    assert.equal(coverageOf([{ _id: 'r', platform: 'x', format: 'post', quantity: 1 }], ds)[0].missing, 0);
  });
});

describe('daysUntil', () => {
  test('counts calendar days in the given timezone', () => {
    assert.equal(daysUntil(D('2026-10-16'), NOW, 'UTC'), 0);
    assert.equal(daysUntil(D('2026-10-19'), NOW, 'UTC'), 3);
    assert.equal(daysUntil(D('2026-10-14'), NOW, 'UTC'), -2);
    assert.equal(daysUntil(null, NOW, 'UTC'), null);
    // 10:00 UTC is already the 17th in Auckland (UTC+13), so 23:00 on the 15th is yesterday there
    assert.equal(daysUntil(new Date('2026-10-15T10:00:00Z'), NOW, 'Pacific/Auckland'), -1);
  });
});

describe('deliverableFlags', () => {
  const live = { status: 'in_progress' };
  test('overdue, due today, due soon, and not flagged when far away or finished', () => {
    const f = (due, status = 'pending') => deliverableFlags(d(status, { dueDate: D(due) }), live, NOW, 'UTC').map((x) => x.code);
    assert.deepEqual(f('2026-10-15'), ['overdue']);
    assert.deepEqual(f('2026-10-16'), ['due_soon']);
    assert.deepEqual(f('2026-10-23'), ['due_soon']);
    assert.deepEqual(f('2026-10-24'), []);
    assert.deepEqual(f('2026-10-01', 'delivered'), []);
    assert.deepEqual(f('2026-10-01', 'approved'), []); // signed off: nothing left to chase
  });

  test('a submitted deliverable past its date is both overdue and awaiting approval', () => {
    const codes = deliverableFlags(d('submitted', { dueDate: D('2026-10-10') }), live, NOW, 'UTC').map((x) => x.code);
    assert.deepEqual(codes, ['overdue', 'awaiting_approval']);
  });

  test('due after the campaign deadline is flagged only while unfinished', () => {
    const campaign = { status: 'in_progress', deadline: D('2026-11-01') };
    assert.deepEqual(deliverableFlags(d('pending', { dueDate: D('2026-11-05') }), campaign, NOW, 'UTC').map((x) => x.code), ['after_campaign_deadline']);
    assert.deepEqual(deliverableFlags(d('delivered', { dueDate: D('2026-11-05') }), campaign, NOW, 'UTC'), []);
    assert.deepEqual(deliverableFlags(d('pending', { dueDate: D('2026-11-01') }), campaign, NOW, 'UTC'), []); // on the deadline itself is fine
  });

  test('closed or archived campaigns raise nothing', () => {
    assert.deepEqual(deliverableFlags(d('pending', { dueDate: D('2026-01-01') }), { status: 'cancelled' }, NOW, 'UTC'), []);
    assert.deepEqual(deliverableFlags(d('pending', { dueDate: D('2026-01-01') }), { status: 'in_progress', archivedAt: NOW }, NOW, 'UTC'), []);
  });
});

describe('campaignFlags', () => {
  const run = (campaign, deliverables = []) => {
    const ds = deliverables.map((x) => ({ ...x, flags: deliverableFlags(x, campaign, NOW, 'UTC') }));
    return campaignFlags(campaign, ds, coverageOf(campaign.requirements ?? [], ds), NOW, 'UTC').map((f) => f.code);
  };

  test('deadline warnings use a 7 day window', () => {
    assert.deepEqual(run({ status: 'confirmed', deadline: D('2026-10-23') }), ['deadline_soon']);
    assert.deepEqual(run({ status: 'confirmed', deadline: D('2026-10-24') }), []);
    assert.deepEqual(run({ status: 'confirmed', deadline: D('2026-10-15') }), ['deadline_overdue']);
  });

  test('proposals are warned about a passing deadline but not about unfinished work', () => {
    assert.deepEqual(run({ status: 'proposed', deadline: D('2026-10-18') }, [d('pending')]), ['deadline_soon']);
  });

  test('unfinished work + near deadline is "incomplete", escalating to danger once late', () => {
    const near = campaignFlags({ status: 'in_progress', deadline: D('2026-10-18') }, [d('in_progress', { flags: [] })], [], NOW, 'UTC');
    assert.equal(near.find((f) => f.code === 'incomplete_deliverables').severity, 'warning');
    const late = campaignFlags({ status: 'in_progress', deadline: D('2026-10-10') }, [d('in_progress', { flags: [] })], [], NOW, 'UTC');
    assert.equal(late.find((f) => f.code === 'incomplete_deliverables').severity, 'danger');
    assert.equal(late.find((f) => f.code === 'incomplete_deliverables').count, 1);
  });

  test('approved-but-unpublished work still counts as unfinished; published work does not', () => {
    const base = { status: 'in_progress', deadline: D('2026-10-18') };
    assert.ok(run(base, [d('approved')]).includes('incomplete_deliverables'));
    assert.ok(!run(base, [d('delivered')]).includes('incomplete_deliverables'));
  });

  test('a campaign marked delivered with unfinished work is flagged, and its deadline is considered met', () => {
    const codes = run({ status: 'delivered', deadline: D('2026-10-01') }, [d('in_progress')]);
    assert.deepEqual(codes, ['incomplete_deliverables']);
  });

  test('completed, cancelled and archived campaigns are never flagged', () => {
    for (const c of [{ status: 'completed' }, { status: 'cancelled' }, { status: 'in_progress', archivedAt: NOW }]) {
      assert.deepEqual(run({ ...c, deadline: D('2026-01-01') }, [d('pending')]), []);
    }
  });
});

describe('deliverable transitions', () => {
  test('approval-required work cannot skip approval; approval-free work cannot be submitted', () => {
    assert.deepEqual(nextDeliverableStatuses({ status: 'completed', requiresApproval: true }), ['in_progress', 'submitted']);
    assert.deepEqual(nextDeliverableStatuses({ status: 'completed', requiresApproval: false }), ['in_progress', 'delivered']);
    assert.deepEqual(nextDeliverableStatuses({ status: 'delivered' }), []);
  });
});
