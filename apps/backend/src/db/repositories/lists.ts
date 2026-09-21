import {
  formatAmount,
  grocerySignature,
  type CustomList,
  type GroceryItem,
  type ListInput,
  type ListItem,
  type ListItemInput,
  type ListItemUpdate,
  type ListUpdate,
} from '@picalendar/shared';
import type { Db } from '../index.js';
import { newId } from '../../util/ids.js';
import { buildGroceryItems, groceryKey, type PlannedIngredient } from '../../util/grocery.js';
import { nowEpoch, toIso } from '../../util/time.js';

interface ListRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

interface ItemRow {
  id: string;
  list_id: string;
  name: string;
  quantity: number | null;
  unit: string;
  checked_at: number | null;
  created_at: number;
}

function toItem(row: ItemRow): ListItem {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    amount: formatAmount({ quantity: row.quantity, unit: row.unit }),
    checked: row.checked_at !== null,
    createdAt: toIso(row.created_at)!,
  };
}

function itemsFor(db: Db, listIds: string[]): Map<string, ListItem[]> {
  const map = new Map<string, ListItem[]>();
  if (listIds.length === 0) return map;

  const rows = db
    .prepare<string[], ItemRow>(
      `SELECT id, list_id, name, quantity, unit, checked_at, created_at
       FROM list_item
       WHERE list_id IN (${listIds.map(() => '?').join(', ')})
       ORDER BY list_id, position`,
    )
    .all(...listIds);

  for (const row of rows) {
    const bucket = map.get(row.list_id);
    if (bucket) bucket.push(toItem(row));
    else map.set(row.list_id, [toItem(row)]);
  }
  return map;
}

function assemble(rows: ListRow[], items: Map<string, ListItem[]>): CustomList[] {
  return rows.map((row) => ({
    id: row.id,
    kind: 'custom' as const,
    name: row.name,
    items: items.get(row.id) ?? [],
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  }));
}

/**
 * Every custom list with its items, in two queries rather than one per list.
 *
 * A household has a handful of these, but the index page reads all of them at
 * once and the storage is an SD card — stitching in memory costs nothing, and
 * this is the same shape `listDishes` takes for the same reason.
 */
export function listLists(db: Db): CustomList[] {
  const rows = db
    .prepare<[], ListRow>('SELECT id, name, created_at, updated_at FROM list ORDER BY position')
    .all();
  return assemble(
    rows,
    itemsFor(
      db,
      rows.map((row) => row.id),
    ),
  );
}

export function getList(db: Db, id: string): CustomList | null {
  const row = db
    .prepare<[string], ListRow>('SELECT id, name, created_at, updated_at FROM list WHERE id = ?')
    .get(id);
  if (!row) return null;
  return assemble([row], itemsFor(db, [id]))[0] ?? null;
}

/** The list a name collision already belongs to, so a 409 can offer to open it. */
export function findListByName(db: Db, name: string): CustomList | null {
  const row = db
    .prepare<[string], { id: string }>('SELECT id FROM list WHERE name = ? COLLATE NOCASE')
    .get(name.trim());
  return row ? getList(db, row.id) : null;
}

