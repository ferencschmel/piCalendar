import ical from 'node-ical';
import rrulePkg from 'rrule';
import type { NormalizedEvent, NormalizedOccurrence } from './types.js';
import { toDayKey, zonedWallClockToEpoch, type WallClock } from '../util/time.js';

const { RRule } = rrulePkg;

export interface ParseOptions {
  /** Materialisation window; recurring series are expanded only inside it. */
  windowStart: number;
  windowEnd: number;
  /** Zone that floating and all-day values are anchored to. */
  displayTimezone: string;
  /** Cap on instances per series, so a malformed daily-forever rule can't OOM. */
  maxOccurrencesPerEvent?: number;
}

/** node-ical decorates its Dates with the originating VTIMEZONE. */
type IcalDate = Date & { tz?: string; dateOnly?: boolean };

const DEFAULT_MAX_OCCURRENCES = 800;

export function parseIcs(body: string, options: ParseOptions): NormalizedEvent[] {
  const parsed = ical.sync.parseICS(body);
  const events: NormalizedEvent[] = [];

  for (const entry of Object.values(parsed)) {
    if (!entry || (entry as { type?: string }).type !== 'VEVENT') continue;
    try {
      events.push(...normalizeVEvent(entry as ical.VEvent, options));
    } catch {
      // One malformed VEVENT must not cost us the rest of the calendar; the
      // sync result reports the count difference instead.
      continue;
    }
  }

  return events;
}

function normalizeVEvent(event: ical.VEvent, options: ParseOptions): NormalizedEvent[] {
  const uid = String(event.uid ?? '').trim();
  if (!uid) return [];

  const start = event.start as IcalDate | undefined;
  if (!start || Number.isNaN(start.getTime())) return [];

  const allDay = isAllDay(event, start);
  const startsAt = toEpoch(start, allDay, options.displayTimezone);
  const endsAt = resolveEnd(event, startsAt, allDay, options.displayTimezone);

  const base: Omit<NormalizedEvent, 'occurrences' | 'recurrenceId'> = {
    uid,
    summary: text(event.summary) ?? '(no title)',
    description: text(event.description),
    location: text(event.location),
    url: text(typeof event.url === 'string' ? event.url : undefined),
    organizer: organizerName(event.organizer),
    status: text(event.status),
    allDay,
    startsAt,
    endsAt,
    timezone: start.tz ?? null,
    rrule: event.rrule ? String(event.rrule) : null,
    sequence: Number(event.sequence ?? 0) || 0,
    sourceUpdatedAt: toEpochOrNull(event.lastmodified as Date | undefined),
  };

  const results: NormalizedEvent[] = [];

  // Modified instances of a series ("this event only" edits) arrive as their
  // own VEVENTs carrying RECURRENCE-ID. They are stored separately and removed
  // from the master's expansion so the instance is not rendered twice.
  const overrides = (event.recurrences ?? {}) as Record<string, ical.VEvent>;
  const overriddenKeys = new Set(Object.keys(overrides));

  for (const [key, override] of Object.entries(overrides)) {
    const child = normalizeVEvent({ ...override, recurrences: undefined } as ical.VEvent, options);
    for (const normalized of child) {
      results.push({ ...normalized, uid, recurrenceId: key });
    }
  }

  const occurrences = event.rrule
    ? expandSeries(event, base, options, overriddenKeys)
    : withinWindow([{ startsAt, endsAt, allDay }], options);

  results.push({ ...base, recurrenceId: '', occurrences });

  // A series master whose every instance was overridden or fell outside the
  // window still gets stored (cheaply) so the next window roll can re-expand it.
  return results;
}

