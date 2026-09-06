import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  dayKeyRange,
  dayStartEpoch,
  toDayKey,
  zonedWallClockToEpoch,
} from '../src/util/time.js';

describe('day keys', () => {
  it('reports the local date, not the UTC date', () => {
    // 2026-03-01T23:30Z is already the 2nd in Budapest (UTC+1).
    const instant = Math.floor(Date.parse('2026-03-01T23:30:00Z') / 1000);
    expect(toDayKey(instant, 'Europe/Budapest')).toBe('2026-03-02');
    expect(toDayKey(instant, 'UTC')).toBe('2026-03-01');
    // ...and still the 1st in New York (UTC-5).
    expect(toDayKey(instant, 'America/New_York')).toBe('2026-03-01');
  });

  it('walks days across a month boundary', () => {
    expect(addDaysToKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayKeyRange('2026-12-30', 4)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
});

describe('local midnight', () => {
  it('resolves midnight to the correct instant per zone', () => {
    expect(dayStartEpoch('2026-06-15', 'UTC')).toBe(Date.parse('2026-06-15T00:00:00Z') / 1000);
    // Budapest is UTC+2 in June, so local midnight is 22:00 the day before.
    expect(dayStartEpoch('2026-06-15', 'Europe/Budapest')).toBe(
      Date.parse('2026-06-14T22:00:00Z') / 1000,
    );
  });

  it('stays correct on both sides of a DST transition', () => {
    // EU clocks go forward on 2026-03-29: UTC+1 before, UTC+2 after.
    expect(dayStartEpoch('2026-03-28', 'Europe/Budapest')).toBe(
      Date.parse('2026-03-27T23:00:00Z') / 1000,
    );
    expect(dayStartEpoch('2026-03-30', 'Europe/Budapest')).toBe(
      Date.parse('2026-03-29T22:00:00Z') / 1000,
    );
  });

  it('keeps a wall-clock time fixed across a DST change', () => {
    // A 19:00 practice must stay 19:00 local — that is 18:00Z in winter and
    // 17:00Z in summer, not a fixed UTC instant.
    const winter = zonedWallClockToEpoch(
      { year: 2026, month: 1, day: 15, hour: 19 },
      'Europe/Budapest',
    );
    const summer = zonedWallClockToEpoch(
      { year: 2026, month: 7, day: 15, hour: 19 },
      'Europe/Budapest',
    );
    expect(new Date(winter * 1000).toISOString()).toBe('2026-01-15T18:00:00.000Z');
    expect(new Date(summer * 1000).toISOString()).toBe('2026-07-15T17:00:00.000Z');
  });
});
