/**
 * Timezone helpers built on `Intl` — no date library needed, and the Pi's
 * bundled ICU already carries the zone database.
 *
 * The whole app stores unix *seconds* in UTC. Anything user-facing (day
 * buckets, all-day anchoring) is resolved against the configured display zone.
 */

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatter.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatter.set(timeZone, fmt);
  }
  return fmt;
}

function partsAsUtcMillis(date: Date, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  // `hour: '2-digit'` with hour12:false renders midnight as 24 in some ICU
  // versions; normalise it back to 0 for the same day.
  const hour = get('hour') % 24;
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

/** Offset of `timeZone` from UTC, in milliseconds, at the given instant. */
export function zoneOffsetMillis(date: Date, timeZone: string): number {
  return partsAsUtcMillis(date, timeZone) - date.getTime();
}

/** `YYYY-MM-DD` for an instant, as seen in `timeZone`. */
export function toDayKey(epochSeconds: number, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/**
 * Turn a wall-clock reading in `timeZone` into an absolute instant.
 *
 * Solved in two passes: guess using the UTC interpretation, correct by that
 * instant's offset, then re-check. The second pass matters across a DST
 * boundary, where the offset at the guess differs from the offset at the
 * answer. (Times inside a spring-forward gap do not exist; the two-pass
 * solution settles on the instant just after the transition, which is what
 * calendar clients show.)
 */
export function zonedWallClockToEpoch(parts: WallClock, timeZone: string): number {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  let millis = naive - zoneOffsetMillis(new Date(naive), timeZone);
  const refined = naive - zoneOffsetMillis(new Date(millis), timeZone);
  if (refined !== millis) millis = refined;
  return Math.floor(millis / 1000);
}

/** Epoch seconds of local midnight starting `dayKey` in `timeZone`. */
export function dayStartEpoch(dayKey: string, timeZone: string, hour = 0, minute = 0): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Invalid day key: ${dayKey}`);
  return zonedWallClockToEpoch({ year, month, day, hour, minute }, timeZone);
}

/** Add whole days to a `YYYY-MM-DD` key without touching timezones. */
export function addDaysToKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Invalid day key: ${dayKey}`);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Inclusive list of day keys from `startKey`, `count` entries long. */
export function dayKeyRange(startKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDaysToKey(startKey, i));
}

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

export function toIso(epochSeconds: number | null): string | null {
  return epochSeconds === null ? null : new Date(epochSeconds * 1000).toISOString();
}
