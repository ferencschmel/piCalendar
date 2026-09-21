import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomList, Dish, GroceryList, ListItem, ListSummary } from '@picalendar/shared';
import { formatParts, sumAmounts } from '@picalendar/shared';
import { closeDb, getDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { createServer } from '../src/server.js';
import { buildGroceryItems, type PlannedIngredient } from '../src/util/grocery.js';
import { nowEpoch, toDayKey } from '../src/util/time.js';

let server: Server;
let base: string;

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body: body as T };
}

async function addDish(name: string, ingredients: unknown[]): Promise<Dish> {
  const { body } = await call<{ dish: Dish }>('/dishes', {
    method: 'POST',
    body: JSON.stringify({ name, ingredients }),
  });
  return body.dish;
}

async function plan(dayKey: string, dishId: string): Promise<void> {
  await call('/menu', { method: 'POST', body: JSON.stringify({ dayKey, dishId }) });
}

/** The window every grocery assertion below shops for. */
const START = '2026-03-02';
const WINDOW = `start=${START}&days=7`;

async function grocery(query = WINDOW): Promise<GroceryList> {
  const { body } = await call<{ list: GroceryList }>(`/lists/grocery?${query}`);
  return body.list;
}

beforeAll(async () => {
  runMigrations(getDb());
  server = createServer().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
});

beforeEach(() => {
  getDb().exec('DELETE FROM dish; DELETE FROM list; DELETE FROM grocery_check;');
});

describe('sumAmounts', () => {
  it('adds quantities that share a scale and presents the largest unit that fills', () => {
    expect(
      sumAmounts([
        { quantity: 500, unit: 'g' },
        { quantity: 1, unit: 'kg' },
      ]),
    ).toEqual([{ quantity: 1.5, unit: 'kg' }]);

    // Still short of a kilo, so it stays in grams rather than reading "0.8 kg".
    expect(
      sumAmounts([
        { quantity: 300, unit: 'g' },
        { quantity: 500, unit: 'g' },
      ]),
    ).toEqual([{ quantity: 800, unit: 'g' }]);

    expect(
      sumAmounts([
        { quantity: 5, unit: 'dl' },
        { quantity: 1, unit: 'l' },
      ]),
    ).toEqual([{ quantity: 1.5, unit: 'l' }]);
  });

  it('keeps units it cannot honestly convert as separate parts', () => {
    const parts = sumAmounts([
      { quantity: 3, unit: 'each' },
      { quantity: 2, unit: 'bunch' },
      { quantity: 1, unit: 'each' },
    ]);
    expect(parts).toEqual([
      { quantity: 4, unit: 'each' },
      { quantity: 2, unit: 'bunch' },
    ]);
    expect(formatParts(parts)).toBe('4 each + 2 bunch');

    // Grams and ounces are the same measure in different systems, and which
    // answer is right depends on the country. They stay apart.
    expect(
      sumAmounts([
        { quantity: 500, unit: 'g' },
        { quantity: 4, unit: 'oz' },
      ]),
    ).toEqual([
      { quantity: 500, unit: 'g' },
      { quantity: 4, unit: 'oz' },
    ]);
  });

  it('drops an unmeasured mention that a measured one already covers', () => {
    expect(
      sumAmounts([
        { quantity: 500, unit: 'g' },
        { quantity: null, unit: 'kg' },
      ]),
    ).toEqual([{ quantity: 500, unit: 'g' }]);

    // Nothing measured it, so the words survive.
    expect(sumAmounts([{ quantity: null, unit: 'a pinch' }])).toEqual([
      { quantity: null, unit: 'a pinch' },
    ]);

    // No measure at all is an ingredient written as just its name.
    expect(sumAmounts([{ quantity: null, unit: '' }])).toEqual([]);
  });
});

describe('buildGroceryItems', () => {
  const rows = (over: Partial<PlannedIngredient>[]): PlannedIngredient[] =>
    over.map((row) => ({
      dayKey: '2026-03-02',
      dishName: 'Gulyás',
      name: 'Onion',
      quantity: 1,
      unit: 'each',
      ...row,
    }));

  it('dates each line by the first and last meal that calls for it', () => {
    const items = buildGroceryItems(
      rows([
        { dayKey: '2026-03-05', name: 'Salmon', quantity: 400, unit: 'g', dishName: 'Baked fish' },
        { dayKey: '2026-03-02', name: 'Salmon', quantity: 300, unit: 'g', dishName: 'Fishcakes' },
      ]),
      () => false,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'salmon',
      name: 'Salmon',
      amount: '700 g',
      firstNeededOn: '2026-03-02',
      lastNeededOn: '2026-03-05',
      dishes: ['Baked fish', 'Fishcakes'],
    });
  });

  it('folds spellings together and shows the commonest one', () => {
    const items = buildGroceryItems(
      rows([{ name: 'onion' }, { name: 'Onion' }, { name: 'onion' }]),
      () => false,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'onion', name: 'onion', amount: '3 each' });
  });
});

