/**
 * Wall-clock formatting in the display timezone.
 *
 * Every label the dashboard shows is derived from a UTC instant plus the
 * feed-wide display timezone, never from the browser's own zone — a Pi whose
 * clock is set to UTC must still read 19:00 for a 19:00 practice.
 * `utils/timeline.ts` owns the geometry; this file owns the words.
 */

const LOCALE = 'en-GB';

/** `09:30`. */
export function timeLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });
}

/** `Saturday 12 September`. */
export function longDateLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  });
}

/** `Sat 12 Sep` — for ranges, where two long dates would not fit on a line. */
export function shortDateLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  });
}

/** The calendar date an instant falls on, `YYYY-MM-DD`, in `timezone`. */
export function dateKey(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  });
}

/**
 * `45 min`, `1 h`, `1 h 30 min`, `3 days`. Rounded to the minute: ICS durations
 * are occasionally off by a second or two and nobody wants to read that.
 */
export function durationLabel(startIso: string, endIso: string): string {
  const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
  if (minutes <= 0) return '';

  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '1 day' : `${days} days`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
