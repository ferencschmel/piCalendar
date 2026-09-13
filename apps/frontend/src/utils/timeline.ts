import type { AgendaDay, CalendarOccurrence } from '@picalendar/shared';

/**
 * Geometry for the dashboard's time-of-day grid.
 *
 * Every day column shares one vertical scale so a glance across the wall
 * compares like with like: 09:00 on Monday sits at the same height as 09:00 on
 * Thursday. The scale is a fixed twelve-hour band rather than one fitted to the
 * events on screen: the hour rows are then the same height every day of the
 * week, which is what lets someone read the wall from across the room without
 * first checking what the axis is claiming today.
 *
 * A band shorter than the day means a 06:30 swim or a 21:00 pickup can sit
 * outside it, so the band pans — see `useTimeWindow`. Nothing is hidden
 * silently: {@link offscreenCounts} feeds the axis's arrows a count of what is
 * above and below.
 */

export const MINUTES_PER_DAY = 1440;

/** Minutes since local midnight; `endMinute` is exclusive. */
export interface TimeWindow {
  startMinute: number;
  endMinute: number;
}

/** Where an occurrence sits inside one day, clamped to that day's midnights. */
export interface DaySpan {
  startMinute: number;
  endMinute: number;
  /** The occurrence began before this day started. */
  continuesBefore: boolean;
  /** The occurrence runs past midnight into the next day. */
  continuesAfter: boolean;
}

export interface PositionedOccurrence extends DaySpan {
  occurrence: CalendarOccurrence;
  /** Zero-based horizontal slot among the events it overlaps. */
  lane: number;
  /** How many slots that overlapping group needs. */
  laneCount: number;
}

/**
 * The band the grid opens on — a household's waking day. Twelve hours is about
 * the most that stays legible on a wall display: below roughly half an hour per
 * row, two events an hour apart stop looking an hour apart.
 */
export const DEFAULT_WINDOW_START_MINUTE = 8 * 60;
export const WINDOW_MINUTES = 12 * 60;

/** One press of an axis arrow. Two hours moves the view without losing it. */
export const PAN_STEP_MINUTES = 2 * 60;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

