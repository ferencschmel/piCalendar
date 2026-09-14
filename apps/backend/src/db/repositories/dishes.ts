import type {
  Course,
  Dish,
  DishInput,
  DishUpdate,
  Ingredient,
  IngredientSuggestion,
} from '@picalendar/shared';
import type { Db } from '../index.js';
import { newId } from '../../util/ids.js';
import { nowEpoch, toIso } from '../../util/time.js';

interface DishRow {
  id: string;
  name: string;
  recipe: string | null;
  source_url: string | null;
  default_course: Course;
  icon: string;
  color: string;
  active: number;
  created_at: number;
  updated_at: number;
}

interface IngredientRow {
  dish_id: string;
  name: string;
  quantity: number | null;
  unit: string;
}

interface UsageRow {
  dish_id: string;
  times_cooked: number;
  last_cooked_on: string | null;
}

interface WishRow {
  wish_id: string;
  dish_id: string;
  person_id: string | null;
  display_name: string | null;
}

/** What a delete is about to take with it, so the page can say so first. */
export interface DishUsage {
  timesCooked: number;
  wishCount: number;
}

/**
 * Assemble the dish list in four queries rather than one per dish.
 *
 * A household's library is a few dozen rows and the page that reads it is not
 * on the hot path, but an N+1 here would still be four queries per dish on a
 * device whose storage is an SD card. Stitching in memory costs nothing.
 */
function assemble(
  rows: DishRow[],
  ingredients: Map<string, Ingredient[]>,
  usage: Map<string, UsageRow>,
  wishes: Map<string, Dish['wishedBy']>,
): Dish[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    recipe: row.recipe,
    sourceUrl: row.source_url,
    defaultCourse: row.default_course,
    icon: row.icon,
    color: row.color,
    active: row.active === 1,
    ingredients: ingredients.get(row.id) ?? [],
    lastCookedOn: usage.get(row.id)?.last_cooked_on ?? null,
    timesCooked: usage.get(row.id)?.times_cooked ?? 0,
    wishedBy: wishes.get(row.id) ?? [],
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  }));
}

function ingredientsFor(db: Db, dishIds: string[] | null): Map<string, Ingredient[]> {
  const map = new Map<string, Ingredient[]>();
  if (dishIds !== null && dishIds.length === 0) return map;

  const rows =
    dishIds === null
      ? db
          .prepare<[], IngredientRow>(
            'SELECT dish_id, name, quantity, unit FROM dish_ingredient ORDER BY dish_id, position',
          )
          .all()
      : db
          .prepare<string[], IngredientRow>(
            `SELECT dish_id, name, quantity, unit FROM dish_ingredient
             WHERE dish_id IN (${dishIds.map(() => '?').join(', ')})
             ORDER BY dish_id, position`,
          )
          .all(...dishIds);

  for (const row of rows) {
    const ingredient: Ingredient = { name: row.name, quantity: row.quantity, unit: row.unit };
    const bucket = map.get(row.dish_id);
    if (bucket) bucket.push(ingredient);
    else map.set(row.dish_id, [ingredient]);
  }
  return map;
}

/**
 * Every distinct ingredient the library knows about, commonest first.
 *
 * What the editor's autocomplete offers. Suggesting from what is already
 * written down is what stops a household ending up with "Onion", "onions" and
 * "Brown onion" as three unrelated things — and carrying each name's usual
 * unit means the second recipe agrees with the first about whether beef is
 * measured in grams or pounds.
 *
 * The unit is the most-used *non-empty* one: an ingredient written without a
 * unit in four dishes and in grams in one should still suggest grams, because
 * a blank is the absence of an answer rather than an answer of its own.
 */
export function listIngredientSuggestions(db: Db): IngredientSuggestion[] {
  return db
    .prepare<[], IngredientSuggestion>(
      `SELECT MIN(name) AS name,
              COUNT(*)  AS uses,
              COALESCE((SELECT i2.unit FROM dish_ingredient i2
                        WHERE i2.name = i.name COLLATE NOCASE AND i2.unit != ''
                        GROUP BY i2.unit COLLATE NOCASE
                        ORDER BY COUNT(*) DESC, i2.unit LIMIT 1), '') AS unit
       FROM dish_ingredient i
       GROUP BY i.name COLLATE NOCASE
       ORDER BY uses DESC, name COLLATE NOCASE`,
    )
    .all();
}

/**
 * How often each dish has been planned, and when it last was.
 *
 * `MAX(day_key)` works because the keys are `YYYY-MM-DD` and therefore sort
 * chronologically as text — the same property that lets the agenda range-scan
 * them. No date arithmetic happens on the server at all.
 */
function usageByDish(db: Db): Map<string, UsageRow> {
  const rows = db
    .prepare<[], UsageRow>(
      `SELECT dish_id, COUNT(*) AS times_cooked, MAX(day_key) AS last_cooked_on
       FROM menu_entry GROUP BY dish_id`,
    )
    .all();
  return new Map(rows.map((row) => [row.dish_id, row]));
}

