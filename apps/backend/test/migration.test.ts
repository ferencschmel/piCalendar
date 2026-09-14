import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

/**
 * Migrations run once on a real installation and are unobservable afterwards,
 * so the only chance to check that a back-fill did what it claimed is here.
 */

const here = path.dirname(new URL(import.meta.url).pathname);
const migrationsDir = path.join(here, '..', 'src', 'db', 'migrations');

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/**
 * A database brought to the state *before* `upTo`, with the bookkeeping table
 * agreeing those files have been applied — so the real runner then finds
 * exactly the one migration under test pending.
 */
function databaseBefore(upTo: string): Db {
  const db = openDatabase(path.join(tempDir('picalendar-migration-'), 'test.sqlite'));
  const staged = tempDir('picalendar-staged-');

  for (const name of fs.readdirSync(migrationsDir)) {
    if (name.endsWith('.sql') && name < upTo) {
      fs.copyFileSync(path.join(migrationsDir, name), path.join(staged, name));
    }
  }
  runMigrations(db, staged);
  return db;
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('004_ingredient_units', () => {
  it('splits the old free-text amounts into a quantity and a unit', () => {
    const db = databaseBefore('004_');

    db.prepare(
      "INSERT INTO dish (id, name, created_at, updated_at) VALUES ('d1', 'Gulyás', 0, 0)",
    ).run();

    const insert = db.prepare(
      'INSERT INTO dish_ingredient (id, dish_id, position, name, amount) VALUES (?, ?, ?, ?, ?)',
    );
    const legacy: Array<[string, string]> = [
      ['Beef shin', '500 g'],
      ['Onion', '3 large'],
      ['Salt', 'a pinch'],
      ['Egg', '2'],
      ['Water', ''],
      ['Milk', '0.5 l'],
    ];
    legacy.forEach(([name, amount], index) => insert.run(`i${index}`, 'd1', index, name, amount));

    expect(runMigrations(db, migrationsDir)).toContain('004_ingredient_units.sql');

    const rows = db
      .prepare<[], { name: string; quantity: number | null; unit: string }>(
        'SELECT name, quantity, unit FROM dish_ingredient ORDER BY position',
      )
      .all();

    expect(rows).toEqual([
      { name: 'Beef shin', quantity: 500, unit: 'g' },
      { name: 'Onion', quantity: 3, unit: 'large' },
      // No leading number, so the whole string was the measure. A bare `CAST`
      // would have quietly turned this into a zero.
      { name: 'Salt', quantity: null, unit: 'a pinch' },
      { name: 'Egg', quantity: 2, unit: '' },
      { name: 'Water', quantity: null, unit: '' },
      { name: 'Milk', quantity: 0.5, unit: 'l' },
    ]);

    db.close();
  });
});