/** The wall-clock reading of an instant in the display timezone. */
function wallClock(iso: string, timezone: string): { dayKey: string; minuteOfDay: number } {
  const parts = formatterFor(timezone).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '0';

  return {
    dayKey: `${value('year')}-${value('month')}-${value('day')}`,
    minuteOfDay: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

/** Whole days from `to` to `from`, both `YYYY-MM-DD` local date keys. */
function dayDelta(from: string, to: string): number {
  return Math.round((Date.parse(`${from}T00:00:00Z`) - Date.parse(`${to}T00:00:00Z`)) / 86_400_000);
}

/**
 * Minutes from the start of `dayKey`. Negative before that midnight and beyond
 * {@link MINUTES_PER_DAY} after the next one, which is how multi-day events are
 * detected. Measured on the wall clock, so a DST day still reads correctly.
 */
export function minutesFromDayStart(iso: string, timezone: string, dayKey: string): number {
  const { dayKey: instantDay, minuteOfDay } = wallClock(iso, timezone);
  return dayDelta(instantDay, dayKey) * MINUTES_PER_DAY + minuteOfDay;
}

/** Clamp an occurrence to one day, remembering which edges it spills past. */
export function spanWithinDay(
  occurrence: CalendarOccurrence,
  dayKey: string,
  timezone: string,
): DaySpan {
  const rawStart = minutesFromDayStart(occurrence.startsAt, timezone, dayKey);
  const rawEnd = minutesFromDayStart(occurrence.endsAt, timezone, dayKey);

  const startMinute = Math.min(Math.max(rawStart, 0), MINUTES_PER_DAY);
  const endMinute = Math.max(Math.min(rawEnd, MINUTES_PER_DAY), startMinute);

  return {
    startMinute,
    endMinute,
    continuesBefore: rawStart < 0,
    continuesAfter: rawEnd > MINUTES_PER_DAY,
  };
}

/** Keep the band inside the day it belongs to, whole minutes either side. */
export function clampWindowStart(startMinute: number): number {
  return Math.min(Math.max(startMinute, 0), MINUTES_PER_DAY - WINDOW_MINUTES);
}

/** The window whose top edge is `startMinute`, clamped into the day. */
export function windowFromStart(startMinute: number): TimeWindow {
  const start = clampWindowStart(startMinute);
  return { startMinute: start, endMinute: start + WINDOW_MINUTES };
}

export function windowMinutes(window: TimeWindow): number {
  return Math.max(window.endMinute - window.startMinute, 1);
}

/** A minute's position in the window as a percentage, for CSS `top`/`height`. */
export function percentOfWindow(minute: number, window: TimeWindow): number {
  return ((minute - window.startMinute) / windowMinutes(window)) * 100;
}

/** The whole hours drawn as gridlines, from the window's first to its last. */
export function hourMarks(window: TimeWindow): number[] {
  const marks: number[] = [];
  const first = Math.ceil(window.startMinute / 60) * 60;
  for (let minute = first; minute <= window.endMinute; minute += 60) marks.push(minute);
  return marks;
}

/**
 * Side-by-side placement for overlapping events.
 *
 * Events are swept in start order and collected into clusters that overlap
 * transitively; every event in a cluster is split across the same number of
 * lanes so the column edges line up rather than jittering per event.
 */
export function layoutDay(
  day: AgendaDay,
  timezone: string,
  window: TimeWindow,
): PositionedOccurrence[] {
  // A zero-length event still occupies a slot; give it a nominal minute so it
  // cannot silently share a lane with whatever starts at the same time.
  const minimumSpan = (span: DaySpan): number => Math.max(span.endMinute, span.startMinute + 1);

  const spans = day.occurrences
    .filter((occurrence) => !occurrence.allDay)
    .map((occurrence) => ({ occurrence, ...spanWithinDay(occurrence, day.date, timezone) }))
    .filter((span) => span.endMinute > window.startMinute && span.startMinute < window.endMinute)
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  const positioned: PositionedOccurrence[] = [];
  let cluster: PositionedOccurrence[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const closeCluster = (): void => {
    for (const item of cluster) item.laneCount = laneEnds.length;
    cluster = [];
    laneEnds = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const span of spans) {
    if (span.startMinute >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= span.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = minimumSpan(span);

    const item: PositionedOccurrence = { ...span, lane, laneCount: 1 };
    cluster.push(item);
    positioned.push(item);
    clusterEnd = Math.max(clusterEnd, minimumSpan(span));
  }

  closeCluster();
  return positioned;
}

/** All-day (and multi-day) occurrences, which live in a band above the grid. */
export function allDayOccurrences(day: AgendaDay): CalendarOccurrence[] {
  return day.occurrences.filter((occurrence) => occurrence.allDay);
}

/**
 * How many timed blocks sit above and below the visible band, counted the way
 * the columns draw them — an event covering two days is one mark on each.
 *
 * The wall has no scrollbar to hint that there is more, so this is the only
 * thing standing between a panned-down grid and a household missing the 07:45
 * bus. The axis turns it into a number beside each arrow.
 */
export function offscreenCounts(
  days: AgendaDay[],
  timezone: string,
  window: TimeWindow,
): { before: number; after: number } {
  let before = 0;
  let after = 0;

  for (const day of days) {
    for (const occurrence of day.occurrences) {
      if (occurrence.allDay) continue;
      const span = spanWithinDay(occurrence, day.date, timezone);
      // A block that merely starts early still shows if it runs into the band,
      // so only the ones with no overlap at all are counted as out of sight.
      if (span.endMinute <= window.startMinute) before += 1;
      else if (span.startMinute >= window.endMinute) after += 1;
    }
  }

  return { before, after };
}
