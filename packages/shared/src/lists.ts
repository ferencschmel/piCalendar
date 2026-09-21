import { z } from 'zod';
import { dayKeySchema, formatAmount, ingredientSchema } from './menu.js';

/**
 * Lists the household keeps: the grocery list, and whatever else someone
 * writes down.
 *
 * Two kinds, and the difference is the whole design. A *custom* list is typed
 * in and owned by whoever typed it. The *grocery* list is derived from the
 * menu — it is the ingredients of everything planned for the next few days,
 * added up — and so it has no rows of its own to edit. Ticking an item is the
 * only thing anyone can do to it, because editing a line would put the list
 * and the meal plan into an argument that the list would win silently.
 */

/**
 * The grocery list's id wherever a list id is expected. Not a row in `list`:
 * giving it one would make it editable by every route the custom lists use,
 * and the point of it is that it is not.
 */
export const GROCERY_LIST_ID = 'grocery';

export type ListKind = 'grocery' | 'custom';

/* --- Amounts -------------------------------------------------------------- */

/** One measured quantity: `500 g`, `3`, `a pinch`. */
export interface AmountPart {
  quantity: number | null;
  unit: string;
}

/**
 * Units that are the same measure at different scales, so two recipes writing
 * `500 g` and `1 kg` of beef produce one line rather than two.
 *
 * Deliberately shallow. It converts *within* a system and never between them:
 * grams to kilograms is arithmetic every kitchen agrees on, whereas ounces to
 * grams and cups to millilitres are conversions whose answer depends on which
 * country's cup you own. An unrecognised unit is not an error — it groups
 * under its own spelling, which is what "3 cloves" and "2 tins" want anyway.
 */
const UNIT_SCALES: Record<string, { family: string; per: number }> = {
  g: { family: 'mass', per: 1 },
  kg: { family: 'mass', per: 1000 },
  ml: { family: 'volume', per: 1 },
  cl: { family: 'volume', per: 10 },
  dl: { family: 'volume', per: 100 },
  l: { family: 'volume', per: 1000 },
  tsp: { family: 'spoon', per: 1 },
  tbsp: { family: 'spoon', per: 3 },
  oz: { family: 'imperial-mass', per: 1 },
  lb: { family: 'imperial-mass', per: 16 },
  lbs: { family: 'imperial-mass', per: 16 },
};

/**
 * The unit a family's total is written back out in, largest first.
 *
 * Narrower than the set accepted above: `cl` and `dl` are read because recipes
 * are written in them, but half a litre reaches a shopping list as `500 ml`
 * rather than `5 dl`, because that is what the label on the carton says.
 */
const FAMILY_STEPS: Record<string, Array<{ unit: string; per: number }>> = {
  mass: [
    { unit: 'kg', per: 1000 },
    { unit: 'g', per: 1 },
  ],
  volume: [
    { unit: 'l', per: 1000 },
    { unit: 'ml', per: 1 },
  ],
  spoon: [
    { unit: 'tbsp', per: 3 },
    { unit: 'tsp', per: 1 },
  ],
  'imperial-mass': [
    { unit: 'lbs', per: 16 },
    { unit: 'oz', per: 1 },
  ],
};

/** Floats added together drift; nothing in a kitchen needs a fourth decimal. */
function tidy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Add up the measures of one ingredient across every meal that calls for it.
 *
 * Returns as few parts as honesty allows. Quantities in compatible units
 * collapse into one; anything else keeps its own part, so `3 each` and
 * `2 bunch` of the same herb reach the shopper as both rather than as a number
 * that means neither.
 *
 * A part with no quantity — "salt, a pinch" — survives only when nothing
 * measured already covers it. Printing `500 g + g` beside the flour would be a
 * worse line than printing `500 g`.
 */
export function sumAmounts(parts: AmountPart[]): AmountPart[] {
  /** Insertion-ordered, so the output reads in the order the recipes did. */
  const totals = new Map<string, { quantity: number; family: string | null; unit: string }>();
  const mentions = new Map<string, string>();

  for (const part of parts) {
    const unit = part.unit.trim();
    const scale = UNIT_SCALES[unit.toLowerCase()];

    if (part.quantity === null) {
      // Keyed by family where there is one, so an unmeasured "g" is covered by
      // a measured "kg" rather than sitting beside it.
      const key = scale ? `#${scale.family}` : `=${unit.toLowerCase()}`;
      if (!mentions.has(key)) mentions.set(key, unit);
      continue;
    }

    const key = scale ? `#${scale.family}` : `=${unit.toLowerCase()}`;
    const existing = totals.get(key);
    const amount = scale ? part.quantity * scale.per : part.quantity;
    if (existing) existing.quantity += amount;
    else totals.set(key, { quantity: amount, family: scale?.family ?? null, unit });
  }

  const summed: AmountPart[] = [...totals.entries()].map(([, total]) => {
    const steps = total.family === null ? undefined : FAMILY_STEPS[total.family];
    if (!steps) return { quantity: tidy(total.quantity), unit: total.unit };

    // The largest unit the total still fills. A step list that runs out leaves
    // the base unit, which is the last entry by construction.
    const step =
      steps.find((candidate) => total.quantity >= candidate.per) ?? steps[steps.length - 1]!;
    return { quantity: tidy(total.quantity / step.per), unit: step.unit };
  });

  for (const [key, unit] of mentions) {
    // Covered by a number: the mention adds nothing a shopper can act on.
    if (totals.has(key)) continue;
    // A bare mention with no unit either — that is an ingredient with no
    // measure at all, which is written as just its name.
    if (unit === '') continue;
    summed.push({ quantity: null, unit });
  }

  return summed;
}

