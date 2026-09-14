import { courseRank, mealRank, type PlannedDish } from '@picalendar/shared';

/** What the repository returns: a planned dish that knows which day it is on. */
export type DatedPlannedDish = PlannedDish & { date: string };

/**
 * Which dishes are planned on each of the days being drawn.
 *
 * Used by both `/api/agenda` and `/api/menu` so the wall display and the
 * planner can never disagree about which day a dish is on — the same reason
 * the two agenda endpoints share one occurrence bucketing function, and the
 * same reason both call one birthday function.
 *
 * There is no timezone conversion here, and that is the point rather than an
 * omission. A menu day is a `YYYY-MM-DD` key on both sides of the comparison:
 * the zone was applied when the agenda derived its day keys, and pushing one
 * back through a conversion is exactly what shifts a meal a day in zones past
 * UTC+12.
 *
 * Entries arrive in `position` order and are sorted into serving order here:
 * meal first, then course, with position left as the tiebreaker so two sides
 * at the same dinner keep the order they were planned in.
 */
export function entriesByDay(
  entries: DatedPlannedDish[],
  dayKeys: string[],
): Map<string, PlannedDish[]> {
  const buckets = new Map<string, PlannedDish[]>(dayKeys.map((key) => [key, []]));

  for (const entry of entries) {
    // A day outside the requested range is not an error — the caller may have
    // asked for a wider span than it draws — it simply has no bucket.
    const bucket = buckets.get(entry.date);
    if (!bucket) continue;

    const { date: _date, ...planned } = entry;
    bucket.push(planned);
  }

  for (const bucket of buckets.values()) {
    if (bucket.length > 1) bucket.sort(compareServingOrder);
  }

  return buckets;
}

/**
 * Breakfast before lunch before dinner; within a meal, the order a course
 * reaches the table. Both orders come from the arrays in the shared package,
 * so the SQL `CHECK` constraints, the course picker and this comparator cannot
 * drift apart.
 */
function compareServingOrder(a: PlannedDish, b: PlannedDish): number {
  return mealRank(a.meal) - mealRank(b.meal) || courseRank(a.course) - courseRank(b.course);
}
