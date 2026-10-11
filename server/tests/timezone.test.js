import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dayRange, formatLocal, localToInstant, monthRange, zonedMidnight, zonedYmd } from '../src/lib/timezone.js';

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

  test('localToInstant: a wall-clock time means different instants in different zones', () => {
    const at = (l, z) => localToInstant(l, z).instant.toISOString();
    assert.equal(at('2040-06-15T18:30', 'Asia/Kolkata'), '2040-06-15T13:00:00.000Z');
    assert.equal(at('2040-06-15T18:30', 'UTC'), '2040-06-15T18:30:00.000Z');
    assert.equal(at('2040-06-15T09:00', 'America/New_York'), '2040-06-15T13:00:00.000Z'); // summer: UTC-4
    assert.equal(at('2040-12-15T09:00', 'America/New_York'), '2040-12-15T14:00:00.000Z'); // winter: UTC-5
    assert.equal(at('2040-06-15T00:30', 'Asia/Kolkata'), '2040-06-14T19:00:00.000Z'); // a different UTC day
  });

  test('localToInstant: a time skipped by a clock change does not exist', () => {
    const r = localToInstant('2040-03-11T02:30', 'America/New_York'); // clocks jump 02:00 -> 03:00
    assert.equal(r.instant, null);
    assert.equal(r.reason, 'skipped');
    assert.ok(localToInstant('2040-03-11T03:30', 'America/New_York').instant);
    assert.ok(localToInstant('2040-03-11T01:59', 'America/New_York').instant);
  });

  test('localToInstant: a time that happens twice resolves to the earlier one and says so', () => {
    const r = localToInstant('2040-11-04T01:30', 'America/New_York'); // clocks go back 02:00 -> 01:00
    assert.equal(r.ambiguous, true);
    assert.equal(r.instant.toISOString(), '2040-11-04T05:30:00.000Z'); // EDT (the first 01:30), not EST (06:30Z)
    assert.equal(localToInstant('2040-11-04T03:30', 'America/New_York').ambiguous, false);
  });

  test('localToInstant: impossible dates and malformed input are rejected', () => {
    for (const bad of ['2040-02-30T10:00', '2041-02-29T10:00', '2040-13-01T10:00', '2040-06-15T24:00', '2040-06-15T10:60']) assert.equal(localToInstant(bad, 'UTC').instant, null, bad);
    for (const bad of ['2040-06-15 10:00', '2040-06-15', '2040-06-15T10:00:00', '2040-06-15T10:00Z', '', undefined]) assert.equal(localToInstant(bad, 'UTC').reason, 'format', String(bad));
  });

  test('formatLocal round-trips with localToInstant', () => {
    for (const zone of ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland', 'UTC']) {
      const instant = new Date('2040-06-15T13:00:00Z');
      const { local, date, time } = formatLocal(instant, zone);
      assert.equal(localToInstant(local, zone).instant.toISOString(), instant.toISOString(), zone);
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(time, /^\d{2}:\d{2}$/);
    }
    assert.deepEqual(formatLocal(new Date('2040-06-15T13:00:00Z'), 'Asia/Kolkata'), { date: '2040-06-15', time: '18:30', local: '2040-06-15T18:30' });
    assert.equal(formatLocal(new Date('2040-06-15T19:00:00Z'), 'Asia/Kolkata').date, '2040-06-16'); // 00:30 next day
  });
});
