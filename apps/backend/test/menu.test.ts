import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AgendaResponse,
  Dish,
  IngredientSuggestion,
  MenuResponse,
  PlannedDish,
  Wish,
} from '@picalendar/shared';
import { formatAmount, lastCookedLabel } from '@picalendar/shared';
import { closeDb, getDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { createServer } from '../src/server.js';
import { entriesByDay, type DatedPlannedDish } from '../src/util/menu.js';
import { dayKeyRange } from '../src/util/time.js';

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

async function addDish(name: string, extra: Record<string, unknown> = {}): Promise<Dish> {
  const { body } = await call<{ dish: Dish }>('/dishes', {
    method: 'POST',
    body: JSON.stringify({ name, ...extra }),
  });
  return body.dish;
}

async function plan(dayKey: string, dishId: string, extra: Record<string, unknown> = {}) {
  return call<{ entry: PlannedDish }>('/menu', {
    method: 'POST',
    body: JSON.stringify({ dayKey, dishId, ...extra }),
  });
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
  getDb().exec('DELETE FROM dish; DELETE FROM person;');
});

/** Minimal planned dish, for the pure bucketing tests. */
function planned(
  date: string,
  name: string,
  over: Partial<DatedPlannedDish> = {},
): DatedPlannedDish {
  return {
    date,
    entryId: `entry-${name}-${date}-${over.meal ?? 'dinner'}`,
    dishId: `dish-${name}`,
    name,
    meal: 'dinner',
    course: 'main',
    icon: 'bi-egg-fried',
    color: '#1b6a57',
    note: null,
    hasRecipe: false,
    ...over,
  };
}

describe('entriesByDay', () => {
  it('buckets each dish onto its own day and leaves the rest empty', () => {
    const days = dayKeyRange('2026-09-14', 3);
    const buckets = entriesByDay(
      [planned('2026-09-14', 'Gulyás'), planned('2026-09-16', 'Halászlé')],
      days,
    );

    expect(buckets.get('2026-09-14')?.map((e) => e.name)).toEqual(['Gulyás']);
    expect(buckets.get('2026-09-15')).toEqual([]);
    expect(buckets.get('2026-09-16')?.map((e) => e.name)).toEqual(['Halászlé']);
  });

  it('sorts a day into serving order: meal first, then course', () => {
    const buckets = entriesByDay(
      [
        planned('2026-09-14', 'Somlói', { meal: 'dinner', course: 'dessert' }),
        planned('2026-09-14', 'Rántott hús', { meal: 'dinner', course: 'main' }),
        planned('2026-09-14', 'Tea', { meal: 'breakfast', course: 'drink' }),
        planned('2026-09-14', 'Húsleves', { meal: 'dinner', course: 'soup' }),
        planned('2026-09-14', 'Szendvics', { meal: 'lunch', course: 'main' }),
      ],
      dayKeyRange('2026-09-14', 1),
    );

    expect(buckets.get('2026-09-14')?.map((e) => e.name)).toEqual([
      'Tea',
      'Szendvics',
      'Húsleves',
      'Rántott hús',
      'Somlói',
    ]);
  });

  it('keeps two dishes of the same course in the order they were planned', () => {
    // Position order arrives from SQL; the sort must be stable across ties or
    // two sides at one dinner would swap places between polls.
    const buckets = entriesByDay(
      [
        planned('2026-09-14', 'Uborkasaláta', { course: 'side' }),
        planned('2026-09-14', 'Rizs', { course: 'side' }),
      ],
      dayKeyRange('2026-09-14', 1),
    );
    expect(buckets.get('2026-09-14')?.map((e) => e.name)).toEqual(['Uborkasaláta', 'Rizs']);
  });

  it('drops an entry whose day was not asked for rather than inventing a bucket', () => {
    const buckets = entriesByDay([planned('2026-10-01', 'Lecsó')], dayKeyRange('2026-09-14', 3));
    expect([...buckets.values()].flat()).toEqual([]);
  });

  /**
   * The whole point of storing a civil day key. This assertion should be
   * trivially true — which is exactly why it is worth pinning, because the day
   * a timezone conversion sneaks into the menu path is the day it stops being.
   * CI runs this file under UTC, Pacific/Auckland, America/Los_Angeles and
   * Asia/Kolkata.
   */
  it('places a dish on its own day whatever the process timezone is', () => {
    const buckets = entriesByDay([planned('2026-09-14', 'Gulyás')], dayKeyRange('2026-09-13', 3));
    expect(buckets.get('2026-09-14')?.map((e) => e.name)).toEqual(['Gulyás']);
    expect(buckets.get('2026-09-13')).toEqual([]);
    expect(buckets.get('2026-09-15')).toEqual([]);
  });
});