function wishesByDish(db: Db): Map<string, Dish['wishedBy']> {
  const rows = db
    .prepare<[], WishRow>(
      `SELECT w.id AS wish_id, w.dish_id, w.person_id, p.display_name
       FROM menu_wish w LEFT JOIN person p ON p.id = w.person_id
       ORDER BY w.created_at`,
    )
    .all();

  const map = new Map<string, Dish['wishedBy']>();
  for (const row of rows) {
    const wish = {
      wishId: row.wish_id,
      personId: row.person_id,
      displayName: row.display_name,
    };
    const bucket = map.get(row.dish_id);
    if (bucket) bucket.push(wish);
    else map.set(row.dish_id, [wish]);
  }
  return map;
}

/**
 * Ordered by name, because the library is read as "find the thing I mean" and
 * alphabetical is the only order a person can predict. Retired dishes sink to
 * the bottom rather than disappearing, so the editor can bring one back.
 */
export function listDishes(db: Db): Dish[] {
  const rows = db
    .prepare<[], DishRow>('SELECT * FROM dish ORDER BY active DESC, name COLLATE NOCASE')
    .all();
  return assemble(rows, ingredientsFor(db, null), usageByDish(db), wishesByDish(db));
}

export function getDish(db: Db, id: string): Dish | null {
  const row = db.prepare<[string], DishRow>('SELECT * FROM dish WHERE id = ?').get(id);
  if (!row) return null;
  return assemble([row], ingredientsFor(db, [id]), usageByDish(db), wishesByDish(db))[0] ?? null;
}

/** A dish whose name already exists, so a 409 can offer to open it instead. */
export function findDishByName(db: Db, name: string): Dish | null {
  const row = db
    .prepare<[string], DishRow>('SELECT * FROM dish WHERE name = ? COLLATE NOCASE')
    .get(name.trim());
  return row ? getDish(db, row.id) : null;
}

export function dishUsage(db: Db, id: string): DishUsage {
  const row = db
    .prepare<[string, string], DishUsage>(
      `SELECT (SELECT COUNT(*) FROM menu_entry WHERE dish_id = ?) AS timesCooked,
              (SELECT COUNT(*) FROM menu_wish  WHERE dish_id = ?) AS wishCount`,
    )
    .get(id, id);
  return row ?? { timesCooked: 0, wishCount: 0 };
}

/**
 * Ingredients are replaced wholesale rather than diffed.
 *
 * The array's order *is* `position`, so there is nothing to reconcile — and a
 * dish has ten of these, saved by hand a few times a week. Diffing would be
 * more code than the writes it saves.
 */
function writeIngredients(db: Db, dishId: string, ingredients: Ingredient[]): void {
  db.prepare('DELETE FROM dish_ingredient WHERE dish_id = ?').run(dishId);
  const insert = db.prepare(
    `INSERT INTO dish_ingredient (id, dish_id, position, name, quantity, unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  ingredients.forEach((ingredient, index) => {
    insert.run(newId(), dishId, index, ingredient.name, ingredient.quantity, ingredient.unit);
  });
}

export function createDish(db: Db, input: DishInput): Dish {
  const id = newId();
  const now = nowEpoch();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO dish (id, name, recipe, source_url, default_course, icon, color,
         active, created_at, updated_at)
       VALUES (@id, @name, @recipe, @sourceUrl, @defaultCourse, @icon, @color,
         @active, @now, @now)`,
    ).run({
      id,
      name: input.name,
      recipe: input.recipe,
      sourceUrl: input.sourceUrl,
      defaultCourse: input.defaultCourse,
      icon: input.icon,
      color: input.color,
      active: input.active ? 1 : 0,
      now,
    });
    writeIngredients(db, id, input.ingredients);
  })();
  return getDish(db, id)!;
}

export function updateDish(db: Db, id: string, patch: DishUpdate): Dish | null {
  const existing = getDish(db, id);
  if (!existing) return null;

  const merged = {
    name: patch.name ?? existing.name,
    recipe: patch.recipe === undefined ? existing.recipe : patch.recipe,
    sourceUrl: patch.sourceUrl === undefined ? existing.sourceUrl : patch.sourceUrl,
    defaultCourse: patch.defaultCourse ?? existing.defaultCourse,
    icon: patch.icon ?? existing.icon,
    color: patch.color ?? existing.color,
    active: patch.active ?? existing.active,
  };

  db.transaction(() => {
    db.prepare(
      `UPDATE dish SET name = @name, recipe = @recipe, source_url = @sourceUrl,
         default_course = @defaultCourse, icon = @icon, color = @color,
         active = @active, updated_at = @now
       WHERE id = @id`,
    ).run({ id, ...merged, active: merged.active ? 1 : 0, now: nowEpoch() });

    // Omitting `ingredients` leaves them alone; sending an empty array clears
    // them. A partial save of the name should not wipe the recipe's shopping.
    if (patch.ingredients !== undefined) writeIngredients(db, id, patch.ingredients);
  })();

  return getDish(db, id);
}

export function deleteDish(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM dish WHERE id = ?').run(id).changes > 0;
}
