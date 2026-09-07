/**
 * Civil-calendar arithmetic for the month and year overviews.
 *
 * Everything here works on `YYYY-MM-DD` keys, which are timezone-free by
 * construction: the display zone has already been applied by the time a date
 * has a key, and "the Monday before the 1st" is the same question in every
 * zone. `utils/datetime.ts` turns instants into keys; this file walks between
 * keys and shapes them into grids.
 *
 * Weeks run Monday to Sunday, which is what the household reading the wall
 * expects and what `en-GB` formats to anyway.
 */

/** Columns in a month grid — one per weekday. */
export const WEEK_LENGTH = 7;

/**
 * Rows in a month grid. Fixed at six rather than the four to six a month
 * actually needs: a wall display that resizes its cells as you step through the
 * year is far more distracting than a couple of trailing greyed-out days.
 */
export const MONTH_GRID_WEEKS = 6;

/** Days a month grid covers, and so the number the agenda is asked for. */
export const MONTH_GRID_DAYS = WEEK_LENGTH * MONTH_GRID_WEEKS;

/** A calendar month. `month` is 1-based, as it reads in a date key. */
export interface MonthAnchor {
  year: number;
  /** 1 = January. */
  month: number;
}

const MILLIS_PER_DAY = 86_400_000;
const LOCALE = 'en-GB';

/** 2024-01-01 was a Monday — the reference the weekday labels are read off. */
const REFERENCE_MONDAY = Date.UTC(2024, 0, 1);

function toKey(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

function toMillis(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00Z`);
}

/** Add whole days to a date key. Negative counts step backwards. */
export function addDays(dayKey: string, days: number): string {
  return toKey(toMillis(dayKey) + days * MILLIS_PER_DAY);
}

/** 0 for Monday through 6 for Sunday. */
export function weekdayIndex(dayKey: string): number {
  return (new Date(toMillis(dayKey)).getUTCDay() + 6) % WEEK_LENGTH;
}

/** The day-of-month a key names, for the number printed in a cell. */
export function dayOfMonth(dayKey: string): number {
  return Number(dayKey.slice(8, 10));
}

export function monthOf(dayKey: string): MonthAnchor {
  return { year: Number(dayKey.slice(0, 4)), month: Number(dayKey.slice(5, 7)) };
}

export function isInMonth(dayKey: string, anchor: MonthAnchor): boolean {
  return dayKey.startsWith(monthKey(anchor));
}

/** `YYYY-MM` — the prefix every key inside the month shares. */
function monthKey(anchor: MonthAnchor): string {
  return `${anchor.year}-${String(anchor.month).padStart(2, '0')}`;
}

export function monthStartKey(anchor: MonthAnchor): string {
  return `${monthKey(anchor)}-01`;
}

/** Step by whole months, rolling the year over at either end. */
export function shiftMonth(anchor: MonthAnchor, delta: number): MonthAnchor {
  // Month index from year zero, so the rollover is a single division rather
  // than a pair of wrap-around branches.
  const index = anchor.year * 12 + (anchor.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function sameMonth(a: MonthAnchor, b: MonthAnchor): boolean {
  return a.year === b.year && a.month === b.month;
}

/**
 * The month laid out as {@link MONTH_GRID_WEEKS} rows of seven keys, starting
 * from the Monday on or before the 1st. The leading and trailing days belong to
 * the neighbouring months and are drawn muted.
 */
export function monthGridWeeks(anchor: MonthAnchor): string[][] {
  const first = monthStartKey(anchor);
  const gridStart = addDays(first, -weekdayIndex(first));

  return Array.from({ length: MONTH_GRID_WEEKS }, (_, week) =>
    Array.from({ length: WEEK_LENGTH }, (_, day) => addDays(gridStart, week * WEEK_LENGTH + day)),
  );
}

/** The first key a month grid shows — what the agenda request starts at. */
export function monthGridStart(anchor: MonthAnchor): string {
  const first = monthStartKey(anchor);
  return addDays(first, -weekdayIndex(first));
}

/** `September 2026`. */
export function monthLabel(anchor: MonthAnchor): string {
  return new Date(Date.UTC(anchor.year, anchor.month - 1, 1)).toLocaleDateString(LOCALE, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `September`, for the twelve headings in the year view. */
export function monthName(anchor: MonthAnchor): string {
  return new Date(Date.UTC(anchor.year, anchor.month - 1, 1)).toLocaleDateString(LOCALE, {
    month: 'long',
    timeZone: 'UTC',
  });
}

/** Monday-first weekday names for a grid's column headings. */
export function weekdayLabels(style: 'long' | 'short' | 'narrow'): string[] {
  return Array.from({ length: WEEK_LENGTH }, (_, index) =>
    new Date(REFERENCE_MONDAY + index * MILLIS_PER_DAY).toLocaleDateString(LOCALE, {
      weekday: style,
      timeZone: 'UTC',
    }),
  );
}

/** The twelve months of a year, in order. */
export function monthsOfYear(year: number): MonthAnchor[] {
  return Array.from({ length: 12 }, (_, index) => ({ year, month: index + 1 }));
}

/** 365, or 366 in a leap year — how many days the year view asks for. */
export function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / MILLIS_PER_DAY;
}

export function yearStartKey(year: number): string {
  return `${year}-01-01`;
}
