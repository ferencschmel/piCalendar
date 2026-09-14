import type {
  Course,
  Meal,
  MenuEntryInput,
  MenuEntryUpdate,
  PlannedDish,
  Wish,
  WishInput,
} from '@picalendar/shared';
import type { Db } from '../index.js';
import { newId } from '../../util/ids.js';
import { nowEpoch, toIso } from '../../util/time.js';

interface EntryRow {
  id: string;
  day_key: string;
  dish_id: string;
  meal: Meal;
  course: Course;
  note: string | null;
  name: string;
  icon: string;
  color: string;
  has_recipe: number;
}

interface WishRow {
  id: string;
  dish_id: string;
  person_id: string | null;
  note: string | null;
  created_at: number;
  dish_name: string;
  icon: string;
  color: string;
  default_course: Course;
  person_name: string | null;
  person_color: string | null;
}

function toPlanned(row: EntryRow): PlannedDish & { date: string } {
  return {
    date: row.day_key,
    entryId: row.id,
    dishId: row.dish_id,
    name: row.name,
    meal: row.meal,
    course: row.course,
    icon: row.icon,
    color: row.color,
    note: row.note,
    hasRecipe: row.has_recipe === 1,
  };
}

/**
 * Every entry planned between two day keys, inclusive.
 *
 * `YYYY-MM-DD` sorts chronologically as text, so a leading `day_key` index
 * makes this the same kind of indexed range scan the occurrence table gets —
 * and, unlike the occurrence table, there is no rolling window to fall off the
 * end of. A meal planned four months out is found here just as reliably as
 * tonight's.
 *
 * The recipe body is deliberately not selected. A wall display renders a name
 * and an icon; shipping the prose for every planned dish would put kilobytes
 * on the wire every minute for text nothing on screen shows.
 */
export function listEntries(
  db: Db,
  startKey: string,
  endKey: string,
): Array<PlannedDish & { date: string }> {
  return db
    .prepare<[string, string], EntryRow>(
      `SELECT e.id, e.day_key, e.dish_id, e.meal, e.course, e.note,
              d.name, d.icon, d.color,
              CASE WHEN d.recipe IS NOT NULL AND d.recipe != '' THEN 1 ELSE 0 END AS has_recipe
       FROM menu_entry e JOIN dish d ON d.id = e.dish_id
       WHERE e.day_key BETWEEN ? AND ?
       ORDER BY e.day_key, e.position`,
    )
    .all(startKey, endKey)
    .map(toPlanned);
}

export function getEntry(db: Db, id: string): (PlannedDish & { date: string }) | null {
  const row = db
    .prepare<[string], EntryRow>(
      `SELECT e.id, e.day_key, e.dish_id, e.meal, e.course, e.note,
              d.name, d.icon, d.color,
              CASE WHEN d.recipe IS NOT NULL AND d.recipe != '' THEN 1 ELSE 0 END AS has_recipe
       FROM menu_entry e JOIN dish d ON d.id = e.dish_id
       WHERE e.id = ?`,
    )
    .get(id);
  return row ? toPlanned(row) : null;
}

/**
 * The entry already planning this dish at this sitting, if there is one.
 *
 * Lets a repeat land as the entry that is already there rather than as a
 * constraint violation. Planning a dish on a *different* day, or at a
 * different meal on the same day, is not a repeat and never matches here.
 */
export function findEntry(
  db: Db,
  dayKey: string,
  meal: Meal,
  dishId: string,
): (PlannedDish & { date: string }) | null {
  const row = db
    .prepare<[string, string, string], { id: string }>(
      'SELECT id FROM menu_entry WHERE day_key = ? AND meal = ? AND dish_id = ?',
    )
    .get(dayKey, meal, dishId);
  return row ? getEntry(db, row.id) : null;
}

/** Appends to the end of that meal, which is where a dropped dish belongs. */
function nextPosition(db: Db, dayKey: string, meal: Meal): number {
  const row = db
    .prepare<[string, string], { next: number }>(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM menu_entry WHERE day_key = ? AND meal = ?',
    )
    .get(dayKey, meal);
  return row?.next ?? 0;
}

/**
 * Plan a dish, and — when it came off the wishlist — fulfil the wish in the
 * same transaction.
 *
 * One transaction rather than two calls because the alternative fails halfway:
 * a planned dish still sitting on the wishlist reads as "nobody has acted on
 * this", which is exactly the opposite of what happened.
 *
 * The course falls back to the dish's own default, so a drag is one decision
 * and not two.
 */