function expandSeries(
  event: ical.VEvent,
  base: Omit<NormalizedEvent, 'occurrences' | 'recurrenceId'>,
  options: ParseOptions,
  overriddenKeys: Set<string>,
): NormalizedOccurrence[] {
  const source = event.rrule;
  if (!source) return [];

  const duration = Math.max(base.endsAt - base.startsAt, 0);
  const limit = options.maxOccurrencesPerEvent ?? DEFAULT_MAX_OCCURRENCES;

  /*
   * The zone the series' wall-clock times belong to. A VEVENT with
   * `DTSTART;TZID=...` carries it explicitly; one with a `Z` suffix is already
   * absolute, and re-reading it as UTC is exact. All-day series are floating by
   * definition and belong to whatever zone the screen is in.
   */
  const zone = base.allDay ? options.displayTimezone : ((event.start as IcalDate).tz ?? 'UTC');

  /*
   * `rrule` rewrites results relative to the *process* timezone when a tzid is
   * set, which would make expansion depend on the Pi's system clock settings.
   * Rebuilding the rule without a tzid yields plain floating instances — dates
   * whose UTC fields spell the intended wall-clock reading — which we then
   * anchor into `zone` ourselves. That is what holds a 19:00 practice at 19:00
   * across a DST change instead of sliding it by an hour.
   */
  const { tzid: _tzid, ...ruleOptions } = source.origOptions;
  const floating = new RRule({ ...ruleOptions, tzid: null });

  // Floating instants sit up to ~14h away from the real ones, so widen the
  // search and let the exact filter below trim the edges.
  const slack = 2 * 86_400;
  const candidates = floating
    .between(
      new Date((options.windowStart - slack) * 1000),
      new Date((options.windowEnd + slack) * 1000),
      true,
    )
    .slice(0, limit);

  const excludedTimes = new Set<number>();
  const excludedDays = new Set<string>();
  for (const [key, value] of Object.entries((event.exdate ?? {}) as Record<string, Date>)) {
    // node-ical keys EXDATE by calendar day; keep the key as well as the parsed
    // value, since the two disagree for all-day (local-midnight) entries.
    excludedDays.add(key.slice(0, 10));
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) continue;
    excludedTimes.add(Math.floor(value.getTime() / 1000));
    excludedDays.add(value.toISOString().slice(0, 10));
    excludedDays.add(
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
    );
  }

  const occurrences: NormalizedOccurrence[] = [];
  for (const candidate of candidates) {
    const startsAt = base.allDay
      ? zonedWallClockToEpoch(localDateParts(candidate, 12), zone)
      : zonedWallClockToEpoch(utcParts(candidate, true), zone);

    // node-ical keys both EXDATE and RECURRENCE-ID overrides by calendar day.
    const floatingDay = candidate.toISOString().slice(0, 10);
    const localDay = toDayKey(startsAt, zone);
    if (
      excludedTimes.has(startsAt) ||
      excludedDays.has(floatingDay) ||
      excludedDays.has(localDay) ||
      overriddenKeys.has(floatingDay) ||
      overriddenKeys.has(localDay)
    ) {
      continue;
    }

    occurrences.push({ startsAt, endsAt: startsAt + duration, allDay: base.allDay });
  }

  return withinWindow(occurrences, options);
}

function withinWindow(
  occurrences: NormalizedOccurrence[],
  options: ParseOptions,
): NormalizedOccurrence[] {
  return occurrences.filter(
    (o) => o.endsAt > options.windowStart && o.startsAt < options.windowEnd,
  );
}

/**
 * Wall-clock reading of a floating instant, taken from its UTC fields. Used for
 * timed values, where both node-ical's rrule options and our own anchoring
 * encode the intended clock time in UTC.
 */
function utcParts(date: Date, withTime: boolean): WallClock {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: withTime ? date.getUTCHours() : 0,
    minute: withTime ? date.getUTCMinutes() : 0,
    second: withTime ? date.getUTCSeconds() : 0,
  };
}

/**
 * Calendar date of a DATE-valued (all-day) entry.
 *
 * node-ical constructs those Dates at *local* midnight, so `20260612` becomes
 * a different absolute instant on every machine — but its local Y/M/D fields
 * always read back as the 12th. Reading them with the local getters is
 * therefore the only process-independent way to recover the calendar date.
 *
 * `shiftHours` nudges to midday first: in a recurring all-day series the
 * floating instances inherit local midnight, and an hour of DST drift would
 * otherwise tip one of them into the previous day.
 */
function localDateParts(date: Date, shiftHours = 0): WallClock {
  const shifted = shiftHours === 0 ? date : new Date(date.getTime() + shiftHours * 3_600_000);
  return {
    year: shifted.getFullYear(),
    month: shifted.getMonth() + 1,
    day: shifted.getDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

function isAllDay(event: ical.VEvent, start: IcalDate): boolean {
  if (start.dateOnly === true) return true;
  return (event as { datetype?: string }).datetype === 'date';
}

/**
 * An all-day DATE value is floating — `20260906` means "the 6th" wherever the
 * display is. The calendar date is recovered from the value and re-anchored to
 * midnight in the display zone; without that, a screen east or west of UTC
 * shows the event on the wrong day.
 */
function toEpoch(date: IcalDate, allDay: boolean, displayTimezone: string): number {
  if (!allDay) return Math.floor(date.getTime() / 1000);
  return zonedWallClockToEpoch(localDateParts(date), displayTimezone);
}

function resolveEnd(
  event: ical.VEvent,
  startsAt: number,
  allDay: boolean,
  displayTimezone: string,
): number {
  const end = event.end as IcalDate | undefined;
  if (end && !Number.isNaN(end.getTime())) {
    const endsAt = toEpoch(end, allDay, displayTimezone);
    if (endsAt > startsAt) return endsAt;
  }
  // RFC 5545: a VEVENT with no DTEND is instantaneous, except a DATE-valued
  // DTSTART which implies one full day.
  return allDay ? startsAt + 86_400 : startsAt;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') {
    if (value && typeof value === 'object' && 'val' in value) {
      return text((value as { val: unknown }).val);
    }
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function organizerName(organizer: unknown): string | null {
  if (!organizer) return null;
  if (typeof organizer === 'string') return text(organizer);
  const record = organizer as { params?: { CN?: string }; val?: string };
  return text(record.params?.CN) ?? text(record.val)?.replace(/^mailto:/i, '') ?? null;
}

function toEpochOrNull(date: Date | undefined): number | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.floor(date.getTime() / 1000);
}