describe('lastCookedLabel', () => {
  it('reads as a household would say it', () => {
    expect(lastCookedLabel(null, '2026-09-14')).toBe('never');
    expect(lastCookedLabel('2026-09-14', '2026-09-14')).toBe('today');
    expect(lastCookedLabel('2026-09-13', '2026-09-14')).toBe('yesterday');
    expect(lastCookedLabel('2026-09-02', '2026-09-14')).toBe('12 days ago');
    expect(lastCookedLabel('2026-06-14', '2026-09-14')).toBe('3 months ago');
    expect(lastCookedLabel('2024-01-01', '2026-09-14')).toBe('over a year ago');
  });

  it('says so when the dish is already planned ahead', () => {
    expect(lastCookedLabel('2026-09-15', '2026-09-14')).toBe('tomorrow');
    expect(lastCookedLabel('2026-09-17', '2026-09-14')).toBe('in 3 days');
  });
});

describe('dish library', () => {
  it('round-trips a dish with its ingredients in order', async () => {
    const dish = await addDish('Gulyás', {
      recipe: 'Brown the onions slowly.',
      defaultCourse: 'main',
      ingredients: [
        { name: 'Beef shin', quantity: 500, unit: 'g' },
        { name: 'Onion', quantity: 3, unit: 'each' },
        { name: 'Sweet paprika', quantity: 2, unit: 'tbsp' },
      ],
    });

    expect(dish.ingredients.map((i) => i.name)).toEqual(['Beef shin', 'Onion', 'Sweet paprika']);
    expect(dish.ingredients[0]).toEqual({ name: 'Beef shin', quantity: 500, unit: 'g' });
    expect(dish.lastCookedOn).toBeNull();
    expect(dish.timesCooked).toBe(0);
  });

  it('answers 409 with the existing dish when the name is already taken', async () => {
    await addDish('Gulyás');
    const { status, body } = await call<{ dish: Dish }>('/dishes', {
      method: 'POST',
      body: JSON.stringify({ name: ' gulyás ' }),
    });

    expect(status).toBe(409);
    // The existing dish comes back so the page can offer to open it rather
    // than leaving the cook retyping a name that cannot be saved.
    expect(body.dish.name).toBe('Gulyás');
  });

  it('replaces ingredients only when they are sent', async () => {
    const dish = await addDish('Lecsó', {
      ingredients: [{ name: 'Pepper', quantity: 4, unit: 'each' }],
    });

    const renamed = await call<{ dish: Dish }>(`/dishes/${dish.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Lecsó tojással' }),
    });
    expect(renamed.body.dish.ingredients).toHaveLength(1);

    const cleared = await call<{ dish: Dish }>(`/dishes/${dish.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ingredients: [] }),
    });
    expect(cleared.body.dish.ingredients).toEqual([]);
  });

  it('keeps an ingredient nobody measures', async () => {
    // "Salt, a pinch" and "parsley, to taste" are real lines in a real recipe.
    // A missing number must stay missing rather than becoming a zero.
    const dish = await addDish('Sült krumpli', {
      ingredients: [
        { name: 'Potato', quantity: 1, unit: 'kg' },
        { name: 'Salt', unit: 'pinch' },
        { name: 'Rosemary' },
      ],
    });

    expect(dish.ingredients).toEqual([
      { name: 'Potato', quantity: 1, unit: 'kg' },
      { name: 'Salt', quantity: null, unit: 'pinch' },
      { name: 'Rosemary', quantity: null, unit: '' },
    ]);
  });

  it('reports what a delete would take with it', async () => {
    const dish = await addDish('Halászlé');
    await plan('2026-09-14', dish.id);
    await plan('2026-09-20', dish.id);

    const { body } = await call<{ removed: { timesCooked: number } }>(`/dishes/${dish.id}`, {
      method: 'DELETE',
    });
    expect(body.removed.timesCooked).toBe(2);

    // The cascade must take the planned entries with it, or the agenda joins
    // against a dish that no longer exists.
    const menu = await call<MenuResponse>('/menu?start=2026-09-14&days=7');
    expect(menu.body.days.flatMap((d) => d.entries)).toEqual([]);
  });
});

