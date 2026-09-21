import { Router } from 'express';
import {
  DEFAULT_GROCERY_DAYS,
  GROCERY_LIST_ID,
  groceryCheckSchema,
  groceryQuerySchema,
  grocerySignature,
  listInputSchema,
  listItemInputSchema,
  listItemUpdateSchema,
  listUpdateSchema,
  type GroceryList,
  type ListSummary,
} from '@picalendar/shared';
import { config } from '../config/index.js';
import { getDb } from '../db/index.js';
import * as lists from '../db/repositories/lists.js';
import { HttpError } from '../middleware/errors.js';
import { pathParam } from '../util/http.js';
import type { Db } from '../db/index.js';
import { addDaysToKey, nowEpoch, toDayKey } from '../util/time.js';

/**
 * Lists: the grocery list, and whatever else the household writes down.
 *
 * Open, for the same reason the dish library and the menu are. `ADMIN_TOKEN`
 * exists to stop a passer-by editing which calendars the house subscribes to;
 * adding milk to the shopping is the interaction this feature is *for*, and
 * the phone in the supermarket holds no token.
 */
export const listsRouter: Router = Router();

/** The window a grocery request covers, as a pair of inclusive day keys. */
function groceryWindow(query: { start?: string; days: number }): { start: string; end: string } {
  const start = query.start ?? toDayKey(nowEpoch(), config.display.timezone);
  return { start, end: addDaysToKey(start, query.days - 1) };
}

function groceryList(db: Db, query: { start?: string; days: number }): GroceryList {
  const { start, end } = groceryWindow(query);
  const items = lists.groceryItems(db, start, end);

  return {
    generatedAt: new Date().toISOString(),
    timezone: config.display.timezone,
    start,
    end,
    days: query.days,
    items,
    dishCount: lists.plannedDishCount(db, start, end),
    checkedCount: items.filter((item) => item.checked).length,
  };
}

/**
 * GET /api/lists — the index: one card per list.
 *
 * The grocery list comes first and is always present. It is not a row in
 * `list` — it is derived from the menu on every request — so it is synthesised
 * here rather than selected, which is also what keeps it out of reach of the
 * mutating routes below.
 */
listsRouter.get('/', (_req, res) => {
  const db = getDb();
  const grocery = groceryList(db, { days: DEFAULT_GROCERY_DAYS });

  const summaries: ListSummary[] = [
    {
      id: GROCERY_LIST_ID,
      kind: 'grocery',
      name: 'Grocery list',
      itemCount: grocery.items.length,
      checkedCount: grocery.checkedCount,
      editable: false,
      note: `From the next ${DEFAULT_GROCERY_DAYS} days of meals`,
    },
    ...lists.listLists(db).map((list) => ({
      id: list.id,
      kind: 'custom' as const,
      name: list.name,
      itemCount: list.items.length,
      checkedCount: list.items.filter((item) => item.checked).length,
      editable: true,
      note: null,
    })),
  ];

  res.set('Cache-Control', 'no-cache');
  res.json({ lists: summaries });
});

/**
 * GET /api/lists/grocery — what to buy for the next few days.
 *
 * Registered before `/:id` deliberately: Express matches in order, and the
 * parameterised route would otherwise swallow this path and look for a custom
 * list called "grocery".
 */
listsRouter.get('/grocery', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json({ list: groceryList(getDb(), groceryQuerySchema.parse(req.query)) });
});

/**
 * Tick a grocery line, and get the list back.
 *
 * The signature a tick is stored against is derived here from the list as it
 * currently stands, never taken from the request: it is the record of what was
 * actually bought, and a client that could supply its own would be able to tick
 * an item against an amount nobody has seen. Ticking a line that is no longer
 * on the list is a 404 — the meal it came from was unplanned while the shopper
 * was walking down the aisle, and silently storing the tick would leave a row
 * that matches nothing.
 *
 * The refreshed list comes back with it so the phone makes one round trip per
 * tap rather than two.
 */
listsRouter.post('/grocery/checks', (req, res) => {
  const query = groceryQuerySchema.parse(req.query);
  const input = groceryCheckSchema.parse(req.body);
  const db = getDb();
  const { start, end } = groceryWindow(query);

  const item = lists.groceryItems(db, start, end).find((candidate) => candidate.key === input.key);
  if (!item) throw HttpError.notFound('Grocery item');

  lists.setGroceryCheck(db, item.key, grocerySignature(item), input.checked);
  res.json({ list: groceryList(db, query) });
});

/** Every tick off at once, for the start of a fresh shop. */
listsRouter.delete('/grocery/checks', (req, res) => {
  const db = getDb();
  lists.clearGroceryChecks(db);
  res.json({ list: groceryList(db, groceryQuerySchema.parse(req.query)) });
});

listsRouter.get('/:id', (req, res) => {
  const list = lists.getList(getDb(), pathParam(req, 'id'));
  if (!list) throw HttpError.notFound('List');
  res.json({ list });
});

/**
 * Checked up front rather than left to the unique index, so the response can
 * name the list that is already there — "Hardware is already a list, open it?"
 * is recoverable where a bare 409 leaves someone retyping.
 */
listsRouter.post('/', (req, res) => {
  const input = listInputSchema.parse(req.body);
  const db = getDb();

  const existing = lists.findListByName(db, input.name);
  if (existing) {
    res.status(409).json({
      error: {
        code: 'conflict',
        message: `“${existing.name}” already exists`,
        details: { name: [`Already a list called “${existing.name}”`] },
      },
      list: existing,
    });
    return;
  }

  res.status(201).json({ list: lists.createList(db, input) });
});

listsRouter.patch('/:id', (req, res) => {
  const list = lists.updateList(getDb(), pathParam(req, 'id'), listUpdateSchema.parse(req.body));
  if (!list) throw HttpError.notFound('List');
  res.json({ list });
});

listsRouter.delete('/:id', (req, res) => {
  if (!lists.deleteList(getDb(), pathParam(req, 'id'))) throw HttpError.notFound('List');
  res.status(204).end();
});

listsRouter.post('/:id/items', (req, res) => {
  const item = lists.addItem(getDb(), pathParam(req, 'id'), listItemInputSchema.parse(req.body));
  if (!item) throw HttpError.notFound('List');
  res.status(201).json({ item });
});

listsRouter.patch('/:id/items/:itemId', (req, res) => {
  const item = lists.updateItem(
    getDb(),
    pathParam(req, 'id'),
    pathParam(req, 'itemId'),
    listItemUpdateSchema.parse(req.body),
  );
  if (!item) throw HttpError.notFound('List item');
  res.json({ item });
});

listsRouter.delete('/:id/items/:itemId', (req, res) => {
  if (!lists.deleteItem(getDb(), pathParam(req, 'id'), pathParam(req, 'itemId'))) {
    throw HttpError.notFound('List item');
  }
  res.status(204).end();
});

/**
 * Everything already ticked, off the list in one tap.
 *
 * A `POST` rather than a `DELETE` on the collection: it removes some items and
 * not others, and a `DELETE /items` that leaves items behind is a route people
 * misread. The remaining list comes back so the page repaints from the server.
 */
listsRouter.post('/:id/items/clear-checked', (req, res) => {
  const db = getDb();
  const id = pathParam(req, 'id');
  const removed = lists.clearCheckedItems(db, id);
  const list = lists.getList(db, id);
  if (!list) throw HttpError.notFound('List');
  res.json({ list, removed });
});