/** `1.5 kg`, `3 each + 2 bunch`, or `''` when nothing was ever measured. */
export function formatParts(parts: AmountPart[]): string {
  return parts
    .map((part) => formatAmount(part))
    .filter((text) => text !== '')
    .join(' + ');
}

/* --- The grocery list ----------------------------------------------------- */

/**
 * How many days of meals to shop for. A household shops for tonight, for the
 * weekend, or for the week; offering a free number would be a keyboard on a
 * phone in a supermarket for no gain.
 */
export const GROCERY_DAY_OPTIONS = [1, 2, 3, 5, 7, 14] as const;
export const DEFAULT_GROCERY_DAYS = 7;

export const groceryQuerySchema = z.object({
  /** Defaults to today in `DISPLAY_TIMEZONE`; nobody shops for last week. */
  start: dayKeySchema.optional(),
  days: z.coerce.number().int().min(1).max(31).default(DEFAULT_GROCERY_DAYS),
});
export type GroceryQuery = z.infer<typeof groceryQuerySchema>;

export interface GroceryItem {
  /**
   * The case-folded name, and the identity a tick is stored against. Case
   * folding is what stops "Onion" bought on Tuesday reappearing as "onion" on
   * Thursday.
   */
  key: string;
  /** The spelling the recipes use most often. */
  name: string;
  amounts: AmountPart[];
  /** `amounts` rendered, so every surface shows the same string. */
  amount: string;
  /** The first day a meal calls for it — the day it has to be in the house. */
  firstNeededOn: string;
  /**
   * The last one. This is the number a shopper actually needs at the fish
   * counter: it is how long the thing has to keep, and therefore whether to
   * buy it fresh today or at all.
   */
  lastNeededOn: string;
  /** Which meals put it on the list, so an odd line can be explained. */
  dishes: string[];
  checked: boolean;
}

export interface GroceryList {
  generatedAt: string;
  timezone: string;
  /** The window shopped for, inclusive. */
  start: string;
  end: string;
  days: number;
  items: GroceryItem[];
  /** Planned dishes behind the list, so an empty one is explicable. */
  dishCount: number;
  checkedCount: number;
}

/**
 * What a tick was ticked against.
 *
 * A tick means "I have bought this", and what was bought is an amount, for a
 * set of days. Change either — a meal added, a longer shop — and the tick no
 * longer describes the line it sits on, so the item comes back unticked. That
 * errs towards asking a shopper to look twice, which is the safe direction:
 * an unexplained tick against an amount nobody bought is how a household ends
 * up at Saturday with half the fish.
 */
export function grocerySignature(item: Pick<GroceryItem, 'amount' | 'lastNeededOn'>): string {
  return `${item.amount}|${item.lastNeededOn}`;
}

export const groceryCheckSchema = z.object({
  key: z.string().trim().min(1).max(200),
  checked: z.boolean(),
});
export type GroceryCheckInput = z.infer<typeof groceryCheckSchema>;

/* --- Custom lists --------------------------------------------------------- */

export const listInputSchema = z.object({
  name: z.string().trim().min(1, 'A list needs a name').max(60),
});
export type ListInput = z.infer<typeof listInputSchema>;
export type ListInputPayload = z.input<typeof listInputSchema>;

export const listUpdateSchema = listInputSchema.partial();
export type ListUpdate = z.infer<typeof listUpdateSchema>;

/**
 * An item is an ingredient plus a tick. Same shape on purpose: "2 kg potatoes"
 * is the same thought whether it was typed onto a list or read off a recipe,
 * and sharing the schema means the unit picker and the summing agree with the
 * dish editor without a second definition to keep in step.
 */
export const listItemInputSchema = ingredientSchema.extend({
  checked: z.boolean().default(false),
});
export type ListItemInput = z.infer<typeof listItemInputSchema>;
export type ListItemInputPayload = z.input<typeof listItemInputSchema>;

export const listItemUpdateSchema = listItemInputSchema.partial();
export type ListItemUpdate = z.infer<typeof listItemUpdateSchema>;
export type ListItemUpdatePayload = z.input<typeof listItemUpdateSchema>;

export interface ListItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
  /** Rendered from the pair, the same way a grocery line is. */
  amount: string;
  checked: boolean;
  createdAt: string;
}

export interface CustomList {
  id: string;
  kind: 'custom';
  name: string;
  items: ListItem[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A list as the index page draws it: enough to show a card, not enough to
 * render the list itself.
 */
export interface ListSummary {
  id: string;
  kind: ListKind;
  name: string;
  itemCount: number;
  checkedCount: number;
  /** Derived lists cannot be renamed, emptied or deleted. */
  editable: boolean;
  /** The grocery card's "for the next N days", so it reads before it is opened. */
  note: string | null;
}

/** `4 of 11 bought` / `Nothing on it yet`, under a card and above a list. */
export function listProgressLabel(
  itemCount: number,
  checkedCount: number,
  verb = 'ticked',
): string {
  if (itemCount === 0) return 'Nothing on it yet';
  if (checkedCount === 0) return `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  if (checkedCount === itemCount) return `All ${itemCount} ${verb}`;
  return `${checkedCount} of ${itemCount} ${verb}`;
}
