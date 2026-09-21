import { formatParts, sumAmounts, type AmountPart, type GroceryItem } from '@picalendar/shared';

/**
 * Turning a week of planned meals into a shopping list.
 *
 * One ingredient line per *thing to buy*, not per recipe that calls for it: a
 * shopper walks past the onions once, and a list that says "onion" three times
 * is a list that gets one of them bought.
 *
 * There is no timezone conversion anywhere in this file, and that is the point
 * rather than an omission — the same point `util/menu.ts` makes. Every date
 * here is a `YYYY-MM-DD` key that already had the display zone applied when
 * the menu was planned, and the only operations performed on one are `<` and
 * `>`, which `YYYY-MM-DD` supports by construction.
 */

/** One recipe line of one planned meal, as the join hands it over. */
export interface PlannedIngredient {
  dayKey: string;
  dishName: string;
  name: string;
  quantity: number | null;
  unit: string;
}

interface Bucket {
  /** Every spelling seen, and how often, so the commonest one is shown. */
  spellings: Map<string, number>;
  amounts: AmountPart[];
  firstNeededOn: string;
  lastNeededOn: string;
  dishes: Set<string>;
}

/**
 * A tick is stored against the case-folded name, so the folding has to be the
 * same everywhere or a tick lands on a line nothing draws.
 */
export function groceryKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Group, sum and date every ingredient the given meals call for.
 *
 * `isChecked` is asked rather than looked up, so the caller owns the one
 * database read and this stays a pure function over rows.
 *
 * Ordering is alphabetical. A supermarket has an order and this is not it, but
 * alphabetical is the only order a person can predict without being told, and
 * a list that reorders itself as meals are planned would be worse than one
 * that never matched the aisles in the first place.
 */
export function buildGroceryItems(
  rows: PlannedIngredient[],
  isChecked: (item: Omit<GroceryItem, 'checked'>) => boolean,
): GroceryItem[] {
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const name = row.name.trim();
    if (name === '') continue;

    const key = groceryKey(name);
    const bucket = buckets.get(key);

    if (!bucket) {
      buckets.set(key, {
        spellings: new Map([[name, 1]]),
        amounts: [{ quantity: row.quantity, unit: row.unit }],
        firstNeededOn: row.dayKey,
        lastNeededOn: row.dayKey,
        dishes: new Set([row.dishName]),
      });
      continue;
    }

    bucket.spellings.set(name, (bucket.spellings.get(name) ?? 0) + 1);
    bucket.amounts.push({ quantity: row.quantity, unit: row.unit });
    if (row.dayKey < bucket.firstNeededOn) bucket.firstNeededOn = row.dayKey;
    if (row.dayKey > bucket.lastNeededOn) bucket.lastNeededOn = row.dayKey;
    bucket.dishes.add(row.dishName);
  }

  const items = [...buckets.entries()].map(([key, bucket]) => {
    const amounts = sumAmounts(bucket.amounts);
    const partial: Omit<GroceryItem, 'checked'> = {
      key,
      name: commonestSpelling(bucket.spellings),
      amounts,
      amount: formatParts(amounts),
      firstNeededOn: bucket.firstNeededOn,
      lastNeededOn: bucket.lastNeededOn,
      dishes: [...bucket.dishes].sort((a, b) => a.localeCompare(b)),
    };
    return { ...partial, checked: isChecked(partial) };
  });

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whichever way the household usually writes it. Ties fall to the
 * alphabetically first spelling rather than to whichever recipe was saved
 * first, so the list does not change its mind when an unrelated dish is added.
 */
function commonestSpelling(spellings: Map<string, number>): string {
  let best = '';
  let bestCount = 0;
  for (const [spelling, count] of spellings) {
    if (count > bestCount || (count === bestCount && spelling.localeCompare(best) < 0)) {
      best = spelling;
      bestCount = count;
    }
  }
  return best;
}
