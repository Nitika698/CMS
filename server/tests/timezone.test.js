import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dayRange, monthRange, zonedMidnight, zonedYmd } from '../src/lib/timezone.js';

const iso = (d) => d.toISOString();
const HOUR = 3600_000;

describe('timezone helpers', () => {
  test('a fixed-offset zone (Asia/Kolkata, UTC+5:30): day and month boundaries are in local time', () => {
    const now = new Date('2026-10-14T10:00:00Z'); // 15:30 local
    const day = dayRange(now, 'Asia/Kolkata');
    assert.equal(iso(day.start), '2026-10-13T18:30:00.000Z');
    assert.equal(iso(day.end), '2026-10-14T18:30:00.000Z');
    const month = monthRange(now, 'Asia/Kolkata');
    assert.equal(iso(month.start), '2026-09-30T18:30:00.000Z');
    assert.equal(iso(month.end), '2026-10-31T18:30:00.000Z');
  });

  test('the local day changes at local midnight, not UTC midnight', () => {
    // 19:00Z is already 00:30 on the 15th in Kolkata
    assert.equal(iso(dayRange(new Date('2026-10-14T19:00:00Z'), 'Asia/Kolkata').start), '2026-10-14T18:30:00.000Z');
    assert.deepEqual(zonedYmd(new Date('2026-10-14T19:00:00Z'), 'Asia/Kolkata'), { year: 2026, month: 10, day: 15 });
    assert.deepEqual(zonedYmd(new Date('2026-10-14T19:00:00Z'), 'UTC'), { year: 2026, month: 10, day: 14 });
  });

  test('DST: the US spring-forward day is 23 hours long and the fall-back day is 25', () => {
    const spring = dayRange(new Date('2026-03-08T18:00:00Z'), 'America/New_York');
    assert.equal(iso(spring.start), '2026-03-08T05:00:00.000Z'); // EST
    assert.equal(iso(spring.end), '2026-03-09T04:00:00.000Z'); // EDT
    assert.equal((spring.end - spring.start) / HOUR, 23);

    const fall = dayRange(new Date('2026-11-01T18:00:00Z'), 'America/New_York');
    assert.equal(iso(fall.start), '2026-11-01T04:00:00.000Z'); // EDT
    assert.equal(iso(fall.end), '2026-11-02T05:00:00.000Z'); // EST
    assert.equal((fall.end - fall.start) / HOUR, 25);
  });

  test('months and days may overflow (used for "next month")', () => {
    assert.equal(iso(zonedMidnight(2026, 13, 1, 'UTC')), '2027-01-01T00:00:00.000Z');
    assert.equal(iso(monthRange(new Date('2026-12-20T00:00:00Z'), 'UTC').end), '2027-01-01T00:00:00.000Z');
  });
});