export function createEntry(
  db: Db,
  input: MenuEntryInput,
): (PlannedDish & { date: string }) | null {
  const dish = db
    .prepare<[string], { default_course: Course }>('SELECT default_course FROM dish WHERE id = ?')
    .get(input.dishId);
  if (!dish) return null;

  const id = newId();
  const now = nowEpoch();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO menu_entry (id, day_key, dish_id, meal, course, position, note,
         created_at, updated_at)
       VALUES (@id, @dayKey, @dishId, @meal, @course, @position, @note, @now, @now)`,
    ).run({
      id,
      dayKey: input.dayKey,
      dishId: input.dishId,
      meal: input.meal,
      course: input.course ?? dish.default_course,
      position: nextPosition(db, input.dayKey, input.meal),
      note: input.note,
      now,
    });

    if (input.wishId) db.prepare('DELETE FROM menu_wish WHERE id = ?').run(input.wishId);
  })();

  return getEntry(db, id);
}

/**
 * Move or re-label a planned dish.
 *
 * Dragging an entry from Tuesday to Thursday is a patch, not a delete plus an
 * insert: the row keeps its identity, so a drag that fails partway cannot
 * leave the dish on neither day. A move to a different day or meal takes a
 * fresh position at the end of wherever it lands.
 */
export function updateEntry(
  db: Db,
  id: string,
  patch: MenuEntryUpdate,
): (PlannedDish & { date: string }) | null {
  const existing = getEntry(db, id);
  if (!existing) return null;

  const dayKey = patch.dayKey ?? existing.date;
  const meal = patch.meal ?? existing.meal;
  const moved = dayKey !== existing.date || meal !== existing.meal;

  db.prepare(
    `UPDATE menu_entry SET day_key = @dayKey, meal = @meal, course = @course, note = @note,
       position = CASE WHEN @moved = 1 THEN @position ELSE position END,
       updated_at = @now
     WHERE id = @id`,
  ).run({
    id,
    dayKey,
    meal,
    course: patch.course ?? existing.course,
    note: patch.note === undefined ? existing.note : patch.note,
    moved: moved ? 1 : 0,
    position: moved ? nextPosition(db, dayKey, meal) : 0,
    now: nowEpoch(),
  });

  return getEntry(db, id);
}

export function deleteEntry(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM menu_entry WHERE id = ?').run(id).changes > 0;
}

function toWish(row: WishRow): Wish {
  return {
    id: row.id,
    dishId: row.dish_id,
    dishName: row.dish_name,
    icon: row.icon,
    color: row.color,
    defaultCourse: row.default_course,
    personId: row.person_id,
    personName: row.person_name,
    personColor: row.person_color,
    note: row.note,
    createdAt: toIso(row.created_at)!,
  };
}

const WISH_SELECT = `SELECT w.id, w.dish_id, w.person_id, w.note, w.created_at,
         d.name AS dish_name, d.icon, d.color, d.default_course,
         p.display_name AS person_name, p.color AS person_color
  FROM menu_wish w
  JOIN dish d ON d.id = w.dish_id
  LEFT JOIN person p ON p.id = w.person_id`;

/**
 * Newest first: a wishlist is read as "what has someone asked for lately", and
 * the thing asked for this morning is the one most likely to be dragged onto a
 * day this evening.
 */
export function listWishes(db: Db): Wish[] {
  return db.prepare<[], WishRow>(`${WISH_SELECT} ORDER BY w.created_at DESC`).all().map(toWish);
}

export function getWish(db: Db, id: string): Wish | null {
  const row = db.prepare<[string], WishRow>(`${WISH_SELECT} WHERE w.id = ?`).get(id);
  return row ? toWish(row) : null;
}

export function createWish(db: Db, input: WishInput): Wish | null {
  const id = newId();
  db.prepare(
    'INSERT INTO menu_wish (id, dish_id, person_id, note, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, input.dishId, input.personId, input.note, nowEpoch());
  return getWish(db, id);
}

/** The existing wish behind a unique-index collision, so a repeat reads as success. */
export function findWish(db: Db, dishId: string, personId: string | null): Wish | null {
  const row = db
    .prepare<[string, string], WishRow>(
      `${WISH_SELECT} WHERE w.dish_id = ? AND COALESCE(w.person_id, '') = ?`,
    )
    .get(dishId, personId ?? '');
  return row ? toWish(row) : null;
}

export function deleteWish(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM menu_wish WHERE id = ?').run(id).changes > 0;
}

/**
 * A token that changes whenever the menus on the calendar could have.
 *
 * Menus are not ingested, so `agenda_revision` — which only ingest bumps —
 * would leave a client that skips repaints on an unchanged revision showing a
 * dinner it has just been told to cancel. The entry count catches deletions,
 * which leave the surviving rows' timestamps untouched; the dish timestamp
 * catches a rename, which changes what the wall reads without touching an
 * entry at all.
 */
export function menuRevision(db: Db): string {
  const row = db
    .prepare<[], { entries: number; entryAt: number | null; dishAt: number | null }>(
      `SELECT (SELECT COUNT(*)        FROM menu_entry) AS entries,
              (SELECT MAX(updated_at) FROM menu_entry) AS entryAt,
              (SELECT MAX(updated_at) FROM dish)       AS dishAt`,
    )
    .get();
  return `${row?.entries ?? 0}.${row?.entryAt ?? 0}.${row?.dishAt ?? 0}`;
}
