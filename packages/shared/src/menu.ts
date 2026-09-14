import { z } from 'zod';

/**
 * Menu planning: a library of dishes, a household wishlist, and which dishes
 * are planned for which day.
 *
 * A planned day is a *civil* date, held as a `YYYY-MM-DD` key rather than as
 * the unix seconds the rest of the app uses. This is the same exception
 * birthdays take, for the same reason: Wednesday's dinner is Wednesday's
 * dinner, and anchoring it to an instant would have a display east of UTC
 * serving it on Tuesday. Nothing here ever pushes a key back through a
 * timezone conversion.
 */

/**
 * When a dish is eaten. The outer axis of a day's plan — a day holds up to
 * three of these, each with its own courses.
 *
 * Array order is serving order, and it is the sort key the dashboard uses, so
 * it lives here rather than being re-derived by a comparator.
 */
export const MEALS = ['breakfast', 'lunch', 'dinner'] as const;
export type Meal = (typeof MEALS)[number];
export const mealSchema = z.enum(MEALS);

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

/**
 * Most households plan dinner and improvise the rest, so an unqualified drop
 * lands there and the other two rows are opt-in on the planner.
 */
export const DEFAULT_MEAL: Meal = 'dinner';

/**
 * What a dish *is* within a meal — the inner axis, and the order it reaches
 * the table in.
 */
export const COURSES = ['starter', 'soup', 'main', 'side', 'dessert', 'drink'] as const;
export type Course = (typeof COURSES)[number];
export const courseSchema = z.enum(COURSES);

export const COURSE_LABELS: Record<Course, string> = {
  starter: 'Starter',
  soup: 'Soup',
  main: 'Main',
  side: 'Side',
  dessert: 'Dessert',
  drink: 'Drink',
};

/** Position of a course in serving order, for sorting a meal's entries. */
export function courseRank(course: Course): number {
  const index = COURSES.indexOf(course);
  return index === -1 ? COURSES.length : index;
}

/** Position of a meal in the day, for sorting a day's entries. */
export function mealRank(meal: Meal): number {
  const index = MEALS.indexOf(meal);
  return index === -1 ? MEALS.length : index;
}

/**
 * `YYYY-MM-DD` in `DISPLAY_TIMEZONE`. Timezone-free by construction: the zone
 * was applied when the key was derived, and everything downstream compares
 * keys rather than converting them.
 */
export const dayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date like 2026-09-14');

const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour, e.g. #1b6a57');