describe('ingredient autocomplete', () => {
  it('offers every distinct ingredient, commonest first', async () => {
    await addDish('Gulyás', {
      ingredients: [
        { name: 'Onion', quantity: 3, unit: 'each' },
        { name: 'Beef shin', quantity: 500, unit: 'g' },
      ],
    });
    await addDish('Lecsó', {
      ingredients: [
        { name: 'Onion', quantity: 2, unit: 'each' },
        { name: 'Pepper', quantity: 4, unit: 'each' },
      ],
    });

    const { body } = await call<{ ingredients: IngredientSuggestion[] }>('/dishes/ingredients');
    expect(body.ingredients[0]).toEqual({ name: 'Onion', unit: 'each', uses: 2 });
    expect(body.ingredients.map((i) => i.name).sort()).toEqual(['Beef shin', 'Onion', 'Pepper']);
  });

  it('folds spellings that differ only in case into one suggestion', async () => {
    // Otherwise the list that exists to stop "Onion" and "onion" becoming two
    // unrelated ingredients would itself offer them as two.
    await addDish('A', { ingredients: [{ name: 'Onion', quantity: 1, unit: 'each' }] });
    await addDish('B', { ingredients: [{ name: 'onion', quantity: 2, unit: 'each' }] });

    const { body } = await call<{ ingredients: IngredientSuggestion[] }>('/dishes/ingredients');
    expect(body.ingredients).toEqual([{ name: 'Onion', unit: 'each', uses: 2 }]);
  });

  it('suggests the unit an ingredient is usually measured in, ignoring blanks', async () => {
    // A blank unit is the absence of an answer, not an answer of its own, so
    // four unmeasured uses must not outvote the one dish that says grams.
    await addDish('A', { ingredients: [{ name: 'Beef', quantity: 1 }] });
    await addDish('B', { ingredients: [{ name: 'Beef', quantity: 2 }] });
    await addDish('C', { ingredients: [{ name: 'Beef', quantity: 500, unit: 'g' }] });

    const { body } = await call<{ ingredients: IngredientSuggestion[] }>('/dishes/ingredients');
    expect(body.ingredients[0]?.unit).toBe('g');
  });

  it('is not mistaken for a dish called "ingredients"', async () => {
    // `/dishes/:id` is registered after this route; if that order ever flips,
    // the autocomplete starts answering 404 and the editor silently loses it.
    const { status } = await call<{ ingredients: IngredientSuggestion[] }>('/dishes/ingredients');
    expect(status).toBe(200);
  });
});

describe('formatAmount', () => {
  it('reads the way a recipe card does', () => {
    expect(formatAmount({ quantity: 500, unit: 'g' })).toBe('500 g');
    expect(formatAmount({ quantity: 0.5, unit: 'l' })).toBe('0.5 l');
    expect(formatAmount({ quantity: 3, unit: '' })).toBe('3');
    expect(formatAmount({ quantity: null, unit: 'a pinch' })).toBe('a pinch');
    expect(formatAmount({ quantity: null, unit: '' })).toBe('');
  });
});