export function createList(db: Db, input: ListInput): CustomList {
  const id = newId();
  const now = nowEpoch();
  const next = db
    .prepare<[], { next: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM list')
    .get();
  db.prepare(
    'INSERT INTO list (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, input.name, next?.next ?? 0, now, now);
  return getList(db, id)!;
}

export function updateList(db: Db, id: string, patch: ListUpdate): CustomList | null {
  const existing = getList(db, id);
  if (!existing) return null;
  db.prepare('UPDATE list SET name = ?, updated_at = ? WHERE id = ?').run(
    patch.name ?? existing.name,
    nowEpoch(),
    id,
  );
  return getList(db, id);
}

export function deleteList(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM list WHERE id = ?').run(id).changes > 0;
}

/**
 * Appends. A list is written top to bottom and read the same way, so a new
 * item belongs at the end — there is no sort to insert into.
 */
export function addItem(db: Db, listId: string, input: ListItemInput): ListItem | null {
  if (!db.prepare('SELECT 1 FROM list WHERE id = ?').get(listId)) return null;

  const id = newId();
  const now = nowEpoch();
  const next = db
    .prepare<[string], { next: number }>(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM list_item WHERE list_id = ?',
    )
    .get(listId);

  db.prepare(
    `INSERT INTO list_item (id, list_id, position, name, quantity, unit, checked_at,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    listId,
    next?.next ?? 0,
    input.name,
    input.quantity,
    input.unit,
    input.checked ? now : null,
    now,
    now,
  );

  touch(db, listId);
  return getItem(db, listId, id);
}

export function getItem(db: Db, listId: string, itemId: string): ListItem | null {
  const row = db
    .prepare<[string, string], ItemRow>(
      `SELECT id, list_id, name, quantity, unit, checked_at, created_at
       FROM list_item WHERE list_id = ? AND id = ?`,
    )
    .get(listId, itemId);
  return row ? toItem(row) : null;
}

/**
 * Ticking and editing are the same write.
 *
 * A tick is a patch of one field, which keeps the item's identity — the
 * alternative, deleting the row and re-adding it ticked, loses its place in
 * the list and would reorder the page under the finger that tapped it.
 */
export function updateItem(
  db: Db,
  listId: string,
  itemId: string,
  patch: ListItemUpdate,
): ListItem | null {
  const existing = getItem(db, listId, itemId);
  if (!existing) return null;

  const now = nowEpoch();
  const checked = patch.checked ?? existing.checked;

  db.prepare(
    `UPDATE list_item SET name = @name, quantity = @quantity, unit = @unit,
       checked_at = CASE WHEN @checked = 0 THEN NULL
                         -- Re-ticking an already ticked item leaves the
                         -- original time alone: nothing was bought twice.
                         ELSE COALESCE(checked_at, @now) END,
       updated_at = @now
     WHERE id = @id`,
  ).run({
    id: itemId,
    name: patch.name ?? existing.name,
    quantity: patch.quantity === undefined ? existing.quantity : patch.quantity,
    unit: patch.unit ?? existing.unit,
    checked: checked ? 1 : 0,
    now,
  });

  touch(db, listId);
  return getItem(db, listId, itemId);
}

export function deleteItem(db: Db, listId: string, itemId: string): boolean {
  const removed =
    db.prepare('DELETE FROM list_item WHERE list_id = ? AND id = ?').run(listId, itemId).changes >
    0;
  if (removed) touch(db, listId);
  return removed;
}

/** Everything already bought, off the list in one tap. Returns how many went. */
export function clearCheckedItems(db: Db, listId: string): number {
  const removed = db
    .prepare('DELETE FROM list_item WHERE list_id = ? AND checked_at IS NOT NULL')
    .run(listId).changes;
  if (removed > 0) touch(db, listId);
  return removed;
}

/** The list's own timestamp follows its items — the card shows when it moved. */
function touch(db: Db, listId: string): void {
  db.prepare('UPDATE list SET updated_at = ? WHERE id = ?').run(nowEpoch(), listId);
}

/* --- The grocery list ----------------------------------------------------- */

/**
 * Every recipe line of every meal planned between two day keys.
 *
 * One indexed range scan over `menu_entry`, joined out to the recipes. The
 * keys are `YYYY-MM-DD` and therefore sort chronologically as text, which is
 * the same property the agenda's range scan leans on — and, unlike the
 * occurrence table, there is no rolling window to fall off the end of.
 *
 * Ingredients with no name are skipped in SQL rather than in the caller: a
 * blank trailing row is what the dish editor leaves behind when a cook stops
 * typing, and it is not an ingredient.
 */
export function plannedIngredients(db: Db, startKey: string, endKey: string): PlannedIngredient[] {
  return db
    .prepare<[string, string], PlannedIngredient>(
      `SELECT e.day_key AS dayKey, d.name AS dishName,
              i.name, i.quantity, i.unit
       FROM menu_entry e
       JOIN dish d ON d.id = e.dish_id
       JOIN dish_ingredient i ON i.dish_id = d.id
       WHERE e.day_key BETWEEN ? AND ? AND TRIM(i.name) != ''
       ORDER BY e.day_key, e.position, i.position`,
    )
    .all(startKey, endKey);
}

/** How many meals are behind the list, so an empty one is explicable. */
export function plannedDishCount(db: Db, startKey: string, endKey: string): number {
  const row = db
    .prepare<[string, string], { count: number }>(
      'SELECT COUNT(*) AS count FROM menu_entry WHERE day_key BETWEEN ? AND ?',
    )
    .get(startKey, endKey);
  return row?.count ?? 0;
}

/**
 * The grocery list for a window: the menu's ingredients, added up and ticked.
 *
 * Both reads happen here so the pure aggregation in `util/grocery.ts` stays a
 * function over rows, and so a list is one pair of queries rather than one per
 * line.
 */
export function groceryItems(db: Db, startKey: string, endKey: string): GroceryItem[] {
  const checks = new Map(
    db
      .prepare<[], { name_key: string; signature: string }>(
        'SELECT name_key, signature FROM grocery_check',
      )
      .all()
      .map((row) => [row.name_key, row.signature]),
  );

  return buildGroceryItems(
    plannedIngredients(db, startKey, endKey),
    (item) => checks.get(item.key) === grocerySignature(item),
  );
}

/**
 * Ticks older than this are dropped whenever one is written.
 *
 * A tick has no owning row to be cascaded away by — the line it was made
 * against stops existing the moment the meal is eaten — so the table would
 * otherwise grow by one row per distinct ingredient the household ever buys.
 * A month is well past the longest shop this list offers, so nothing a
 * shopper could still be looking at is ever swept up.
 */
const CHECK_RETENTION_SECONDS = 30 * 86_400;

export function setGroceryCheck(db: Db, key: string, signature: string, checked: boolean): void {
  const folded = groceryKey(key);
  const now = nowEpoch();

  db.transaction(() => {
    if (checked) {
      db.prepare(
        `INSERT INTO grocery_check (name_key, signature, checked_at) VALUES (?, ?, ?)
         ON CONFLICT (name_key) DO UPDATE SET signature = excluded.signature,
                                              checked_at = excluded.checked_at`,
      ).run(folded, signature, now);
    } else {
      db.prepare('DELETE FROM grocery_check WHERE name_key = ?').run(folded);
    }

    db.prepare('DELETE FROM grocery_check WHERE checked_at < ?').run(now - CHECK_RETENTION_SECONDS);
  })();
}

/** Every tick off at once, for the start of a fresh shop. */
export function clearGroceryChecks(db: Db): number {
  return db.prepare('DELETE FROM grocery_check').run().changes;
}