/** Same constraint the birthday icons take: a Bootstrap Icons class name. */
const dishIconSchema = z
  .string()
  .trim()
  .regex(/^bi-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a Bootstrap icon name, e.g. bi-egg-fried')
  .max(60);

export const DEFAULT_DISH_ICON = 'bi-egg-fried';
export const DEFAULT_DISH_COLOR = '#1b6a57';

/** Offered in the dish editor's picker. Any valid `bi-*` name is accepted. */
export const suggestedDishIcons = [
  'bi-egg-fried',
  'bi-cup-hot',
  'bi-cake',
  'bi-cookie',
  'bi-basket',
  'bi-fish',
  'bi-egg',
  'bi-carrot',
  'bi-apple',
  'bi-cup-straw',
  'bi-nut',
  'bi-snow',
] as const;

/**
 * Units offered in the editor's picker, roughly in the order a kitchen reaches
 * for them: weight, then volume, then the things you count.
 *
 * A suggestion list rather than a `CHECK` constraint, because a household
 * measures in cloves, tins and bunches — an enum would reject the ingredient
 * rather than the typo. The editor offers these and accepts anything.
 */
export const SUGGESTED_UNITS = [
  'g',
  'kg',
  'oz',
  'lbs',
  'ml',
  'dl',
  'l',
  'tsp',
  'tbsp',
  'cup',
  'each',
  'clove',
  'slice',
  'bunch',
  'pinch',
  'tin',
  'pack',
] as const;

export const unitSchema = z.string().trim().max(20);

export const ingredientSchema = z.object({
  name: z.string().trim().min(1, 'An ingredient needs a name').max(120),
  /**
   * Nullable rather than defaulted to zero: "a pinch of salt" and "parsley, to
   * taste" are real lines in a real recipe, and "0 pinch" is not what anyone
   * meant by leaving the number off.
   */
  quantity: z.number().nonnegative().max(100_000).nullable().default(null),
  unit: unitSchema.default(''),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

/**
 * `500 g` / `3 each` / `a pinch` / `2`, for one line of a recipe card.
 *
 * `String` on a number drops trailing zeros of its own accord, so a half is
 * `0.5` and five hundred is `500` rather than `500.0`.
 */
export function formatAmount(ingredient: Pick<Ingredient, 'quantity' | 'unit'>): string {
  const { quantity, unit } = ingredient;
  if (quantity === null) return unit;
  return unit ? `${String(quantity)} ${unit}` : String(quantity);
}

/**
 * One distinct ingredient across the whole library, for the editor's
 * autocomplete.
 *
 * Carries the unit it is most often measured in, so choosing "Beef shin" fills
 * in "g" as well — the point of suggesting from what is already written down is
 * that the second recipe agrees with the first.
 */
export interface IngredientSuggestion {
  name: string;
  /** The most-used non-empty unit for this name, or `''` if it never has one. */
  unit: string;
  /** How many dishes use it, so the common things sort to the top. */
  uses: number;
}

export const dishInputSchema = z.object({
  name: z.string().trim().min(1, 'A dish needs a name').max(120),
  /** Free prose, the way it would be written on a recipe card. Never parsed. */
  recipe: z.string().max(8000).nullable().default(null),
  /** Where it came from, so a phone can open the original mid-cook. */
  sourceUrl: z
    .string()
    .trim()
    .url('Must be a link, e.g. https://…')
    .max(2000)
    .nullable()
    .default(null),
  /**
   * What this dish usually is, so dropping it on a day asks no second
   * question. Overridable per entry: last night's main is tonight's side.
   */
  defaultCourse: courseSchema.default('main'),
  icon: dishIconSchema.default(DEFAULT_DISH_ICON),
  color: hexColorSchema.default(DEFAULT_DISH_COLOR),
  /** Retired rather than deleted, so the evenings it was served on survive. */
  active: z.boolean().default(true),
  /**
   * Sent whole on every save and replaced whole on the server. A dish has ten
   * of these, the array's order *is* the stored position, and diffing them
   * would be more code than the write it saves.
   */
  ingredients: z.array(ingredientSchema).max(60).default([]),
});
export type DishInput = z.infer<typeof dishInputSchema>;
export type DishInputPayload = z.input<typeof dishInputSchema>;

export const dishUpdateSchema = dishInputSchema.partial();
export type DishUpdate = z.infer<typeof dishUpdateSchema>;
export type DishUpdatePayload = z.input<typeof dishUpdateSchema>;

export interface Dish {
  id: string;
  name: string;
  recipe: string | null;
  sourceUrl: string | null;
  defaultCourse: Course;
  icon: string;
  color: string;
  active: boolean;
  ingredients: Ingredient[];
  /**
   * The most recent day this dish was planned on, or `null`. Derived rather
   * than stored: it is what stops a household planning the same thing three
   * Tuesdays running, and a stored copy would need invalidating on every
   * entry write.
   */
  lastCookedOn: string | null;
  /** How many times it has been planned, ever. */
  timesCooked: number;
  /** Who currently has it on the wishlist. */
  wishedBy: Array<{ wishId: string; personId: string | null; displayName: string | null }>;
  createdAt: string;
  updatedAt: string;
}

export const wishInputSchema = z.object({
  dishId: z.string().uuid(),
  /**
   * Who asked. Nullable because the display has no sign-in, and a dish dragged
   * across without stopping to pick a name is still a wish worth honouring.
   */
  personId: z.string().uuid().nullable().default(null),
  note: z.string().trim().max(200).nullable().default(null),
});
export type WishInput = z.infer<typeof wishInputSchema>;
export type WishInputPayload = z.input<typeof wishInputSchema>;

export interface Wish {
  id: string;
  dishId: string;
  dishName: string;
  icon: string;
  color: string;
  defaultCourse: Course;
  personId: string | null;
  personName: string | null;
  personColor: string | null;
  note: string | null;
  createdAt: string;
}

export const menuEntryInputSchema = z.object({
  dayKey: dayKeySchema,
  dishId: z.string().uuid(),
  meal: mealSchema.default(DEFAULT_MEAL),
  /** Falls back to the dish's own `defaultCourse` when the client omits it. */
  course: courseSchema.optional(),
  note: z.string().trim().max(200).nullable().default(null),
  /**
   * Set when the dish came off the wishlist. The wish is deleted in the same
   * transaction that plans it, so a fulfilled wish cannot linger.
   */
  wishId: z.string().uuid().optional(),
});
export type MenuEntryInput = z.infer<typeof menuEntryInputSchema>;
export type MenuEntryInputPayload = z.input<typeof menuEntryInputSchema>;

/**
 * Moving an entry between days or meals is a patch, not a delete plus an
 * insert — the row keeps its identity, so a drag cannot half-fail into a
 * dish that exists on neither day.
 */
export const menuEntryUpdateSchema = z.object({
  dayKey: dayKeySchema.optional(),
  meal: mealSchema.optional(),
  course: courseSchema.optional(),
  note: z.string().trim().max(200).nullable().optional(),
});
export type MenuEntryUpdate = z.infer<typeof menuEntryUpdateSchema>;
export type MenuEntryUpdatePayload = z.input<typeof menuEntryUpdateSchema>;

/**
 * One dish as it appears on one day of the calendar being drawn.
 *
 * Flattened out of the join deliberately: the dashboard wants a name, a colour
 * and an icon, and shipping the recipe and every ingredient to a wall display
 * that renders none of them would put kilobytes on the wire every minute.
 */
export interface PlannedDish {
  entryId: string;
  dishId: string;
  name: string;
  meal: Meal;
  course: Course;
  icon: string;
  color: string;
  note: string | null;
  /** So a card can offer to open the recipe without fetching it first. */
  hasRecipe: boolean;
}

/** A day's plan as the menu page works with it, grouped the way it is drawn. */
export interface MenuDay {
  date: string;
  isToday: boolean;
  entries: PlannedDish[];
}

export interface MenuResponse {
  generatedAt: string;
  timezone: string;
  days: MenuDay[];
  revision: string;
}

export const menuQuerySchema = z.object({
  start: dayKeySchema.optional(),
  /** A fortnight at most; the planner shows one week and peeks at the next. */
  days: z.coerce.number().int().min(1).max(31).default(7),
});
export type MenuQuery = z.infer<typeof menuQuerySchema>;

/** Group a day's entries by meal, in serving order, skipping empty meals. */
export function byMeal(entries: PlannedDish[]): Array<{ meal: Meal; entries: PlannedDish[] }> {
  return MEALS.map((meal) => ({ meal, entries: entries.filter((e) => e.meal === meal) })).filter(
    (group) => group.entries.length > 0,
  );
}

/** `12 days ago` / `today` / `never`, for the "when did we last cook this" line. */
export function lastCookedLabel(lastCookedOn: string | null, todayKey: string): string {
  if (!lastCookedOn) return 'never';
  const days = Math.round(
    (Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${lastCookedOn}T00:00:00Z`)) / 86_400_000,
  );
  if (days === 0) return 'today';
  if (days < 0) return days === -1 ? 'tomorrow' : `in ${-days} days`;
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return 'over a year ago';
}