describe('planning', () => {
  it('falls back to the dish default course so a drop is one decision', async () => {
    const soup = await addDish('Húsleves', { defaultCourse: 'soup' });
    const { status, body } = await plan('2026-09-14', soup.id);

    expect(status).toBe(201);
    expect(body.entry.course).toBe('soup');
    expect(body.entry.meal).toBe('dinner');
  });

  it('plans the same dish on as many days as the household likes', async () => {
    // A pot of something is eaten on Monday and again on Thursday. Nothing
    // about this is a conflict, and it must never be reported as one.
    const dish = await addDish('Pörkölt');
    for (const day of ['2026-09-14', '2026-09-15', '2026-09-17', '2026-10-01']) {
      expect((await plan(day, dish.id)).status).toBe(201);
    }

    const { body } = await call<MenuResponse>('/menu?start=2026-09-14&days=7');
    expect(body.days.filter((d) => d.entries.length > 0).map((d) => d.date)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-17',
    ]);
  });

  it('answers a repeat at the same sitting with the entry already there', async () => {
    const dish = await addDish('Pizza');
    const first = await plan('2026-09-14', dish.id, { meal: 'dinner' });
    const repeat = await call<{ entry: PlannedDish; alreadyPlanned: boolean }>('/menu', {
      method: 'POST',
      body: JSON.stringify({ dayKey: '2026-09-14', dishId: dish.id, meal: 'dinner' }),
    });

    // Not an error: the dish is planned, which is what the person asked for.
    // A conflict warning would report a failure for an outcome they have.
    expect(repeat.status).toBe(200);
    expect(repeat.body.alreadyPlanned).toBe(true);
    expect(repeat.body.entry.entryId).toBe(first.body.entry.entryId);

    const { body } = await call<MenuResponse>('/menu?start=2026-09-14&days=1');
    expect(body.days[0]?.entries).toHaveLength(1);
  });

  it('allows the same dish at a different meal on the same day', async () => {
    // Yesterday's stew reheated for lunch and served again at dinner is a real
    // plan, so the uniqueness is scoped to the meal and not to the day.
    const dish = await addDish('Pörkölt');
    expect((await plan('2026-09-14', dish.id, { meal: 'lunch' })).status).toBe(201);
    expect((await plan('2026-09-14', dish.id, { meal: 'dinner' })).status).toBe(201);
  });

  it('moves an entry between days without changing its identity', async () => {
    const dish = await addDish('Rakott krumpli');
    const created = await plan('2026-09-14', dish.id);
    const entryId = created.body.entry.entryId;

    const moved = await call<{ entry: PlannedDish }>(`/menu/${entryId}`, {
      method: 'PATCH',
      body: JSON.stringify({ dayKey: '2026-09-17', meal: 'lunch' }),
    });

    expect(moved.status).toBe(200);
    expect(moved.body.entry.entryId).toBe(entryId);
    expect(moved.body.entry.meal).toBe('lunch');

    const menu = await call<MenuResponse>('/menu?start=2026-09-14&days=7');
    expect(menu.body.days.find((d) => d.date === '2026-09-14')?.entries).toEqual([]);
    expect(menu.body.days.find((d) => d.date === '2026-09-17')?.entries).toHaveLength(1);
  });

  it('records when a dish was last cooked', async () => {
    const dish = await addDish('Túrós tészta');
    await plan('2026-09-14', dish.id);
    await plan('2026-09-02', dish.id);

    const { body } = await call<{ dishes: Dish[] }>('/dishes');
    expect(body.dishes[0]?.lastCookedOn).toBe('2026-09-14');
    expect(body.dishes[0]?.timesCooked).toBe(2);
  });
});