describe('GET /api/lists/grocery', () => {
  it('sums the ingredients of everything planned in the window', async () => {
    const stew = await addDish('Beef stew', [
      { name: 'Beef shin', quantity: 500, unit: 'g' },
      { name: 'Onion', quantity: 2, unit: 'each' },
    ]);
    const soup = await addDish('Onion soup', [
      { name: 'Onion', quantity: 6, unit: 'each' },
      { name: 'Butter', quantity: 50, unit: 'g' },
    ]);

    await plan('2026-03-03', stew.id);
    await plan('2026-03-06', soup.id);

    const list = await grocery();
    expect(list.start).toBe('2026-03-02');
    expect(list.end).toBe('2026-03-08');
    expect(list.dishCount).toBe(2);

    // Alphabetical, and one line per thing to buy.
    expect(list.items.map((item) => `${item.name} ${item.amount}`)).toEqual([
      'Beef shin 500 g',
      'Butter 50 g',
      'Onion 8 each',
    ]);

    const onion = list.items.find((item) => item.key === 'onion')!;
    expect(onion.firstNeededOn).toBe('2026-03-03');
    expect(onion.lastNeededOn).toBe('2026-03-06');
    expect(onion.dishes).toEqual(['Beef stew', 'Onion soup']);
  });

  it('shops only the days asked for', async () => {
    const stew = await addDish('Beef stew', [{ name: 'Beef shin', quantity: 500, unit: 'g' }]);
    const soup = await addDish('Onion soup', [{ name: 'Onion', quantity: 6, unit: 'each' }]);
    await plan('2026-03-02', stew.id);
    await plan('2026-03-06', soup.id);

    const tonight = await grocery(`start=${START}&days=1`);
    expect(tonight.end).toBe('2026-03-02');
    expect(tonight.items.map((item) => item.name)).toEqual(['Beef shin']);
  });

  it('starts from today when no start is given', async () => {
    const dish = await addDish('Porridge', [{ name: 'Oats', quantity: 100, unit: 'g' }]);
    const today = toDayKey(nowEpoch(), 'Europe/Budapest');
    await plan(today, dish.id);

    const list = await grocery('days=1');
    expect(list.start).toBe(today);
    expect(list.items.map((item) => item.name)).toEqual(['Oats']);
  });

  /**
   * The day keys planned are the day keys shopped. Both sides of every
   * comparison in this path are already keys, so there is nothing here for a
   * timezone to shift — and this assertion holds identically under all four
   * zones CI runs the suite in. A change that makes it pass only in some is a
   * bug, not a flaky test.
   */
  it('never pushes a day key through a timezone conversion', async () => {
    const dish = await addDish('Late dinner', [{ name: 'Rice', quantity: 200, unit: 'g' }]);
    await plan('2026-03-08', dish.id);

    // The last day of the window, which is where an off-by-one zone shift
    // would drop the meal out of the list entirely.
    const list = await grocery();
    expect(list.items.map((item) => item.name)).toEqual(['Rice']);
    expect(list.items[0]?.lastNeededOn).toBe('2026-03-08');

    // And the day after it is genuinely outside.
    expect((await grocery(`start=${START}&days=6`)).items).toEqual([]);
  });
});

describe('grocery ticks', () => {
  async function stock(): Promise<void> {
    const dish = await addDish('Beef stew', [{ name: 'Beef shin', quantity: 500, unit: 'g' }]);
    await plan('2026-03-03', dish.id);
  }

  async function tick(
    key: string,
    checked: boolean,
  ): Promise<{ status: number; list: GroceryList }> {
    const { status, body } = await call<{ list: GroceryList }>(`/lists/grocery/checks?${WINDOW}`, {
      method: 'POST',
      body: JSON.stringify({ key, checked }),
    });
    return { status, list: body?.list };
  }

  it('ticks a line off and back on, and the tick survives a re-read', async () => {
    await stock();

    const ticked = await tick('beef shin', true);
    expect(ticked.status).toBe(200);
    expect(ticked.list.items[0]?.checked).toBe(true);
    expect(ticked.list.checkedCount).toBe(1);

    expect((await grocery()).items[0]?.checked).toBe(true);

    expect((await tick('beef shin', false)).list.items[0]?.checked).toBe(false);
    expect((await grocery()).items[0]?.checked).toBe(false);
  });

  /**
   * The case that makes the signature worth storing. A tick records an amount
   * bought; planning a second stew doubles what is needed, and a tick left
   * standing would send the shopper home with half of it.
   */
  it('unticks a line when the amount needed changes under it', async () => {
    await stock();
    await tick('beef shin', true);

    const second = await addDish('Goulash', [{ name: 'Beef shin', quantity: 400, unit: 'g' }]);
    await plan('2026-03-05', second.id);

    const list = await grocery();
    expect(list.items[0]?.amount).toBe('900 g');
    expect(list.items[0]?.checked).toBe(false);
  });

  it('refuses a tick on a line that is no longer on the list', async () => {
    await stock();
    const { status } = await call('/lists/grocery/checks?' + WINDOW, {
      method: 'POST',
      body: JSON.stringify({ key: 'saffron', checked: true }),
    });
    expect(status).toBe(404);
  });

  it('clears every tick for a fresh shop', async () => {
    await stock();
    await tick('beef shin', true);

    const { status, body } = await call<{ list: GroceryList }>(`/lists/grocery/checks?${WINDOW}`, {
      method: 'DELETE',
    });
    expect(status).toBe(200);
    expect(body.list.checkedCount).toBe(0);
  });
});

