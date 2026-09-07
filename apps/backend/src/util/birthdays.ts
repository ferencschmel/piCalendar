import { birthdayDayKey, type Birthday, type BirthdayCelebration } from '@picalendar/shared';

/**
 * Which birthdays fall on each of the days being drawn.
 *
 * Computed rather than stored. Birthdays recur forever and are three integers
 * each, so materialising them into `event_occurrence` alongside ingested events
 * would buy nothing and cost writes on every window roll — and it would cap
 * them at the occurrence window, when the whole point of a year grid is to show
 * a birthday in December that no feed has been expanded for yet.
 *
 * Day keys are `YYYY-MM-DD` and therefore timezone-free by construction: the
 * display zone was applied when the key was derived, and matching a birth month
 * and day against a key's is plain integer comparison. Nothing here converts a
 * key back into an instant, which is what would shift a celebration a day in
 * zones past UTC+12.
 *
 * Used by both `/api/agenda` and `/api/agenda/density` so a cake in the week
 * view and a cake in the year view can never disagree about the date.
 *
 * Birthdays are the outer loop, so a day two of them share lists them in the
 * order they were passed in — which is the repository's calendar ordering.
 */
export function celebrationsByDay(
  birthdays: Birthday[],
  dayKeys: string[],
): Map<string, BirthdayCelebration[]> {
  const buckets = new Map<string, BirthdayCelebration[]>(dayKeys.map((key) => [key, []]));
  if (birthdays.length === 0) return buckets;

  // A range is at most a year and change, so every key it spans falls in one of
  // two calendar years; asking each birthday for those is cheaper than testing
  // every birthday against every day.
  const years = [...new Set(dayKeys.map((key) => Number(key.slice(0, 4))))];

  for (const birthday of birthdays) {
    for (const year of years) {
      // Nobody has a birthday before they were born, which a year view stepped
      // back past a child's birth would otherwise happily draw.
      if (birthday.date.year !== null && year < birthday.date.year) continue;

      const date = birthdayDayKey(birthday.date, year);
      const bucket = buckets.get(date);
      if (!bucket) continue;

      // "Turns 0" is not how anyone describes the day someone was born, so the
      // birth year itself shows the name alone.
      const age = birthday.date.year === null ? null : year - birthday.date.year;

      bucket.push({
        birthdayId: birthday.id,
        displayName: birthday.displayName,
        color: birthday.color,
        icon: birthday.icon,
        date,
        age: age !== null && age >= 1 ? age : null,
        observed: birthday.date.month === 2 && birthday.date.day === 29 && !date.endsWith('-02-29'),
      });
    }
  }

  return buckets;
}