describe('wishlist', () => {
  async function addPerson(displayName: string): Promise<string> {
    const { body } = await call<{ person: { id: string } }>('/people', {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    });
    return body.person.id;
  }

  it('keeps one wish per person so two children both reading as themselves', async () => {
    const dish = await addDish('Pizza');
    const bea = await addPerson('Bea');
    const mark = await addPerson('Márk');

    await call('/menu/wishes', {
      method: 'POST',
      body: JSON.stringify({ dishId: dish.id, personId: bea }),
    });
    await call('/menu/wishes', {
      method: 'POST',
      body: JSON.stringify({ dishId: dish.id, personId: mark }),
    });

    const { body } = await call<{ wishes: Wish[] }>('/menu/wishes');
    expect(body.wishes.map((w) => w.personName).sort()).toEqual(['Bea', 'Márk']);
  });

  it('treats a repeat wish as success rather than an error', async () => {
    const dish = await addDish('Pizza');
    const bea = await addPerson('Bea');
    const payload = JSON.stringify({ dishId: dish.id, personId: bea });

    const first = await call<{ alreadyWished: boolean }>('/menu/wishes', {
      method: 'POST',
      body: payload,
    });
    const second = await call<{ alreadyWished: boolean }>('/menu/wishes', {
      method: 'POST',
      body: payload,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.alreadyWished).toBe(true);
  });

  it('fulfils the wish in the same transaction that plans it', async () => {
    const dish = await addDish('Palacsinta', { defaultCourse: 'dessert' });
    const bea = await addPerson('Bea');
    const wished = await call<{ wish: Wish }>('/menu/wishes', {
      method: 'POST',
      body: JSON.stringify({ dishId: dish.id, personId: bea }),
    });

    const { status } = await plan('2026-09-16', dish.id, { wishId: wished.body.wish.id });
    expect(status).toBe(201);

    // A planned dish still sitting on the wishlist would read as "nobody has
    // acted on this", which is the opposite of what just happened.
    const { body } = await call<{ wishes: Wish[] }>('/menu/wishes');
    expect(body.wishes).toEqual([]);
  });
});

describe('GET /api/agenda', () => {
  it('carries the day menu in serving order alongside the events', async () => {
    const soup = await addDish('Húsleves', { defaultCourse: 'soup' });
    const main = await addDish('Gulyás', { defaultCourse: 'main', recipe: 'Slowly.' });

    // Planned out of order on purpose: the response must be sorted, not echoed.
    await plan('2026-09-14', main.id);
    await plan('2026-09-14', soup.id);

    const { body } = await call<AgendaResponse>('/agenda?start=2026-09-14&days=2');
    const day = body.days.find((d) => d.date === '2026-09-14');

    expect(day?.menu.map((e) => [e.name, e.course])).toEqual([
      ['Húsleves', 'soup'],
      ['Gulyás', 'main'],
    ]);
    expect(day?.menu[1]?.hasRecipe).toBe(true);
    expect(body.days.find((d) => d.date === '2026-09-15')?.menu).toEqual([]);
  });

  it('moves the revision when a menu changes, so the wall repaints', async () => {
    const dish = await addDish('Lencseleves');
    const before = await call<AgendaResponse>('/agenda?start=2026-09-14&days=2');

    await plan('2026-09-14', dish.id);
    const after = await call<AgendaResponse>('/agenda?start=2026-09-14&days=2');

    // Ingest is the only thing that bumps `agenda_revision`, so without the
    // menu segment a client skipping unchanged repaints would keep showing a
    // dinner it has just been told about — or one it has been told to cancel.
    expect(after.body.revision).not.toBe(before.body.revision);
  });

  it('shows the menu regardless of who presence reports', async () => {
    const dish = await addDish('Lecsó');
    await plan('2026-09-14', dish.id);

    const { body } = await call<{ person: { id: string } }>('/people', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Bea' }),
    });
    await call('/presence/sightings', {
      method: 'POST',
      body: JSON.stringify({ personId: body.person.id }),
    });

    // Presence selects whose *calendars* are worth the wall's attention.
    // Dinner is cooked for whoever walks in.
    const agenda = await call<AgendaResponse>('/agenda?start=2026-09-14&days=1');
    expect(agenda.body.days[0]?.menu.map((e) => e.name)).toEqual(['Lecsó']);
  });
});
