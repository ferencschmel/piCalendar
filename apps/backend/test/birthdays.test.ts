import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BIRTHDAY_ICON,
  birthdayDateSchema,
  type Birthday,
  type BirthdayDate,
} from '@picalendar/shared';
import { celebrationsByDay } from '../src/util/birthdays.js';
import { dayKeyRange } from '../src/util/time.js';

function birthday(displayName: string, date: BirthdayDate): Birthday {
  return {
    id: `id-${displayName}`,
    displayName,
    date,
    icon: DEFAULT_BIRTHDAY_ICON,
    color: '#ff0000',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('celebrationsByDay', () => {
  it('places a birthday on its day and works out the age', () => {
    const days = dayKeyRange('2026-03-01', 5);
    const buckets = celebrationsByDay([birthday('Ada', { month: 3, day: 3, year: 2017 })], days);

    expect(buckets.get('2026-03-03')?.map((c) => [c.displayName, c.age])).toEqual([['Ada', 9]]);
    expect(buckets.get('2026-03-02')).toEqual([]);
  });

  it('leaves the age out when no birth year is on file', () => {
    const buckets = celebrationsByDay(
      [birthday('Nan', { month: 3, day: 3, year: null })],
      dayKeyRange('2026-03-01', 5),
    );
    expect(buckets.get('2026-03-03')?.[0]?.age).toBeNull();
  });

  it('observes a 29 February birthday on the 28th in a common year', () => {
    const leap = celebrationsByDay(
      [birthday('Leap', { month: 2, day: 29, year: 2004 })],
      dayKeyRange('2028-02-25', 7),
    );
    expect(leap.get('2028-02-29')?.[0]?.observed).toBe(false);
    expect(leap.get('2028-02-28')).toEqual([]);

    const common = celebrationsByDay(
      [birthday('Leap', { month: 2, day: 29, year: 2004 })],
      dayKeyRange('2026-02-24', 5),
    );
    expect(common.get('2026-02-28')?.[0]?.observed).toBe(true);
    expect(common.get('2026-02-28')?.[0]?.age).toBe(22);
  });

  it('spans a range that crosses into the next year', () => {
    const buckets = celebrationsByDay(
      [birthday('Ada', { month: 1, day: 2, year: 2017 })],
      dayKeyRange('2026-12-28', 10),
    );
    expect(buckets.get('2027-01-02')?.[0]?.age).toBe(10);
  });

  it('draws nothing for a year before the person was born', () => {
    const buckets = celebrationsByDay(
      [birthday('Ada', { month: 3, day: 3, year: 2017 })],
      dayKeyRange('2015-03-01', 5),
    );
    expect(buckets.get('2015-03-03')).toEqual([]);
  });

  it('shows the birth day itself without an age rather than "turns 0"', () => {
    const buckets = celebrationsByDay(
      [birthday('Ada', { month: 3, day: 3, year: 2017 })],
      dayKeyRange('2017-03-01', 5),
    );
    expect(buckets.get('2017-03-03')?.[0]?.age).toBeNull();
  });

  it('lists two birthdays sharing a day in the order they were given', () => {
    const buckets = celebrationsByDay(
      [
        birthday('Ada', { month: 5, day: 5, year: null }),
        birthday('Zoe', { month: 5, day: 5, year: null }),
      ],
      dayKeyRange('2026-05-01', 10),
    );
    expect(buckets.get('2026-05-05')?.map((c) => c.displayName)).toEqual(['Ada', 'Zoe']);
  });
});

describe('birthdayDateSchema', () => {
  it('rejects a day the month does not have', () => {
    expect(birthdayDateSchema.safeParse({ month: 2, day: 30 }).success).toBe(false);
    expect(birthdayDateSchema.safeParse({ month: 4, day: 31 }).success).toBe(false);
  });

  it('accepts 29 February without a year', () => {
    const parsed = birthdayDateSchema.parse({ month: 2, day: 29 });
    expect(parsed).toEqual({ month: 2, day: 29, year: null });
  });
});