describe('custom lists', () => {
  async function makeList(name = 'Hardware'): Promise<CustomList> {
    const { body } = await call<{ list: CustomList }>('/lists', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return body.list;
  }

  async function addItem(listId: string, item: Record<string, unknown>): Promise<ListItem> {
    const { body } = await call<{ item: ListItem }>(`/lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify(item),
    });
    return body.item;
  }

  it('creates a list, fills it, ticks an item and empties the ticked ones', async () => {
    const list = await makeList();
    expect(list.items).toEqual([]);

    await addItem(list.id, { name: 'Screws', quantity: 20, unit: 'each' });
    const paint = await addItem(list.id, { name: 'Paint', quantity: 2.5, unit: 'l' });
    expect(paint.amount).toBe('2.5 l');

    const ticked = await call<{ item: ListItem }>(`/lists/${list.id}/items/${paint.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ checked: true }),
    });
    expect(ticked.body.item.checked).toBe(true);

    const cleared = await call<{ list: CustomList; removed: number }>(
      `/lists/${list.id}/items/clear-checked`,
      { method: 'POST' },
    );
    expect(cleared.body.removed).toBe(1);
    expect(cleared.body.list.items.map((item) => item.name)).toEqual(['Screws']);
  });

  it('keeps items in the order they were written', async () => {
    const list = await makeList();
    for (const name of ['Milk', 'Bread', 'Apples']) await addItem(list.id, { name });

    const { body } = await call<{ list: CustomList }>(`/lists/${list.id}`);
    expect(body.list.items.map((item) => item.name)).toEqual(['Milk', 'Bread', 'Apples']);
    // No number is a real line on a shopping list, and not a zero.
    expect(body.list.items[0]).toMatchObject({ quantity: null, unit: '', amount: '' });
  });

  it('names the existing list rather than failing an identical name', async () => {
    const first = await makeList('Hardware');
    const { status, body } = await call<{ list: CustomList }>('/lists', {
      method: 'POST',
      body: JSON.stringify({ name: 'hardware' }),
    });
    expect(status).toBe(409);
    expect(body.list.id).toBe(first.id);
  });

  it('renames and deletes, and taking the list takes its items', async () => {
    const list = await makeList();
    await addItem(list.id, { name: 'Screws' });

    const renamed = await call<{ list: CustomList }>(`/lists/${list.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Garage' }),
    });
    expect(renamed.body.list.name).toBe('Garage');

    expect((await call(`/lists/${list.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/lists/${list.id}`)).status).toBe(404);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM list_item').get()).toEqual({ n: 0 });
  });
});

describe('GET /api/lists', () => {
  it('puts the grocery list first and marks it underivable from a row', async () => {
    await call('/lists', { method: 'POST', body: JSON.stringify({ name: 'Hardware' }) });

    const { body } = await call<{ lists: ListSummary[] }>('/lists');
    expect(body.lists.map((list) => list.id)).toEqual(['grocery', expect.any(String)]);
    expect(body.lists[0]).toMatchObject({ kind: 'grocery', editable: false });
    expect(body.lists[1]).toMatchObject({ kind: 'custom', name: 'Hardware', editable: true });
  });

  /** The grocery list has no row, so the mutating routes cannot reach it. */
  it('does not let the grocery list be renamed or deleted', async () => {
    expect(
      (
        await call('/lists/grocery', {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Nope' }),
        })
      ).status,
    ).toBe(404);
    expect((await call('/lists/grocery', { method: 'DELETE' })).status).toBe(404);
  });
});
